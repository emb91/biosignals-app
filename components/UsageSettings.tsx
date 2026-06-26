'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, ArrowUpRight, ChevronRight } from 'lucide-react';

type CreditBucket = {
  id: string;
  source: 'free_monthly' | 'paid_monthly' | 'annual' | 'purchased' | 'adjustment' | string;
  credits_granted: number;
  credits_remaining: number;
  valid_from: string;
  expires_at: string;
};

type UsageSummary = {
  unlimited: boolean;
  complimentary?: boolean;
  available: boolean;
  plan: { key: string; name: string; billingInterval?: 'monthly' | 'annual' };
  credits: {
    available: number;
    granted: number;
    includedAvailable?: number;
    includedGranted?: number;
    purchasedAvailable?: number;
    purchasedGranted?: number;
    adjustmentAvailable?: number;
    adjustmentGranted?: number;
    buckets?: CreditBucket[];
  };
  annualPace?: {
    monthlyCredits: number;
    annualCredits: number;
    usedCredits: number;
    monthsEquivalent: number;
    level: 'normal' | 'heads_up' | 'strong';
    message: string;
  } | null;
  capacity?: {
    storedContacts: number;
    storedContactsCap: number;
    activeMonitoredContacts: number;
    activeMonitoredContactsCap: number;
    monitoringCadenceDays: number;
  };
  activeIcps?: { used: number; limit: number };
  triage: { used: number; limit: number };
  leadEnrichmentCredits?: {
    used: number;
    included: number;
    importedContactCompanyCredits: number;
    companyOnlyCredits: number;
    netNewLeadCredits: number;
  };
  importedEnrichments: { used: number; included: number; hardCap: number };
  activeLeads: { used: number; cap: number; waitlisted: number; cadenceDays: number };
  netNewLeads: { used: number; limit: number };
  sequences: { used: number; limit: number; emailSteps?: number; linkedinAdds?: number; linkedinMessages?: number };
  phoneReveals: { used: number; limit: number };
  emailFinder: { used: number; limit: number };
};

const CARD =
  'mt-3 rounded-2xl border border-white/80 bg-white/70 p-5 shadow-[0_8px_24px_-12px_rgba(13,53,71,0.15)] backdrop-blur-xl';

type UsageSettingsProps = {
  href?: string;
  className?: string;
  showHeading?: boolean;
};

function UsageBar({ used, total, label, sublabel, unlimited }: {
  used: number; total: number; label: string; sublabel?: string; unlimited?: boolean;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div className="mt-4 first:mt-0">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        {unlimited ? (
          <span className="text-xs text-[#7d909a]">
            <span className="font-semibold text-[#0d3547]">{used.toLocaleString()}</span> used · Unlimited
          </span>
        ) : total <= 0 ? (
          <span className="text-xs text-[#7d909a]">0 available</span>
        ) : (
          <span className={`text-xs ${pct >= 100 ? 'font-semibold text-red-600' : pct >= 90 ? 'font-medium text-amber-600' : 'text-[#7d909a]'}`}>
            {used.toLocaleString()} / {total.toLocaleString()}
          </span>
        )}
      </div>
      {sublabel && <p className="mt-0.5 text-xs text-[#7d909a]">{sublabel}</p>}
      {!unlimited && total > 0 && (
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full ${pct >= 100 ? 'bg-red-500' : pct >= 90 ? 'bg-amber-500' : 'bg-[#0d3547]'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function CreditBucketRow({ label, amount, expiresAt, sublabel }: {
  label: string;
  amount: number;
  expiresAt?: string | null;
  sublabel?: string;
}) {
  return (
    <div className="mt-4 first:mt-0">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="text-right text-xs font-semibold text-[#0d3547]">
          {amount.toLocaleString()} credits
          {expiresAt ? <span className="font-normal text-[#7d909a]"> · expire {formatDate(expiresAt)}</span> : null}
        </span>
      </div>
      {sublabel && <p className="mt-0.5 text-xs text-[#7d909a]">{sublabel}</p>}
    </div>
  );
}

export default function UsageSettings({ href, className = '', showHeading = true }: UsageSettingsProps = {}) {
  const [data, setData] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const sectionClassName = className || 'mt-8';
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/billing/summary');
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <section className={sectionClassName}>
        {showHeading && <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-[#7d909a]">Usage</h2>}
        <div className={`${CARD} flex items-center gap-2 text-sm text-[#7d909a]`}>
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      </section>
    );
  }
  if (!data) return null;

  const unlimited = data.unlimited;
  const includedGranted = data.credits.includedGranted ?? data.credits.granted;
  const includedAvailable = data.credits.includedAvailable ?? data.credits.available;
  const includedUsed = Math.max(0, includedGranted - includedAvailable);
  const purchasedGranted = data.credits.purchasedGranted ?? 0;
  const purchasedAvailable = data.credits.purchasedAvailable ?? 0;
  const storedContacts = data.capacity?.storedContacts ?? data.activeLeads.used;
  const storedContactsCap = data.capacity?.storedContactsCap ?? data.activeLeads.cap;
  const activeMonitored = data.capacity?.activeMonitoredContacts ?? data.activeLeads.used;
  const activeMonitoredCap = data.capacity?.activeMonitoredContactsCap ?? data.activeLeads.cap;
  const cadenceDays = data.capacity?.monitoringCadenceDays ?? data.activeLeads.cadenceDays;
  const compact = Boolean(href);
  const creditBuckets = groupCreditBuckets(data.credits.buckets ?? []);
  const periodLabel = data.plan.billingInterval === 'annual' ? 'this annual term' : 'this month';
  const cardContent = (
    <>
      {!unlimited && (
        <>
          {creditBuckets.length > 0 ? (
            <>
              <div className="text-xs font-bold uppercase tracking-[0.08em] text-[#7d909a]">Credit balances</div>
              {creditBuckets.map((bucket) => (
                <CreditBucketRow
                  key={`${bucket.source}:${bucket.expiresAt ?? 'none'}`}
                  label={bucketLabel(bucket.source, data.plan.billingInterval)}
                  amount={bucket.available}
                  expiresAt={bucket.expiresAt}
                  sublabel={bucketSublabel(bucket.source)}
                />
              ))}
            </>
          ) : (
            <UsageBar
              used={includedUsed}
              total={includedGranted}
              label={data.plan.billingInterval === 'annual' ? 'Annual included credits' : 'Included monthly credits'}
              sublabel={
                data.plan.billingInterval === 'annual'
                  ? 'Annual credits are granted upfront and remain available until renewal.'
                  : 'Included credits reset each billing period and do not roll over.'
              }
            />
          )}
          {data.annualPace && data.annualPace.level !== 'normal' && (
            <div className={`mt-4 rounded-xl border px-4 py-3 text-xs leading-5 ${
              data.annualPace.level === 'strong'
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-[#dbe8ed] bg-[#f4f8fa] text-[#4a6470]'
            }`}
            >
              {data.annualPace.message}
            </div>
          )}
          {!compact && creditBuckets.length === 0 && purchasedGranted > 0 && (
            <UsageBar
              used={Math.max(0, purchasedGranted - purchasedAvailable)}
              total={purchasedGranted}
              label="Purchased rollover credits"
              sublabel="Purchased credits can be used for any paid action and remain available until expiry."
            />
          )}
        </>
      )}
      {!compact && (
        <>
          <div className="mt-6 text-xs font-bold uppercase tracking-[0.08em] text-[#7d909a]">Capacity and counters</div>
          <UsageBar
            used={storedContacts}
            total={storedContactsCap}
            label="Workspace lead capacity"
            sublabel="Buying credits does not increase how many leads your plan can hold or monitor."
          />
          {data.activeIcps && (
            <UsageBar
              unlimited={unlimited}
              used={data.activeIcps.used}
              total={data.activeIcps.limit}
              label="Active ICPs"
              sublabel="Editing an existing ICP does not use another slot."
            />
          )}
          <UsageBar
            used={activeMonitored}
            total={activeMonitoredCap}
            label="Active leads monitored"
            sublabel={`Checked every ${cadenceDays === 7 ? 'week' : 'month'}${data.activeLeads.waitlisted ? ` · ${data.activeLeads.waitlisted} waitlisted` : ''}.`}
          />
          <UsageBar unlimited={unlimited} used={data.triage.used} total={data.triage.limit} label="Imported records triaged this month" />
          <UsageBar
            unlimited={unlimited}
            used={data.leadEnrichmentCredits?.used ?? (
              data.importedEnrichments.used * 4 + data.netNewLeads.used * 4
            )}
            total={data.leadEnrichmentCredits?.included ?? (
              data.importedEnrichments.included * 4 + data.netNewLeads.limit * 4
            )}
            label={`Lead enrichment credits ${periodLabel}`}
            sublabel={
              data.leadEnrichmentCredits
                ? `Shared by imported contact+company (${data.leadEnrichmentCredits.importedContactCompanyCredits}), company-only (${data.leadEnrichmentCredits.companyOnlyCredits}), and net-new leads (${data.leadEnrichmentCredits.netNewLeadCredits}). Purchased credits cover extra actions.`
                : 'Shared by imported enrichment and net-new leads. Purchased credits cover extra actions.'
            }
          />
          <UsageBar
            unlimited={unlimited}
            used={data.sequences.used}
            total={data.sequences.limit}
            label={`Sequences generated ${periodLabel}`}
            sublabel={`${(data.sequences.emailSteps ?? data.sequences.used * 4).toLocaleString()} email steps · ${(data.sequences.linkedinAdds ?? data.sequences.used).toLocaleString()} LinkedIn adds · ${(data.sequences.linkedinMessages ?? data.sequences.used * 2).toLocaleString()} LinkedIn messages. Extra sequences use credits.`}
          />
          <UsageBar unlimited={unlimited} used={data.phoneReveals.used} total={data.phoneReveals.limit} label={`Phone reveals ${periodLabel}`} />
          <UsageBar unlimited={unlimited} used={data.emailFinder.used} total={data.emailFinder.limit} label={`Email-finder requests ${periodLabel}`} />
        </>
      )}
    </>
  );

  return (
    <section className={sectionClassName}>
      {showHeading && (
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-[#7d909a]">Usage</h2>
          {href && <ChevronRight className="h-5 w-5 text-[#b6c2c8]" />}
        </div>
      )}
      <p className={`${showHeading ? 'mt-1' : 'mt-0'} text-sm text-[#7d909a]`}>
        {unlimited
          ? 'Your workspace is complimentary with no limits — here is your current activity.'
          : data.complimentary
            ? 'Arcova workspaces use a pretend credit track so the product experience matches customer workspaces.'
            : data.plan.billingInterval === 'annual'
              ? 'Annual credits are available upfront. We show pace warnings when usage is ahead of the usual monthly rhythm.'
              : 'Included credits reset with your plan. Purchased credits roll over and can be used for any paid action.'}
      </p>
      {href ? (
        <Link
          href={href}
          aria-label="Open usage settings"
          className={`${CARD} group block transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-arcova-teal/35`}
        >
          {cardContent}
        </Link>
      ) : (
        <div className={CARD}>
          {cardContent}
        </div>
      )}

      {!unlimited && data.plan.key === 'free' && data.available && (
        <div className="mt-5 flex items-center gap-3 rounded-xl border border-[#e8f0f3] bg-[#f4f8fa] px-4 py-3">
          <p className="flex-1 text-sm text-[#4a6470]">Upgrade for more credits, monitoring capacity, and usage.</p>
          <a href="/settings/billing" className="inline-flex items-center gap-1 rounded-lg bg-[#0d3547] px-3 py-1.5 text-xs font-semibold text-white">
            <ArrowUpRight className="h-3 w-3" /> Upgrade
          </a>
        </div>
      )}
    </section>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function bucketLabel(source: string, interval?: 'monthly' | 'annual'): string {
  if (source === 'annual') return 'Annual included credits';
  if (source === 'purchased') return 'Purchased rollover credits';
  if (source === 'adjustment') return 'Adjustment credits';
  if (source === 'free_monthly' || source === 'paid_monthly') {
    return interval === 'annual' ? 'Included credits' : 'Included monthly credits';
  }
  return 'Credits';
}

function bucketSublabel(source: string): string | undefined {
  if (source === 'annual') return 'Granted upfront and available until annual renewal.';
  if (source === 'purchased') return 'Can be used for paid actions; does not increase active ICP capacity, lead capacity or monitoring cadence.';
  if (source === 'adjustment') return 'Manual workspace credit adjustment.';
  if (source === 'free_monthly' || source === 'paid_monthly') return 'Included credits expire at billing rollover.';
  return undefined;
}

function groupCreditBuckets(buckets: CreditBucket[]) {
  const grouped = new Map<string, { source: string; expiresAt: string; available: number }>();
  for (const bucket of buckets) {
    const available = Number(bucket.credits_remaining ?? 0);
    if (available <= 0) continue;
    const expiresAt = bucket.expires_at;
    const key = `${bucket.source}:${expiresAt}`;
    const existing = grouped.get(key);
    if (existing) existing.available += available;
    else grouped.set(key, { source: bucket.source, expiresAt, available });
  }
  return [...grouped.values()].sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());
}
