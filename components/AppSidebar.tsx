'use client';

import { useEffect, useState, Suspense, useMemo } from 'react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Gauge,
  LogOut,
  Menu,
  Send,
  Settings as SettingsIcon,
  UserRound,
  X,
} from 'lucide-react';
import {
  NavIconAccount,
  NavIconContact,
  NavIconData,
  NavIconGtmBase,
  NavIconHealth,
  NavIconImport,
  NavIconMyCompany,
  NavIconMyIcps,
  NavIconLog,
  NavIconOutreach,
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

type SidebarUsageSummary = {
  unlimited: boolean;
  plan: { key: string; name: string };
  credits: { available: number; granted: number };
};

const setupItems: NavItem[] = [
  { name: 'My Company', href: ROUTES.setup.company, icon: NavIconMyCompany },
  { name: 'My ICPs', href: ROUTES.setup.icps, icon: NavIconMyIcps },
];

const topNavigation: NavItem[] = [
  { name: 'Today', href: ROUTES.today, icon: NavIconToday },
  { name: 'GTM base', href: ROUTES.gtmBase, icon: NavIconGtmBase },
  { name: 'Import', href: ROUTES.import, icon: NavIconImport },
  { name: 'Coverage', href: ROUTES.coverage, icon: NavIconHealth },
  { name: 'Data', href: ROUTES.data, icon: NavIconData },
  { name: 'Outreach', href: ROUTES.outreach, icon: NavIconOutreach },
];

// Log lives in the Workspace section now; Settings is reached via the identity
// footer. Admin Dash is appended for admins (see bottomItems).
const bottomNavigation: NavItem[] = [
  { name: 'Log', href: ROUTES.log, icon: NavIconLog },
];


const NAV_DOT_DISMISS_PREFIX = 'arcova_nav_dot_seen';
const FULL_WIDTH_SIDEBAR_QUERY = '(min-width: 1280px)';
const SIDEBAR_VISIBLE_QUERY = '(min-width: 1024px)';

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
  const { user, logout } = useAuth();
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
  const [dataJobCount, setDataJobCount] = useState(0);
  // Cached profile picture for the identity footer (falls back to initials).
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  // Hover-to-expand: when the rail is collapsed, hovering pops the full nav out
  // as an overlay without reflowing the page.
  const [hovering, setHovering] = useState(false);
  const [showSignalsDot, setShowSignalsDot] = useState(false);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileHidden, setMobileHidden] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [fullWidthSidebar, setFullWidthSidebar] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [accountUsageOpen, setAccountUsageOpen] = useState(false);
  const [usageSummary, setUsageSummary] = useState<SidebarUsageSummary | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);

  // Identity footer: name + company, opens Settings on click.
  const metadata = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const metaName = [metadata.full_name, metadata.name, metadata.display_name]
    .find((v): v is string => typeof v === 'string' && v.trim().length > 0)
    ?.trim();
  const emailLocal = user?.email?.split('@')[0]?.replace(/[._-]+/g, ' ').trim();
  const displayName = metaName || emailLocal || 'Your account';
  // Profile picture: the cached enrichment photo wins; fall back to an OAuth
  // (e.g. Google) avatar from auth metadata, then to initials.
  const metaAvatar = [metadata.avatar_url, metadata.picture]
    .find((v): v is string => typeof v === 'string' && v.trim().length > 0)
    ?.trim();
  const resolvedAvatar = avatarUrl || metaAvatar || null;
  const accountInitials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || 'A';
  // Log only. Settings is the identity footer; Admin Dash lives in Settings (admin-only).
  const bottomItems = bottomNavigation;

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

  const contactsActive = pathname === ROUTES.contacts;
  const accountsActive = pathname === ROUTES.accounts;

  const closeAccountMenu = () => {
    setAccountMenuOpen(false);
    setAccountUsageOpen(false);
  };

  const navigateFromAccountMenu = (href: string) => {
    closeAccountMenu();
    guardedNavigate(href);
  };

  const openTeamInvite = () => {
    closeAccountMenu();
    if (pathname === ROUTES.settings) {
      window.history.replaceState(null, '', `${ROUTES.settings}#team-settings`);
      window.requestAnimationFrame(() => {
        document.getElementById('team-settings')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      return;
    }
    guardedNavigate(`${ROUTES.settings}#team-settings`);
  };

  const handleLogout = async () => {
    closeAccountMenu();
    try {
      await logout();
      window.location.href = '/login';
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  // Cached profile picture for the footer avatar (saved during profile enrichment).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetch('/api/me/profile')
      .then((response) => (response.ok ? response.json() : null))
      .then((profile) => {
        const photo = profile?.enriched?.photoUrl;
        if (!cancelled && typeof photo === 'string' && photo.trim()) {
          setAvatarUrl(photo);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const loadUsage = () => {
      fetch('/api/billing/summary')
        .then((response) => (response.ok ? response.json() : null))
        .then((summary) => {
          if (!cancelled && summary) setUsageSummary(summary);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setUsageLoading(false);
        });
    };
    setUsageLoading(true);
    loadUsage();
    const interval = window.setInterval(loadUsage, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [user]);

  useEffect(() => {
    closeAccountMenu();
  }, [pathname]);

  const setCollapsed = (collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
  };

  // Responsive auto-behaviour:
  //   ≥1280px     → full sidebar by default; user can collapse with the header arrow.
  //   1024–1279px → compact rail by default; hover reveals the full sidebar as an overlay.
  //   <1024px     → hide sidebar entirely; show hamburger that opens slide-in overlay.
  useEffect(() => {
    const visibleMq = window.matchMedia(SIDEBAR_VISIBLE_QUERY);
    const fullWidthMq = window.matchMedia(FULL_WIDTH_SIDEBAR_QUERY);
    const update = () => {
      const isVisible = visibleMq.matches;
      setMobileHidden(!isVisible);
      setFullWidthSidebar(fullWidthMq.matches);
      if (isVisible) setMobileOpen(false);
    };
    update();
    visibleMq.addEventListener('change', update);
    fullWidthMq.addEventListener('change', update);
    return () => {
      visibleMq.removeEventListener('change', update);
      fullWidthMq.removeEventListener('change', update);
    };
  }, []);

  const autoCollapsed = !mobileHidden && !fullWidthSidebar;
  // The user toggle only applies in full-width mode. Smaller desktop widths are
  // intentionally hover-reveal rails, so there is no persistent close/open state.
  const effectiveCollapsed = !mobileHidden && (autoCollapsed || (fullWidthSidebar && sidebarCollapsed));

  // While collapsed, hovering the rail pops the full nav out as an overlay.
  // The collapsed footprint is preserved so page content never reflows.
  const isHoverExpanded = effectiveCollapsed && hovering && !mobileHidden;
  const displayCollapsed = effectiveCollapsed && !mobileHidden && !isHoverExpanded;

  useEffect(() => {
    const loadCompletionStatus = async () => {
      try {
        const [companiesRes, profileRes, importRes, dataJobsRes, healthRes, signalsRes] = await Promise.all([
          fetch(ROUTES.api.icps),
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
          const trimmedCompany = typeof profile?.company_name === 'string' ? profile.company_name.trim() : '';
          setCompanyName(trimmedCompany || null);
          const needsProfile = !trimmedCompany;
          setShowMyProfileDot(needsProfile);
          setupNeedsAttention = setupNeedsAttention || needsProfile;
        }

        if (importRes.ok) {
          const result = await importRes.json();
          const importReady = Boolean(result.ready);
          const importSignature = importReady ? `import-ready:${result.completeCount ?? 'ready'}` : null;
          importNeedsAttention = dismissibleDotVisible('import', importSignature, pathname === ROUTES.import);
          contactsNeedAttention = dismissibleDotVisible('contacts', importSignature, pathname === ROUTES.contacts);
          accountsNeedAttention = dismissibleDotVisible('accounts', importSignature, pathname === ROUTES.accounts);
          setShowImportDot(importNeedsAttention);
          setShowContactsDot(contactsNeedAttention);
          setShowAccountsDot(accountsNeedAttention);
        }

        if (dataJobsRes.ok) {
          const result = await dataJobsRes.json();
          const jobs = Array.isArray(result.jobs) ? result.jobs : [];
          // Live = queued or in-flight (anything not finished/failed). This drives
          // the count badge on the Data nav item ("something's cooking").
          const liveJobs = jobs.filter((job: Record<string, unknown>) =>
            !['complete', 'completed', 'failed', 'cancelled'].includes(String(job.status)),
          );
          setDataJobCount(liveJobs.length);
          dataNeedsAttention = liveJobs.length > 0;
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
            pathname === ROUTES.contacts || pathname === ROUTES.accounts,
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
    if (itemName === 'Contacts') return showContactsDot || showSignalsDot;
    if (itemName === 'Accounts') return showAccountsDot || showSignalsDot;
    if (itemName === 'Outreach') return false;
    if (itemName === 'Customers') return false;
    if (itemName === 'Health') return showHealthDot;
    // Data shows a live count badge instead of a dot (see renderNavItem).
    if (itemName === 'Data') return false;
    if (itemName === 'My Company' || itemName === 'My company') return showMyProfileDot;
    if (itemName === 'My ICPs') return showCompaniesDot;
    if (itemName === 'Guided setup') return setupDotVisible;
    if (itemName === 'Target ICP') return showCompaniesDot;
    return false;
  };

  const renderSectionLabel = (label: string) => (
    <p className="px-2.5 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-arcova-navy/35">
      {label}
    </p>
  );

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
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-arcova-coral shadow-[0_0_0_2px_rgba(255,255,255,0.95)]" />
          )}
        </div>
        <span className="flex-1">{item.name}</span>
        {item.name === 'Data' && dataJobCount > 0 && (
          <span
            className={cn(
              'flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums shadow-[0_2px_8px_-2px_rgba(0,164,180,0.6)]',
              (item.active ?? isActive(item.href)) ? 'bg-white/20 text-white' : 'bg-arcova-teal text-white',
            )}
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/80" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
            </span>
            {dataJobCount}
          </span>
        )}
      </button>
    </div>
  );

  const railIconButton = (
    key: string,
    Icon: React.ComponentType<{ className?: string }>,
    opts: { onClick: () => void; active: boolean; title: string; dot?: boolean; badge?: number },
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
        {opts.badge ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-arcova-teal px-1 text-[9px] font-bold tabular-nums text-white ring-2 ring-[rgba(255,255,255,0.95)]">
            {opts.badge}
          </span>
        ) : opts.dot ? (
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-arcova-coral ring-2 ring-[rgba(255,255,255,0.95)]" />
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
        {bottomItems.map((item) =>
          railIconButton(item.name, item.icon, {
            onClick: () => guardedNavigate(item.href),
            active: isActive(item.href),
            title: item.name,
          }),
        )}
        {railIconButton('contacts', NavIconContact, {
          onClick: () => guardedNavigate(ROUTES.contacts),
          active: contactsActive,
          title: 'Contacts',
          dot: showContactsDot || showSignalsDot,
        })}
        {railIconButton('accounts', NavIconAccount, {
          onClick: () => guardedNavigate(ROUTES.accounts),
          active: accountsActive,
          title: 'Accounts',
          dot: showAccountsDot || showSignalsDot,
        })}
        {topNavigation.slice(3).map((item) =>
          railIconButton(item.href, item.icon, {
            onClick: () => guardedNavigate(item.href),
            active: isActive(item.href),
            title: item.name,
            dot: shouldShowDot(item.name),
            badge: item.name === 'Data' && dataJobCount > 0 ? dataJobCount : undefined,
          }),
        )}
        {railIconButton('setup', NavIconSetup, {
          onClick: () =>
            guardedNavigate(!setupComplete && !setupStateLoading ? ROUTES.setup.arcova : ROUTES.setup.company),
          active: setupActive,
          title: 'About',
          dot: setupDotVisible,
        })}
      </>
    );
  };

  const grantedCredits = usageSummary?.credits.granted ?? 0;
  const availableCredits = usageSummary?.credits.available ?? 0;
  const usedCredits = Math.max(0, grantedCredits - availableCredits);
  const usagePct = grantedCredits > 0 ? Math.min(100, Math.round((usedCredits / grantedCredits) * 100)) : 0;
  const usageLabel = usageLoading
    ? 'Loading'
    : usageSummary?.unlimited
      ? 'Unlimited'
      : typeof usageSummary?.credits.available === 'number'
        ? `${usageSummary.credits.available.toLocaleString()} credits`
        : 'Open usage';

  const accountMenu = accountMenuOpen ? (
    <div className="fixed bottom-[4.75rem] left-3 z-[90] w-[18.5rem] overflow-hidden rounded-2xl border border-[rgba(13,53,71,0.12)] bg-white/95 p-2.5 shadow-[0_24px_80px_-32px_rgba(13,53,71,0.45)] backdrop-blur-xl">
      <div className="flex items-start gap-2.5 px-2 py-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-arcova-navy/10 text-[11px] font-bold text-arcova-navy">
          {resolvedAvatar ? (
            <Image
              src={resolvedAvatar}
              alt=""
              width={36}
              height={36}
              unoptimized
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
          ) : (
            accountInitials
          )}
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-[12px] font-semibold text-arcova-navy">{displayName}</span>
          {companyName && <span className="block truncate text-[10.5px] text-arcova-navy/45">{companyName}</span>}
          {user?.email && <span className="block truncate text-[10.5px] text-arcova-navy/45">{user.email}</span>}
        </span>
      </div>

      <div className="my-2 h-px bg-[rgba(13,53,71,0.08)]" />

      <button
        type="button"
        onClick={() => navigateFromAccountMenu(ROUTES.setup.profile)}
        className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-[#0d3547] transition hover:bg-[#f4f7f9]"
      >
        <span className="flex min-w-0 items-center gap-3">
          <UserRound className="h-4 w-4 shrink-0 text-[#4a6470]" />
          <span className="truncate text-[12.5px] font-medium">Profile</span>
        </span>
      </button>

      <button
        type="button"
        onClick={() => navigateFromAccountMenu(ROUTES.settings)}
        className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-[#0d3547] transition hover:bg-[#f4f7f9]"
      >
        <span className="flex min-w-0 items-center gap-3">
          <SettingsIcon className="h-4 w-4 shrink-0 text-[#4a6470]" />
          <span className="truncate text-[12.5px] font-medium">Settings</span>
        </span>
      </button>

      <button
        type="button"
        onClick={openTeamInvite}
        className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-[#0d3547] transition hover:bg-[#f4f7f9]"
      >
        <span className="flex min-w-0 items-center gap-3">
          <Send className="h-4 w-4 shrink-0 text-[#4a6470]" />
          <span className="truncate text-[12.5px] font-medium">Invite a friend</span>
        </span>
      </button>

      <div className="my-2 h-px bg-[rgba(13,53,71,0.08)]" />

      <button
        type="button"
        onClick={() => setAccountUsageOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-[#0d3547] transition hover:bg-[#f4f7f9]"
      >
        <span className="flex min-w-0 items-center gap-3">
          <Gauge className="h-4 w-4 shrink-0 text-[#4a6470]" />
          <span className="truncate text-[12.5px] font-medium">Usage remaining</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-[10.5px] text-[#7d909a]">
          {usageLabel}
          <ChevronRight className={`h-3.5 w-3.5 text-[#b6c2c8] transition-transform ${accountUsageOpen ? 'rotate-90' : ''}`} />
        </span>
      </button>

      {accountUsageOpen && (
        <div className="mx-2 mb-2 ml-9 rounded-xl border border-[rgba(13,53,71,0.08)] bg-[#f8fbfc] px-3 py-2.5">
          {usageLoading ? (
            <p className="text-[12px] text-[#7d909a]">Loading usage</p>
          ) : usageSummary?.unlimited ? (
            <p className="text-[12px] text-[#4a6470]">{usageSummary.plan.name}</p>
          ) : (
            <div>
              <div className="flex items-baseline justify-between gap-3 text-[12px]">
                <span className="font-medium text-[#0d3547]">{availableCredits.toLocaleString()} credits</span>
                <span className="text-[11px] text-[#7d909a]">{grantedCredits.toLocaleString()} granted</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-[#0d3547]" style={{ width: `${usagePct}%` }} />
              </div>
              <button
                type="button"
                onClick={() => navigateFromAccountMenu('/settings/usage')}
                className="mt-2 text-xs font-semibold text-[#0d3547] hover:underline"
              >
                View details
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => navigateFromAccountMenu('/settings/billing')}
            className="mt-2 flex w-full items-center justify-between gap-3 rounded-lg bg-white px-2.5 py-1.5 text-left text-[12px] font-medium text-[#0d3547] ring-1 ring-[rgba(13,53,71,0.08)] transition hover:bg-[#f4f7f9]"
          >
            Upgrade for more usage
            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[#4a6470]" />
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => void handleLogout()}
        className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[#0d3547] transition hover:bg-[#f4f7f9]"
      >
        <LogOut className="h-4 w-4 shrink-0 text-[#4a6470]" />
        <span className="text-[12.5px] font-medium">Log out</span>
      </button>
    </div>
  ) : null;

  return (
    <>
      {accountMenuOpen && (
        <button
          type="button"
          aria-label="Close account menu"
          className="fixed inset-0 z-[80] cursor-default bg-transparent"
          onClick={closeAccountMenu}
        />
      )}
      {accountMenu}
      {/* Hamburger button — visible only when the sidebar is hidden below desktop widths. */}
      {mobileHidden && !mobileOpen && (
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className={cn(
            'fixed left-3.5 top-3.5 z-40 flex h-10 w-10 items-center justify-center rounded-xl',
            'border border-[rgba(13,53,71,0.1)] bg-white/85 shadow-[0_8px_24px_-12px_rgba(13,53,71,0.3)] backdrop-blur-md',
            'text-[#0d3547] transition-colors hover:bg-white',
          )}
          aria-label="Open menu"
          title="Open menu"
        >
          <Menu className="h-5 w-5" strokeWidth={2.2} />
        </button>
      )}

      {/* Backdrop for mobile slide-in */}
      {mobileHidden && mobileOpen && (
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-[rgba(13,53,71,0.32)] backdrop-blur-[2px]"
          aria-label="Close menu"
        />
      )}

      <div
        onMouseEnter={() => {
          if (effectiveCollapsed && !mobileHidden) setHovering(true);
        }}
        onMouseLeave={() => setHovering(false)}
        className={cn(
          'flex h-full min-h-0 bg-transparent',
          mobileHidden
            ? cn(
                'fixed left-0 top-0 z-50 pl-3 py-3 transition-transform duration-200 ease-out',
                mobileOpen ? 'translate-x-0' : '-translate-x-full',
              )
            : cn('relative shrink-0 pl-3', effectiveCollapsed && 'w-[6.75rem]'),
        )}
      >
      <div
        className={cn(
          'flex h-full min-h-0 flex-col overflow-hidden transition-[width] duration-200 ease-out',
          railGlass,
          displayCollapsed ? 'w-[6rem]' : 'w-[18.25rem]',
          'rounded-[1.75rem]',
          // Hover pop-out: float the full nav over the page from the collapsed slot.
          isHoverExpanded && 'absolute left-3 top-0 z-50 shadow-[0_24px_60px_-24px_rgba(13,53,71,0.55)]',
        )}
      >
        {/* Close button — only at mobile slide-in */}
        {mobileHidden && (
          <div className="flex shrink-0 justify-end border-b border-[rgba(13,53,71,0.08)] px-3 pt-3">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className={cn(sidebarChromeToggleClass, 'h-9 w-9')}
              aria-label="Close menu"
              title="Close menu"
            >
              <X className="h-[1.125rem] w-[1.125rem]" strokeWidth={2.2} />
            </button>
          </div>
        )}
        {/* Header */}
        {displayCollapsed ? (
          <div className="flex flex-col items-center border-b border-[rgba(13,53,71,0.08)] px-2.5 py-5">
            {fullWidthSidebar ? (
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
            ) : (
              <Image
                src="/images/network-og.png"
                alt=""
                width={40}
                height={40}
                className="rounded-xl shadow-sm ring-1 ring-black/5"
              />
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 border-b border-[rgba(13,53,71,0.08)] px-4 py-[1.125rem]">
            <div className="flex min-w-0 flex-1 items-center gap-2 py-1">
              <Image
                src="/images/network-og.png"
                alt=""
                width={32}
                height={32}
                className="shrink-0 rounded-lg shadow-sm ring-1 ring-black/5"
              />
              <span className="min-w-0 leading-tight">
                <span className="block truncate font-manrope text-[15px] font-extrabold tracking-tight text-arcova-navy">arcova</span>
                <span className="block truncate text-[10px] font-medium text-arcova-navy/40">GTM intelligence</span>
              </span>
            </div>
          {fullWidthSidebar && !isHoverExpanded && (
            <button
              type="button"
              onClick={() => setCollapsed(true)}
                className={cn(sidebarChromeToggleClass, 'h-9 w-9')}
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
              >
                <ChevronLeft className="h-[1.125rem] w-[1.125rem]" strokeWidth={2.2} />
              </button>
            )}
          </div>
        )}

        {displayCollapsed ? (
          <nav className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden px-2 py-4">
              {renderCollapsedRail()}
            </div>
            <div className="flex shrink-0 flex-col gap-2 border-t border-[rgba(13,53,71,0.08)] px-2 pb-4 pt-3">
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => setAccountMenuOpen((value) => !value)}
                  title={companyName ? `${displayName} · ${companyName}` : displayName}
                  aria-label="Open account menu"
                  className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-arcova-navy/10 text-[11px] font-bold text-arcova-navy transition-colors hover:bg-arcova-navy/15"
                >
                  {resolvedAvatar ? (
                    <Image
                      src={resolvedAvatar}
                      alt=""
                      width={36}
                      height={36}
                      unoptimized
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    accountInitials
                  )}
                </button>
              </div>
            </div>
          </nav>
        ) : (
          <nav className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto p-5 pt-2">
              {setupFlowOnly ? (
                setupComplete || setupStateLoading ? (
                  <div className="space-y-1">
                    {setupItems.map(renderNavItem)}
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {renderNavItem({ name: 'Guided setup', href: ROUTES.setup.arcova, icon: NavIconSetup })}
                    {guidedSetupNestedItems.map(renderNavItem)}
                  </div>
                )
              ) : (
                <>
                  {renderSectionLabel('Workspace')}
                  <div className="space-y-0.5">
                    {renderNavItem({ name: 'Today', href: ROUTES.today, icon: NavIconToday })}
                    {renderNavItem({ name: 'GTM base', href: ROUTES.gtmBase, icon: NavIconGtmBase })}
                    {renderNavItem({ name: 'Import', href: ROUTES.import, icon: NavIconImport })}
                    {bottomItems.map(renderNavItem)}
                  </div>

                  {renderSectionLabel('Go-to-market')}
                  <div className="space-y-0.5">
                    {renderNavItem({ name: 'Contacts', href: ROUTES.contacts, icon: NavIconContact })}
                    {renderNavItem({ name: 'Accounts', href: ROUTES.accounts, icon: NavIconAccount })}
                    {renderNavItem({ name: 'Coverage', href: ROUTES.coverage, icon: NavIconHealth })}
                    {renderNavItem({ name: 'Data', href: ROUTES.data, icon: NavIconData })}
                    {renderNavItem({ name: 'Outreach', href: ROUTES.outreach, icon: NavIconOutreach })}
                  </div>

                  {renderSectionLabel('About')}
                  <div className="space-y-0.5">
                    {setupItems.map(renderNavItem)}
                  </div>
                </>
              )}
            </div>
            <div className="shrink-0 border-t border-[rgba(13,53,71,0.08)] p-3">
              <button
                type="button"
                onClick={() => setAccountMenuOpen((value) => !value)}
                className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-white/70"
                aria-label="Open account menu"
                title={companyName ? `${displayName} · ${companyName}` : displayName}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-arcova-navy/10 text-[11px] font-bold text-arcova-navy">
                  {resolvedAvatar ? (
                    <Image
                      src={resolvedAvatar}
                      alt=""
                      width={32}
                      height={32}
                      unoptimized
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    accountInitials
                  )}
                </span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-[12.5px] font-semibold text-arcova-navy">{displayName}</span>
                  {companyName && <span className="block truncate text-[10.5px] text-arcova-navy/45">{companyName}</span>}
                </span>
              </button>
            </div>
          </nav>
        )}
      </div>
    </div>
    </>
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
