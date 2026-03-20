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
  Users, 
  Settings, 
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navigation: NavItem[] = [
  {
    name: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    name: 'Signals',
    href: '/customer-signals',
    icon: Radio,
  },
  {
    name: 'Leads',
    href: '/results',
    icon: Users,
  },
  {
    name: 'Companies',
    href: '/companies',
    icon: Target,
  },
  {
    name: 'Personas',
    href: '/personas',
    icon: UserCircle,
  },
  {
    name: 'My Profile',
    href: '/my-profile',
    icon: User,
  },
  {
    name: 'Settings',
    href: '/settings',
    icon: Settings,
  },
];

export default function AppSidebar() {
  const pathname = usePathname();
  const [showCompaniesDot, setShowCompaniesDot] = useState(false);
  const [showPersonasDot, setShowPersonasDot] = useState(false);
  const [showMyProfileDot, setShowMyProfileDot] = useState(false);

  const isActive = (href: string) => {
    if (pathname === href) return true;
    if (href === '/dashboard') return false;
    return pathname.startsWith(`${href}/`);
  };

  useEffect(() => {
    const loadCompletionStatus = async () => {
      try {
        const [companiesRes, personasRes, profileRes] = await Promise.all([
          fetch('/api/companies'),
          fetch('/api/contacts'),
          fetch('/api/user-company-profile'),
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
      } catch (error) {
        console.error('Error loading sidebar completion status:', error);
      }
    };

    loadCompletionStatus();
  }, []);

  const shouldShowDot = (itemName: string) => {
    if (itemName === 'Companies') return showCompaniesDot;
    if (itemName === 'Personas') return showPersonasDot;
    if (itemName === 'My Profile') return showMyProfileDot;
    return false;
  };

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
          {navigation.map((item) => (
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
          ))}
        </nav>
      </div>
    </div>
  );
}
