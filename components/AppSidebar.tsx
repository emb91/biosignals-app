'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  Target, 
  Upload, 
  BarChart3, 
  Settings, 
  BookOpen, 
  Headphones,
  User,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: NavItem[];
}

const navigation: NavItem[] = [
  {
    name: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    name: 'Company Analysis',
    href: '/about',
    icon: User,
  },
  {
    name: 'Setup New',
    href: '/icp',
    icon: Target,
  },
  {
    name: 'Upload Data',
    href: '/upload',
    icon: Upload,
  },
  {
    name: 'Results',
    href: '/results',
    icon: BarChart3,
  },
  {
    name: 'Settings',
    href: '/settings',
    icon: Settings,
  },
];

export default function AppSidebar() {
  const pathname = usePathname();
  const [expandedItems, setExpandedItems] = useState<string[]>([]);

  const toggleExpanded = (itemName: string) => {
    setExpandedItems(prev => 
      prev.includes(itemName) 
        ? prev.filter(name => name !== itemName)
        : [...prev, itemName]
    );
  };

  const isActive = (href: string) => {
    return pathname === href;
  };

  return (
    <div className="flex h-screen bg-white">
      {/* Sidebar */}
      <div className="w-64 bg-arcova-darkblue border-r border-arcova-mint/20 flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-arcova-mint/20">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-arcova-teal rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">A</span>
            </div>
            <span className="text-white font-semibold text-lg">Arcova</span>
          </div>
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

        {/* Credits Section */}
        <div className="p-4 border-t border-arcova-mint/20">
          <div className="bg-arcova-mint/10 rounded-lg p-3 mb-4">
            <div className="text-xs text-white/80 mb-1">Available Credits</div>
            <div className="text-sm">
              <div className="flex items-center justify-between">
                <span className="text-white/90">Email</span>
                <span className="text-arcova-teal font-semibold">3905</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/90">Phone</span>
                <span className="text-white/70">0</span>
              </div>
            </div>
          </div>

          {/* Bottom Links */}
          <div className="space-y-2">
            <Link
              href="/learning"
              className="flex items-center space-x-3 px-3 py-2 rounded-lg text-sm text-white hover:bg-arcova-mint/20 hover:text-white transition-colors"
            >
              <BookOpen className="w-4 h-4" />
              <span>Learning Center</span>
            </Link>
            <Link
              href="/support"
              className="flex items-center space-x-3 px-3 py-2 rounded-lg text-sm text-white hover:bg-arcova-mint/20 hover:text-white transition-colors"
            >
              <Headphones className="w-4 h-4" />
              <span>Open Support</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
