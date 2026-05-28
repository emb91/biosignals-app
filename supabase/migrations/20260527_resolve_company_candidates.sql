-- Phase 2 — trigram-similarity RPC used by lib/companies/resolve-mentions.ts.
--
-- Returns top-N companies by max(similarity) across (company_name, aliases[]).
-- Filters to candidates >= p_min_similarity to keep the payload bounded.
-- Caller does its own further filtering and LLM disambiguation.

CREATE OR REPLACE FUNCTION public.resolve_company_candidates(
  p_query text,
  p_limit integer DEFAULT 10,
  p_min_similarity double precision DEFAULT 0.45
)
RETURNS TABLE(id uuid, company_name text, similarity double precision)
LANGUAGE sql STABLE AS $function$
  WITH name_sims AS (
    SELECT
      c.id,
      c.company_name,
      similarity(lower(c.company_name), p_query) AS sim
    FROM companies c
    WHERE c.company_name IS NOT NULL
  ),
  alias_sims AS (
    SELECT
      c.id,
      c.company_name,
      MAX(similarity(lower(alias), p_query)) AS sim
    FROM companies c
    CROSS JOIN LATERAL unnest(COALESCE(c.aliases, ARRAY[]::text[])) AS alias
    WHERE c.aliases IS NOT NULL AND array_length(c.aliases, 1) > 0
    GROUP BY c.id, c.company_name
  ),
  combined AS (
    SELECT id, company_name, sim FROM name_sims
    UNION ALL
    SELECT id, company_name, sim FROM alias_sims
  ),
  best_per_company AS (
    SELECT id, company_name, MAX(sim) AS similarity
    FROM combined
    GROUP BY id, company_name
  )
  SELECT id, company_name, similarity
  FROM best_per_company
  WHERE similarity >= p_min_similarity
  ORDER BY similarity DESC
  LIMIT p_limit;
$function$;
