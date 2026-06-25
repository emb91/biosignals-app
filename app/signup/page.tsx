import { redirect } from 'next/navigation'

/**
 * Public signup entry. The marketing site's "Start for free" CTAs and the hero
 * "map your market" form both point here (the form submits the typed company as
 * ?domain=). We don't have a separate signup screen — account creation lives on
 * /login behind the sign-up toggle — so this forwards to it in sign-up mode and
 * carries the typed company through so onboarding can pre-fill it.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string }>
}) {
  const { domain } = await searchParams
  const params = new URLSearchParams({ mode: 'signup' })
  const seed = domain?.trim()
  if (seed) params.set('domain', seed)
  redirect(`/login?${params.toString()}`)
}
