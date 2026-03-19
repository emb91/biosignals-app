'use client';

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
    name: 'My Profile',
    href: '/my-profile',
    icon: User,
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
    name: 'Settings',
    href: '/settings',
    icon: Settings,
  },
];

export default function AppSidebar() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    return pathname === href;
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
                <item.icon className="w-5 h-5" />
                <span>{item.name}</span>
              </Link>
            </div>
          ))}
        </nav>
      </div>
    </div>
  );
}
