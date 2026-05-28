-- Phase 4 — pre-filter RPC for backfillRecentMentionsForCompany.
--
-- Given a source table spec and a set of normalized name targets, returns
-- rows whose name column trigram-similar to ANY target above threshold,
-- restricted to the lookback window. Caller (lib/companies/backfill-mentions-for-company.ts)
-- then runs the resolver on the extracted raw names and applies updates per row.
--
-- Returns: rows of (pk jsonb, names text[]).
-- The caller deserializes and runs the resolver client-side.

CREATE OR REPLACE FUNCTION public.backfill_candidate_rows(
  p_table text,
  p_pk_cols text[],
  p_date_col text,                 -- nullable when table has no date col
  p_cutoff timestamptz,
  p_name_col text,
  p_names_array_col text,          -- nullable
  p_normalized_col text,
  p_normalized_array_col text,     -- nullable
  p_dest_col text,                 -- 'mentioned_company_ids' | 'canonical_company_id'
  p_targets text[],
  p_min_similarity double precision DEFAULT 0.4,
  p_limit integer DEFAULT 500
)
RETURNS TABLE(pk jsonb, names text[])
LANGUAGE plpgsql STABLE AS $$
DECLARE
  pk_jsonb    text;
  names_expr  text;
  match_expr  text;
  date_clause text := '';
  v_sql       text;
BEGIN
  IF p_dest_col NOT IN ('mentioned_company_ids', 'canonical_company_id') THEN
    RAISE EXCEPTION 'invalid dest col: %', p_dest_col;
  END IF;

  SELECT string_agg(format('%L, t.%I', c, c), ', ')
    INTO pk_jsonb
    FROM unnest(p_pk_cols) AS c;

  IF p_names_array_col IS NOT NULL AND p_names_array_col <> p_name_col THEN
    names_expr := format(
      'array_remove(coalesce(t.%I, ARRAY[]::text[]) || ARRAY[t.%I], NULL)',
      p_names_array_col, p_name_col
    );
  ELSIF p_names_array_col IS NOT NULL AND p_names_array_col = p_name_col THEN
    names_expr := format('array_remove(coalesce(t.%I, ARRAY[]::text[]), NULL)', p_names_array_col);
  ELSE
    names_expr := format('array_remove(ARRAY[t.%I], NULL)', p_name_col);
  END IF;

  IF p_normalized_array_col IS NOT NULL THEN
    match_expr := format(
      'EXISTS (SELECT 1 FROM unnest(t.%I) AS norm CROSS JOIN unnest($1) AS tgt WHERE similarity(norm, tgt) >= $2)',
      p_normalized_array_col
    );
  ELSE
    match_expr := format(
      '(t.%I IS NOT NULL AND EXISTS (SELECT 1 FROM unnest($1) AS tgt WHERE similarity(t.%I, tgt) >= $2))',
      p_normalized_col, p_normalized_col
    );
  END IF;

  IF p_date_col IS NOT NULL AND p_date_col <> '' THEN
    date_clause := format('AND t.%I >= $3 ', p_date_col);
  END IF;

  v_sql := format(
    'SELECT jsonb_build_object(%s) AS pk, %s AS names
       FROM %I AS t
      WHERE %s %s
      LIMIT $4',
    pk_jsonb, names_expr, p_table, match_expr, date_clause
  );

  IF p_date_col IS NOT NULL AND p_date_col <> '' THEN
    RETURN QUERY EXECUTE v_sql USING p_targets, p_min_similarity, p_cutoff, p_limit;
  ELSE
    RETURN QUERY EXECUTE v_sql USING p_targets, p_min_similarity, p_limit;
  END IF;
END;
$$;
