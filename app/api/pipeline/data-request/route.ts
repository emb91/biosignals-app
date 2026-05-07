import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase-server';
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
];

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
      targetCompanyCount?: number | string;
      targetContactCount?: number | string;
      maxCreditUnits?: number | string;
    };
    try {
      body = (await request.json()) as { icpId?: string; requestType?: string };
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const icpId = typeof body.icpId === 'string' ? body.icpId.trim() : '';
    const requestType = body.requestType as PipelineDataRequestType;
    if (!icpId || !REQUEST_TYPES.includes(requestType)) {
      return NextResponse.json({ error: 'icpId and valid requestType required' }, { status: 400 });
    }

    const targetCompanyCount = normalizePositiveInt(
      body.targetCompanyCount,
      requestType === 'expand_companies' ? DEFAULT_ACQUISITION_TARGET_COMPANIES : 0,
    );
    const targetContactCount =
      body.targetContactCount == null ? null : normalizePositiveInt(body.targetContactCount, 0);
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

    const { data: icp, error: icpErr } = await supabase
      .from('icps')
      .select('id')
      .eq('user_id', user.id)
      .eq('id', icpId)
      .maybeSingle();

    if (icpErr || !icp) {
      return NextResponse.json({ error: 'ICP not found' }, { status: 404 });
    }

    const filename = requestFilename(user.id, icpId, requestType);
    const estimate = estimateDataAcquisitionUsage({
      requestType,
      targetCompanyCount,
      targetContactCount,
    });

    const { data: batch, error: batchErr } = await supabase
      .from('upload_batches')
      .insert({
        user_id: user.id,
        filename,
        total_rows: 0,
        status: 'processing',
        duplicate_rows: 0,
        enriched_rows: 0,
        failed_rows: 0,
        processed_rows: 0,
      })
      .select('id')
      .single();

    if (batchErr || !batch) {
      console.error('[pipeline/data-request]', batchErr);
      return NextResponse.json({ error: 'Failed to record data request' }, { status: 500 });
    }

    const { data: job, error: jobErr } = await supabase
      .from('data_acquisition_jobs')
      .insert({
        user_id: user.id,
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
          requested_from: 'pipeline',
        },
      })
      .select('id')
      .single();

    if (jobErr || !job) {
      console.error('[pipeline/data-request] job', jobErr);
      return NextResponse.json({ error: 'Failed to create acquisition job' }, { status: 500 });
    }

    await recordDataAcquisitionUsageEvent(supabase, {
      jobId: job.id as string,
      userId: user.id,
      eventType: 'job_requested',
      quantity: targetCompanyCount,
      provider: 'arcova',
      metadata: {
        requestType,
        targetCompanyCount,
        targetContactCount: estimate.targetContactCount,
        estimate,
      },
    });

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

    return NextResponse.json({
      jobId: job.id as string,
      batchId: batch.id as string,
      filename,
      targetCompanyCount,
      targetContactCount: estimate.targetContactCount,
      estimatedScreenedCompanies: {
        min: estimate.screenedCompaniesMin,
        max: estimate.screenedCompaniesMax,
      },
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
