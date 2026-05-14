'use client';

import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { ArrowLeft, ArchiveRestore, ChevronDown, Loader2, RotateCw } from 'lucide-react';

type ArchivedAccount = {
  id: string;
  company_name: string | null;
  domain: string | null;
  archived_at: string | null;
  archived_reason: string | null;
};

type ArchivedContact = {
  id: string;
  full_name: string | null;
  email: string | null;
  company_id: string | null;
  company_name: string | null;
  archived_at: string | null;
  archived_reason: string | null;
};

type ArchivedGroup = {
  account: ArchivedAccount | null;
  contacts: ArchivedContact[];
  key: string;
  archivedAt: string | null;
};

function relativeTime(iso: string | null): string {
  if (!iso) return 'unknown';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function absoluteTime(iso: string | null): string {
  if (!iso) return 'Unknown';
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function ArchivedRecordCard({
  group,
  collapsed,
  onToggle,
  onRestoreGroup,
  onRestoreContact,
  restoring,
}: {
  group: ArchivedGroup;
  collapsed: boolean;
  onToggle: () => void;
  onRestoreGroup: (group: ArchivedGroup) => void;
  onRestoreContact: (contact: ArchivedContact, group: ArchivedGroup) => void;
  restoring: boolean;
}) {
  const accountLabel =
    group.account?.company_name ||
    group.account?.domain ||
    group.contacts[0]?.company_name ||
    'Archived account';

  const accountMeta =
    group.account?.domain ||
    group.contacts[0]?.email ||
    null;

  return (
    <div
      className={`rounded-lg border border-white/80 bg-white/55 backdrop-blur-xl ${
        collapsed
          ? 'shadow-[0_2px_8px_-4px_rgba(13,53,71,0.1)]'
          : 'shadow-[0_8px_24px_-12px_rgba(13,53,71,0.15)]'
      }`}
    >
      <div
        className={`flex items-center gap-2.5 px-3.5 py-1.5 transition-colors hover:bg-white/40 ${
          !collapsed ? 'border-b border-[rgba(13,53,71,0.07)]' : ''
        }`}
      >
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <span className="shrink-0 rounded px-1.5 py-px text-[10px] font-semibold tracking-wide bg-[#0d3547]/8 text-[#0d3547] border border-[#0d3547]/12">
            Archived
          </span>
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[#0d3547]">
            {accountLabel}
          </span>
          {collapsed && (
            <span className="hidden shrink-0 text-[11px] text-[#7d909a] sm:block">
              {group.contacts.length} {group.contacts.length === 1 ? 'contact' : 'contacts'}
            </span>
          )}
          <span className="shrink-0 text-[10.5px] text-[#b6c2c8]">{relativeTime(group.archivedAt)}</span>
          <ChevronDown
            className={`h-3 w-3 shrink-0 text-[#b6c2c8] transition-transform duration-200 ${!collapsed ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {!collapsed && (
        <div className="space-y-3 px-3.5 py-2.5">
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <span className="text-[12px] text-[#7d909a]">
              <span className="font-semibold text-[#0d3547]">{group.contacts.length}</span> contacts
            </span>
            {accountMeta && (
              <span className="text-[12px] text-[#7d909a]">
                <span className="font-semibold text-[#0d3547]">Domain</span> {accountMeta}
              </span>
            )}
          </div>

          <p className="text-[11px] text-[#b6c2c8]">{absoluteTime(group.archivedAt)}</p>

          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => onRestoreGroup(group)}
              disabled={restoring}
              className="inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-semibold border border-[rgba(45,138,138,0.18)] bg-[rgba(45,138,138,0.08)] text-[#2d8a8a] disabled:opacity-60"
            >
              <ArchiveRestore className="h-3 w-3" />
              {restoring ? 'Restoring…' : 'Restore'}
            </button>
          </div>

          <div>
            <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#7d909a]">
              Contacts in this account
            </p>
            <ul className="space-y-1.5">
              {group.contacts.map((contact) => (
                <li
                  key={contact.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-[rgba(13,53,71,0.06)] bg-[rgba(255,255,255,0.6)] px-2.5 py-2"
                >
                  <div className="min-w-0 text-[12px] text-[#4a6470]">
                    <span className="font-medium text-[#0d3547]">
                      {contact.full_name || contact.email || 'Unnamed contact'}
                    </span>
                    {contact.email && <span className="text-[#7d909a]"> · {contact.email}</span>}
                  </div>
                  {!group.account && (
                    <button
                      type="button"
                      onClick={() => onRestoreContact(contact, group)}
                      disabled={restoring}
                      className="shrink-0 rounded px-2 py-1 text-[10.5px] font-semibold text-[#2d8a8a] transition hover:bg-[rgba(45,138,138,0.08)] disabled:opacity-60"
                    >
                      Restore
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center gap-1.5 text-[11.5px] text-[#7d909a]">
            {group.account
              ? 'Restoring any contact here will also restore the archived account group.'
              : 'This account is already active. Restore individual contacts below if you want them back.'}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ArchivedRecordsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [accounts, setAccounts] = useState<ArchivedAccount[]>([]);
  const [contacts, setContacts] = useState<ArchivedContact[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [restoringKey, setRestoringKey] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, router, user]);

  const loadArchivedRecords = useCallback(async () => {
    setLoadingData(true);
    try {
      const response = await fetch('/api/settings/archived-records');
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to load archived records.');
      }
      setAccounts(Array.isArray(result.accounts) ? result.accounts : []);
      setContacts(Array.isArray(result.contacts) ? result.contacts : []);
    } catch (error) {
      console.error('Failed to load archived records:', error);
      setAccounts([]);
      setContacts([]);
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (user) void loadArchivedRecords();
  }, [user, loadArchivedRecords]);

  const groups = useMemo<ArchivedGroup[]>(() => {
    const byKey = new Map<string, ArchivedGroup>();

    for (const account of accounts) {
      byKey.set(account.id, {
        account,
        contacts: [],
        key: account.id,
        archivedAt: account.archived_at,
      });
    }

    for (const contact of contacts) {
      const key = contact.company_id ?? `contact:${contact.id}`;
      const current = byKey.get(key);
      if (current) {
        current.contacts.push(contact);
        if (!current.archivedAt || (contact.archived_at && contact.archived_at > current.archivedAt)) {
          current.archivedAt = contact.archived_at;
        }
      } else {
        byKey.set(key, {
          account: null,
          contacts: [contact],
          key,
          archivedAt: contact.archived_at,
        });
      }
    }

    return [...byKey.values()].sort((a, b) => {
      const aTime = a.archivedAt ? new Date(a.archivedAt).getTime() : 0;
      const bTime = b.archivedAt ? new Date(b.archivedAt).getTime() : 0;
      return bTime - aTime;
    });
  }, [accounts, contacts]);

  const toggle = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const confirmRestoreGroup = useCallback((group: ArchivedGroup): boolean => {
    const label =
      group.account?.company_name ||
      group.account?.domain ||
      group.contacts[0]?.company_name ||
      'this account';
    return window.confirm(`Are you sure you want to restore ${label}?`);
  }, []);

  const confirmRestoreContact = useCallback((contact: ArchivedContact): boolean => {
    const label = contact.full_name || contact.email || 'this contact';
    return window.confirm(`Are you sure you want to restore ${label}?`);
  }, []);

  const restoreRecord = useCallback(async (restoreType: 'account' | 'contact', restoreId: string, restoreKey: string) => {
    if (!restoreId) return;

    setRestoringKey(restoreKey);
    try {
      const response = await fetch('/api/settings/archived-records/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: restoreType, id: restoreId }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to restore archived record.');
      }
      await loadArchivedRecords();
    } catch (error) {
      console.error('Failed to restore archived record:', error);
      window.alert(error instanceof Error ? error.message : 'Could not restore archived record.');
    } finally {
      setRestoringKey(null);
    }
  }, [loadArchivedRecords]);

  if (loading || loadingData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent">
        <Loader2 className="h-8 w-8 animate-spin text-arcova-teal" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen bg-transparent">
      <AppSidebar />
      <div className="flex min-h-0 flex-1 overflow-hidden min-[1280px]:flex-row flex-col">
        <div className="bg-transparent flex-1 overflow-auto px-6 py-8 lg:px-10">
          <div className="mx-auto w-full max-w-[1180px]">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div>
                <div className="mb-2">
                  <Link href="/settings" className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-[#7d909a] hover:text-[#0d3547]">
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Settings
                  </Link>
                </div>
                <h1 className="text-2xl font-semibold text-slate-950">Archived records</h1>
                <p className="mt-2 text-sm text-slate-500">
                  Archived records stay hidden from active views and are protected from automatic re-import and re-enrichment.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadArchivedRecords()}
                className="inline-flex items-center gap-2 rounded-lg border border-[rgba(13,53,71,0.12)] px-3 py-2 text-sm font-medium text-[#4a6470] hover:bg-white"
              >
                <RotateCw className="h-4 w-4" />
                Refresh
              </button>
            </div>

            {groups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[rgba(13,53,71,0.05)]">
                  <ArchiveRestore className="h-8 w-8 text-[#b6c2c8]" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-[#0d3547]">No archived records</h3>
                <p className="max-w-xs text-sm text-[#7d909a]">
                  Archived account groups will appear here if you ever need to restore them.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {groups.map((group) => (
                  <ArchivedRecordCard
                    key={group.key}
                    group={group}
                    collapsed={!expandedKeys.has(group.key)}
                    onToggle={() => toggle(group.key)}
                    onRestoreGroup={(selectedGroup) => {
                      if (!confirmRestoreGroup(selectedGroup)) return;
                      void restoreRecord(
                        selectedGroup.account ? 'account' : 'contact',
                        selectedGroup.account?.id ?? selectedGroup.contacts[0]?.id ?? '',
                        selectedGroup.key,
                      );
                    }}
                    onRestoreContact={(contact, selectedGroup) => {
                      if (!confirmRestoreContact(contact)) return;
                      void restoreRecord(
                        selectedGroup.account ? 'account' : 'contact',
                        selectedGroup.account?.id ?? contact.id,
                        selectedGroup.key,
                      );
                    }}
                    restoring={restoringKey === group.key}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
