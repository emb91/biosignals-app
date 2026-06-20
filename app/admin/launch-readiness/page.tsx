'use client';

import { useEffect, useState } from 'react';

type Report = {
  generatedAt: string;
  ready: boolean;
  checks: Record<string, number>;
  monitoring: {
    contacts: Record<string, number>;
    accounts: Record<string, number>;
  };
  last30Days: {
    creditsSettled: number;
    apifyCostUsd: number;
    apifyRuns: number;
  };
  paidLaunchEvidence: {
    ready: boolean;
    finalizedCreditTransactions7d: number;
    providerRuns7d: number;
    stripeEvents30d: number;
    activeMonitoredContacts: number;
    contactsWithinCadence: number;
    activeMonitoredAccounts: number;
    accountsWithinCadence: number;
    successfulCronJobs7d: number;
    contactMonitorJobSeen: boolean;
    accountMonitorJobSeen: boolean;
  };
  backups: {
    ready: boolean;
    connectedWorkspaces: number;
    missingBaselines: number;
    staleRollingBackups: number;
    failed24h: number;
    lastCompletedAt: string | null;
  };
  workspaces: Array<{
    orgId: string;
    name: string;
    plan: string;
    subscriptionStatus: string;
    creditBalance: number;
    settledCredits30d: number;
    apifyCost30dUsd: number;
    activeMonitoredContacts: number;
    activeMonitoredAccounts: number;
    overdueMonitors: number;
  }>;
};

export default function LaunchReadinessPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetch('/api/admin/launch-readiness', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error ?? 'Report failed');
        return response.json() as Promise<Report>;
      })
      .then(setReport)
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Report failed'));
  }, []);

  return (
    <main className="mx-auto min-h-screen max-w-7xl space-y-8 bg-white px-6 py-10 text-slate-800">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-teal-700">Internal</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-950">Launch readiness</h1>
        <p className="mt-2 text-sm text-slate-500">
          Credit conservation, monitoring coverage, provider cost, Stripe, cron, and workspace integrity.
        </p>
        <button
          type="button"
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true);
            setError('');
            try {
              const response = await fetch('/api/admin/launch-readiness', { method: 'POST' });
              if (!response.ok) throw new Error((await response.json()).error ?? 'Refresh failed');
              window.location.reload();
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : 'Refresh failed');
              setRefreshing(false);
            }
          }}
          className="mt-4 rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {refreshing ? 'Refreshing monitoring…' : 'Refresh monitoring universes'}
        </button>
      </div>

      {error && <div className="rounded-xl bg-red-50 p-4 text-red-800">{error}</div>}
      {!report && !error && <p>Loading report…</p>}

      {report && (
        <>
          <section className={`rounded-2xl border p-6 ${report.ready ? 'border-emerald-300 bg-emerald-50' : 'border-amber-300 bg-amber-50'}`}>
            <h2 className="text-xl font-semibold">{report.ready ? 'Operational checks pass' : 'Action required'}</h2>
            <p className="mt-1 text-sm">Generated {new Date(report.generatedAt).toLocaleString()}</p>
          </section>

          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {Object.entries(report.checks).map(([name, value]) => (
              <div key={name} className="rounded-xl border border-slate-200 p-4">
                <p className="break-words text-xs text-slate-500">{label(name)}</p>
                <p className={`mt-2 text-2xl font-semibold ${value > 0 ? 'text-red-700' : 'text-slate-950'}`}>{value}</p>
              </div>
            ))}
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            <Metric title="Credits settled · 30d" value={number(report.last30Days.creditsSettled)} />
            <Metric title="Apify cost · 30d" value={`$${number(report.last30Days.apifyCostUsd)}`} />
            <Metric title="Apify runs · 30d" value={number(report.last30Days.apifyRuns)} />
          </section>

          <section className={`rounded-2xl border p-6 ${report.paidLaunchEvidence.ready ? 'border-emerald-300 bg-emerald-50' : 'border-sky-300 bg-sky-50'}`}>
            <h2 className="text-xl font-semibold">
              {report.paidLaunchEvidence.ready ? 'Paid-launch evidence complete' : 'Shadow evidence still required'}
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(report.paidLaunchEvidence)
                .filter(([key]) => key !== 'ready')
                .map(([key, value]) => (
                  <div key={key} className="rounded-lg bg-white/70 p-3">
                    <p className="text-xs text-slate-500">{label(key)}</p>
                    <p className="mt-1 font-semibold">{typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value}</p>
                  </div>
                ))}
            </div>
          </section>

          <section className={`rounded-2xl border p-6 ${report.backups.ready ? 'border-emerald-300 bg-emerald-50' : 'border-red-300 bg-red-50'}`}>
            <h2 className="text-xl font-semibold">
              {report.backups.ready ? 'HubSpot backups healthy' : 'HubSpot backup attention required'}
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {Object.entries(report.backups)
                .filter(([key]) => key !== 'ready')
                .map(([key, value]) => (
                  <div key={key} className="rounded-lg bg-white/70 p-3">
                    <p className="text-xs text-slate-500">{label(key)}</p>
                    <p className="mt-1 break-words font-semibold">
                      {value == null ? '—' : String(value)}
                    </p>
                  </div>
                ))}
            </div>
          </section>

          <section className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  {['Workspace', 'Plan', 'Status', 'Credits', 'Settled 30d', 'Cost 30d', 'Contacts', 'Accounts', 'Overdue'].map((heading) => (
                    <th key={heading} className="px-4 py-3">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.workspaces.map((workspace) => (
                  <tr key={workspace.orgId} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium">{workspace.name}</td>
                    <td className="px-4 py-3">{workspace.plan}</td>
                    <td className="px-4 py-3">{workspace.subscriptionStatus}</td>
                    <td className="px-4 py-3">{number(workspace.creditBalance)}</td>
                    <td className="px-4 py-3">{number(workspace.settledCredits30d)}</td>
                    <td className="px-4 py-3">${number(workspace.apifyCost30dUsd)}</td>
                    <td className="px-4 py-3">{workspace.activeMonitoredContacts}</td>
                    <td className="px-4 py-3">{workspace.activeMonitoredAccounts}</td>
                    <td className={`px-4 py-3 ${workspace.overdueMonitors > 0 ? 'font-semibold text-red-700' : ''}`}>
                      {workspace.overdueMonitors}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-5">
      <p className="text-sm text-slate-500">{title}</p>
      <p className="mt-2 text-3xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function number(value: number) {
  return Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function label(value: string) {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2');
}
