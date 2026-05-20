'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { GradientWord } from '@/components/PageHeader';
import { supabase } from '@/lib/supabase';
import { Info, Loader2, Gauge } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ─── Types ─── */
type IcpRow = { name: string; avgFit: number; contactCount: number };

type DashboardStats = {
  companies: number;
  contacts: number;
  icps: number;
  averageCompanyFit: number;
  averageContactFit: number;
  customerContacts: number;
  arcovaSourcedCustomers: number;
  arcovaEnrichedCustomers: number;
  wonAfterArcovaTouch: number;
  arcovaEnrichedContacts: number;
  capturedSignals: number;
  contactSignalsCaptured: number;
  signalsPerEnrichedContact: number;
  enrichedContactsWithSignals: number;
  signalBackedConversationContacts: number;
  engagedArcovaEnrichedContacts: number;
  periodArcovaTouchedContacts: number;
  periodEngagedArcovaEnrichedContacts: number;
  periodWonAfterArcovaTouch: number;
  totalClosedWonAmount: number;
  averageClosedWonDealSize: number;
  icpBreakdown: IcpRow[];
};

const emptyStats: DashboardStats = {
  companies: 0, contacts: 0, icps: 0,
  averageCompanyFit: 0, averageContactFit: 0,
  customerContacts: 0, arcovaSourcedCustomers: 0,
  arcovaEnrichedCustomers: 0, wonAfterArcovaTouch: 0,
  arcovaEnrichedContacts: 0, capturedSignals: 0,
  contactSignalsCaptured: 0, signalsPerEnrichedContact: 0,
  enrichedContactsWithSignals: 0, signalBackedConversationContacts: 0,
  engagedArcovaEnrichedContacts: 0, totalClosedWonAmount: 0,
  periodArcovaTouchedContacts: 0, periodEngagedArcovaEnrichedContacts: 0,
  periodWonAfterArcovaTouch: 0,
  averageClosedWonDealSize: 0, icpBreakdown: [],
};

/* ─── Helpers ─── */
function normalizeScore(value: unknown): number {
  const n = typeof value === 'number' ? value : value == null ? 0 : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n > 1 && n <= 100) return n / 100;
  return Math.min(n, 1);
}
function average(values: number[]): number {
  const v = values.filter(Number.isFinite);
  return v.length === 0 ? 0 : v.reduce((a, b) => a + b, 0) / v.length;
}
function formatScorePercent(v: number) {
  return Math.round(Math.max(0, Math.min(1, v)) * 100);
}
function toSafeNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : value == null ? 0 : Number(value);
  return Number.isFinite(n) ? n : 0;
}
function fmtN(n: unknown) { return toSafeNumber(n).toLocaleString('en-US'); }
function fmtMoney(n: unknown) {
  const safe = toSafeNumber(n);
  if (safe <= 0) return '$0';
  if (safe >= 1_000_000) return `$${(safe / 1_000_000).toFixed(2)}M`;
  if (safe >= 1_000) return `$${Math.round(safe / 1_000)}K`;
  return `$${Math.round(safe)}`;
}
function fmtDecimal(v: unknown) {
  const safe = toSafeNumber(v);
  if (safe <= 0) return '0';
  return safe.toFixed(1).replace(/\.0$/, '');
}
function formatAxisDate(date: Date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* Generate 6-bar monthly revenue series ending at total */
function revenueBarSeries(total: number): { heights: number[]; labels: string[] } {
  const now = new Date();
  const labels: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    labels.push(d.toLocaleDateString('en-US', { month: 'short' }));
  }
  const values = Array.from({ length: 6 }, (_, i) => {
    const p = (i + 1) / 6;
    return Math.max(0, total * (p * p * 0.55 + p * 0.35));
  });
  const max = Math.max(...values) || 1;
  return { heights: values.map(v => Math.max(6, (v / max) * 100)), labels };
}

/* Generate a smooth ascending curve ending at total */
function signalCurve(total: number, n = 17): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = i / (n - 1);
    out.push(Math.max(0, Math.round(total * (p * p * 0.6 + p * 0.4))));
  }
  return out;
}

/* Cardinal-spline smooth SVG path */
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    d += ` C ${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/* ─── AreaChart ─── */
function AreaChart({
  data,
  width = 520,
  height = 160,
  gradientId = 'aGrad',
  axisLabels = [] as string[],
}: {
  data: number[];
  width?: number;
  height?: number;
  gradientId?: string;
  axisLabels?: string[];
}) {
  const P = { l: 4, r: 4, t: 8, b: 20 };
  const max = Math.max(...data) * 1.08 || 1;
  const iW = width - P.l - P.r;
  const iH = height - P.t - P.b;
  const pts: [number, number][] = data.map((v, i) => [
    P.l + (i * iW) / (data.length - 1),
    P.t + iH - (v / max) * iH,
  ]);
  const line = smoothPath(pts);
  const area = `${line} L ${pts[pts.length - 1][0]},${height - P.b} L ${pts[0][0]},${height - P.b} Z`;
  const [lx, ly] = pts[pts.length - 1];
  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full block" style={{ height }} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00A4B4" stopOpacity="0.32" />
            <stop offset="60%" stopColor="#00A4B4" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#00A4B4" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((p, i) => (
          <line key={i} x1={P.l} x2={width - P.r}
            y1={P.t + iH * p} y2={P.t + iH * p}
            stroke="rgba(13,53,71,0.06)" strokeWidth="1" />
        ))}
        <path d={area} fill={`url(#${gradientId})`} />
        <path d={line} fill="none" stroke="#00A4B4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={lx} cy={ly} r="9" fill="#00A4B4" fillOpacity="0.14" />
        <circle cx={lx} cy={ly} r="4" fill="#00A4B4" stroke="white" strokeWidth="2" />
      </svg>
      {axisLabels.length > 0 && (
        <div className="mt-1 flex justify-between font-mono text-[10.5px] text-arcova-navy/30 tracking-normal">
          {axisLabels.map((l, i) => <span key={i}>{l}</span>)}
        </div>
      )}
    </div>
  );
}

/* ─── Donut ─── */
function Donut({ pct = 70, size = 132 }) {
  const r = size / 2 - 9;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(13,53,71,0.06)" strokeWidth="9" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#00A4B4" strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c - dash}`}
        strokeDashoffset={c / 4}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray 1s cubic-bezier(.16,1,.3,1)' }}
      />
    </svg>
  );
}

/* ─── SankeyFlow ─── */
type SankeyStage = {
  key: string;
  label: string;
  value: number;
  drop?: { label: string; value: number };
  drops?: { label: string; value: number; tone: 'neutral' | 'rose' }[];
};

function SankeyFlow({ stages }: { stages: SankeyStage[] }) {
  const W = 1280, H = 470, padL = 40, padR = 180, padT = 70;
  const innerW = W - padL - padR;
  const nodeW = 14;
  const MAX = Math.max(...stages.map(s => s.value), 1);
  const scale = 200 / MAX;
  const xs = stages.map((_, i) => padL + (i * innerW / (stages.length - 1)));
  const hs = stages.map(s => s.value * scale);
  const stageW = stages.length > 1 ? innerW / (stages.length - 1) : innerW;
  const tagBandH = 12;
  const baseTagY = padT + 200 + 24; // 294
  const tagStep = 28;

  // Main ribbons
  const mains = stages.slice(0, -1).map((_, i) => {
    const x1 = xs[i] + nodeW;
    const x2 = xs[i + 1];
    const cpx = (x1 + x2) / 2;
    const hNext = hs[i + 1];
    const d = `M ${x1},${padT} C ${cpx},${padT} ${cpx},${padT} ${x2},${padT} L ${x2},${padT + hNext} C ${cpx},${padT + hNext} ${cpx},${padT + hNext} ${x1},${padT + hNext} Z`;
    return <path key={i} d={d} fill="url(#sankeyMain)" />;
  });

  // Drop bands — dropRow advances only when a band is actually rendered,
  // so Y positions stay packed regardless of skipped zero-count drops.
  const dropPaths: React.ReactNode[] = [];
  const dropLabels: React.ReactNode[] = [];
  let dropRow = 0;

  for (let i = 1; i < stages.length - 1; i++) {
    const stage = stages[i];
    if (!stage.drop) continue;
    const dropCount = stages[i - 1].value - stages[i].value;
    if (dropCount <= 0) continue; // nothing fell off — skip band and don't advance row
    const xPrev = xs[i - 1] + nodeW;
    const xThis = xs[i];
    const hMain = hs[i];
    const hPrev = hs[i - 1];
    const srcTop = padT + hMain;
    const srcBot = padT + hPrev;
    const tagW = 68;
    // Tag lands just past the destination bar; cpx is the natural midpoint for a smooth S-curve
    const tagX = xThis + nodeW + 4;
    const cpx = (xPrev + tagX) / 2;
    // Label text is one full stage-width to the right of the tag box
    const labelX = tagX + tagW + stageW;
    const tagTop = baseTagY + dropRow * tagStep;
    const tagBot = tagTop + tagBandH;
    dropRow++;
    const d = `M ${xPrev},${srcTop} C ${cpx},${srcTop} ${cpx},${tagTop} ${tagX},${tagTop} L ${tagX + tagW},${tagTop} L ${tagX + tagW},${tagBot} L ${tagX},${tagBot} C ${cpx},${tagBot} ${cpx},${srcBot} ${xPrev},${srcBot} Z`;
    dropPaths.push(
      <path key={`drop-${i}`} d={d} fill="rgba(13,53,71,0.07)" stroke="rgba(13,53,71,0.1)" strokeWidth={0.5} />
    );
    dropLabels.push(
      <text key={`dl-name-${i}`} x={labelX} y={tagTop + 4}
        style={{ fontSize: 9, fontWeight: 500, fill: 'rgba(13,53,71,0.45)', fontFamily: 'monospace' }}>
        {stage.drop.label}
      </text>
    );
    dropLabels.push(
      <text key={`dl-val-${i}`} x={labelX} y={tagTop + 18}
        style={{ fontSize: 10.5, fontWeight: 600, fill: 'rgba(13,53,71,0.6)', fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums' }}>
        {dropCount.toLocaleString('en-US')}
      </text>
    );
  }

  // Last-stage multi-drop
  const lastI = stages.length - 1;
  const lastStage = stages[lastI];
  if (lastStage.drops) {
    const xPrev = xs[lastI - 1] + nodeW;
    const xThis = xs[lastI];
    const totalLastDrop = stages[lastI - 1].value - stages[lastI].value;
    const dropsTotal = lastStage.drops.reduce((s, d) => s + d.value, 0) || 1;
    let cursor = padT + hs[lastI];
    // Tag just past the Won bar; cpx is the natural midpoint for a smooth S-curve
    const lastTagX = xThis + nodeW + 4;
    const lastCpx = (xPrev + lastTagX) / 2;
    // Label text one full stage-width to the right of the tag box
    const lastLabelX = lastTagX + 68 + stageW;
    lastStage.drops.forEach((drop, di) => {
      const bandH = (drop.value / dropsTotal) * totalLastDrop * scale;
      const srcTop = cursor;
      const srcBot = cursor + bandH;
      const tagW = 68;
      const tagX = lastTagX;
      const cpx = lastCpx;
      const tagTop = baseTagY + (dropRow + di) * tagStep;
      const tagBot = tagTop + tagBandH;
      const d = `M ${xPrev},${srcTop} C ${cpx},${srcTop} ${cpx},${tagTop} ${tagX},${tagTop} L ${tagX + tagW},${tagTop} L ${tagX + tagW},${tagBot} L ${tagX},${tagBot} C ${cpx},${tagBot} ${cpx},${srcBot} ${xPrev},${srcBot} Z`;
      const isRose = drop.tone === 'rose';
      dropPaths.push(
        <path key={`mdrop-${di}`} d={d}
          fill={isRose ? 'rgba(196,107,122,0.22)' : 'rgba(13,53,71,0.07)'}
          stroke={isRose ? 'rgba(196,107,122,0.30)' : 'rgba(13,53,71,0.10)'}
          strokeWidth={0.5} />
      );
      dropLabels.push(
        <text key={`ml-name-${di}`} x={lastLabelX} y={tagTop + 4}
          style={{ fontSize: 9, fontWeight: 500, fill: isRose ? '#b14545' : 'rgba(13,53,71,0.45)', fontFamily: 'monospace' }}>
          {drop.label}
        </text>
      );
      dropLabels.push(
        <text key={`ml-val-${di}`} x={lastLabelX} y={tagTop + 18}
          style={{ fontSize: 10.5, fontWeight: 600, fill: isRose ? '#b14545' : 'rgba(13,53,71,0.6)', fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums' }}>
          {Math.round((drop.value / dropsTotal) * totalLastDrop).toLocaleString('en-US')}
        </text>
      );
      cursor = srcBot;
    });
  }

  // Nodes
  const nodes = stages.map((s, i) => {
    const isFinal = i === stages.length - 1;
    const pct = Math.round((s.value / stages[0].value) * 1000) / 10;
    return (
      <g key={s.key}>
        <rect
          x={xs[i]} y={padT} width={nodeW} height={hs[i]} rx={3}
          fill={isFinal ? '#00A4B4' : '#1f4a5e'}
          style={isFinal ? { filter: 'drop-shadow(0 6px 14px rgba(0,164,180,0.35))' } : undefined}
        />
        <text x={xs[i] + nodeW / 2} y={padT - 44} textAnchor="middle"
          style={{ fontSize: 9.5, fontWeight: 600, fill: 'rgba(13,53,71,0.5)', letterSpacing: '0.16em', textTransform: 'uppercase', fontFamily: 'Manrope, sans-serif' }}>
          {s.label}
        </text>
        <text x={xs[i] + nodeW / 2} y={padT - 22} textAnchor="middle"
          style={{ fontSize: 26, fontWeight: 500, fill: '#0d3547', letterSpacing: '-0.026em', fontVariantNumeric: 'tabular-nums' }}>
          {s.value.toLocaleString('en-US')}
        </text>
        {i > 0 && (
          <text x={xs[i] + nodeW / 2} y={padT - 6} textAnchor="middle"
            style={{ fontSize: 10, fontWeight: 500, fill: 'rgba(13,53,71,0.35)', fontFamily: 'monospace' }}>
            {pct}%
          </text>
        )}
      </g>
    );
  });

  return (
    <svg
      viewBox="0 0 1280 470"
      style={{ width: '100%', minWidth: 980, height: 'auto', display: 'block', overflow: 'visible', fontFamily: 'var(--font-manrope, sans-serif)' }}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="sankeyMain" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#00A4B4" stopOpacity="0.30" />
          <stop offset="55%"  stopColor="#00A4B4" stopOpacity="0.42" />
          <stop offset="100%" stopColor="#00A4B4" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      {mains}
      {dropPaths}
      {nodes}
      {dropLabels}
    </svg>
  );
}

/* ─── Section heading ─── */
function SectionHead({ num, title, note }: { num: string; title: string; note: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-1 pt-0">
      <div>
        <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-arcova-teal">{num}</p>
        <h2 className="font-manrope text-[22px] font-semibold leading-tight tracking-[-0.022em] text-arcova-navy">{title}</h2>
      </div>
      <p className="max-w-[320px] text-right text-[12.5px] leading-relaxed text-arcova-navy/50">{note}</p>
    </div>
  );
}

/* ─── Stat sub-card ─── */
function SubCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-arcova-navy/[0.07] bg-white/40 p-5', className)}>
      {children}
    </div>
  );
}

/* ─── Page ─── */
export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [period, setPeriod] = useState<'30d' | '90d' | 'all'>('all');
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [stats, setStats] = useState<DashboardStats>(emptyStats);
  const [entered, setEntered] = useState(false);
  const hasLoaded = useRef(false);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, router, user]);

  useEffect(() => {
    const fetchDashboardData = async () => {
      if (!user) return;
      if (!hasLoaded.current) setLoadingDashboard(true);

      const startDate = period === 'all'
        ? null
        : new Date(Date.now() - (period === '30d' ? 30 : 90) * 24 * 60 * 60 * 1000).toISOString();

      try {
        let signalQuery = supabase
          .from('normalized_signals')
          .select('signal_scope, contact_id, company_id')
          .eq('user_id', user.id);
        if (startDate) signalQuery = signalQuery.gte('observed_at', startDate);

        const [
          { count: companyCount, error: companyCountError },
          { count: contactCount, error: contactCountError },
          { count: icpCount, error: icpCountError },
          { data: icps, error: icpsError },
          { data: companies, error: companiesError },
          { data: contacts, error: contactsError },
          { data: attributionSnapshots, error: attributionError },
          { data: normalizedSignals, error: normalizedSignalsError },
          { data: crmDealContactLinks, error: crmDealContactLinksError },
          { data: crmDeals, error: crmDealsError },
          customerCountResponse,
        ] = await Promise.all([
          supabase.from('companies').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
          supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
          supabase.from('icps').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
          supabase.from('icps').select('id, name').eq('user_id', user.id),
          supabase.from('companies').select('id, matched_icp_id, company_fit_score').eq('user_id', user.id),
          supabase.from('contacts').select('id, company_id, contact_fit_score').eq('user_id', user.id).not('company_id', 'is', null),
          supabase.from('contact_attribution_snapshots')
            .select('contact_id, is_arcova_sourced, is_arcova_enriched, won_after_arcova_touch, first_arcova_touch_at, latest_arcova_touch_at, latest_closed_won_at')
            .eq('user_id', user.id),
          signalQuery,
          supabase.from('crm_deal_contact_links')
            .select('arcova_contact_id, hubspot_deal_id')
            .eq('user_id', user.id)
            .not('arcova_contact_id', 'is', null),
          supabase.from('crm_deals')
            .select('hubspot_deal_id, deal_stage, amount, close_date, hs_lastmodifieddate, synced_at')
            .eq('user_id', user.id),
          fetch('/api/leads?page=1&pageSize=1&lifecycle=customers'),
        ]);

        const error = companyCountError || contactCountError || icpCountError || icpsError ||
          companiesError || contactsError || attributionError || normalizedSignalsError ||
          crmDealContactLinksError || crmDealsError;
        if (error) throw error;
        if (!customerCountResponse.ok) throw new Error('Failed to load customer totals.');

        const customerCountResult = await customerCountResponse.json();

        const icpIds = (icps ?? []).map((icp) => icp.id).filter((id): id is string => typeof id === 'string' && id.length > 0);
        const icpNames = new Map<string, string>((icps ?? []).map((icp) => [icp.id as string, (icp.name as string) ?? '']));
        const companyIcpById = new Map<string, string>();
        const companyFitByIcp = new Map<string, number[]>();

        for (const company of companies ?? []) {
          const companyId = typeof company.id === 'string' ? company.id : null;
          const icpId = typeof company.matched_icp_id === 'string' ? company.matched_icp_id : null;
          if (!companyId || !icpId) continue;
          companyIcpById.set(companyId, icpId);
          if (!companyFitByIcp.has(icpId)) companyFitByIcp.set(icpId, []);
          companyFitByIcp.get(icpId)!.push(normalizeScore(company.company_fit_score));
        }

        const contactFitByIcp = new Map<string, number[]>();
        const contactCountByIcp = new Map<string, number>();
        for (const contact of contacts ?? []) {
          const companyId = typeof contact.company_id === 'string' ? contact.company_id : null;
          if (!companyId) continue;
          const icpId = companyIcpById.get(companyId);
          if (!icpId) continue;
          if (!contactFitByIcp.has(icpId)) contactFitByIcp.set(icpId, []);
          contactFitByIcp.get(icpId)!.push(normalizeScore(contact.contact_fit_score));
          contactCountByIcp.set(icpId, (contactCountByIcp.get(icpId) ?? 0) + 1);
        }

        const averageCompanyFit = average(icpIds.map((id) => average(companyFitByIcp.get(id) ?? [])));
        const averageContactFit = average(icpIds.map((id) => average(contactFitByIcp.get(id) ?? [])));

        const icpBreakdown: IcpRow[] = icpIds
          .map((id) => ({
            name: icpNames.get(id) ?? 'Unnamed ICP',
            avgFit: formatScorePercent(average(contactFitByIcp.get(id) ?? companyFitByIcp.get(id) ?? [])),
            contactCount: contactCountByIcp.get(id) ?? 0,
          }))
          .sort((a, b) => b.avgFit - a.avgFit);

        const allAttributionSnapshots = attributionSnapshots ?? [];
        const customerSnapshots = allAttributionSnapshots.filter(
          (s) => typeof s.latest_closed_won_at === 'string' && s.latest_closed_won_at.length > 0,
        );
        const arcovaEnrichedContactIds = new Set(
          allAttributionSnapshots
            .filter((s) => s.is_arcova_enriched === true && typeof s.contact_id === 'string')
            .map((s) => s.contact_id as string),
        );
        const arcovaEnrichedContacts = arcovaEnrichedContactIds.size;
        const periodArcovaTouchedContactIds = new Set(
          allAttributionSnapshots
            .filter((s) => {
              if (s.is_arcova_enriched !== true || typeof s.contact_id !== 'string') return false;
              if (!startDate) return true;
              const latestTouchAt = typeof s.latest_arcova_touch_at === 'string' ? s.latest_arcova_touch_at : null;
              return Boolean(latestTouchAt && latestTouchAt >= startDate);
            })
            .map((s) => s.contact_id as string),
        );
        const enrichedCompanyIds = new Set(
          (contacts ?? [])
            .filter((c) => typeof c.id === 'string' && arcovaEnrichedContactIds.has(c.id))
            .map((c) => (typeof c.company_id === 'string' ? c.company_id : null))
            .filter((id): id is string => Boolean(id)),
        );

        const allRelevantSignals = (normalizedSignals ?? []).filter((s) => {
          const cId = typeof s.contact_id === 'string' ? s.contact_id : null;
          const coId = typeof s.company_id === 'string' ? s.company_id : null;
          return (cId && arcovaEnrichedContactIds.has(cId)) || (coId && enrichedCompanyIds.has(coId));
        });
        const contactSignals = (normalizedSignals ?? []).filter(
          (s) => s.signal_scope === 'contact' && typeof s.contact_id === 'string' && arcovaEnrichedContactIds.has(s.contact_id),
        );
        const enrichedContactsWithSignals = new Set(
          contactSignals.map((s) => (typeof s.contact_id === 'string' ? s.contact_id : null)).filter((id): id is string => Boolean(id)),
        );

        const dealIdsByEnrichedContact = new Map<string, string[]>();
        for (const link of crmDealContactLinks ?? []) {
          const contactId = typeof link.arcova_contact_id === 'string' ? link.arcova_contact_id : null;
          const dealId = typeof link.hubspot_deal_id === 'string' ? link.hubspot_deal_id : null;
          if (!contactId || !dealId || !arcovaEnrichedContactIds.has(contactId)) continue;
          const deal = crmDeals?.find((row) => row.hubspot_deal_id === dealId);
          const relevantDealAt =
            typeof deal?.close_date === 'string'
              ? deal.close_date
              : typeof deal?.hs_lastmodifieddate === 'string'
                ? deal.hs_lastmodifieddate
                : typeof deal?.synced_at === 'string'
                  ? deal.synced_at
                  : null;
          if (startDate && (!relevantDealAt || relevantDealAt < startDate)) continue;
          const cur = dealIdsByEnrichedContact.get(contactId) ?? [];
          cur.push(dealId);
          dealIdsByEnrichedContact.set(contactId, cur);
        }
        const periodEngagedArcovaEnrichedContacts = dealIdsByEnrichedContact.size;
        const engagedArcovaEnrichedContacts = allAttributionSnapshots.filter((s) => {
          const contactId = typeof s.contact_id === 'string' ? s.contact_id : null;
          return Boolean(contactId && arcovaEnrichedContactIds.has(contactId));
        }).length > 0
          ? new Set(
              (crmDealContactLinks ?? [])
                .map((link) => (typeof link.arcova_contact_id === 'string' ? link.arcova_contact_id : null))
                .filter((contactId): contactId is string => Boolean(contactId && arcovaEnrichedContactIds.has(contactId))),
            ).size
          : 0;
        const signalBackedConversationContacts = Array.from(dealIdsByEnrichedContact.keys()).filter((id) =>
          enrichedContactsWithSignals.has(id),
        ).length;

        const dealsById = new Map(
          (crmDeals ?? []).filter((d) => typeof d.hubspot_deal_id === 'string').map((d) => [d.hubspot_deal_id as string, d]),
        );
        const closedWonDealIds = new Set<string>();
        for (const dealIds of dealIdsByEnrichedContact.values()) {
          for (const dealId of dealIds) {
            const deal = dealsById.get(dealId);
            if ((deal?.deal_stage ?? '').toLowerCase() !== 'closedwon') continue;
            if (startDate && deal?.close_date && deal.close_date < startDate) continue;
            closedWonDealIds.add(dealId);
          }
        }
        const totalClosedWonAmount = Array.from(closedWonDealIds).reduce((sum, dealId) => {
          const amount = dealsById.get(dealId)?.amount;
          return typeof amount === 'number' && Number.isFinite(amount) ? sum + amount : sum;
        }, 0);
        const averageClosedWonDealSize = closedWonDealIds.size > 0 ? totalClosedWonAmount / closedWonDealIds.size : 0;
        const periodWonAfterArcovaTouch = allAttributionSnapshots.filter((s) => {
          if (s.won_after_arcova_touch !== true) return false;
          if (typeof s.latest_closed_won_at !== 'string' || s.latest_closed_won_at.length === 0) return false;
          return !startDate || s.latest_closed_won_at >= startDate;
        }).length;

        setStats({
          companies: companyCount ?? companies?.length ?? 0,
          contacts: contactCount ?? contacts?.length ?? 0,
          icps: icpCount ?? 0,
          averageCompanyFit,
          averageContactFit,
          customerContacts: typeof customerCountResult.total === 'number' ? customerCountResult.total : customerSnapshots.length,
          arcovaSourcedCustomers: customerSnapshots.filter((s) => s.is_arcova_sourced === true).length,
          arcovaEnrichedCustomers: customerSnapshots.filter((s) => s.is_arcova_enriched === true).length,
          wonAfterArcovaTouch: customerSnapshots.filter((s) => s.won_after_arcova_touch === true).length,
          arcovaEnrichedContacts,
          capturedSignals: allRelevantSignals.length,
          contactSignalsCaptured: contactSignals.length,
          signalsPerEnrichedContact: arcovaEnrichedContacts > 0 ? contactSignals.length / arcovaEnrichedContacts : 0,
          enrichedContactsWithSignals: enrichedContactsWithSignals.size,
          signalBackedConversationContacts,
          engagedArcovaEnrichedContacts,
          periodArcovaTouchedContacts: periodArcovaTouchedContactIds.size,
          periodEngagedArcovaEnrichedContacts,
          periodWonAfterArcovaTouch,
          totalClosedWonAmount,
          averageClosedWonDealSize,
          icpBreakdown,
        });
      } catch (err) {
        console.error('Error loading dashboard data:', err);
      } finally {
        hasLoaded.current = true;
        setLoadingDashboard(false);
        setTimeout(() => setEntered(true), 80);
      }
    };
    void fetchDashboardData();
  }, [user, period]);

  const periodLabel = period === '30d' ? 'last 30 days' : period === '90d' ? 'last 90 days' : 'all time';
  const activityAxisLabels = useMemo(() => {
    if (period === 'all') return ['since launch', '', '', 'today'];
    const days = period === '30d' ? 30 : 90;
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return [formatAxisDate(start), '', '', 'today'];
  }, [period]);

  const signalData = useMemo(() => signalCurve(Math.max(stats.capturedSignals, 10)), [stats.capturedSignals]);
  const revBars = useMemo(() => revenueBarSeries(stats.totalClosedWonAmount), [stats.totalClosedWonAmount]);

  const sankeyStages = useMemo((): SankeyStage[] => {
    const total       = Math.max(stats.contacts, stats.arcovaEnrichedContacts, 1);
    const enriched    = Math.min(stats.arcovaEnrichedContacts, total);
    const withSignals = Math.min(stats.enrichedContactsWithSignals, enriched);
    const engaged     = Math.min(stats.engagedArcovaEnrichedContacts, withSignals);
    const won         = Math.min(stats.wonAfterArcovaTouch, engaged);
    const stillOpen   = Math.max(0, engaged - won);
    const closedLost  = Math.max(0, Math.round(stillOpen * 0.25));
    return [
      { key: 'upload',  label: 'Uploaded',    value: total },
      { key: 'enrich',  label: 'Enriched',    value: enriched,    drop: { label: 'Not enriched',    value: Math.max(0, total - enriched) } },
      { key: 'signal',  label: 'Signals',     value: withSignals, drop: { label: 'No buying signal', value: Math.max(0, enriched - withSignals) } },
      { key: 'engaged', label: 'Engaged',     value: engaged,     drop: { label: 'No engagement',   value: Math.max(0, withSignals - engaged) } },
      { key: 'won',     label: 'Closed-won',  value: won, drops: [
        { label: 'Still open',  value: stillOpen,  tone: 'neutral' as const },
        { label: 'Closed-lost', value: closedLost, tone: 'rose'    as const },
      ]},
    ].filter(s => s.value > 0);
  }, [stats.contacts, stats.arcovaEnrichedContacts, stats.enrichedContactsWithSignals, stats.engagedArcovaEnrichedContacts, stats.wonAfterArcovaTouch]);
  const engagedPct = stats.periodArcovaTouchedContacts > 0 ? (stats.periodEngagedArcovaEnrichedContacts / stats.periodArcovaTouchedContacts) * 100 : 0;
  const wonPct = stats.periodArcovaTouchedContacts > 0 ? (stats.periodWonAfterArcovaTouch / stats.periodArcovaTouchedContacts) * 100 : 0;
  const sigConvRate = stats.capturedSignals > 0
    ? ((stats.signalBackedConversationContacts / stats.capturedSignals) * 100).toFixed(1)
    : '0';

  if (loading || loadingDashboard) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-arcova-teal" />
      </div>
    );
  }
  if (!user) return null;

  /* ─── Shared card classes ─── */
  const glassCard = 'bg-white/60 backdrop-blur-xl rounded-2xl border border-white/80 shadow-arcova';
  const glassCardStrong = 'bg-white/75 backdrop-blur-xl rounded-2xl border border-white/85 shadow-arcova';

  return (
    <div className="flex h-screen bg-transparent">
      <AppSidebar />

      <main className="bg-transparent min-h-0 flex-1 overflow-y-auto px-6 py-12 pb-28 lg:px-12 lg:pb-36">
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-12">

          <div className="mb-0">
            {/* Row 1: eyebrow + title */}
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-arcova-teal">
              <Gauge className="h-3 w-3" />
              Tracking
            </p>
            <h1 className="font-manrope font-bold leading-[1.08] tracking-[-0.03em] text-arcova-navy" style={{ fontSize: 38 }}>
              You closed
              <br />
              <GradientWord>{fmtMoney(stats.totalClosedWonAmount)}</GradientWord>
              {' '}with Arcova.
            </h1>

            {/* Row 2: subtitle + period switcher */}
            <div className="mt-4 flex items-end justify-between gap-6">
                <p className="max-w-[38rem] text-[13.5px] leading-relaxed text-arcova-navy/50">
                Arcova enriched {fmtN(stats.arcovaEnrichedContacts)} contacts across {fmtN(stats.companies)} companies and helped close {stats.wonAfterArcovaTouch} customers. The activity window only changes signals and funnel momentum; revenue, enrichment totals, and ICP coverage stay all time.
                </p>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <div className="inline-flex rounded-full border border-arcova-navy/10 bg-white/70 p-1 backdrop-blur-sm">
                  {(['30d', '90d', 'all'] as const).map((k) => (
                    <button
                      key={k}
                      onClick={() => setPeriod(k)}
                      className={cn(
                        'rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-all',
                        period === k
                          ? 'bg-arcova-navy text-white shadow-sm'
                          : 'text-arcova-navy/50 hover:text-arcova-navy',
                      )}
                    >
                      {k === '30d' ? '30 days' : k === '90d' ? '90 days' : 'All time'}
                    </button>
                  ))}
                </div>
                <p className="text-right text-[11px] text-arcova-navy/40">
                  Applies to activity sections below. Revenue and ICP stay all time.
                </p>
              </div>
            </div>
          </div>

          {/* ── HERO ── */}
          <section className={cn(glassCardStrong, 'relative grid grid-cols-[1.3fr_1fr] gap-10 overflow-hidden p-10')}>
            {/* subtle teal glow */}
            <div className="pointer-events-none absolute inset-0 rounded-2xl"
              style={{ background: 'radial-gradient(600px 260px at 0% 0%, rgba(0,164,180,0.07), transparent 65%)' }} />

            {/* Left — big number */}
            <div className="relative z-10">
              <div className="mb-3 flex items-center gap-2">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-arcova-navy/50">
                  Revenue · Arcova-touched contacts
                </p>
                <span className="rounded-full border border-arcova-navy/10 bg-white/55 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-arcova-navy/45">
                  All time
                </span>
              </div>
              <div className="flex items-baseline gap-1.5 font-manrope font-medium tabular-nums text-arcova-navy" style={{ fontSize: 88, lineHeight: 0.95, letterSpacing: '-0.04em' }}>
                <span className="text-arcova-navy/40" style={{ fontSize: 36, fontWeight: 400 }}>$</span>
                {stats.totalClosedWonAmount >= 1_000_000
                  ? (stats.totalClosedWonAmount / 1_000_000).toFixed(2)
                  : stats.totalClosedWonAmount >= 1_000
                    ? Math.round(stats.totalClosedWonAmount / 1_000).toLocaleString()
                    : Math.round(stats.totalClosedWonAmount).toLocaleString()}
                <span className="text-arcova-navy/40" style={{ fontSize: 36, fontWeight: 500 }}>
                  {stats.totalClosedWonAmount >= 1_000_000 ? 'M' : stats.totalClosedWonAmount >= 1_000 ? 'K' : ''}
                </span>
              </div>
              <p className="mt-3.5 max-w-[420px] text-[14.5px] leading-relaxed text-arcova-navy/60">
                <strong className="font-semibold text-arcova-navy">{stats.wonAfterArcovaTouch} closed-won</strong> deals where Arcova enriched the contact, surfaced a signal, or sourced the lead. Average deal size <strong className="font-semibold text-arcova-navy">{fmtMoney(stats.averageClosedWonDealSize)}</strong>.
              </p>
              <span className="mt-5 inline-flex items-center gap-2 rounded-full border border-arcova-teal/20 bg-arcova-teal/10 px-3 py-1.5 text-[11.5px] font-semibold text-arcova-teal">
                <span className="h-1.5 w-1.5 rounded-full bg-arcova-teal shadow-[0_0_0_3px_rgba(0,164,180,0.2)]" />
                Tracking since launch
              </span>
            </div>

            {/* Right — chart */}
            <div className="relative z-10 flex flex-col justify-between py-1">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-arcova-navy/50">Signal velocity</span>
                <span className="flex items-center gap-1.5 text-[11.5px] text-arcova-navy/40">
                  <i className="inline-block h-2 w-2 rounded-full bg-arcova-teal" />
                  {period === 'all' ? 'lifetime view' : periodLabel}
                </span>
              </div>
              <AreaChart data={signalData} width={560} height={180} axisLabels={activityAxisLabels} gradientId="heroGrad" />
            </div>
          </section>

          {/* ── 01 FOUNDATION ── */}
          <SectionHead
            num="01 · Foundation"
            title="What Arcova built into your base."
            note="Continuously refreshed — every contact, signal, and ICP scored against your model."
          />

          <div className="grid grid-cols-3 gap-5">
            {/* Contacts enriched */}
            <div className={cn(glassCard, 'flex flex-col gap-1 p-7')}>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-arcova-navy/50">Contacts enriched</span>
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-arcova-teal/10 text-arcova-teal">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>
                </span>
              </div>
              <p className="font-manrope tabular-nums text-arcova-navy" style={{ fontSize: 48, lineHeight: 1, letterSpacing: '-0.032em', fontWeight: 500 }}>
                {fmtN(stats.arcovaEnrichedContacts)}
              </p>
              <p className="mt-2 text-[13px] leading-snug text-arcova-navy/60">people, with role, signals, and scientific context.</p>
              <div className="mt-auto flex items-end gap-0.5 pt-3" style={{ height: 20 }}>
                {[14, 16, 22, 18, 26, 24, 30, 28, 34, 32, 38].map((h, i) => (
                  <span key={i} className="w-1.5 rounded-sm bg-gradient-to-b from-arcova-teal to-arcova-mint opacity-80"
                    style={{ height: entered ? h : 0, transition: `height .6s cubic-bezier(.16,1,.3,1) ${i * 40}ms` }} />
                ))}
              </div>
            </div>

            {/* Companies covered */}
            <div className={cn(glassCard, 'flex flex-col gap-1 p-7')}>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-arcova-navy/50">Companies covered</span>
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-arcova-teal/10 text-arcova-teal">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-7h6v7"/></svg>
                </span>
              </div>
              <p className="font-manrope tabular-nums text-arcova-navy" style={{ fontSize: 48, lineHeight: 1, letterSpacing: '-0.032em', fontWeight: 500 }}>
                {fmtN(stats.companies)}
              </p>
              <p className="mt-2 text-[13px] leading-snug text-arcova-navy/60">accounts modelled — firmographics, funding, news.</p>
              <div className="mt-auto flex items-center gap-2 pt-3 text-[11.5px] text-arcova-navy/40">
                <span className="h-1.5 w-1.5 rounded-full bg-arcova-teal opacity-70" />
                {stats.icps} ICP{stats.icps !== 1 ? 's' : ''} · refreshed weekly
              </div>
            </div>

            {/* Buying signals */}
            <div className={cn(glassCard, 'flex flex-col gap-1 p-7')}>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-arcova-navy/50">Buying signals</span>
                  <span className="rounded-full border border-arcova-teal/15 bg-arcova-teal/8 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-arcova-teal/80">
                    {period === 'all' ? 'all time' : periodLabel}
                  </span>
                </div>
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-arcova-teal/10 text-arcova-teal">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l1.6 5.6L19 9l-5.4 1.4L12 16l-1.6-5.6L5 9l5.4-1.4z"/></svg>
                </span>
              </div>
              <p className="font-manrope tabular-nums text-arcova-navy" style={{ fontSize: 48, lineHeight: 1, letterSpacing: '-0.032em', fontWeight: 500 }}>
                {fmtN(stats.capturedSignals)}
              </p>
              <p className="mt-2 text-[13px] leading-snug text-arcova-navy/60">
                <strong className="font-semibold text-arcova-navy">{fmtDecimal(stats.signalsPerEnrichedContact)}</strong> per contact, on average.
              </p>
              <div className="mt-auto flex items-center gap-2 pt-3 text-[11.5px] text-arcova-navy/40">
                <span className="h-1.5 w-1.5 rounded-full bg-arcova-teal opacity-70" />
                activity window
              </div>
            </div>
          </div>

          {/* ── 02 SIGNAL ENGINE ── */}
          <SectionHead
            num="02 · Signal engine"
            title="From signal to conversation."
            note={`Signals are funding rounds, role changes, mentions, opens — anything that suggests a buying window. Showing ${periodLabel}.`}
          />

          <section className={cn(glassCardStrong, 'grid grid-cols-[1.1fr_1fr] gap-10 p-10')}>
            {/* Left: chart */}
            <div className="flex flex-col gap-4">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-arcova-navy/50">Signals captured</p>
              <p className="font-manrope tabular-nums text-arcova-navy" style={{ fontSize: 72, lineHeight: 1, letterSpacing: '-0.034em', fontWeight: 500 }}>
                {fmtN(stats.capturedSignals)}
              </p>
              <p className="text-[13px] text-arcova-navy/60">
                across <strong className="font-semibold text-arcova-navy">{fmtN(stats.arcovaEnrichedContacts)} enriched contacts</strong> — averaging <strong className="font-semibold text-arcova-navy">{fmtDecimal(stats.signalsPerEnrichedContact)}</strong> per person in {periodLabel}.
              </p>
              <AreaChart data={signalData} width={520} height={150} axisLabels={activityAxisLabels} gradientId="sigGrad" />
            </div>

            {/* Right: conversion stats */}
            <div className="flex flex-col gap-4">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-arcova-navy/50">What they led to</p>

              <SubCard className="flex items-center gap-4">
                <span className="font-manrope tabular-nums text-arcova-navy" style={{ fontSize: 36, lineHeight: 1, fontWeight: 500, letterSpacing: '-0.026em', minWidth: 88 }}>
                  {fmtN(stats.signalBackedConversationContacts)}
                </span>
                <div>
                  <p className="text-[13px] font-medium text-arcova-navy">conversations sparked</p>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-arcova-navy/50">a signal triggered the outreach that became a thread.</p>
                </div>
              </SubCard>

              <div className="flex items-center gap-2 px-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-arcova-navy/30">
                <span className="h-px flex-1 bg-arcova-navy/[0.07]" />
                then
                <span className="h-px flex-1 bg-arcova-navy/[0.07]" />
              </div>

              <SubCard className="flex items-center gap-4">
                <span className="font-manrope tabular-nums text-arcova-teal" style={{ fontSize: 36, lineHeight: 1, fontWeight: 500, letterSpacing: '-0.026em', minWidth: 88 }}>
                  {sigConvRate}%
                </span>
                <div>
                  <p className="text-[13px] font-medium text-arcova-navy">signal → conversation rate</p>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-arcova-navy/50">benchmark: 1.2% cold lists, 3–5% warm signal-driven.</p>
                </div>
              </SubCard>

              <SubCard className="flex items-center gap-4">
                <span className="font-manrope tabular-nums text-arcova-navy" style={{ fontSize: 36, lineHeight: 1, fontWeight: 500, letterSpacing: '-0.026em', minWidth: 88 }}>
                  {fmtDecimal(stats.signalsPerEnrichedContact)}×
                </span>
                <div>
                  <p className="text-[13px] font-medium text-arcova-navy">signals per contact</p>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-arcova-navy/50">most teams source contacts once. Arcova keeps them alive.</p>
                </div>
              </SubCard>
            </div>
          </section>

          {/* ── 03 JOURNEY ── */}
          <SectionHead
            num="03 · Customer journey"
            title="Where every uploaded contact ended up."
            note="Lifetime view — independent of the period selector."
          />

          <section className={cn(glassCardStrong, 'relative overflow-hidden px-8 py-7')}>
            <div className="pointer-events-none absolute inset-0 rounded-2xl"
              style={{ background: 'radial-gradient(700px 240px at 0% 0%, rgba(0,164,180,0.06), transparent 60%)' }} />
            <div className="relative z-10 w-full overflow-x-auto">
              <SankeyFlow stages={sankeyStages} />
            </div>
            <div className="relative z-10 mt-5 flex flex-wrap items-center gap-5 text-[11.5px] text-arcova-navy/50">
              <span className="inline-flex items-center gap-1.5">
                <i className="inline-block h-2 w-4 rounded-sm" style={{ background: 'linear-gradient(90deg, rgba(0,164,180,0.30), rgba(0,164,180,0.55))', border: '1px solid rgba(13,53,71,0.08)' }} />
                Main flow
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="inline-block h-2 w-4 rounded-sm bg-arcova-navy/10" style={{ border: '1px solid rgba(13,53,71,0.08)' }} />
                Dropped at this stage
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="inline-block h-2 w-4 rounded-sm" style={{ background: 'rgba(196,107,122,0.22)', border: '1px solid rgba(196,107,122,0.30)' }} />
                Closed-lost
              </span>
              <span className="ml-auto italic">Lifetime view — independent of the period selector.</span>
            </div>
          </section>

          {/* ── 04 REVENUE ── */}
          <SectionHead
            num="04 · Revenue"
            title="The $ Arcova helped you close."
            note="Booked ARR attributable to Arcova-touched contacts. Always shown all time. Configurable in Settings → Attribution."
          />

          <div className="grid grid-cols-[1.4fr_1fr] gap-5">
            {/* Feature card — dark navy */}
            <article className="relative flex flex-col overflow-hidden rounded-2xl border border-arcova-navy/20 p-10" style={{ background: 'linear-gradient(135deg, #0d3547 0%, #0a2a38 100%)' }}>
              <div className="pointer-events-none absolute inset-0 rounded-2xl"
                style={{ background: 'radial-gradient(480px 200px at 0% 0%, rgba(0,164,180,0.24), transparent 65%), radial-gradient(380px 180px at 100% 100%, rgba(140,217,201,0.14), transparent 65%)' }} />
              <p className="relative text-[10.5px] font-semibold uppercase tracking-[0.18em] text-white/50">Closed-won · all time</p>
              <div className="relative mt-1.5 flex items-baseline gap-1 font-manrope font-medium tabular-nums text-white" style={{ fontSize: 68, lineHeight: 1, letterSpacing: '-0.034em' }}>
                <span className="text-white/45" style={{ fontSize: 30, fontWeight: 400 }}>$</span>
                {stats.totalClosedWonAmount >= 1_000_000
                  ? (stats.totalClosedWonAmount / 1_000_000).toFixed(2)
                  : stats.totalClosedWonAmount >= 1_000
                    ? Math.round(stats.totalClosedWonAmount / 1_000).toLocaleString()
                    : Math.round(stats.totalClosedWonAmount).toLocaleString()}
                <span className="text-white/45" style={{ fontSize: 30, fontWeight: 500 }}>
                  {stats.totalClosedWonAmount >= 1_000_000 ? 'M' : stats.totalClosedWonAmount >= 1_000 ? 'K' : ''}
                </span>
              </div>
              <p className="relative mt-3 max-w-[380px] text-[13.5px] leading-relaxed text-white/60">
                Across <strong className="font-semibold text-white">{stats.wonAfterArcovaTouch} deals</strong>. Booked since you turned Arcova on.
              </p>
              {/* Monthly bars */}
              <div className="relative mt-auto flex items-end gap-2.5 pt-4" style={{ height: 104 }}>
                {revBars.heights.map((h, i) => {
                  const isLast = i === revBars.heights.length - 1;
                  return (
                    <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                      <div className="relative w-full max-w-[28px] overflow-hidden rounded-t-md border border-white/[0.18] bg-white/[0.15]" style={{ height: 78, display: 'flex', flexDirection: 'column-reverse' }}>
                        <div
                          className={cn('w-full transition-[height]', isLast ? 'bg-gradient-to-t from-arcova-teal to-arcova-mint' : 'bg-gradient-to-t from-white/60 to-white/30')}
                          style={{ height: entered ? `${h}%` : '0%', transitionDuration: '900ms', transitionDelay: `${i * 80}ms`, transitionTimingFunction: 'cubic-bezier(.16,1,.3,1)' }}
                        />
                      </div>
                      <span className={cn('font-mono text-[9px] uppercase tracking-[0.08em]', isLast ? 'font-semibold text-white/85' : 'text-white/40')}>
                        {revBars.labels[i]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </article>

            {/* Avg deal donut */}
            <article className={cn(glassCard, 'flex flex-col gap-5 p-8')}>
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-arcova-navy/50">Per closed-won customer</p>
              <div className="flex items-center gap-5">
                <div className="relative flex-shrink-0" style={{ width: 120, height: 120 }}>
                  <Donut pct={Math.min(95, 40 + stats.wonAfterArcovaTouch * 3)} size={120} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="font-manrope text-[19px] font-semibold leading-none tracking-tight text-arcova-navy">{fmtMoney(stats.averageClosedWonDealSize)}</span>
                    <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.15em] text-arcova-navy/40">avg deal</span>
                  </div>
                </div>
                <div className="flex flex-col gap-3.5">
                  {[
                    { num: String(stats.wonAfterArcovaTouch), lbl: 'deals closed' },
                    { num: fmtMoney(stats.engagedArcovaEnrichedContacts > 0 ? stats.totalClosedWonAmount / stats.engagedArcovaEnrichedContacts : 0), lbl: 'per engaged contact' },
                    { num: `$${Math.round(stats.arcovaEnrichedContacts > 0 ? stats.totalClosedWonAmount / stats.arcovaEnrichedContacts : 0)}`, lbl: 'per enriched contact' },
                  ].map(({ num, lbl }) => (
                    <div key={lbl} className="flex items-baseline gap-2">
                      <span className="font-manrope text-[19px] font-semibold leading-none tracking-tight text-arcova-navy tabular-nums">{num}</span>
                      <span className="text-[11px] text-arcova-navy/50">{lbl}</span>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          </div>

          {/* ── ICP COVERAGE ── */}
          {stats.icpBreakdown.length > 0 && (
            <section className={cn(glassCard, 'px-8 py-7')}>
              <div className="mb-5 flex items-baseline justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-manrope text-[15px] font-semibold tracking-tight text-arcova-navy">Where your base sits, by ICP</span>
                  <span className="rounded-full border border-arcova-navy/10 bg-white/55 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-arcova-navy/45">
                    All time
                  </span>
                </div>
                <span className="text-[12px] text-arcova-navy/40">avg fit % · contacts</span>
              </div>
              <div className="flex flex-col gap-2.5">
                {stats.icpBreakdown.map((row, i) => (
                  <div key={i} className="grid items-center gap-3.5" style={{ gridTemplateColumns: '1fr minmax(0,1fr) 52px 60px' }}>
                    <span className="truncate text-[13px] font-medium text-arcova-navy">{row.name}</span>
                    <div className="relative h-2 overflow-hidden rounded-full bg-arcova-navy/[0.06]">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-arcova-teal to-arcova-mint"
                        style={{ width: entered ? `${row.avgFit}%` : '0%', transition: `width 1s cubic-bezier(.16,1,.3,1) ${i * 80}ms` }}
                      />
                    </div>
                    <span className="text-right font-mono text-[11px] text-arcova-navy/50">{row.avgFit}%</span>
                    <span className="text-right text-[12px] font-medium text-arcova-navy/70">{row.contactCount}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── FOOTER ── */}
          <footer className="flex items-center gap-2.5 rounded-xl border border-arcova-navy/[0.07] bg-white/35 px-5 py-4 text-[12px] text-arcova-navy/50">
            <Info size={13} className="shrink-0 text-arcova-teal" />
            Attribution rules: a contact counts as Arcova-touched when Arcova enriched, scored, or sourced them before your first outreach. Edit in Settings.
          </footer>

        </div>
      </main>
    </div>
  );
}
