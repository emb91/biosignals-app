export function billingPortalConfigurationId(): string | undefined {
  const value = process.env.STRIPE_BILLING_PORTAL_CONFIGURATION?.trim();
  return value?.startsWith('bpc_') ? value : undefined;
}

export function isBillingPortalConfigured(): boolean {
  return Boolean(billingPortalConfigurationId() || process.env.STRIPE_BILLING_PORTAL_USE_DEFAULT === 'true');
}
