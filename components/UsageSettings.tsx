'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ArrowUpRight } from 'lucide-react';

type UsageSummary = {
  unlimited: boolean;
  available: boolean;
  plan: { key: string; name: string };
  credits: { available: number; granted: number };
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

function UsageBar({ used, total, label, sublabel }: {
  used: number; total: number; label: string; sublabel?: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div className="mt-4 first:mt-0">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className={`text-xs ${pct >= 100 ? 'font-semibold text-red-600' : pct >= 90 ? 'font-medium text-amber-600' : 'text-[#7d909a]'}`}>
          {used.toLocaleString()} / {total.toLocaleString()}
        </span>
      </div>
      {sublabel && <p className="mt-0.5 text-xs text-[#7d909a]">{sublabel}</p>}
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${pct >= 100 ? 'bg-red-500' : pct >= 90 ? 'bg-amber-500' : 'bg-[#0d3547]'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function UsageSettings() {
  const [data, setData] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
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
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-[#7d909a]">Usage</h2>
        <div className={`${CARD} flex items-center gap-2 text-sm text-[#7d909a]`}>
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      </section>
    );
  }
  if (!data || data.unlimited) return null;

  const creditsUsed = Math.max(0, data.credits.granted - data.credits.available);
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-[#7d909a]">Usage</h2>
      <p className="mt-1 text-sm text-[#7d909a]">
        Monthly and daily limits use UTC. Monitoring is included and does not consume credits.
      </p>
      <div className={CARD}>
        <UsageBar used={creditsUsed} total={data.credits.granted} label="Plan credits" />
        <UsageBar used={data.activeLeads.used} total={data.activeLeads.cap} label="Active leads monitored"
          sublabel={`Checked every ${data.activeLeads.cadenceDays === 7 ? 'week' : 'month'}${data.activeLeads.waitlisted ? ` · ${data.activeLeads.waitlisted} waitlisted` : ''}.`} />
        <UsageBar used={data.triage.used} total={data.triage.limit} label="Imported records triaged this month" />
        <UsageBar used={data.importedEnrichments.used} total={data.importedEnrichments.hardCap}
          label="Imported enrichments this month"
          sublabel={`${data.importedEnrichments.included.toLocaleString()} included before purchased credits are used.`} />
        <UsageBar used={data.netNewLeads.used} total={data.netNewLeads.limit} label="Net-new enriched leads this month" />
        <UsageBar used={data.sequences.used} total={data.sequences.limit} label="Sequences generated in 24 hours" />
        <UsageBar used={data.phoneReveals.used} total={data.phoneReveals.limit} label="Phone reveals today" />
        <UsageBar used={data.emailFinder.used} total={data.emailFinder.limit} label="Email-finder requests today" />

        {data.plan.key === 'free' && data.available && (
          <div className="mt-5 flex items-center gap-3 rounded-xl border border-[#e8f0f3] bg-[#f4f8fa] px-4 py-3">
            <p className="flex-1 text-sm text-[#4a6470]">Upgrade for more credits, monitoring capacity, and usage.</p>
            <a href="/settings" className="inline-flex items-center gap-1 rounded-lg bg-[#0d3547] px-3 py-1.5 text-xs font-semibold text-white">
              <ArrowUpRight className="h-3 w-3" /> Upgrade
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
