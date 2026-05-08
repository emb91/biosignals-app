'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  Clock,
  Gauge,
  Handshake,
  Target,
  Activity,
  Radio,
  FileUp,
  Database,
  UserRound,
  Building2,
  Settings,
  User,
  Wrench,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Bot,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEnrichmentGuard } from '@/context/EnrichmentGuardContext';
import { ROUTES } from '@/lib/routes';

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const setupItems: NavItem[] = [
  { name: 'My Company', href: ROUTES.setup.company, icon: User },
  { name: 'My ICPs', href: ROUTES.setup.icps, icon: Target },
];

const leadsItems: NavItem[] = [
  { name: 'Contacts', href: ROUTES.leads.contacts, icon: UserRound },
  { name: 'Accounts', href: ROUTES.leads.accounts, icon: Building2 },
];

const topNavigation: NavItem[] = [
  { name: 'Today', href: ROUTES.briefing, icon: Clock },
  { name: 'GTM base', href: ROUTES.dashboard, icon: Gauge },
  { name: 'Import', href: ROUTES.import, icon: FileUp },
  { name: 'Health', href: ROUTES.leads.health, icon: Activity },
  { name: 'Data', href: ROUTES.leads.data, icon: Database },
  { name: 'Signals', href: '/customer-signals', icon: Radio },
  { name: 'Agent lab', href: ROUTES.agentLab, icon: Bot },
];

const bottomNavigation: NavItem[] = [
  { name: 'Settings', href: '/settings', icon: Settings },
];

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'arcova_sidebar_collapsed';
const SIDEBAR_LEGACY_HIDDEN_KEY = 'arcova_sidebar_hidden';
const NAV_DOT_DISMISS_PREFIX = 'arcova_nav_dot_seen';

const railGlass = cn(
  'border border-[rgba(13,53,71,0.1)] bg-[rgba(255,255,255,0.55)] shadow-[0_12px_40px_-24px_rgba(13,53,71,0.35),inset_0_1px_0_rgba(255,255,255,0.85)] backdrop-blur-2xl backdrop-saturate-150',
);

function dismissibleDotVisible(key: string, signature: string | null, visited: boolean): boolean {
  if (!signature) return false;
  const storageKey = `${NAV_DOT_DISMISS_PREFIX}:${key}`;
  if (visited) {
    localStorage.setItem(storageKey, signature);
    return false;
  }
  return localStorage.getItem(storageKey) !== signature;
}

interface AppSidebarProps {
  setupFlowOnly?: boolean;
}

export default function AppSidebar({ setupFlowOnly = false }: AppSidebarProps) {
  const pathname = usePathname();
  const { guardedNavigate } = useEnrichmentGuard();
  const [showCompaniesDot, setShowCompaniesDot] = useState(false);
  const [showMyProfileDot, setShowMyProfileDot] = useState(false);
  const [showTodayDot, setShowTodayDot] = useState(false);
  const [showImportDot, setShowImportDot] = useState(false);
  const [showContactsDot, setShowContactsDot] = useState(false);
  const [showAccountsDot, setShowAccountsDot] = useState(false);
  const [showHealthDot, setShowHealthDot] = useState(false);
  const [showDataDot, setShowDataDot] = useState(false);
  const [showSignalsDot, setShowSignalsDot] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const isActive = (href: string) => {
    if (pathname === href) return true;
    if (href === ROUTES.dashboard || href === ROUTES.briefing) return false;
    return pathname.startsWith(`${href}/`);
  };

  const leadsActive = leadsItems.some((item) => isActive(item.href));
  const setupActive = setupItems.some((item) => isActive(item.href));

  const [leadsOpen, setLeadsOpen] = useState(leadsActive);
  const [setupOpen, setSetupOpen] = useState(setupActive);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
      if (stored === '1' || stored === '0') {
        setSidebarCollapsed(stored === '1');
        return;
      }
      const legacy = localStorage.getItem(SIDEBAR_LEGACY_HIDDEN_KEY);
      if (legacy === '1') {
        setSidebarCollapsed(true);
        localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, '1');
        return;
      }
    } catch {
      /* ignore */
    }
    setSidebarCollapsed(false);
  }, []);

  const setCollapsed = (collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (leadsActive) setLeadsOpen(true);
  }, [leadsActive]);

  useEffect(() => {
    if (setupActive) setSetupOpen(true);
  }, [setupActive]);

  useEffect(() => {
    const loadCompletionStatus = async () => {
      try {
        const [companiesRes, profileRes, importRes, dataJobsRes, healthRes, signalsRes] = await Promise.all([
          fetch('/api/company-criteria'),
          fetch('/api/user-company-profile'),
          fetch('/api/import-ready'),
          fetch('/api/data-acquisition/jobs'),
          fetch('/api/pipeline/icp-cards'),
          fetch('/api/signal-events?recent=1&limit=1'),
        ]);

        let setupNeedsAttention = false;
        let importNeedsAttention = false;
        let contactsNeedAttention = false;
        let accountsNeedAttention = false;
        let healthNeedsAttention = false;
        let dataNeedsAttention = false;
        let signalsNeedAttention = false;

        if (companiesRes.ok) {
          const result = await companiesRes.json();
          const needsCompanies = (result.data || []).length === 0;
          setShowCompaniesDot(needsCompanies);
          setupNeedsAttention = setupNeedsAttention || needsCompanies;
        }

        if (profileRes.ok) {
          const result = await profileRes.json();
          const profile = result.data;
          const needsProfile = !(profile && typeof profile.company_name === 'string' && profile.company_name.trim());
          setShowMyProfileDot(needsProfile);
          setupNeedsAttention = setupNeedsAttention || needsProfile;
        }

        if (importRes.ok) {
          const result = await importRes.json();
          const importReady = Boolean(result.ready);
          const importSignature = importReady ? `import-ready:${result.completeCount ?? 'ready'}` : null;
          importNeedsAttention = dismissibleDotVisible('import', importSignature, pathname === ROUTES.import);
          contactsNeedAttention = dismissibleDotVisible(
            'contacts',
            importSignature,
            pathname === ROUTES.leads.contacts,
          );
          accountsNeedAttention = dismissibleDotVisible(
            'accounts',
            importSignature,
            pathname === ROUTES.leads.accounts,
          );
          setShowImportDot(importNeedsAttention);
          setShowContactsDot(contactsNeedAttention);
          setShowAccountsDot(accountsNeedAttention);
        }

        if (dataJobsRes.ok) {
          const result = await dataJobsRes.json();
          const jobs = Array.isArray(result.jobs) ? result.jobs : [];
          const jobsNeedingAttention = jobs.filter((job: Record<string, unknown>) =>
            job.status === 'failed' || job.status === 'running' || job.status === 'processing' || job.status === 'queued',
          );
          const dataSignature = jobsNeedingAttention.length > 0
            ? jobsNeedingAttention
                .map((job: Record<string, unknown>) => `${String(job.id)}:${String(job.status)}`)
                .join('|')
            : null;
          dataNeedsAttention = dismissibleDotVisible('data', dataSignature, pathname === ROUTES.leads.data);
          setShowDataDot(dataNeedsAttention);
        }

        if (healthRes.ok) {
          const result = await healthRes.json();
          const cards = Array.isArray(result.cards) ? result.cards : [];
          const hasHealthIssue = cards.some((card: Record<string, unknown>) =>
            card.overall === 'red' ||
            card.overall === 'amber' ||
            card.coverage === 'red' ||
            card.contact_fit === 'red' ||
            card.depth === 'red'
          );
          healthNeedsAttention = hasHealthIssue;
          setShowHealthDot(healthNeedsAttention);
        }

        if (signalsRes.ok) {
          const result = await signalsRes.json();
          const latestSignal = Array.isArray(result.data) ? result.data[0] : null;
          const signalSignature = latestSignal?.id ? `signal:${String(latestSignal.id)}` : null;
          signalsNeedAttention = dismissibleDotVisible(
            'signals',
            signalSignature,
            pathname === '/customer-signals' || pathname === ROUTES.signals,
          );
          setShowSignalsDot(signalsNeedAttention);
        }

        setShowTodayDot(
          setupNeedsAttention ||
          importNeedsAttention ||
          contactsNeedAttention ||
          accountsNeedAttention ||
          healthNeedsAttention ||
          dataNeedsAttention ||
          signalsNeedAttention,
        );
      } catch (error) {
        console.error('Error loading sidebar completion status:', error);
      }
    };

    loadCompletionStatus();
  }, [pathname]);

  const setupDotVisible = showCompaniesDot || showMyProfileDot;

  const shouldShowDot = (itemName: string) => {
    if (itemName === 'Today') return showTodayDot;
    if (itemName === 'GTM base') return false;
    if (itemName === 'Import') return showImportDot;
    if (itemName === 'Contacts') return showContactsDot;
    if (itemName === 'Accounts') return showAccountsDot;
    if (itemName === 'Health') return showHealthDot;
    if (itemName === 'Data') return showDataDot;
    if (itemName === 'Signals') return showSignalsDot;
    if (itemName === 'My Company') return showMyProfileDot;
    if (itemName === 'My ICPs') return showCompaniesDot;
    return false;
  };

  const renderNavItem = (item: NavItem) => (
    <div key={item.name}>
      <button
        type="button"
        onClick={() => guardedNavigate(item.href)}
        className={cn(
          'w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-sm font-medium font-manrope transition-colors text-left',
          isActive(item.href)
            ? 'bg-arcova-teal text-white shadow-sm'
            : 'text-[#4a6470] hover:bg-white/70 hover:text-arcova-navy',
        )}
      >
        <div className="relative">
          <item.icon className="w-5 h-5" />
          {shouldShowDot(item.name) && (
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-arcova-teal shadow-[0_0_0_2px_rgba(255,255,255,0.95)]" />
          )}
        </div>
        <span>{item.name}</span>
      </button>
    </div>
  );

  const renderAccordion = ({
    label,
    icon: Icon,
    items,
    open,
    onToggle,
    active,
    dotVisible,
  }: {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    items: NavItem[];
    open: boolean;
    onToggle: () => void;
    active: boolean;
    dotVisible?: boolean;
  }) => (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium font-manrope transition-colors',
          active ? 'bg-arcova-teal text-white shadow-sm' : 'text-[#4a6470] hover:bg-white/70 hover:text-arcova-navy',
        )}
      >
        <div className="flex items-center space-x-3">
          <div className="relative">
            <Icon className="w-5 h-5" />
            {dotVisible && !open && (
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-arcova-teal shadow-[0_0_0_2px_rgba(255,255,255,0.95)]" />
            )}
          </div>
          <span>{label}</span>
        </div>
        <ChevronDown
          className={cn('w-4 h-4 transition-transform duration-200', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="mt-1 ml-4 space-y-1 border-l border-[rgba(13,53,71,0.1)] pl-3">
          {items.map(renderNavItem)}
        </div>
      )}
    </div>
  );

  const railIconButton = (
    key: string,
    Icon: React.ComponentType<{ className?: string }>,
    opts: { onClick: () => void; active: boolean; title: string; dot?: boolean },
  ) => (
    <div key={key} className="flex justify-center">
      <button
        type="button"
        onClick={opts.onClick}
        title={opts.title}
        aria-label={opts.title}
        className={cn(
          'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors',
          opts.active
            ? 'bg-arcova-teal text-white shadow-sm'
            : 'text-[#4a6470] hover:bg-white/80 hover:text-arcova-navy',
        )}
      >
        <Icon className="h-5 w-5" />
        {opts.dot ? (
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-arcova-teal ring-2 ring-[rgba(255,255,255,0.95)]" />
        ) : null}
      </button>
    </div>
  );

  const renderCollapsedRail = () => {
    if (setupFlowOnly) {
      return (
        <>
          {railIconButton('setup-flow', Wrench, {
            onClick: () => guardedNavigate(ROUTES.setup.company),
            active: setupActive,
            title: 'Setup',
          })}
        </>
      );
    }
    return (
      <>
        {topNavigation.slice(0, 3).map((item) =>
          railIconButton(item.href, item.icon, {
            onClick: () => guardedNavigate(item.href),
            active: isActive(item.href),
            title: item.name,
            dot: shouldShowDot(item.name),
          }),
        )}
        {railIconButton('leads', Handshake, {
          onClick: () => guardedNavigate(ROUTES.leads.contacts),
          active: leadsActive,
          title: 'Leads',
          dot: showContactsDot || showAccountsDot,
        })}
        {topNavigation.slice(3).map((item) =>
          railIconButton(item.href, item.icon, {
            onClick: () => guardedNavigate(item.href),
            active: isActive(item.href),
            title: item.name,
            dot: shouldShowDot(item.name),
          }),
        )}
        {railIconButton('setup', Wrench, {
          onClick: () => guardedNavigate(ROUTES.setup.company),
          active: setupActive,
          title: 'Setup',
          dot: setupDotVisible,
        })}
      </>
    );
  };

  return (
    <div className="flex h-screen min-h-0 shrink-0 bg-transparent py-3 pl-3">
      <div
        className={cn(
          'flex min-h-0 flex-col overflow-hidden transition-[width] duration-200 ease-out',
          railGlass,
          sidebarCollapsed ? 'w-[4.75rem]' : 'w-[15.5rem]',
          'rounded-[1.75rem]',
        )}
      >
        {/* Header */}
        {sidebarCollapsed ? (
          <div className="flex flex-col items-center gap-3 border-b border-[rgba(13,53,71,0.08)] px-2 py-4">
            <button
              type="button"
              onClick={() => guardedNavigate('/')}
              className="rounded-xl p-0.5 transition-colors hover:bg-white/65"
              aria-label="Go to home"
              title="Go to home"
            >
              <Image
                src="/images/network-og.png"
                alt=""
                width={36}
                height={36}
                className="rounded-xl shadow-sm ring-1 ring-black/5"
              />
            </button>
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[rgba(13,53,71,0.12)] bg-white/55 text-[#4a6470] shadow-sm transition-colors hover:bg-white/90 hover:text-arcova-navy"
              aria-label="Expand sidebar"
              title="Expand sidebar"
            >
              <ChevronRight className="h-4 w-4" strokeWidth={2.2} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 border-b border-[rgba(13,53,71,0.08)] px-3.5 py-4">
            <button
              type="button"
              onClick={() => guardedNavigate('/')}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-xl py-1 text-left transition-colors hover:bg-white/60"
              aria-label="Go to home"
              title="Go to home"
            >
              <Image
                src="/images/network-og.png"
                alt=""
                width={32}
                height={32}
                className="shrink-0 rounded-lg shadow-sm ring-1 ring-black/5"
              />
              <span className="truncate text-lg font-semibold font-manrope text-arcova-navy">arcova</span>
            </button>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[rgba(13,53,71,0.12)] bg-white/55 text-[#4a6470] shadow-sm transition-colors hover:bg-white/90 hover:text-arcova-navy"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={2.2} />
            </button>
          </div>
        )}

        {sidebarCollapsed ? (
          <nav className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overflow-x-hidden px-1.5 py-3">
              {renderCollapsedRail()}
            </div>
            {!setupFlowOnly ? (
              <div className="shrink-0 border-t border-[rgba(13,53,71,0.08)] px-1.5 pb-3 pt-2">
                {bottomNavigation.map((item) =>
                  railIconButton(item.name, item.icon, {
                    onClick: () => guardedNavigate(item.href),
                    active: isActive(item.href),
                    title: item.name,
                  }),
                )}
              </div>
            ) : null}
          </nav>
        ) : (
          <nav className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
              {setupFlowOnly ? (
                <div className="rounded-xl border border-[rgba(13,53,71,0.08)] bg-white/45 px-3 py-3 backdrop-blur-sm">
                  <div className="flex items-start gap-3">
                    <Wrench className="mt-0.5 h-5 w-5 shrink-0 text-arcova-teal" aria-hidden />
                    <div>
                      <p className="text-sm font-semibold font-manrope text-arcova-navy">Setup</p>
                      <p className="mt-1 text-xs leading-relaxed text-[#4a6470]">
                        Stay in the chat to finish. The rest of the app opens when setup is complete.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {renderNavItem({ name: 'Today', href: ROUTES.briefing, icon: Clock })}
                  {renderNavItem({ name: 'GTM base', href: ROUTES.dashboard, icon: Gauge })}
                  {renderNavItem({ name: 'Import', href: ROUTES.import, icon: FileUp })}
                  {renderAccordion({
                    label: 'Leads',
                    icon: Handshake,
                    items: leadsItems,
                    open: leadsOpen,
                    onToggle: () => setLeadsOpen((o) => !o),
                    active: leadsActive && !leadsOpen,
                    dotVisible: showContactsDot || showAccountsDot,
                  })}
                  {renderNavItem({ name: 'Health', href: ROUTES.leads.health, icon: Activity })}
                  {renderNavItem({ name: 'Data', href: ROUTES.leads.data, icon: Database })}
                  {renderNavItem({ name: 'Signals', href: '/customer-signals', icon: Radio })}
                  {renderNavItem({ name: 'Agent lab', href: ROUTES.agentLab, icon: Bot })}
                  {renderAccordion({
                    label: 'Setup',
                    icon: Wrench,
                    items: setupItems,
                    open: setupOpen,
                    onToggle: () => setSetupOpen((o) => !o),
                    active: setupActive && !setupOpen,
                    dotVisible: setupDotVisible,
                  })}
                </>
              )}
            </div>
            {!setupFlowOnly ? (
              <div className="shrink-0 border-t border-[rgba(13,53,71,0.08)] p-3">
                {bottomNavigation.map(renderNavItem)}
              </div>
            ) : null}
          </nav>
        )}
      </div>
    </div>
  );
}
