export type OrgMonitoringMember = {
  userId: string;
  role: string | null;
  joinedAt: string | null;
  createdAt: string | null;
};

const ROLE_RANK: Record<string, number> = {
  owner: 0,
  admin: 1,
  member: 2,
};

function timeValue(value: string | null): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

export function pickOrgMonitoringRepresentative(
  members: OrgMonitoringMember[],
): OrgMonitoringMember | null {
  const candidates = members.filter((member) => Boolean(member.userId));
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => {
    const roleDelta = (ROLE_RANK[a.role ?? ''] ?? 99) - (ROLE_RANK[b.role ?? ''] ?? 99);
    if (roleDelta !== 0) return roleDelta;
    const joinedDelta = timeValue(a.joinedAt) - timeValue(b.joinedAt);
    if (joinedDelta !== 0) return joinedDelta;
    const createdDelta = timeValue(a.createdAt) - timeValue(b.createdAt);
    if (createdDelta !== 0) return createdDelta;
    return a.userId.localeCompare(b.userId);
  })[0];
}
