'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { PageHeader } from '@/components/PageHeader';
import { supabase } from '@/lib/supabase';
import { Building2, Gauge, Loader2, Target, Users } from 'lucide-react';

type DashboardStats = {
  companies: number;
  contacts: number;
  icps: number;
  averageCompanyFit: number;
  averageContactFit: number;
};

const emptyStats: DashboardStats = {
  companies: 0,
  contacts: 0,
  icps: 0,
  averageCompanyFit: 0,
  averageContactFit: 0,
};

function normalizeScore(value: unknown): number {
  const n = typeof value === 'number' ? value : value == null ? 0 : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n > 1 && n <= 100) return n / 100;
  return Math.min(n, 1);
}

function average(values: number[]): number {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (finiteValues.length === 0) return 0;
  return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
}

function formatScorePercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

function plural(count: number, singular: string, pluralLabel = `${singular}s`): string {
  return count === 1 ? singular : pluralLabel;
}

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [stats, setStats] = useState<DashboardStats>(emptyStats);

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
        ] = await Promise.all([
          supabase.from('companies').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
          supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
          supabase.from('icps').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
          supabase.from('icps').select('id').eq('user_id', user.id),
          supabase.from('companies').select('id, matched_icp_id, company_fit_score').eq('user_id', user.id),
          supabase.from('contacts').select('company_id, contact_fit_score').eq('user_id', user.id).not('company_id', 'is', null),
        ]);

        const error = companyCountError || contactCountError || icpCountError || icpsError || companiesError || contactsError;
        if (error) throw error;

        const icpIds = (icps ?? [])
          .map((icp) => icp.id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0);
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
        for (const contact of contacts ?? []) {
          const companyId = typeof contact.company_id === 'string' ? contact.company_id : null;
          if (!companyId) continue;
          const icpId = companyIcpById.get(companyId);
          if (!icpId) continue;

          if (!contactFitByIcp.has(icpId)) contactFitByIcp.set(icpId, []);
          contactFitByIcp.get(icpId)!.push(normalizeScore(contact.contact_fit_score));
        }

        const averageCompanyFit = average(
          icpIds.map((icpId) => average(companyFitByIcp.get(icpId) ?? [])),
        );
        const averageContactFit = average(
          icpIds.map((icpId) => average(contactFitByIcp.get(icpId) ?? [])),
        );

        setStats({
          companies: companyCount ?? companies?.length ?? 0,
          contacts: contactCount ?? contacts?.length ?? 0,
          icps: icpCount ?? 0,
          averageCompanyFit,
          averageContactFit,
        });
      } catch (error) {
        console.error('Error loading dashboard data:', error);
      } finally {
        setLoadingDashboard(false);
      }
    };

    void fetchDashboardData();
  }, [user]);

  const companyFit = useMemo(() => formatScorePercent(stats.averageCompanyFit), [stats.averageCompanyFit]);
  const contactFit = useMemo(() => formatScorePercent(stats.averageContactFit), [stats.averageContactFit]);

  if (loading || loadingDashboard) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent">
        <Loader2 className="h-8 w-8 animate-spin text-arcova-teal" />
      </div>
    );
  }

  if (!user) return null;

  const countCards = [
    {
      label: plural(stats.companies, 'company', 'companies'),
      value: stats.companies,
      Icon: Building2,
    },
    {
      label: plural(stats.contacts, 'contact'),
      value: stats.contacts,
      Icon: Users,
    },
    {
      label: `ICP${stats.icps === 1 ? '' : 's'} defined`,
      value: stats.icps,
      Icon: Target,
    },
  ];

  return (
    <div className="flex h-screen bg-transparent">
      <AppSidebar />

      <main className="bg-transparent min-h-0 flex-1 overflow-y-auto px-6 py-8 lg:px-10">
        <div className="mx-auto flex min-h-full w-full max-w-[1180px] flex-col gap-6">
          <PageHeader
            eyebrow="Tracking"
            eyebrowIcon={<Gauge className="h-3 w-3" />}
            title="Your go-to-market base"
            subtitle="The short version of what Arcova knows about your market right now."
          />

          <section className="grid gap-4 md:grid-cols-3">
            {countCards.map(({ label, value, Icon }) => (
              <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <p className="text-sm font-medium text-slate-500">You have</p>
                  <span className="rounded-lg bg-cyan-50 p-2 text-arcova-teal">
                    <Icon className="h-5 w-5" />
                  </span>
                </div>
                <p className="mt-8 leading-none tracking-normal text-slate-950">
                  <span className="text-6xl font-semibold">{value}</span>
                  <span className="ml-3 text-2xl font-semibold">{label}</span>
                </p>
              </div>
            ))}
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-500">Company fit</p>
              <p className="mt-6 max-w-md text-lg leading-7 text-slate-700">
                <span className="mr-3 align-middle text-6xl font-semibold leading-none tracking-normal text-slate-950">
                  {companyFit}%
                </span>
                average company fit across your ICPs.
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Calculated by averaging company fit within each ICP, then averaging those ICPs.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-500">Contact fit</p>
              <p className="mt-6 max-w-md text-lg leading-7 text-slate-700">
                <span className="mr-3 align-middle text-6xl font-semibold leading-none tracking-normal text-slate-950">
                  {contactFit}%
                </span>
                average contact fit across your ICPs.
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Calculated by averaging contact fit within each ICP, then averaging those ICPs.
              </p>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
