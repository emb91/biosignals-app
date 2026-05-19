'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { supabase } from '@/lib/supabase';
import { Loader2, TrendingUp, Info } from 'lucide-react';

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
function fmtN(n: number) { return n.toLocaleString('en-US'); }
function fmtMoney(n: number) {
  if (!Number.isFinite(n) || n <= 0) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}
function fmtDecimal(v: number) {
  if (!Number.isFinite(v) || v <= 0) return '0';
  return v.toFixed(1).replace(/\.0$/, '');
}

/* Generate a smooth ascending curve ending at `total`, n points */
function signalCurve(total: number, n = 17): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = i / (n - 1);
    const base = total * (p * p * 0.6 + p * 0.4);
    out.push(Math.max(0, Math.round(base)));
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
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/* ─── AreaChart ─── */
function AreaChart({
  data,
  width = 520,
  height = 160,
  accent = '#00A4B4',
  gradientId = 'aGrad',
  axisLabels = [] as string[],
}: {
  data: number[];
  width?: number;
  height?: number;
  accent?: string;
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
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', display: 'block', height }} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.36" />
            <stop offset="60%" stopColor={accent} stopOpacity="0.10" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((p, i) => (
          <line key={i} x1={P.l} x2={width - P.r}
            y1={P.t + iH * p} y2={P.t + iH * p}
            stroke="rgba(13,53,71,0.06)" strokeWidth="1" />
        ))}
        <path d={area} fill={`url(#${gradientId})`} />
        <path d={line} fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={lx} cy={ly} r="9" fill={accent} fillOpacity="0.16" />
        <circle cx={lx} cy={ly} r="4" fill={accent} stroke="white" strokeWidth="2" />
      </svg>
      {axisLabels.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10.5, color: '#b6c2c8', fontFamily: 'var(--font-jetbrains-mono)', letterSpacing: 0 }}>
          {axisLabels.map((l, i) => <span key={i}>{l}</span>)}
        </div>
      )}
    </div>
  );
}

/* ─── Donut ─── */
function Donut({ pct = 70, accent = '#00A4B4', size = 132 }) {
  const r = size / 2 - 9;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(13,53,71,0.06)" strokeWidth="9" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={accent} strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c - dash}`}
        strokeDashoffset={c / 4}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray 1s cubic-bezier(.16,1,.3,1)' }}
      />
    </svg>
  );
}

/* ─── Page ─── */
export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [stats, setStats] = useState<DashboardStats>(emptyStats);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, router, user]);

  useEffect(() => {
    const fetchDashboardData = async () => {
      if (!user) return;
      try {
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
            .select('contact_id, is_arcova_sourced, is_arcova_enriched, won_after_arcova_touch, latest_closed_won_at')
            .eq('user_id', user.id),
          supabase.from('normalized_signals')
            .select('signal_scope, contact_id, company_id')
            .eq('user_id', user.id),
          supabase.from('crm_deal_contact_links')
            .select('arcova_contact_id, hubspot_deal_id')
            .eq('user_id', user.id)
            .not('arcova_contact_id', 'is', null),
          supabase.from('crm_deals')
            .select('hubspot_deal_id, deal_stage, amount')
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

        const customerSnapshots = (attributionSnapshots ?? []).filter(
          (s) => typeof s.latest_closed_won_at === 'string' && s.latest_closed_won_at.length > 0,
        );
        const arcovaEnrichedContactIds = new Set(
          (attributionSnapshots ?? [])
            .filter((s) => s.is_arcova_enriched === true && typeof s.contact_id === 'string')
            .map((s) => s.contact_id as string),
        );
        const arcovaEnrichedContacts = arcovaEnrichedContactIds.size;
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
          const cur = dealIdsByEnrichedContact.get(contactId) ?? [];
          cur.push(dealId);
          dealIdsByEnrichedContact.set(contactId, cur);
        }
        const engagedArcovaEnrichedContacts = dealIdsByEnrichedContact.size;
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
            if ((deal?.deal_stage ?? '').toLowerCase() === 'closedwon') closedWonDealIds.add(dealId);
          }
        }
        const totalClosedWonAmount = Array.from(closedWonDealIds).reduce((sum, dealId) => {
          const amount = dealsById.get(dealId)?.amount;
          return typeof amount === 'number' && Number.isFinite(amount) ? sum + amount : sum;
        }, 0);
        const averageClosedWonDealSize = closedWonDealIds.size > 0 ? totalClosedWonAmount / closedWonDealIds.size : 0;

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
          totalClosedWonAmount,
          averageClosedWonDealSize,
          icpBreakdown,
        });
      } catch (err) {
        console.error('Error loading dashboard data:', err);
      } finally {
        setLoadingDashboard(false);
        setTimeout(() => setEntered(true), 80);
      }
    };
    void fetchDashboardData();
  }, [user]);

  const signalData = useMemo(() => signalCurve(Math.max(stats.capturedSignals, 10)), [stats.capturedSignals]);
  const engagedPct = stats.arcovaEnrichedContacts > 0 ? (stats.engagedArcovaEnrichedContacts / stats.arcovaEnrichedContacts) * 100 : 0;
  const wonPct = stats.arcovaEnrichedContacts > 0 ? (stats.wonAfterArcovaTouch / stats.arcovaEnrichedContacts) * 100 : 0;
  const engagedBarW = Math.max(8, engagedPct);
  const wonBarW = Math.max(4, wonPct);
  const donutPct = Math.min(95, 40 + stats.wonAfterArcovaTouch * 3);
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

  /* ─── ink / glass token shorthands ─── */
  const ink = '#0d3547';
  const inkSoft = '#4a6470';
  const inkMute = '#7d909a';
  const inkFaint = '#b6c2c8';
  const accent = '#00A4B4';
  const accentSoft = '#8CD9C9';
  const glass = 'rgba(255,255,255,0.55)';
  const glassStrong = 'rgba(255,255,255,0.78)';
  const glassEdge = 'rgba(255,255,255,0.85)';
  const glassLine = 'rgba(13,53,71,0.07)';

  const cardBase: React.CSSProperties = {
    background: glassStrong,
    border: `1px solid ${glassEdge}`,
    borderRadius: 26,
    backdropFilter: 'blur(28px) saturate(150%)',
    WebkitBackdropFilter: 'blur(28px) saturate(150%)',
    boxShadow: '0 24px 60px -32px rgba(13,53,71,0.18), 0 2px 6px -2px rgba(13,53,71,0.06)',
  };

  const cardLight: React.CSSProperties = {
    background: glass,
    border: `1px solid ${glassEdge}`,
    borderRadius: 22,
    backdropFilter: 'blur(28px) saturate(150%)',
    WebkitBackdropFilter: 'blur(28px) saturate(150%)',
  };

  const eyebrow: React.CSSProperties = {
    fontSize: 10.5, fontWeight: 600, letterSpacing: '0.18em',
    textTransform: 'uppercase', color: inkMute,
  };

  const sectionEyebrow: React.CSSProperties = {
    ...eyebrow, letterSpacing: '0.2em', marginBottom: 6,
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'transparent' }}>
      <AppSidebar />

      <main style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
        <div style={{
          maxWidth: 1280, margin: '0 auto', width: '100%',
          display: 'flex', flexDirection: 'column', gap: 28,
          padding: '32px 36px 120px',
        }}>

          {/* ── PAGE HEADER ── */}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 32, padding: '4px 2px 8px' }}>
            <div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 14, ...eyebrow }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent, boxShadow: '0 0 0 4px rgba(0,164,180,0.16)', display: 'inline-block' }} />
                Your impact with Arcova · all time
              </div>
              <h1 style={{
                margin: 0, fontFamily: 'var(--font-manrope), sans-serif',
                fontSize: 44, lineHeight: 1.04, letterSpacing: '-0.034em', fontWeight: 500,
                color: ink, maxWidth: 760,
              }}>
                You closed{' '}
                <span style={{
                  background: 'linear-gradient(135deg, #00A4B4, #007e8b)',
                  WebkitBackgroundClip: 'text', backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}>
                  {fmtMoney(stats.totalClosedWonAmount)}
                </span>{' '}
                in deals with contacts Arcova touched.
              </h1>
              <p style={{ margin: '14px 0 0', maxWidth: 580, fontSize: 15, lineHeight: 1.55, color: inkSoft }}>
                Arcova enriched <strong style={{ fontWeight: 600, color: ink }}>{fmtN(stats.arcovaEnrichedContacts)} contacts</strong> across{' '}
                <strong style={{ fontWeight: 600, color: ink }}>{fmtN(stats.companies)} companies</strong>, captured{' '}
                <strong style={{ fontWeight: 600, color: ink }}>{fmtN(stats.capturedSignals)} buying signals</strong>, and sparked{' '}
                <strong style={{ fontWeight: 600, color: ink }}>{fmtN(stats.signalBackedConversationContacts)} conversations</strong>.{' '}
                {stats.wonAfterArcovaTouch} of those became customers.
              </p>
            </div>
          </div>

          {/* ── HERO ── */}
          <section style={{
            ...cardBase,
            padding: '32px 36px 28px',
            overflow: 'hidden',
            display: 'grid',
            gridTemplateColumns: '1.3fr 1fr',
            gap: 28,
            alignItems: 'stretch',
            position: 'relative',
          }}>
            <div style={{
              content: '', position: 'absolute', inset: 0,
              background: 'radial-gradient(800px 320px at 0% 0%, rgba(0,164,180,0.08), transparent 60%), radial-gradient(700px 360px at 110% 110%, rgba(140,217,201,0.18), transparent 60%)',
              pointerEvents: 'none',
            }} />

            {/* Left: big number */}
            <div style={{ position: 'relative', zIndex: 1 }}>
              <p style={{ ...eyebrow, margin: '0 0 14px' }}>Revenue · Arcova-touched contacts</p>
              <div style={{
                fontFamily: 'var(--font-manrope), sans-serif',
                fontSize: 96, lineHeight: 0.95, letterSpacing: '-0.04em', fontWeight: 500,
                color: ink, display: 'flex', alignItems: 'baseline', gap: 6,
                fontVariantNumeric: 'tabular-nums',
              }}>
                <span style={{ fontSize: 38, fontWeight: 400, color: inkSoft }}>$</span>
                {stats.totalClosedWonAmount >= 1_000_000
                  ? (stats.totalClosedWonAmount / 1_000_000).toFixed(2)
                  : stats.totalClosedWonAmount >= 1_000
                    ? Math.round(stats.totalClosedWonAmount / 1_000).toLocaleString()
                    : Math.round(stats.totalClosedWonAmount).toLocaleString()}
                <span style={{ fontSize: 38, fontWeight: 500, color: inkSoft }}>
                  {stats.totalClosedWonAmount >= 1_000_000 ? 'M' : stats.totalClosedWonAmount >= 1_000 ? 'K' : ''}
                </span>
              </div>
              <p style={{ fontSize: 15, color: inkSoft, margin: '14px 0 0', lineHeight: 1.55, maxWidth: 460 }}>
                <strong style={{ color: ink, fontWeight: 600 }}>{stats.wonAfterArcovaTouch} closed-won</strong> deals where Arcova enriched the contact, surfaced a signal, or sourced the lead. Average deal size <strong style={{ color: ink, fontWeight: 600 }}>{fmtMoney(stats.averageClosedWonDealSize)}</strong>.
              </p>
              <span style={{
                marginTop: 22, display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '6px 12px 6px 8px',
                background: 'rgba(0,164,180,0.1)', border: '1px solid rgba(0,164,180,0.22)',
                borderRadius: 999, color: '#00707b', fontSize: 12, fontWeight: 600,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: '#00707b', boxShadow: '0 0 0 4px rgba(0,164,180,0.18)', display: 'inline-block' }} />
                Tracking since launch
              </span>
            </div>

            {/* Right: chart */}
            <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '4px 0', minHeight: 220 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                <span style={{ ...eyebrow }}>Signal velocity</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: inkMute }}>
                  <i style={{ width: 8, height: 8, borderRadius: '50%', background: accent, display: 'inline-block' }} />
                  signals captured / week
                </span>
              </div>
              <AreaChart data={signalData} width={560} height={180} axisLabels={['since launch', '', '', 'this wk']} gradientId="heroGrad" />
            </div>
          </section>

          {/* ── 01 FOUNDATION ── */}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, padding: '4px 4px 0', marginTop: 14 }}>
            <div>
              <p style={{ ...sectionEyebrow }}>01 · Foundation</p>
              <h2 style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 26, lineHeight: 1.15, letterSpacing: '-0.024em', fontWeight: 500, color: ink, margin: 0 }}>What Arcova built into your base.</h2>
            </div>
            <p style={{ fontSize: 13, color: inkMute, maxWidth: 340, textAlign: 'right', lineHeight: 1.5, margin: 0 }}>
              Continuously refreshed — every contact, signal, and ICP scored against your model.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            {/* Contacts enriched */}
            <div style={{ ...cardLight, padding: '22px 22px 20px', display: 'flex', flexDirection: 'column', gap: 4, position: 'relative', overflow: 'hidden', minHeight: 168 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ ...eyebrow, letterSpacing: '0.16em' }}>Contacts enriched</span>
                <span style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', background: 'rgba(0,164,180,0.1)', color: accent, borderRadius: 9 }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>
                </span>
              </div>
              <p style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 52, lineHeight: 0.95, letterSpacing: '-0.034em', fontWeight: 500, color: ink, margin: '6px 0 0', fontVariantNumeric: 'tabular-nums' }}>
                {fmtN(stats.arcovaEnrichedContacts)}
              </p>
              <p style={{ fontSize: 13.5, color: inkSoft, margin: '8px 0 0', lineHeight: 1.45 }}>people, with role, signals, and scientific context.</p>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 20, marginTop: 'auto' }}>
                {[14, 16, 22, 18, 26, 24, 30, 28, 34, 32, 38].map((h, i) => (
                  <span key={i} style={{
                    width: 6, borderRadius: 2, opacity: 0.85,
                    background: `linear-gradient(180deg, ${accent}, ${accentSoft})`,
                    height: entered ? h : 0,
                    transition: `height .6s cubic-bezier(.16,1,.3,1) ${i * 40}ms`,
                  }} />
                ))}
              </div>
            </div>

            {/* Companies covered */}
            <div style={{ ...cardLight, padding: '22px 22px 20px', display: 'flex', flexDirection: 'column', gap: 4, minHeight: 168 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ ...eyebrow, letterSpacing: '0.16em' }}>Companies covered</span>
                <span style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', background: 'rgba(0,164,180,0.1)', color: accent, borderRadius: 9 }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-7h6v7"/></svg>
                </span>
              </div>
              <p style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 52, lineHeight: 0.95, letterSpacing: '-0.034em', fontWeight: 500, color: ink, margin: '6px 0 0', fontVariantNumeric: 'tabular-nums' }}>
                {fmtN(stats.companies)}
              </p>
              <p style={{ fontSize: 13.5, color: inkSoft, margin: '8px 0 0', lineHeight: 1.45 }}>accounts modelled — firmographics, funding, news.</p>
              <div style={{ marginTop: 'auto', paddingTop: 14, display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: inkMute }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent, opacity: 0.7, display: 'inline-block' }} />
                {stats.icps} ICP{stats.icps !== 1 ? 's' : ''} · refreshed weekly
              </div>
            </div>

            {/* Buying signals */}
            <div style={{ ...cardLight, padding: '22px 22px 20px', display: 'flex', flexDirection: 'column', gap: 4, minHeight: 168 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ ...eyebrow, letterSpacing: '0.16em' }}>Buying signals captured</span>
                <span style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', background: 'rgba(0,164,180,0.1)', color: accent, borderRadius: 9 }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l1.6 5.6L19 9l-5.4 1.4L12 16l-1.6-5.6L5 9l5.4-1.4z"/></svg>
                </span>
              </div>
              <p style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 52, lineHeight: 0.95, letterSpacing: '-0.034em', fontWeight: 500, color: ink, margin: '6px 0 0', fontVariantNumeric: 'tabular-nums' }}>
                {fmtN(stats.capturedSignals)}
              </p>
              <p style={{ fontSize: 13.5, color: inkSoft, margin: '8px 0 0', lineHeight: 1.45 }}>
                <strong style={{ color: ink, fontWeight: 600 }}>{fmtDecimal(stats.signalsPerEnrichedContact)}</strong> per contact, on average.
              </p>
              <div style={{ marginTop: 'auto', paddingTop: 14, display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: inkMute }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent, opacity: 0.7, display: 'inline-block' }} />
                still streaming
              </div>
            </div>
          </div>

          {/* ── 02 SIGNAL ENGINE ── */}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, padding: '4px 4px 0', marginTop: 14 }}>
            <div>
              <p style={{ ...sectionEyebrow }}>02 · Signal engine</p>
              <h2 style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 26, lineHeight: 1.15, letterSpacing: '-0.024em', fontWeight: 500, color: ink, margin: 0 }}>From signal to conversation.</h2>
            </div>
            <p style={{ fontSize: 13, color: inkMute, maxWidth: 340, textAlign: 'right', lineHeight: 1.5, margin: 0 }}>
              Signals are funding rounds, role changes, mentions, opens — anything that suggests a buying window.
            </p>
          </div>

          <section style={{ ...cardBase, padding: '28px 32px 24px', display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 32, position: 'relative', overflow: 'hidden' }}>
            {/* Left: chart */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <p style={{ ...eyebrow, margin: 0 }}>Signals captured</p>
              <p style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 80, lineHeight: 0.95, letterSpacing: '-0.036em', fontWeight: 500, color: ink, margin: '4px 0 0', fontVariantNumeric: 'tabular-nums' }}>
                {fmtN(stats.capturedSignals)}
              </p>
              <p style={{ fontSize: 13.5, color: inkSoft, margin: '6px 0 0' }}>
                across <strong style={{ color: ink, fontWeight: 600 }}>{fmtN(stats.arcovaEnrichedContacts)} contacts</strong> — averaging <strong style={{ color: ink, fontWeight: 600 }}>{fmtDecimal(stats.signalsPerEnrichedContact)}</strong> per person.
              </p>
              <AreaChart data={signalData} width={520} height={150} axisLabels={['since launch', '', '', 'this wk']} gradientId="sigGrad" />
            </div>

            {/* Right: conversion stats */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <p style={{ ...eyebrow, margin: 0 }}>What they led to</p>

              <div style={{ background: 'rgba(255,255,255,0.55)', border: `1px solid ${glassLine}`, borderRadius: 16, padding: 18, display: 'flex', alignItems: 'center', gap: 18 }}>
                <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 38, lineHeight: 1, fontWeight: 500, color: ink, letterSpacing: '-0.028em', minWidth: 96, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtN(stats.signalBackedConversationContacts)}
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13, color: ink, fontWeight: 500 }}>conversations sparked</span>
                  <span style={{ fontSize: 12, color: inkMute, lineHeight: 1.45 }}>a signal triggered the outreach that became a thread.</span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: inkFaint, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600, padding: '0 4px' }}>
                <span style={{ flex: 1, height: 1, background: glassLine }} />
                then
                <span style={{ flex: 1, height: 1, background: glassLine }} />
              </div>

              <div style={{ background: 'rgba(255,255,255,0.55)', border: `1px solid ${glassLine}`, borderRadius: 16, padding: 18, display: 'flex', alignItems: 'center', gap: 18 }}>
                <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 38, lineHeight: 1, fontWeight: 500, color: accent, letterSpacing: '-0.028em', minWidth: 96, fontVariantNumeric: 'tabular-nums' }}>
                  {sigConvRate}%
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13, color: ink, fontWeight: 500 }}>signal → conversation rate</span>
                  <span style={{ fontSize: 12, color: inkMute, lineHeight: 1.45 }}>benchmark: 1.2% for cold lists, 3–5% for warm signal-driven.</span>
                </div>
              </div>

              <div style={{ background: 'rgba(255,255,255,0.55)', border: `1px solid ${glassLine}`, borderRadius: 16, padding: 18, display: 'flex', alignItems: 'center', gap: 18 }}>
                <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 38, lineHeight: 1, fontWeight: 500, color: ink, letterSpacing: '-0.028em', minWidth: 96, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtDecimal(stats.signalsPerEnrichedContact)}×
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13, color: ink, fontWeight: 500 }}>signals per contact</span>
                  <span style={{ fontSize: 12, color: inkMute, lineHeight: 1.45 }}>most teams source contacts once. Arcova keeps them alive.</span>
                </div>
              </div>
            </div>
          </section>

          {/* ── 03 CUSTOMER FUNNEL ── */}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, padding: '4px 4px 0', marginTop: 14 }}>
            <div>
              <p style={{ ...sectionEyebrow }}>03 · Customer funnel</p>
              <h2 style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 26, lineHeight: 1.15, letterSpacing: '-0.024em', fontWeight: 500, color: ink, margin: 0 }}>How Arcova-enriched contacts moved through your pipeline.</h2>
            </div>
            <p style={{ fontSize: 13, color: inkMute, maxWidth: 340, textAlign: 'right', lineHeight: 1.5, margin: 0 }}>
              Every contact below was enriched, scored, or sourced by Arcova before you touched them.
            </p>
          </div>

          <section style={{ ...cardLight, padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 0 }}>
            {[
              { name: 'Enriched by Arcova', sub: 'contacts in your base', value: stats.arcovaEnrichedContacts, barW: '100%', pct: '100%', deep: true },
              { name: 'Engaged with you', sub: 'replied, booked, or opened a thread', value: stats.engagedArcovaEnrichedContacts, barW: `${engagedBarW}%`, pct: `${engagedPct.toFixed(1)}%`, deep: false },
              { name: 'Closed-won', sub: 'became customers', value: stats.wonAfterArcovaTouch, barW: `${wonBarW}%`, pct: `${wonPct.toFixed(2)}%`, deep: true },
            ].map((row, i, arr) => (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '200px 1fr 160px',
                gap: 20, alignItems: 'center', padding: '14px 0',
                borderBottom: i < arr.length - 1 ? `1px solid ${glassLine}` : 'none',
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 15, fontWeight: 600, color: ink, letterSpacing: '-0.012em' }}>{row.name}</span>
                  <span style={{ fontSize: 11.5, color: inkMute }}>{row.sub}</span>
                </div>
                <div style={{ height: 30, position: 'relative', background: 'rgba(255,255,255,0.4)', borderRadius: 10, overflow: 'hidden', border: `1px solid ${glassLine}` }}>
                  <div style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0,
                    width: entered ? row.barW : '0%',
                    background: row.deep
                      ? `linear-gradient(90deg, ${accent}, #007e8b)`
                      : `linear-gradient(90deg, rgba(0,164,180,0.85), rgba(140,217,201,0.7))`,
                    borderRadius: 9,
                    transition: 'width .8s cubic-bezier(.16,1,.3,1)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.4)',
                  }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 32, lineHeight: 1, fontWeight: 500, color: ink, letterSpacing: '-0.028em', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtN(row.value)}
                  </span>
                  <span style={{ fontSize: 11, color: inkMute, fontFamily: 'var(--font-jetbrains-mono)', marginTop: 4 }}>{row.pct}</span>
                </div>
              </div>
            ))}
          </section>

          {/* ── 04 REVENUE ── */}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, padding: '4px 4px 0', marginTop: 14 }}>
            <div>
              <p style={{ ...sectionEyebrow }}>04 · Revenue</p>
              <h2 style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 26, lineHeight: 1.15, letterSpacing: '-0.024em', fontWeight: 500, color: ink, margin: 0 }}>The $ Arcova helped you close.</h2>
            </div>
            <p style={{ fontSize: 13, color: inkMute, maxWidth: 340, textAlign: 'right', lineHeight: 1.5, margin: 0 }}>
              Booked ARR attributable to Arcova-touched contacts. Configurable in Settings → Attribution.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14 }}>
            {/* Feature card — dark */}
            <article style={{
              background: 'linear-gradient(135deg, #0d3547 0%, #0a2a38 100%)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 26,
              padding: '28px 32px',
              display: 'flex', flexDirection: 'column', gap: 14,
              position: 'relative', overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(500px 220px at 0% 0%, rgba(0,164,180,0.28), transparent 60%), radial-gradient(400px 200px at 100% 100%, rgba(140,217,201,0.18), transparent 60%)', pointerEvents: 'none' }} />
              <p style={{ ...eyebrow, color: 'rgba(255,255,255,0.5)', margin: 0, position: 'relative' }}>Closed-won · all time</p>
              <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 72, lineHeight: 0.95, letterSpacing: '-0.036em', fontWeight: 500, color: 'white', margin: '6px 0 0', display: 'flex', alignItems: 'baseline', gap: 2, fontVariantNumeric: 'tabular-nums', position: 'relative' }}>
                <span style={{ fontSize: 32, color: 'rgba(255,255,255,0.55)', fontWeight: 400 }}>$</span>
                {stats.totalClosedWonAmount >= 1_000_000
                  ? (stats.totalClosedWonAmount / 1_000_000).toFixed(2)
                  : stats.totalClosedWonAmount >= 1_000
                    ? Math.round(stats.totalClosedWonAmount / 1_000).toLocaleString()
                    : Math.round(stats.totalClosedWonAmount).toLocaleString()}
                <span style={{ fontSize: 32, color: 'rgba(255,255,255,0.55)', fontWeight: 500 }}>
                  {stats.totalClosedWonAmount >= 1_000_000 ? 'M' : stats.totalClosedWonAmount >= 1_000 ? 'K' : ''}
                </span>
              </div>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.66)', margin: '4px 0 0', lineHeight: 1.5, maxWidth: 460, position: 'relative' }}>
                Across <strong style={{ color: 'white', fontWeight: 600 }}>{stats.wonAfterArcovaTouch} deals</strong>. Booked since you turned Arcova on.
              </p>
            </article>

            {/* Avg deal + stats */}
            <article style={{ ...cardBase, padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ ...eyebrow, margin: 0 }}>Per closed-won customer</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 6 }}>
                <div style={{ position: 'relative', width: 132, height: 132, flexShrink: 0 }}>
                  <Donut pct={donutPct} />
                  <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontFamily: 'var(--font-manrope), sans-serif', fontSize: 22, lineHeight: 1, fontWeight: 600, color: ink, letterSpacing: '-0.02em', textAlign: 'center' }}>
                    <div>
                      {fmtMoney(stats.averageClosedWonDealSize)}
                      <small style={{ display: 'block', fontSize: 9.5, color: inkMute, letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 600, marginTop: 4 }}>avg deal</small>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { num: String(stats.wonAfterArcovaTouch), lbl: 'deals closed' },
                    { num: fmtMoney(stats.engagedArcovaEnrichedContacts > 0 ? stats.totalClosedWonAmount / stats.engagedArcovaEnrichedContacts : 0), lbl: 'revenue per engaged contact' },
                    { num: String(Math.round(stats.arcovaEnrichedContacts > 0 ? stats.totalClosedWonAmount / stats.arcovaEnrichedContacts : 0)), lbl: '$ earned per enriched contact' },
                  ].map(({ num, lbl }, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 22, fontWeight: 600, color: ink, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{num}</span>
                      <span style={{ fontSize: 11.5, color: inkMute }}>{lbl}</span>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          </div>

          {/* ── ICP COVERAGE ── */}
          {stats.icpBreakdown.length > 0 && (
            <section style={{ ...cardLight, padding: '22px 26px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
                <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 15, fontWeight: 600, color: ink, letterSpacing: '-0.012em' }}>Where your base sits, by ICP</span>
                <span style={{ fontSize: 12, color: inkMute }}>average fit % · contact count</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {stats.icpBreakdown.map((row, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '200px 1fr 60px 70px', gap: 14, alignItems: 'center' }}>
                    <span style={{ fontSize: 13, color: ink, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.name}</span>
                    <div style={{ position: 'relative', height: 8, background: 'rgba(13,53,71,0.06)', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, background: `linear-gradient(90deg, ${accent}, ${accentSoft})`, borderRadius: 999, width: entered ? `${row.avgFit}%` : '0%', transition: `width 1s cubic-bezier(.16,1,.3,1) ${i * 80}ms` }} />
                    </div>
                    <span style={{ fontFamily: 'var(--font-jetbrains-mono)', fontSize: 11.5, color: inkMute, textAlign: 'right' }}>{row.avgFit}%</span>
                    <span style={{ fontSize: 12.5, color: inkSoft, fontWeight: 500, textAlign: 'right' }}>{row.contactCount}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── FOOTER ── */}
          <footer style={{ marginTop: 18, padding: '14px 18px', background: 'rgba(255,255,255,0.45)', border: `1px solid ${glassLine}`, borderRadius: 14, fontSize: 12, color: inkMute, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Info size={13} style={{ color: accent, flexShrink: 0 }} />
            Attribution rules: a contact counts as Arcova-touched when Arcova enriched, scored, or sourced them before your first outreach. Edit in Settings.
          </footer>

        </div>
      </main>
    </div>
  );
}
