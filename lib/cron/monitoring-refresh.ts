import { refreshAllMonitoringUniverses } from '@/lib/billing/monitoring';

type MonitoringRefreshResult = {
  refreshed: boolean;
  reason: 'disabled' | 'requested';
  failures: Array<{ org_id: string; error: string }>;
};

function truthy(value: string | null | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export async function maybeRefreshMonitoringUniverses(params: {
  searchParams?: URLSearchParams;
  envName: string;
}): Promise<MonitoringRefreshResult> {
  const requested = truthy(params.searchParams?.get('refreshMonitoringUniverse'))
    || truthy(params.searchParams?.get('refresh_monitoring_universe'))
    || truthy(process.env[params.envName]);
  if (!requested) {
    return { refreshed: false, reason: 'disabled', failures: [] };
  }
  return {
    refreshed: true,
    reason: 'requested',
    failures: await refreshAllMonitoringUniverses(),
  };
}
