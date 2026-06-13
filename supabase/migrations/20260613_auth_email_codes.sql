-- Short-code indirection for emailed auth links.
-- A Supabase token_hash (56 hex) embedded in a URL makes a ~120-char link that
-- quoted-printable line-wrapping corrupts in email (the `=` separator + adjacent
-- token chars get mangled → broken link). We instead store the token against a
-- short opaque code and email `?code=<8char>`, resolved server-side in
-- /auth/confirm (see lib/auth-links.ts). One-time use, expiring.
-- Service-role only: RLS enabled, no policies.
create table if not exists public.auth_email_codes (
  code text primary key,
  token_hash text not null,
  otp_type text not null,
  next text not null default '/today',
  email text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);
alter table public.auth_email_codes enable row level security;
