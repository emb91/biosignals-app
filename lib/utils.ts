import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getDisplayName(user: { displayName?: string | null; email?: string | null }): string {
  if (user.displayName) {
    // Extract first name from display name (split by space and take first part)
    const firstName = user.displayName.split(' ')[0];
    return firstName;
  }
  return user.email || 'User';
}
