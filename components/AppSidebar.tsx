'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Target,
  Activity,
  Radio,
  FileUp,
  Database,
  Users,
  Building2,
  Settings,
  User,
  Wrench,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Menu,
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
  { name: 'Contacts', href: ROUTES.leads.contacts, icon: Users },
  { name: 'Accounts', href: ROUTES.leads.accounts, icon: Building2 },
];

const topNavigation: NavItem[] = [
  { name: 'Briefing', href: ROUTES.dashboard, icon: LayoutDashboard },
  { name: 'Import', href: ROUTES.import, icon: FileUp },
  { name: 'Health', href: ROUTES.leads.health, icon: Activity },
  { name: 'Data', href: ROUTES.leads.data, icon: Database },
  { name: 'Signals', href: '/customer-signals', icon: Radio },
];

const bottomNavigation: NavItem[] = [
  { name: 'Settings', href: '/settings', icon: Settings },
];

const SIDEBAR_HIDDEN_STORAGE_KEY = 'arcova_sidebar_hidden';
const NARROW_SCREEN_QUERY = '(max-width: 1024px)';

interface AppSidebarProps {
  setupFlowOnly?: boolean;
}

export default function AppSidebar({ setupFlowOnly = false }: AppSidebarProps) {
  const pathname = usePathname();
  const { guardedNavigate } = useEnrichmentGuard();
  const [showCompaniesDot, setShowCompaniesDot] = useState(false);
  const [showMyProfileDot, setShowMyProfileDot] = useState(false);
  const [showImportDot, setShowImportDot] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [sidebarPreviewOpen, setSidebarPreviewOpen] = useState(false);

  const isActive = (href: string) => {
    if (pathname === href) return true;
    if (href === ROUTES.dashboard) return false;
    return pathname.startsWith(`${href}/`);
  };

  const leadsActive = leadsItems.some((item) => isActive(item.href));
  const setupActive = setupItems.some((item) => isActive(item.href));

  const [leadsOpen, setLeadsOpen] = useState(leadsActive);
  const [setupOpen, setSetupOpen] = useState(setupActive);

  useEffect(() => {
    const stored = localStorage.getItem(SIDEBAR_HIDDEN_STORAGE_KEY);
    if (stored === '1' || stored === '0') {
      setSidebarHidden(stored === '1');
      return;
    }
    setSidebarHidden(window.matchMedia(NARROW_SCREEN_QUERY).matches);
  }, []);

  useEffect(() => {
    const media = window.matchMedia(NARROW_SCREEN_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      const stored = localStorage.getItem(SIDEBAR_HIDDEN_STORAGE_KEY);
      if (stored === '1' || stored === '0') return;
      setSidebarHidden(event.matches);
    };

    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  const updateSidebarHidden = (hidden: boolean) => {
    setSidebarHidden(hidden);
    setSidebarPreviewOpen(false);
    localStorage.setItem(SIDEBAR_HIDDEN_STORAGE_KEY, hidden ? '1' : '0');
  };

  const pinSidebarOpen = () => {
    updateSidebarHidden(false);
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
        const [companiesRes, profileRes, importRes] = await Promise.all([
          fetch('/api/company-criteria'),
          fetch('/api/user-company-profile'),
          fetch('/api/import-ready'),
        ]);

        if (companiesRes.ok) {
          const result = await companiesRes.json();
          setShowCompaniesDot((result.data || []).length === 0);
        }

        if (profileRes.ok) {
          const result = await profileRes.json();
          const profile = result.data;
          setShowMyProfileDot(
            !(profile && typeof profile.company_name === 'string' && profile.company_name.trim())
          );
        }

        if (importRes.ok) {
          const result = await importRes.json();
          setShowImportDot(Boolean(result.ready));
        }
      } catch (error) {
        console.error('Error loading sidebar completion status:', error);
      }
    };

    loadCompletionStatus();
  }, []);

  const setupDotVisible = showCompaniesDot || showMyProfileDot;

  const shouldShowDot = (itemName: string) => {
    if (itemName === 'Import') return showImportDot;
    return false;
  };

  const renderNavItem = (item: NavItem) => (
    <div key={item.name}>
      <button
        type="button"
        onClick={() => guardedNavigate(item.href)}
        className={cn(
          'w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left',
          isActive(item.href)
            ? 'bg-arcova-teal text-white'
            : 'text-white hover:bg-arcova-mint/20 hover:text-white',
        )}
      >
        <div className="relative">
          <item.icon className="w-5 h-5" />
          {shouldShowDot(item.name) && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#EF4444] shadow-[0_0_8px_#EF4444]" />
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
          'w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors',
          active ? 'bg-arcova-teal text-white' : 'text-white hover:bg-arcova-mint/20',
        )}
      >
        <div className="flex items-center space-x-3">
          <div className="relative">
            <Icon className="w-5 h-5" />
            {dotVisible && !open && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#EF4444] shadow-[0_0_8px_#EF4444]" />
            )}
          </div>
          <span>{label}</span>
        </div>
        <ChevronDown
          className={cn('w-4 h-4 transition-transform duration-200', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="mt-1 ml-4 space-y-1 border-l border-arcova-mint/20 pl-3">
          {items.map(renderNavItem)}
        </div>
      )}
    </div>
  );

  const shellClassName = cn(
    'flex h-screen bg-white',
    sidebarHidden && sidebarPreviewOpen && 'fixed inset-y-0 left-0 z-50 shadow-2xl shadow-slate-950/20',
  );

  if (sidebarHidden && !sidebarPreviewOpen) {
    return (
      <button
        type="button"
        onClick={() => setSidebarPreviewOpen(true)}
        onMouseEnter={() => setSidebarPreviewOpen(true)}
        className="fixed left-3 top-3 z-50 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900"
        aria-label="Preview sidebar"
        title="Preview sidebar"
      >
        <Menu className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div
      className={shellClassName}
      onMouseLeave={() => {
        if (sidebarHidden) setSidebarPreviewOpen(false);
      }}
    >
      <div className="w-64 bg-arcova-darkblue border-r border-arcova-mint/20 flex flex-col">
        {/* Logo */}
        <div className="flex items-center justify-between gap-3 p-6 border-b border-arcova-mint/20">
          <button
            type="button"
            onClick={() => {
              if (sidebarHidden) pinSidebarOpen();
              else guardedNavigate('/');
            }}
            className="flex min-w-0 flex-1 items-center space-x-2 rounded-lg text-left transition-colors hover:bg-white/5"
            aria-label={sidebarHidden ? 'Keep sidebar open' : 'Go to home'}
            title={sidebarHidden ? 'Keep sidebar open' : 'Go to home'}
          >
            <Image
              src="/images/network-og.png"
              alt="Arcova"
              width={32}
              height={32}
              className="rounded-lg"
            />
            <span className="text-white font-semibold text-lg">arcova</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (sidebarHidden) pinSidebarOpen();
              else updateSidebarHidden(true);
            }}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/55 transition-colors hover:bg-white/10 hover:text-white"
            aria-label={sidebarHidden ? 'Keep sidebar open' : 'Hide sidebar'}
            title={sidebarHidden ? 'Keep sidebar open' : 'Hide sidebar'}
          >
            {sidebarHidden ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-2">
          {setupFlowOnly ? (
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3">
              <div className="flex items-start gap-3">
                <Wrench className="mt-0.5 h-5 w-5 shrink-0 text-arcova-teal" aria-hidden />
                <div>
                  <p className="text-sm font-semibold text-white">Setup</p>
                  <p className="mt-1 text-xs leading-relaxed text-white/60">
                    Stay in the chat to finish. The rest of the app opens when setup is complete.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Briefing */}
              {renderNavItem({ name: 'Briefing', href: ROUTES.dashboard, icon: LayoutDashboard })}

              {/* Import */}
              {renderNavItem({ name: 'Import', href: ROUTES.import, icon: FileUp })}

              {/* Leads (Contacts + Accounts) */}
              {renderAccordion({
                label: 'Leads',
                icon: Users,
                items: leadsItems,
                open: leadsOpen,
                onToggle: () => setLeadsOpen((o) => !o),
                active: leadsActive && !leadsOpen,
              })}

              {/* Health (formerly Pipeline) */}
              {renderNavItem({ name: 'Health', href: ROUTES.leads.health, icon: Activity })}

              {/* Data */}
              {renderNavItem({ name: 'Data', href: ROUTES.leads.data, icon: Database })}

              {/* Signals */}
              {renderNavItem({ name: 'Signals', href: '/customer-signals', icon: Radio })}

              {/* Setup */}
              {renderAccordion({
                label: 'Setup',
                icon: Wrench,
                items: setupItems,
                open: setupOpen,
                onToggle: () => setSetupOpen((o) => !o),
                active: setupActive && !setupOpen,
                dotVisible: setupDotVisible,
              })}

              {/* Settings */}
              {bottomNavigation.map(renderNavItem)}
            </>
          )}
        </nav>
      </div>
    </div>
  );
}
