'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Target,
  UserCircle,
  Radio,
  FileUp,
  Users,
  Settings,
  User,
  Wrench,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const setupItems: NavItem[] = [
  { name: 'Company Criteria', href: '/company-criteria', icon: Target },
  { name: 'Buyer criteria', href: '/personas', icon: UserCircle },
  { name: 'Arcova Setup', href: '/arcova-setup', icon: User },
];

const topNavigation: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Import', href: '/import', icon: FileUp },
  { name: 'Signals', href: '/customer-signals', icon: Radio },
  { name: 'Leads', href: '/results', icon: Users },
];

const bottomNavigation: NavItem[] = [
  { name: 'Settings', href: '/settings', icon: Settings },
];

interface AppSidebarProps {
  /**
   * When true, hide the rest of the app nav and show setup as a single focus state
   * (no links to profile / companies / teams so first-time users stay in the guided flow).
   */
  setupFlowOnly?: boolean;
}

export default function AppSidebar({ setupFlowOnly = false }: AppSidebarProps) {
  const pathname = usePathname();
  const [showCompaniesDot, setShowCompaniesDot] = useState(false);
  const [showPersonasDot, setShowPersonasDot] = useState(false);
  const [showMyProfileDot, setShowMyProfileDot] = useState(false);
  const [showImportDot, setShowImportDot] = useState(false);

  const isActive = (href: string) => {
    if (pathname === href) return true;
    if (href === '/dashboard') return false;
    return pathname.startsWith(`${href}/`);
  };

  const setupActive = setupItems.some((item) => isActive(item.href));
  const [setupOpen, setSetupOpen] = useState(setupActive);

  useEffect(() => {
    if (setupActive) setSetupOpen(true);
  }, [setupActive]);

  useEffect(() => {
    const loadCompletionStatus = async () => {
      try {
        const [companiesRes, personasRes, profileRes, importRes] = await Promise.all([
          fetch('/api/company-criteria'),
          fetch('/api/contacts'),
          fetch('/api/user-company-profile'),
          fetch('/api/import-ready'),
        ]);

        if (companiesRes.ok) {
          const companiesResult = await companiesRes.json();
          const companies = companiesResult.data || [];
          setShowCompaniesDot(companies.length === 0);
        }

        if (personasRes.ok) {
          const personasResult = await personasRes.json();
          const personas = personasResult.data || [];
          setShowPersonasDot(personas.length === 0);
        }

        if (profileRes.ok) {
          const profileResult = await profileRes.json();
          const profile = profileResult.data;
          const hasCompletedProfile = Boolean(
            profile &&
            typeof profile.company_name === 'string' &&
            profile.company_name.trim()
          );
          setShowMyProfileDot(!hasCompletedProfile);
        }

        if (importRes.ok) {
          const importResult = await importRes.json();
          setShowImportDot(Boolean(importResult.ready));
        }
      } catch (error) {
        console.error('Error loading sidebar completion status:', error);
      }
    };

    loadCompletionStatus();
  }, []);

  const setupDotVisible = showCompaniesDot || showPersonasDot || showMyProfileDot;

  const shouldShowDot = (itemName: string) => {
    if (itemName === 'Companies') return showCompaniesDot;
    if (itemName === 'Buyer criteria') return showPersonasDot;
    if (itemName === 'My company') return showMyProfileDot;
    if (itemName === 'Import') return showImportDot;
    return false;
  };

  const renderNavItem = (item: NavItem) => (
    <div key={item.name}>
      <Link
        href={item.href}
        className={cn(
          "flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
          isActive(item.href)
            ? "bg-arcova-teal text-white"
            : "text-white hover:bg-arcova-mint/20 hover:text-white"
        )}
      >
        <div className="relative">
          <item.icon className="w-5 h-5" />
          {shouldShowDot(item.name) && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#EF4444] shadow-[0_0_8px_#EF4444]" />
          )}
        </div>
        <span>{item.name}</span>
      </Link>
    </div>
  );

  return (
    <div className="flex h-screen bg-white">
      <div className="w-64 bg-arcova-darkblue border-r border-arcova-mint/20 flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-arcova-mint/20">
          <Link href="/" className="flex items-center space-x-2">
            <Image
              src="/images/network-og.png"
              alt="Arcova"
              width={32}
              height={32}
              className="rounded-lg"
            />
            <span className="text-white font-semibold text-lg">arcova</span>
          </Link>
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
              {topNavigation.map(renderNavItem)}

              <div>
                <button
                  type="button"
                  onClick={() => setSetupOpen((o) => !o)}
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                    setupActive
                      ? 'bg-arcova-teal text-white'
                      : 'text-white hover:bg-arcova-mint/20'
                  )}
                >
                  <div className="flex items-center space-x-3">
                    <div className="relative">
                      <Wrench className="w-5 h-5" />
                      {setupDotVisible && !setupOpen && (
                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#EF4444] shadow-[0_0_8px_#EF4444]" />
                      )}
                    </div>
                    <span>Setup</span>
                  </div>
                  <ChevronDown
                    className={cn('w-4 h-4 transition-transform duration-200', setupOpen && 'rotate-180')}
                  />
                </button>

                {setupOpen && (
                  <div className="mt-1 ml-4 space-y-1 border-l border-arcova-mint/20 pl-3">
                    {setupItems.map(renderNavItem)}
                  </div>
                )}
              </div>

              {bottomNavigation.map(renderNavItem)}
            </>
          )}
        </nav>
      </div>
    </div>
  );
}
