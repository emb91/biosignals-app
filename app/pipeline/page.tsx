'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { toast } from 'sonner';
import { Kanban, Loader2, Plus } from 'lucide-react';
import {
  healthDotClass,
  healthLabel,
  isWeakDim,
  type HealthDim,
  type PipelineDataRequestType,
} from '@/lib/pipeline-icp-health';

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

function MetricBlock({
  title,
  valueLine,
  dim,
}: {
  title: string;
  valueLine: string;
  dim: HealthDim;
}) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-3">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</p>
      <p className="mt-1 text-lg font-semibold text-gray-900 tabular-nums">{valueLine}</p>
      <div className="mt-2 flex items-center gap-2">
        <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${healthDotClass(dim)}`} title={healthLabel(dim)} />
        <span className="text-xs text-gray-600">{healthLabel(dim)}</span>
      </div>
    </div>
  );
}

function buildCtas(card: IcpPipelineCard): { type: PipelineDataRequestType; label: string }[] {
  const out: { type: PipelineDataRequestType; label: string }[] = [];
  if (isWeakDim(card.coverage)) {
    out.push({
      type: 'expand_companies',
      label: 'Find more companies for this ICP',
    });
  }
  if (card.company_count > 0 && isWeakDim(card.contact_fit)) {
    out.push({
      type: 'better_contacts',
      label: 'Find better contacts for this ICP',
    });
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

function formatFitLine(avg: number | null): string {
  if (avg == null || !Number.isFinite(avg)) return '—';
  return `${Math.round(avg * 100)}% avg fit`;
}

function formatDepthLine(avg: number | null): string {
  if (avg == null || !Number.isFinite(avg)) return '—';
  return `${avg.toFixed(1)} contacts / company`;
}

export default function PipelinePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [cards, setCards] = useState<IcpPipelineCard[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState<string | null>(null);

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

  const submitDataRequest = async (icpId: string, requestType: PipelineDataRequestType) => {
    const key = `${icpId}:${requestType}`;
    setRequesting(key);
    try {
      const res = await fetch('/api/pipeline/data-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ icpId, requestType }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Request failed');
      }
      toast.success('Data request recorded. Open Import to follow the new Arcova-sourced batch.', {
        action: {
          label: 'Open Import',
          onClick: () => router.push('/import'),
        },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setRequesting(null);
    }
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

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-auto p-6">
          <div className="w-full max-w-3xl mx-auto">
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-gray-900">Pipeline</h1>
              <p className="text-gray-600 mt-1 text-sm leading-relaxed">
                One card per ICP. We order by health so the weakest coverage, contact quality, and depth float to
                the top. CTAs raise an Arcova data request; batches land in Import.
              </p>
            </div>

            {cards === null ? (
              <div className="flex justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-arcova-teal" />
              </div>
            ) : loadError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{loadError}</div>
            ) : cards.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Kanban className="w-8 h-8 text-gray-400" />
                </div>
                <h2 className="text-lg font-semibold text-gray-900 mb-2">No ICPs yet</h2>
                <p className="text-gray-500 text-sm mb-6 max-w-md mx-auto">
                  Define at least one ICP under My ICPs to see pipeline health here.
                </p>
                <button
                  type="button"
                  onClick={() => router.push('/company-criteria/new')}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-arcova-teal text-white text-sm font-semibold rounded-lg hover:bg-arcova-teal/90 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add an ICP
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {cards.map((card) => {
                  const ctas = buildCtas(card);
                  const showCtas = ctas.length > 0;

                  return (
                    <article
                      key={card.icp_id}
                      className={`rounded-xl border shadow-sm overflow-hidden transition-colors ${
                        card.thin_data
                          ? 'border-dashed border-gray-300 bg-gray-50/90'
                          : 'border-gray-200 bg-white'
                      }`}
                    >
                      <div className="p-5 space-y-4">
                        {card.thin_data && (
                          <p className="text-sm text-gray-500 leading-relaxed rounded-lg bg-white/60 border border-gray-100 px-3 py-2">
                            Not enough data to assess — import more contacts or find companies for this ICP
                            (fewer than five companies matched so far).
                          </p>
                        )}

                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h2 className="text-base font-semibold text-gray-900 leading-snug">{card.label}</h2>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs font-medium text-gray-500">Overall</span>
                            <span
                              className={`inline-block h-3 w-3 rounded-full ${healthDotClass(card.overall)}`}
                              title={healthLabel(card.overall)}
                            />
                            <span className="text-xs text-gray-600">{healthLabel(card.overall)}</span>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <MetricBlock
                            title="Company coverage"
                            valueLine={`${card.company_count} compan${card.company_count === 1 ? 'y' : 'ies'}`}
                            dim={card.coverage}
                          />
                          <MetricBlock
                            title="Average contact fit"
                            valueLine={formatFitLine(card.avg_contact_fit)}
                            dim={card.contact_fit}
                          />
                          <MetricBlock
                            title="Contact depth"
                            valueLine={formatDepthLine(card.avg_contacts_per_company)}
                            dim={card.depth}
                          />
                        </div>

                        {showCtas && (
                          <div className="pt-2 border-t border-gray-100 space-y-2">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Next steps</p>
                            <div className="flex flex-col sm:flex-row flex-wrap gap-2">
                              {ctas.map((cta) => {
                                const busy = requesting === `${card.icp_id}:${cta.type}`;
                                return (
                                  <button
                                    key={cta.type}
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void submitDataRequest(card.icp_id, cta.type)}
                                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-arcova-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-arcova-teal/90 disabled:opacity-60 transition-colors"
                                  >
                                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                    {cta.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
