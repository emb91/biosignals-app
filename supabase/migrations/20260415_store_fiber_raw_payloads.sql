-- Preserve full Fiber enrichment payloads on each contact row so Arcova can
-- decide later what to display without needing to re-enrich contacts.

alter table public.contacts
add column if not exists fiber_person_response_raw jsonb,
add column if not exists fiber_company_response_raw jsonb,
add column if not exists fiber_person_raw jsonb,
add column if not exists fiber_company_raw jsonb,
add column if not exists fiber_lookup_metadata jsonb;
