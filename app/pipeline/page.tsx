'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { AgentPanel } from '@/components/AgentPanel';
import { Building2, Kanban, Loader2, Plus, Users, ArrowRight } from 'lucide-react';
import {
  healthLabel,
  isWeakDim,
  type HealthDim,
  type PipelineDataRequestType,
} from '@/lib/pipeline-icp-health';
import { cn } from '@/lib/utils';

interface IcpPipelineCard {
  icp_id: string;
  icp_index: number;
  label: string;
  company_count: number;
  avg_contact_fit: number | null;
  avg_contacts_per_company: number | null;
  thin_data: boolean;
  coverage: HealthDim;
  contact_fit: HealthDim;
  depth: HealthDim;
  overall: HealthDim;
}

function healthAccentClass(d: HealthDim): string {
  switch (d) {
    case 'red':    return 'border-l-red-400';
    case 'amber':  return 'border-l-amber-400';
    case 'green':  return 'border-l-emerald-400';
  }
}

function HealthBadge({ dim }: { dim: HealthDim }) {
  const cls =
    dim === 'red'
      ? 'bg-red-50 text-red-700 border-red-200'
      : dim === 'amber'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-emerald-50 text-emerald-700 border-emerald-200';
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium', cls)}>
      {healthLabel(dim)}
    </span>
  );
}

function DimStatusDot({ dim }: { dim: HealthDim }) {
  const cls =
    dim === 'red'
      ? 'bg-red-400'
      : dim === 'amber'
        ? 'bg-amber-400'
        : 'bg-emerald-400';
  return <span className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', cls)} />;
}

function MetricBlock({
  icon,
  title,
  value,
  dim,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  dim: HealthDim;
}) {
  return (
    <div className="flex flex-col gap-1.5 px-4 py-3 min-w-0">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-gray-400 uppercase tracking-wide">
        {icon}
        {title}
      </div>
      <p className="text-base font-semibold text-gray-900 tabular-nums leading-snug">{value}</p>
      <div className="flex items-center gap-1.5">
        <DimStatusDot dim={dim} />
        <span className="text-[11px] text-gray-500">{healthLabel(dim)}</span>
      </div>
    </div>
  );
}

function buildCtas(card: IcpPipelineCard): { type: PipelineDataRequestType; label: string }[] {
  const out: { type: PipelineDataRequestType; label: string }[] = [];
  if (isWeakDim(card.coverage)) {
    out.push({ type: 'expand_companies', label: 'Find more companies for this ICP' });
  }
  if (card.company_count > 0 && isWeakDim(card.contact_fit)) {
    out.push({ type: 'better_contacts', label: 'Find better contacts for this ICP' });
  }
  if (card.company_count > 0 && isWeakDim(card.depth)) {
    out.push({
      type: 'more_contacts_at_accounts',
      label:
        card.icp_index > 0
          ? `Find more contacts at your ICP ${card.icp_index} accounts`
          : 'Find more contacts at accounts for this ICP',
    });
  }
  return out;
}

function formatFitValue(avg: number | null): string {
  if (avg == null || !Number.isFinite(avg)) return '—';
  return `${Math.round(avg * 100)}%`;
}

function formatDepthValue(avg: number | null): string {
  if (avg == null || !Number.isFinite(avg)) return '—';
  return `${avg.toFixed(1)}`;
}

export default function PipelinePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [cards, setCards] = useState<IcpPipelineCard[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadCards = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch('/api/pipeline/icp-cards');
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Failed to load pipeline');
      }
      setCards((payload.cards ?? []) as IcpPipelineCard[]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load');
      setCards([]);
    }
  }, []);

  useEffect(() => {
    if (user) void loadCards();
  }, [user, loadCards]);

  const openDataRequest = (card: IcpPipelineCard, requestType: PipelineDataRequestType) => {
    const mode = requestType === 'expand_companies' ? 'companies' : 'contacts_for_icp';
    const params = new URLSearchParams({
      mode,
      icpId: card.icp_id,
      requestType,
      source: 'pipeline',
    });
    router.push(`/data?${params.toString()}`);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-arcova-teal" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen bg-gray-50">
      <AppSidebar />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto p-6">
          <div className="w-full max-w-2xl mx-auto">

            <div className="mb-6">
              <h1 className="text-2xl font-bold text-gray-900">Pipeline</h1>
              <p className="text-gray-500 mt-1 text-sm">
                ICP health at a glance — weakest coverage floats to the top.
              </p>
            </div>

            {cards === null ? (
              <div className="flex justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-arcova-teal" />
              </div>
            ) : loadError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {loadError}
              </div>
            ) : cards.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
                <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Kanban className="w-6 h-6 text-gray-400" />
                </div>
                <h2 className="text-base font-semibold text-gray-900 mb-1">No ICPs yet</h2>
                <p className="text-gray-400 text-sm mb-5 max-w-xs mx-auto">
                  Define at least one ICP to see pipeline health here.
                </p>
                <button
                  type="button"
                  onClick={() => router.push('/company-criteria/new')}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-arcova-teal text-white text-sm font-semibold rounded-lg hover:bg-arcova-teal/90 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add an ICP
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {cards.map((card) => {
                  const ctas = buildCtas(card);
                  const showCtas = ctas.length > 0;

                  return (
                    <article
                      key={card.icp_id}
                      className={cn(
                        'bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden border-l-4',
                        healthAccentClass(card.overall),
                      )}
                    >
                      {/* Header */}
                      <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
                        <div className="min-w-0">
                          <h2 className="text-sm font-semibold text-gray-900 leading-snug">{card.label}</h2>
                        </div>
                        <div className="shrink-0 flex items-center gap-2">
                          <span className="text-[11px] text-gray-400">Overall</span>
                          <HealthBadge dim={card.overall} />
                        </div>
                      </div>

                      {card.thin_data && (
                        <div className="mx-5 mb-3 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-[11px] text-gray-500 leading-relaxed">
                          Not enough data to assess — fewer than 5 companies matched so far.
                        </div>
                      )}

                      {/* Metrics */}
                      <div className="mx-5 mb-4 grid grid-cols-3 divide-x divide-gray-100 rounded-lg border border-gray-100 bg-gray-50/60 overflow-hidden">
                        <MetricBlock
                          icon={<Building2 className="w-3 h-3" />}
                          title="Companies"
                          value={`${card.company_count}`}
                          dim={card.coverage}
                        />
                        <MetricBlock
                          icon={<Users className="w-3 h-3" />}
                          title="Avg fit"
                          value={formatFitValue(card.avg_contact_fit)}
                          dim={card.contact_fit}
                        />
                        <MetricBlock
                          icon={<Users className="w-3 h-3" />}
                          title="Depth"
                          value={formatDepthValue(card.avg_contacts_per_company)}
                          dim={card.depth}
                        />
                      </div>

                      {/* CTAs */}
                      {showCtas && (
                        <div className="border-t border-gray-100 px-5 py-3 flex flex-col sm:flex-row flex-wrap gap-2">
                          {ctas.map((cta) => {
                            return (
                              <button
                                key={cta.type}
                                type="button"
                                onClick={() => openDataRequest(card, cta.type)}
                                className="inline-flex items-center gap-1.5 rounded-full border border-arcova-teal/30 bg-white px-3 py-1.5 text-xs font-semibold text-arcova-teal hover:border-arcova-teal hover:bg-arcova-teal/5 disabled:opacity-60 transition-colors"
                              >
                                <ArrowRight className="h-3 w-3" />
                                {cta.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <AgentPanel page="pipeline" />
      </div>
    </div>
  );
}
