'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, ArrowUpRight, ChevronRight } from 'lucide-react';

type UsageSummary = {
  unlimited: boolean;
  complimentary?: boolean;
  available: boolean;
  plan: { key: string; name: string };
  credits: {
    available: number;
    granted: number;
    includedAvailable?: number;
    includedGranted?: number;
    purchasedAvailable?: number;
    purchasedGranted?: number;
  };
  capacity?: {
    storedContacts: number;
    storedContactsCap: number;
    activeMonitoredContacts: number;
    activeMonitoredContactsCap: number;
    monitoringCadenceDays: number;
  };
  triage: { used: number; limit: number };
  importedEnrichments: { used: number; included: number; hardCap: number };
  activeLeads: { used: number; cap: number; waitlisted: number; cadenceDays: number };
  netNewLeads: { used: number; limit: number };
  sequences: { used: number; limit: number };
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

function MetricRow({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <div className="mt-4 first:mt-0">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="text-xs font-semibold text-[#0d3547]">{value}</span>
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
  const cardContent = (
    <>
      {!unlimited && (
        <>
          <UsageBar
            used={includedUsed}
            total={includedGranted}
            label="Included monthly credits"
            sublabel="Included credits reset each billing period and do not roll over."
          />
          <UsageBar
            used={Math.max(0, purchasedGranted - purchasedAvailable)}
            total={purchasedGranted}
            label="Purchased rollover credits"
            sublabel="Purchased credits can be used for any paid action and remain available until expiry."
          />
          <UsageBar
            used={storedContacts}
            total={storedContactsCap}
            label="Workspace lead capacity"
            sublabel="Buying credits does not increase how many leads your plan can hold or monitor."
          />
          <UsageBar
            used={activeMonitored}
            total={activeMonitoredCap}
            label="Active leads monitored"
            sublabel={`Checked every ${cadenceDays === 7 ? 'week' : 'month'}${data.activeLeads.waitlisted ? ` · ${data.activeLeads.waitlisted} waitlisted` : ''}.`}
          />
        </>
      )}
      <UsageBar unlimited={unlimited} used={data.triage.used} total={data.triage.limit} label="Imported records triaged this month" />
      <MetricRow label="Imported enrichments this month" value={data.importedEnrichments.used.toLocaleString()} />
      <MetricRow label="Net-new enriched leads this month" value={data.netNewLeads.used.toLocaleString()} />
      <MetricRow label="Sequences generated in 24 hours" value={data.sequences.used.toLocaleString()} />
      <MetricRow label="Phone reveals today" value={data.phoneReveals.used.toLocaleString()} />
      <MetricRow label="Email-finder requests today" value={data.emailFinder.used.toLocaleString()} />
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
