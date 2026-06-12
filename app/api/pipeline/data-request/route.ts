import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { orgIdForUser, scopeIcpsToUser } from '@/lib/org-context';
import { computeCriteriaHash } from '@/lib/data-acquisition/criteria-hash';
import type { PipelineDataRequestType } from '@/lib/pipeline-icp-health';
import {
  DEFAULT_ACQUISITION_TARGET_COMPANIES,
  estimateDataAcquisitionUsage,
  normalizePositiveInt,
  recordDataAcquisitionUsageEvent,
} from '@/lib/data-acquisition-metering';
import { runDataAcquisitionJob } from '@/lib/data-acquisition/job-runner';

const REQUEST_TYPES: PipelineDataRequestType[] = [
  'expand_companies',
  'better_contacts',
  'more_contacts_at_accounts',
  'contacts_at_company',
];

type CompanyContext = {
  id: string;
  company_name: string | null;
  domain: string | null;
  website: string | null;
  linkedin_url: string | null;
  matched_icp_id: string | null;
};

function requestFilename(
  userId: string,
  icpId: string,
  requestType: PipelineDataRequestType,
): string {
  const day = new Date().toISOString().slice(0, 10);
  const shortUser = userId.replace(/-/g, '').slice(0, 8);
  const shortIcp = icpId.replace(/-/g, '').slice(0, 8);
  return `arcova-pipeline-${requestType}-icp-${shortIcp}-user-${shortUser}-${day}.csv`;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: {
      icpId?: string;
      requestType?: string;
      companyId?: string;
      targetCompanyCount?: number | string;
      targetContactCount?: number | string;
      maxCreditUnits?: number | string;
    };
    try {
      body = (await request.json()) as { icpId?: string; requestType?: string };
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    let icpId = typeof body.icpId === 'string' ? body.icpId.trim() : '';
    const companyId = typeof body.companyId === 'string' ? body.companyId.trim() : '';
    const requestType = body.requestType as PipelineDataRequestType;
    if (!REQUEST_TYPES.includes(requestType)) {
      return NextResponse.json({ error: 'valid requestType required' }, { status: 400 });
    }

    let companyContext: CompanyContext | null = null;

    if (requestType === 'contacts_at_company') {
      if (!companyId) {
        return NextResponse.json({ error: 'companyId required for contacts_at_company' }, { status: 400 });
      }
      const { data: company, error: companyErr } = await supabase
        .from('accounts_view')
        .select('id, company_name, domain, website, linkedin_url, matched_icp_id')
        .eq('user_id', user.id)
        .eq('id', companyId)
        .maybeSingle();

      if (companyErr || !company) {
        return NextResponse.json({ error: 'Company not found' }, { status: 404 });
      }

      companyContext = company as unknown as CompanyContext;
      icpId = icpId || companyContext.matched_icp_id || '';
    }

    if (!icpId) {
      return NextResponse.json({ error: 'icpId required' }, { status: 400 });
    }

    const targetCompanyCount = normalizePositiveInt(
      body.targetCompanyCount,
      requestType === 'expand_companies' ? DEFAULT_ACQUISITION_TARGET_COMPANIES : 0,
    );
    const targetContactCount =
      body.targetContactCount == null
        ? requestType === 'contacts_at_company'
          ? 5
          : requestType === 'better_contacts' || requestType === 'more_contacts_at_accounts'
            ? DEFAULT_ACQUISITION_TARGET_COMPANIES
            : null
        : normalizePositiveInt(body.targetContactCount, 0);
    const rawMaxCreditUnits =
      typeof body.maxCreditUnits === 'number'
        ? body.maxCreditUnits
        : typeof body.maxCreditUnits === 'string'
          ? Number.parseFloat(body.maxCreditUnits)
          : null;
    const maxCreditUnits =
      rawMaxCreditUnits != null && Number.isFinite(rawMaxCreditUnits)
        ? Math.max(0, rawMaxCreditUnits)
        : null;

    if (requestType === 'expand_companies' && targetCompanyCount <= 0) {
      return NextResponse.json({ error: 'targetCompanyCount must be greater than 0' }, { status: 400 });
    }
    if (
      (requestType === 'contacts_at_company' ||
        requestType === 'better_contacts' ||
        requestType === 'more_contacts_at_accounts') &&
      (!targetContactCount || targetContactCount <= 0)
    ) {
      return NextResponse.json({ error: 'targetContactCount must be greater than 0' }, { status: 400 });
    }

    // The ICP must be visible to this user (company-wide or their own personal) — a
    // member can buy data against a company ICP; billing is org-level.
    const reqOrgId = await orgIdForUser(supabase, user.id);
    const { data: icp, error: icpErr } = await scopeIcpsToUser(
      supabase.from('icps').select('id'),
      reqOrgId,
      user.id,
    )
      .eq('id', icpId)
      .maybeSingle();

    if (icpErr || !icp) {
      return NextResponse.json({ error: 'ICP not found' }, { status: 404 });
    }

    const filename = requestFilename(user.id, icpId, requestType);
    const estimate = estimateDataAcquisitionUsage({
      requestType,
      targetCompanyCount,
      targetContactCount: requestType === 'expand_companies' ? null : targetContactCount,
    });

    const { data: batch, error: batchErr } = await supabase
      .from('upload_batches')
      .insert({
        user_id: user.id,
        filename,
        total_rows: 0,
        status: 'processing',
        duplicate_rows: 0,
        failed_rows: 0,
        processed_rows: 0,
      })
      .select('id')
      .single();

    if (batchErr || !batch) {
      console.error('[pipeline/data-request]', batchErr);
      return NextResponse.json({ error: 'Failed to record data request' }, { status: 500 });
    }

    // Org-level concurrent-dedup gate: fingerprint the request. A partial unique index on
    // (org_id, criteria_hash) over in-flight statuses makes a duplicate insert fail with
    // 23505 — so two reps firing the SAME buy collapse to one job (race-proof at the DB).
    const criteriaHash = computeCriteriaHash({
      requestType,
      icpId,
      targetCompanyCount,
      targetContactCount: estimate.targetContactCount,
      companyId: companyContext?.id ?? null,
    });

    const { data: job, error: jobErr } = await supabase
      .from('data_acquisition_jobs')
      .insert({
        user_id: user.id,
        org_id: reqOrgId,
        criteria_hash: criteriaHash,
        icp_id: icpId,
        upload_batch_id: batch.id,
        request_type: requestType,
        source_strategy: 'apollo_first',
        status: 'queued',
        target_company_count: targetCompanyCount,
        target_contact_count: estimate.targetContactCount,
        max_screened_companies: estimate.screenedCompaniesMax,
        max_contact_enrichments: estimate.targetContactCount,
        max_credit_units: maxCreditUnits ?? estimate.estimatedMaxCreditUnits,
        estimated_min_credit_units: estimate.estimatedMinCreditUnits,
        estimated_max_credit_units: estimate.estimatedMaxCreditUnits,
        metadata: {
          estimate,
          requested_from: requestType === 'contacts_at_company' ? 'data' : 'pipeline',
          company: companyContext,
        },
      })
      .select('id')
      .single();

    if (jobErr || !job) {
      // Duplicate in-flight request for this org → attach to the existing job instead of
      // buying twice. (Only fires when org_id + criteria_hash are both set.)
      if ((jobErr as { code?: string } | null)?.code === '23505' && reqOrgId) {
        await supabase.from('upload_batches').delete().eq('id', batch.id);
        const { data: existingJob } = await supabase
          .from('data_acquisition_jobs')
          .select('id')
          .eq('org_id', reqOrgId)
          .eq('criteria_hash', criteriaHash)
          .in('status', ['queued', 'discovering', 'processing', 'importing', 'enriching'])
          .order('requested_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (existingJob?.id) {
          return NextResponse.json({
            jobId: existingJob.id as string,
            attached: true,
            message: "A teammate is already running this exact request — you'll share the results.",
          });
        }
      }
      console.error('[pipeline/data-request] job', jobErr);
      return NextResponse.json({ error: 'Failed to create acquisition job' }, { status: 500 });
    }

    const jobRequestQuantity =
      requestType === 'expand_companies'
        ? targetCompanyCount
        : estimate.targetContactCount;

    await recordDataAcquisitionUsageEvent(supabase, {
      jobId: job.id as string,
      userId: user.id,
      orgId: reqOrgId,
      eventType: 'job_requested',
      quantity: jobRequestQuantity,
      provider: 'arcova',
      metadata: {
        requestType,
        targetCompanyCount,
        targetContactCount: estimate.targetContactCount,
        companyId: companyContext?.id ?? null,
        estimate,
      },
    });

    // Sequential per-user execution: only start this job when nothing is
    // running and no older job is waiting. Otherwise it stays 'queued' and the
    // queue advancer (end of runDataAcquisitionJob) or the polling safety net
    // (GET /api/data-acquisition/jobs) starts it later. Billing caps are
    // checked when the job actually starts, not here.
    const [{ count: activeCount }, { count: queuedAheadCount }] = await Promise.all([
      supabase
        .from('data_acquisition_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .in('status', ['discovering', 'processing', 'importing', 'enriching']),
      supabase
        .from('data_acquisition_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'queued')
        .neq('id', job.id),
    ]);

    const startNow = (activeCount ?? 0) === 0 && (queuedAheadCount ?? 0) === 0;

    if (startNow) {
      const backgroundTask = () =>
        runDataAcquisitionJob(job.id as string).catch((error) => {
          console.error('[pipeline/data-request] acquisition job failed', error);
        });

      if (process.env.NODE_ENV === 'development') {
        setTimeout(() => {
          void backgroundTask();
        }, 0);
      } else {
        after(backgroundTask);
      }
    }

    return NextResponse.json({
      jobId: job.id as string,
      batchId: batch.id as string,
      filename,
      queued: !startNow,
      queuePosition: startNow ? 0 : (queuedAheadCount ?? 0) + 1,
      targetCompanyCount,
      targetContactCount: estimate.targetContactCount,
      estimatedCreditUnits: {
        min: estimate.estimatedMinCreditUnits,
        max: estimate.estimatedMaxCreditUnits,
      },
    });
  } catch (e) {
    console.error('[pipeline/data-request]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
