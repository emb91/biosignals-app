'use client';

/**
 * Teammate-activity surfacing for contacts: "In sequence with Alice" / "Assigned to Alice".
 *
 * Self-contained drop-in for the contacts list + side panel:
 *   const activity = useOrgOutreachActivity(contactIds);
 *   <OrgOutreachBadge activity={activity.get(contact.id)} />          // action cell
 *   <OrgOutreachAssignment activity={activity.get(contact.id)} />     // side panel row
 *
 * The action-cell badge shows for ANY teammate activity (a draft means they're working
 * it — steer away). The side-panel assignment line only shows once the touch is
 * customer-facing (sent/queued/replied).
 */
import { useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';

export type OrgOutreachInfo = {
  userName: string;
  status: string;
  customerFacing: boolean;
};

/** Fetch teammate outreach activity for a set of the caller's contact ids. */
export function useOrgOutreachActivity(contactIds: string[]): Map<string, OrgOutreachInfo> {
  const [byId, setById] = useState<Map<string, OrgOutreachInfo>>(() => new Map());
  const key = useMemo(() => [...contactIds].filter(Boolean).sort().join(','), [contactIds]);

  useEffect(() => {
    if (!key) {
      setById(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/org/outreach-activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactIds: key.split(',') }),
        });
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as { byContactId?: Record<string, OrgOutreachInfo> };
        if (!cancelled) setById(new Map(Object.entries(json.byContactId ?? {})));
      } catch {
        /* best-effort — no badge on failure */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return byId;
}

/** Compact badge for the contacts action cell: a teammate is working this lead. */
export function OrgOutreachBadge({ activity }: { activity: OrgOutreachInfo | undefined }) {
  if (!activity) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600"
      title={`${activity.userName} is working this contact`}
    >
      <Users className="h-3 w-3" />
      In sequence with {activity.userName}
    </span>
  );
}

/** Side-panel line: only shown once a teammate's touch is customer-facing. */
export function OrgOutreachAssignment({ activity }: { activity: OrgOutreachInfo | undefined }) {
  if (!activity?.customerFacing) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-500">
      <Users className="h-3.5 w-3.5" />
      <span>
        Assigned to <span className="font-medium text-slate-700">{activity.userName}</span>
      </span>
    </div>
  );
}
