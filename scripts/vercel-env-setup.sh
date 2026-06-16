#!/bin/bash
# Run this from your terminal (where you're logged into Vercel CLI).
# Sets all billing env vars for production + preview.
# Usage: bash scripts/vercel-env-setup.sh

set -e

echo "Setting Stripe billing env vars on Vercel..."

# New per-seat price IDs (created by stripe-bootstrap.mjs 2026-06-16)
vercel env add STRIPE_PRICE_STARTER_SEAT production <<< "price_1TiqDRRxQg2ButDEPXK2NSzQ"
vercel env add STRIPE_PRICE_STARTER_SEAT preview    <<< "price_1TiqDRRxQg2ButDEPXK2NSzQ"

vercel env add STRIPE_PRICE_STARTER_SEAT_ANNUAL production <<< "price_1TiqDSRxQg2ButDEyqqYms4g"
vercel env add STRIPE_PRICE_STARTER_SEAT_ANNUAL preview    <<< "price_1TiqDSRxQg2ButDEyqqYms4g"

vercel env add STRIPE_PRICE_GROWTH_SEAT production <<< "price_1TiqDSRxQg2ButDENf8kDHua"
vercel env add STRIPE_PRICE_GROWTH_SEAT preview    <<< "price_1TiqDSRxQg2ButDENf8kDHua"

vercel env add STRIPE_PRICE_GROWTH_SEAT_ANNUAL production <<< "price_1TiqDTRxQg2ButDEPv8fbskZ"
vercel env add STRIPE_PRICE_GROWTH_SEAT_ANNUAL preview    <<< "price_1TiqDTRxQg2ButDEPv8fbskZ"

vercel env add STRIPE_PRICE_ENRICH_PACK production <<< "price_1TiqDURxQg2ButDEHtrtW5YT"
vercel env add STRIPE_PRICE_ENRICH_PACK preview    <<< "price_1TiqDURxQg2ButDEHtrtW5YT"

# Prod webhook signing secret (endpoint: https://app.arcova.bio/api/stripe/webhook)
# This replaces the local-dev whsec from `stripe listen` — only set on production.
# Paste the live value from Stripe Dashboard → Developers → Webhooks → signing secret. Never commit it.
vercel env add STRIPE_WEBHOOK_SECRET production <<< "${STRIPE_WEBHOOK_SECRET:?set this in your shell, do not hardcode}"

# Flip enforcement on
vercel env add BILLING_ENFORCEMENT production <<< "true"
vercel env add BILLING_ENFORCEMENT preview    <<< "true"

echo ""
echo "Done. Trigger a redeploy to pick up the new vars:"
echo "  vercel --prod"
