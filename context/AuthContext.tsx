'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  login: (email: string, password: string, captchaToken?: string) => Promise<void>;
  signup: (email: string, password: string, fullName?: string, captchaToken?: string, next?: string) => Promise<boolean>;
  loginWithGoogle: (next?: string) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = async (email: string, password: string, captchaToken?: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: captchaToken ? { captchaToken } : undefined,
    });
    if (error) throw error;
  };

  // Returns true when the account needs email confirmation before sign-in
  // (no session yet) — the caller must show "check your email" instead of
  // navigating into the app.
  const signup = async (
    email: string,
    password: string,
    fullName?: string,
    captchaToken?: string,
    next?: string,
  ): Promise<boolean> => {
    // Routed server-side (/api/auth/signup) so the confirmation email goes
    // through Resend with a /auth/confirm link, like invites and reset — no
    // Supabase rate limit and our own copy. Returns true when the account needs
    // email confirmation before sign-in.
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, fullName, captchaToken, next }),
    });
    const data = (await res.json().catch(() => ({}))) as { needsConfirm?: boolean; error?: string };
    if (!res.ok) {
      throw new Error(data.error || 'Could not create your account. Please try again.');
    }
    return Boolean(data.needsConfirm);
  };

  const loginWithGoogle = async (next?: string) => {
    const callback = new URL('/auth/callback', window.location.origin);
    if (next) callback.searchParams.set('next', next);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: callback.toString(),
      },
    });
    if (error) throw error;
  };

  const logout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const resetPassword = async (email: string) => {
    // Routed server-side (/api/auth/reset) so the recovery email goes through
    // Resend with a /auth/confirm link, like invites — no Supabase rate limit or
    // broken template. Always resolves ok (no account enumeration).
    const res = await fetch('/api/auth/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!res.ok && res.status !== 200) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || 'Could not start password reset. Please try again.');
    }
  };

  const updatePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (error) throw error;
  };

  const value = {
    user,
    session,
    loading,
    login,
    signup,
    loginWithGoogle,
    logout,
    resetPassword,
    updatePassword,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
