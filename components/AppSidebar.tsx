'use client';

import { useEffect, useState, Suspense, useMemo } from 'react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { ChevronDown, ChevronLeft } from 'lucide-react';
import {
  NavIconAccount,
  NavIconContact,
  NavIconData,
  NavIconGtmBase,
  NavIconHealth,
  NavIconImport,
  NavIconLeads,
  NavIconMyCompany,
  NavIconMyIcps,
  NavIconSettings,
  NavIconSetup,
  NavIconSignals,
  NavIconToday,
} from '@/components/NavRailIcons';
import { cn } from '@/lib/utils';
import { useEnrichmentGuard } from '@/context/EnrichmentGuardContext';
import { useAuth } from '@/context/AuthContext';
import { ROUTES } from '@/lib/routes';
import { useSetupState } from '@/lib/use-setup-state';
import { requestSetupSection, useSetupNavigation, type SetupSection } from '@/lib/setup-navigation';

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  active?: boolean;
}

const setupItems: NavItem[] = [
  { name: 'My Company', href: ROUTES.setup.company, icon: NavIconMyCompany },
  { name: 'My ICPs', href: ROUTES.setup.icps, icon: NavIconMyIcps },
];

const leadsItems: NavItem[] = [
  { name: 'Contacts', href: ROUTES.leads.contacts, icon: NavIconContact },
  { name: 'Accounts', href: ROUTES.leads.accounts, icon: NavIconAccount },
];

const topNavigation: NavItem[] = [
  { name: 'Today', href: ROUTES.today, icon: NavIconToday },
  { name: 'GTM base', href: ROUTES.gtmBase, icon: NavIconGtmBase },
  { name: 'Import', href: ROUTES.import, icon: NavIconImport },
  { name: 'Health', href: ROUTES.health, icon: NavIconHealth },
  { name: 'Data', href: ROUTES.data, icon: NavIconData },
  { name: 'Signals', href: ROUTES.signals, icon: NavIconSignals },
];

const bottomNavigation: NavItem[] = [
  { name: 'Settings', href: ROUTES.settings, icon: NavIconSettings },
];

const ADMIN_EMAIL = 'emma@arcova.bio';

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'arcova_sidebar_collapsed';
const SIDEBAR_LEGACY_HIDDEN_KEY = 'arcova_sidebar_hidden';
const NAV_DOT_DISMISS_PREFIX = 'arcova_nav_dot_seen';

const railGlass = cn(
  'border border-[rgba(13,53,71,0.1)] bg-[rgba(255,255,255,0.55)] shadow-[0_12px_40px_-24px_rgba(13,53,71,0.35),inset_0_1px_0_rgba(255,255,255,0.85)] backdrop-blur-2xl backdrop-saturate-150',
);

/** Collapse control: shrinks on hover (matches compact chrome in design refs). */
const sidebarChromeToggleClass = cn(
  'inline-flex shrink-0 items-center justify-center rounded-lg border border-[rgba(13,53,71,0.12)] bg-white/55 text-[#4a6470] shadow-sm',
  'origin-center transition-[transform,background-color,color] duration-150 ease-out',
  'hover:scale-[0.72] hover:bg-white/90 hover:text-arcova-navy',
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

function AppSidebarInner({ setupFlowOnly = false }: AppSidebarProps) {
  const { user } = useAuth();
  const pathname = usePathname();
  const { step2Complete, setupComplete, loading: setupStateLoading } = useSetupState();
  const { activeSection: activeSetupSection } = useSetupNavigation();
  const { guardedNavigate } = useEnrichmentGuard();
  const showTargetIcpInGuidedNav =
    step2Complete || (pathname === ROUTES.setup.arcova && (activeSetupSection === 'target' || activeSetupSection === 'buying'));
  const jumpToSetupSection = (section: SetupSection) => {
    requestSetupSection(section);
    if (pathname !== ROUTES.setup.arcova) {
      guardedNavigate(ROUTES.setup.arcova);
    }
  };
  /** Guided setup rail mirrors Supabase: company row unlocks target, ICP row unlocks buying team. */
  const guidedSetupNestedItems = useMemo((): NavItem[] => {
    const items: NavItem[] = [
      {
        name: 'My company',
        href: ROUTES.setup.arcova,
        icon: NavIconMyCompany,
        onClick: () => jumpToSetupSection('company'),
        active: pathname === ROUTES.setup.arcova && activeSetupSection === 'company',
      },
    ];
    if (showTargetIcpInGuidedNav) {
      items.push({
        name: 'Target ICP',
        href: ROUTES.setup.arcova,
        icon: NavIconMyIcps,
        onClick: () => jumpToSetupSection('target'),
        active: pathname === ROUTES.setup.arcova && activeSetupSection === 'target',
      });
    }
    if (step2Complete) {
      items.push({
        name: 'Buying team',
        href: ROUTES.setup.arcova,
        icon: NavIconContact,
        onClick: () => jumpToSetupSection('buying'),
        active: pathname === ROUTES.setup.arcova && activeSetupSection === 'buying',
      });
    }
    return items;
  }, [activeSetupSection, pathname, showTargetIcpInGuidedNav, step2Complete]);
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
  const isAdminUser = user?.email?.trim().toLowerCase() === ADMIN_EMAIL;
  const bottomItems = isAdminUser
    ? [
        ...bottomNavigation,
        { name: 'Admin Dash', href: ROUTES.admin.llmUsage, icon: NavIconSettings },
        { name: 'Signals TODO', href: ROUTES.admin.signalsTodo, icon: NavIconSignals },
      ]
    : bottomNavigation;

  const isActive = (href: string) => {
    const qAt = href.indexOf('?');
    if (qAt !== -1) {
      const path = href.slice(0, qAt);
      if (pathname !== path) return false;
      return false;
    }
    if (pathname === href) return true;
    if (href === ROUTES.gtmBase || href === ROUTES.today) return false;
    return pathname.startsWith(`${href}/`);
  };

  const setupActive =
    setupItems.some((item) => isActive(item.href)) ||
    pathname === ROUTES.setup.arcova;

  const setupAccordionItems: NavItem[] =
    setupComplete || setupStateLoading
      ? setupItems
      : [
          { name: 'Guided setup', href: ROUTES.setup.arcova, icon: NavIconSetup },
          {
            name: 'My company',
            href: ROUTES.setup.arcova,
            icon: NavIconMyCompany,
            onClick: () => jumpToSetupSection('company'),
            active: pathname === ROUTES.setup.arcova && activeSetupSection === 'company',
          },
          ...(showTargetIcpInGuidedNav
            ? [{
              name: 'Target ICP',
              href: ROUTES.setup.arcova,
              icon: NavIconMyIcps,
              onClick: () => jumpToSetupSection('target'),
              active: pathname === ROUTES.setup.arcova && activeSetupSection === 'target',
            } as NavItem]
            : []),
          ...(step2Complete
            ? [{
              name: 'Buying team',
              href: ROUTES.setup.arcova,
              icon: NavIconContact,
              onClick: () => jumpToSetupSection('buying'),
              active: pathname === ROUTES.setup.arcova && activeSetupSection === 'buying',
            } as NavItem]
            : []),
        ];

  const leadsActive = leadsItems.some((item) => isActive(item.href));

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
          dataNeedsAttention = dismissibleDotVisible('data', dataSignature, pathname === ROUTES.data);
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
            pathname === ROUTES.signals,
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
    if (itemName === 'My Company' || itemName === 'My company') return showMyProfileDot;
    if (itemName === 'My ICPs') return showCompaniesDot;
    if (itemName === 'Guided setup') return setupDotVisible;
    if (itemName === 'Target ICP') return showCompaniesDot;
    return false;
  };

  const renderNavItem = (item: NavItem) => (
    <div key={item.name}>
      <button
        type="button"
        onClick={() => item.onClick?.() ?? guardedNavigate(item.href)}
        className={cn(
          'w-full flex items-center space-x-3 rounded-xl px-3.5 py-2.5 text-[0.9375rem] font-medium font-manrope leading-snug transition-colors text-left',
          (item.active ?? isActive(item.href))
            ? 'bg-arcova-navy text-white shadow-sm'
            : 'text-[#4a6470] hover:bg-white/70 hover:text-arcova-navy',
        )}
      >
        <div className="relative">
          <item.icon className="h-[1.375rem] w-[1.375rem] shrink-0" />
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
          'w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-[0.9375rem] font-medium font-manrope leading-snug transition-colors',
          active ? 'bg-arcova-navy text-white shadow-sm' : 'text-[#4a6470] hover:bg-white/70 hover:text-arcova-navy',
        )}
      >
        <div className="flex items-center space-x-3">
          <div className="relative">
            <Icon className="h-[1.375rem] w-[1.375rem] shrink-0" />
            {dotVisible && !open && (
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-arcova-teal shadow-[0_0_0_2px_rgba(255,255,255,0.95)]" />
            )}
          </div>
          <span>{label}</span>
        </div>
        <ChevronDown
          className={cn('h-[1.125rem] w-[1.125rem] shrink-0 transition-transform duration-200', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="ml-[1.125rem] mt-1.5 space-y-1 border-l border-[rgba(13,53,71,0.1)] pl-3.5">
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
          'relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors',
          opts.active
            ? 'bg-arcova-navy text-white shadow-sm'
            : 'text-[#4a6470] hover:bg-white/80 hover:text-arcova-navy',
        )}
      >
        <Icon className="h-[1.375rem] w-[1.375rem]" />
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
          {railIconButton('setup-flow', NavIconSetup, {
            onClick: () => guardedNavigate(ROUTES.setup.arcova),
            active: pathname === ROUTES.setup.arcova,
            title: 'Guided setup',
            dot: setupDotVisible,
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
        {railIconButton('leads', NavIconLeads, {
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
        {railIconButton('setup', NavIconSetup, {
          onClick: () =>
            guardedNavigate(!setupComplete && !setupStateLoading ? ROUTES.setup.arcova : ROUTES.setup.company),
          active: setupActive,
          title: 'Setup',
          dot: setupDotVisible,
        })}
      </>
    );
  };

  return (
    <div className="flex h-full min-h-0 shrink-0 bg-transparent pl-3">
      <div
        className={cn(
          'flex h-full min-h-0 flex-col overflow-hidden transition-[width] duration-200 ease-out',
          railGlass,
          sidebarCollapsed ? 'w-[6rem]' : 'w-[18.25rem]',
          'rounded-[1.75rem]',
        )}
      >
        {/* Header */}
        {sidebarCollapsed ? (
          <div className="flex flex-col items-center border-b border-[rgba(13,53,71,0.08)] px-2.5 py-5">
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className="rounded-xl p-0.5 transition-colors hover:bg-white/65"
              aria-label="Expand sidebar"
              title="Expand sidebar"
            >
              <Image
                src="/images/network-og.png"
                alt=""
                width={40}
                height={40}
                className="rounded-xl shadow-sm ring-1 ring-black/5"
              />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 border-b border-[rgba(13,53,71,0.08)] px-4 py-[1.125rem]">
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
                width={40}
                height={40}
                className="shrink-0 rounded-lg shadow-sm ring-1 ring-black/5"
              />
              <span className="truncate text-xl font-semibold font-manrope text-arcova-navy">arcova</span>
            </button>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className={cn(sidebarChromeToggleClass, 'h-9 w-9')}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <ChevronLeft className="h-[1.125rem] w-[1.125rem]" strokeWidth={2.2} />
            </button>
          </div>
        )}

        {sidebarCollapsed ? (
          <nav className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden px-2 py-4">
              {renderCollapsedRail()}
            </div>
            <div className="shrink-0 border-t border-[rgba(13,53,71,0.08)] px-2 pb-4 pt-3">
              {bottomItems.map((item) =>
                railIconButton(item.name, item.icon, {
                  onClick: () => guardedNavigate(item.href),
                  active: isActive(item.href),
                  title: item.name,
                }),
              )}
            </div>
          </nav>
        ) : (
          <nav className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-5">
              {setupFlowOnly ? (
                setupComplete || setupStateLoading ? (
                  <div className="space-y-1">
                    {setupItems.map(renderNavItem)}
                  </div>
                ) : (
                  renderAccordion({
                    label: 'Guided setup',
                    icon: NavIconSetup,
                    items: guidedSetupNestedItems,
                    open: setupOpen,
                    onToggle: () => setSetupOpen((o) => !o),
                    active: setupActive && !setupOpen,
                    dotVisible: setupDotVisible,
                  })
                )
              ) : (
                <>
                  {renderNavItem({ name: 'Today', href: ROUTES.today, icon: NavIconToday })}
                  {renderNavItem({ name: 'GTM base', href: ROUTES.gtmBase, icon: NavIconGtmBase })}
                  {renderNavItem({ name: 'Import', href: ROUTES.import, icon: NavIconImport })}
                  {renderAccordion({
                    label: 'Leads',
                    icon: NavIconLeads,
                    items: leadsItems,
                    open: leadsOpen,
                    onToggle: () => setLeadsOpen((o) => !o),
                    active: leadsActive && !leadsOpen,
                    dotVisible: showContactsDot || showAccountsDot,
                  })}
                  {renderNavItem({ name: 'Health', href: ROUTES.health, icon: NavIconHealth })}
                  {renderNavItem({ name: 'Data', href: ROUTES.data, icon: NavIconData })}
                  {renderNavItem({ name: 'Signals', href: ROUTES.signals, icon: NavIconSignals })}
                  {renderAccordion({
                    label: 'Setup',
                    icon: NavIconSetup,
                    items: setupAccordionItems,
                    open: setupOpen,
                    onToggle: () => setSetupOpen((o) => !o),
                    active: setupActive && !setupOpen,
                    dotVisible: setupDotVisible,
                  })}
                </>
              )}
            </div>
            <div className="shrink-0 border-t border-[rgba(13,53,71,0.08)] px-4 py-3.5">
              {bottomItems.map(renderNavItem)}
            </div>
          </nav>
        )}
      </div>
    </div>
  );
}

export default function AppSidebar(props: AppSidebarProps) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full min-h-0 shrink-0 pl-3">
          <div
            className={cn(
              railGlass,
              'h-full min-h-[320px] w-[18.25rem] shrink-0 animate-pulse rounded-[1.75rem] bg-white/35',
            )}
          />
        </div>
      }
    >
      <AppSidebarInner {...props} />
    </Suspense>
  );
}
