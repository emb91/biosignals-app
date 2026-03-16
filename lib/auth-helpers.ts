import { supabase } from '@/lib/supabase'

// Get the current user's session token (client-side)
export async function getCurrentUserToken() {
  const { data: { session }, error } = await supabase.auth.getSession()
  
  if (error || !session) {
    throw new Error('No user logged in')
  }
  
  return session.access_token
}

// Get display name from user metadata or email
export function getDisplayName(user: { email?: string | null; user_metadata?: { full_name?: string; name?: string } }): string {
  if (user.user_metadata?.full_name) {
    return user.user_metadata.full_name.split(' ')[0]
  }
  if (user.user_metadata?.name) {
    return user.user_metadata.name.split(' ')[0]
  }
  if (user.email) {
    return user.email.split('@')[0]
  }
  return 'User'
}
