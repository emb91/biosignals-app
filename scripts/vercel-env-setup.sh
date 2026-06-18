#!/bin/bash
# Run scripts/stripe-bootstrap.mjs first, export the six printed price IDs,
# then run this while authenticated with the Vercel CLI.

set -e

: "${STRIPE_PRICE_STARTER_WORKSPACE:?missing Starter monthly price}"
: "${STRIPE_PRICE_STARTER_WORKSPACE_ANNUAL:?missing Starter annual price}"
: "${STRIPE_PRICE_GROWTH_WORKSPACE:?missing Growth monthly price}"
: "${STRIPE_PRICE_GROWTH_WORKSPACE_ANNUAL:?missing Growth annual price}"
: "${STRIPE_PRICE_STARTER_CREDITS_1000:?missing Starter credit-pack price}"
: "${STRIPE_PRICE_GROWTH_CREDITS_1000:?missing Growth credit-pack price}"
: "${STRIPE_WEBHOOK_SECRET:?missing production webhook secret}"

for environment in production preview; do
  vercel env add STRIPE_PRICE_STARTER_WORKSPACE "$environment" <<< "$STRIPE_PRICE_STARTER_WORKSPACE"
  vercel env add STRIPE_PRICE_STARTER_WORKSPACE_ANNUAL "$environment" <<< "$STRIPE_PRICE_STARTER_WORKSPACE_ANNUAL"
  vercel env add STRIPE_PRICE_GROWTH_WORKSPACE "$environment" <<< "$STRIPE_PRICE_GROWTH_WORKSPACE"
  vercel env add STRIPE_PRICE_GROWTH_WORKSPACE_ANNUAL "$environment" <<< "$STRIPE_PRICE_GROWTH_WORKSPACE_ANNUAL"
  vercel env add STRIPE_PRICE_STARTER_CREDITS_1000 "$environment" <<< "$STRIPE_PRICE_STARTER_CREDITS_1000"
  vercel env add STRIPE_PRICE_GROWTH_CREDITS_1000 "$environment" <<< "$STRIPE_PRICE_GROWTH_CREDITS_1000"
done

vercel env add STRIPE_WEBHOOK_SECRET production <<< "$STRIPE_WEBHOOK_SECRET"

# Keep enforcement off through the seven-day shadow reconciliation. Enable
# ARCOVA_CREDIT_ENFORCEMENT only after ledger/provider totals reconcile.
echo "Price IDs installed. Redeploy, run shadow reconciliation, then enable ARCOVA_CREDIT_ENFORCEMENT."
