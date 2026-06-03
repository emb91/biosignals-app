/**
 * Sidebar nav icons — SVG paths match the standalone Arcova prototypes
 * (e.g. contacts.jsx / icps.jsx in the design bundle).
 */

import { cn } from '@/lib/utils';

const stroke = {
  width: 1.7 as const,
  cap: 'round' as const,
  join: 'round' as const,
};

type IconProps = { className?: string };

export function NavIconToday({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke.width}
      strokeLinecap={stroke.cap}
      strokeLinejoin={stroke.join}
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function NavIconGtmBase({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke.width}
      strokeLinecap={stroke.cap}
      strokeLinejoin={stroke.join}
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
      <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </svg>
  );
}

export function NavIconImport({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke.width}
      strokeLinecap={stroke.cap}
      strokeLinejoin={stroke.join}
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

export function NavIconLeads({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke.width}
      strokeLinecap={stroke.cap}
      strokeLinejoin={stroke.join}
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.9" />
      <path d="M16 3.1a4 4 0 0 1 0 7.8" />
    </svg>
  );
}

export function NavIconContact({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke.width}
      strokeLinecap={stroke.cap}
      strokeLinejoin={stroke.join}
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="10" cy="8" r="4" />
    </svg>
  );
}

export function NavIconAccount({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke.width}
      strokeLinecap={stroke.cap}
      strokeLinejoin={stroke.join}
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <path d="M3 21V8l9-5 9 5v13" />
      <path d="M9 21V12h6v9" />
    </svg>
  );
}

export function NavIconCustomers({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke.width}
      strokeLinecap={stroke.cap}
      strokeLinejoin={stroke.join}
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <rect x="3" y="4" width="14" height="16" rx="2" />
      <path d="M7 8h6M7 12h6M7 16h4" />
      <circle cx="18" cy="17" r="3" />
      <path d="m16.9 17 0.8 0.8 1.5-1.6" />
    </svg>
  );
}

export function NavIconHealth({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke.width}
      strokeLinecap={stroke.cap}
      strokeLinejoin={stroke.join}
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <path d="M3 12h4l2-7 4 14 2-7h6" />
    </svg>
  );
}

export function NavIconData({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke.width}
      strokeLinecap={stroke.cap}
      strokeLinejoin={stroke.join}
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="6" rx="2" />
      <rect x="3" y="14" width="18" height="6" rx="2" />
    </svg>
  );
}

export function NavIconSignals({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke.width}
      strokeLinecap={stroke.cap}
      strokeLinejoin={stroke.join}
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <path d="M2 12a10 10 0 0 1 20 0" />
      <path d="M5 12a7 7 0 0 1 14 0" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

export function NavIconSetup({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke.width}
      strokeLinecap={stroke.cap}
      strokeLinejoin={stroke.join}
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <path d="m14 5 6 6-9 9H5v-6z" />
    </svg>
  );
}

export function NavIconMyCompany({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke.width}
      strokeLinecap={stroke.cap}
      strokeLinejoin={stroke.join}
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M8 6h8M8 10h8M8 14h5" />
    </svg>
  );
}

export function NavIconMyIcps({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke.width}
      strokeLinecap={stroke.cap}
      strokeLinejoin={stroke.join}
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    </svg>
  );
}

export function NavIconOutreach({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke.width}
      strokeLinecap={stroke.cap}
      strokeLinejoin={stroke.join}
      className={cn('shrink-0', className)}
      aria-hidden
    >
      {/* Paper-plane: maps to "send" / outbound */}
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4z" />
    </svg>
  );
}

export function NavIconLog({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke.width}
      strokeLinecap={stroke.cap}
      strokeLinejoin={stroke.join}
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <path d="M9 12h6M9 16h6M9 8h6M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    </svg>
  );
}

export function NavIconSettings({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke.width}
      strokeLinecap={stroke.cap}
      strokeLinejoin={stroke.join}
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}
