-- Phase 1c — Dedup the companies table.
--
-- Today: `companies` is per-user. Same domain has up to N rows, one per user
-- that tracks it. Target: canonical, one row per domain. All FK references
-- to "loser" rows are repointed to the canonical winner before deletion.
--
-- For each lower(domain) cluster with >1 row:
--   - winner = the row with the most-recent updated_at (tie → created_at)
--   - enrichment fields on winner are NOT modified here — winner is kept as-is
--     except aliases are unioned across all rows in the cluster
--   - all 13 FK tables that reference companies(id) are repointed
--   - loser rows are deleted (CASCADE on user_companies, etc. will not fire
--     because we've already moved every reference)
--
-- A snapshot of every pre-dedup row goes to companies_pre_dedup_backup (retain
-- ~30 days before dropping). This makes the migration reversible if a merge
-- decision turns out wrong.

create table if not exists companies_pre_dedup_backup (like companies including all);

insert into companies_pre_dedup_backup select * from companies;

do $$
declare
  v_winner uuid;
  v_loser uuid;
  v_domain text;
  v_merged_aliases text[];
begin
  for v_domain in
    select lower(domain)
    from companies
    where domain is not null and domain <> ''
    group by lower(domain)
    having count(*) > 1
  loop
    -- Pick winner: most-recent updated_at, then most-recent created_at.
    select id into v_winner
    from companies
    where lower(domain) = v_domain
    order by updated_at desc nulls last, created_at desc nulls last
    limit 1;

    -- Union aliases across all rows in the cluster.
    select array(
      select distinct unnest_alias
      from companies, lateral unnest(coalesce(aliases, array[]::text[])) as unnest_alias
      where lower(domain) = v_domain
        and unnest_alias is not null
        and unnest_alias <> ''
    ) into v_merged_aliases;

    update companies
      set aliases = v_merged_aliases,
          aliases_updated_at = greatest(coalesce(aliases_updated_at, '-infinity'::timestamptz), now())
      where id = v_winner;

    -- Repoint every loser's FK references to the winner, then delete loser.
    for v_loser in
      select id from companies
      where lower(domain) = v_domain and id <> v_winner
    loop
      -- user_companies: PK is (user_id, company_id). If the same user already
      -- has a row pointing to the winner, the loser's row is a duplicate —
      -- merge into winner's by preferring winner's values; otherwise repoint.
      update user_companies
        set company_id = v_winner,
            updated_at = greatest(updated_at, now())
        where company_id = v_loser
          and not exists (
            select 1 from user_companies w
            where w.company_id = v_winner and w.user_id = user_companies.user_id
          );
      -- The remaining loser-user_companies rows are dupes; delete them.
      delete from user_companies where company_id = v_loser;

      -- Repoint other FK references. For tables with (user_id, company_id)
      -- compound uniqueness, the loser row by definition came from a different
      -- user, so no conflict can arise — different user_id values yield
      -- distinct keys after repoint.
      update contacts set company_id = v_winner where company_id = v_loser;
      update normalized_signals set company_id = v_winner where company_id = v_loser;
      update signal_source_events set entity_company_id = v_winner where entity_company_id = v_loser;
      update signals set company_id = v_winner where company_id = v_loser;
      update account_readiness_snapshots set company_id = v_winner where company_id = v_loser;
      update account_reason_snapshots set company_id = v_winner where company_id = v_loser;
      update company_conference_appearances set company_id = v_winner where company_id = v_loser;
      update company_icp_scores set company_id = v_winner where company_id = v_loser;
      update contact_persona_scores set company_id = v_winner where company_id = v_loser;
      update crm_contact_company_links set arcova_company_id = v_winner where arcova_company_id = v_loser;
      update crm_contacts set arcova_company_id = v_winner where arcova_company_id = v_loser;
      update crm_deal_company_links set arcova_company_id = v_winner where arcova_company_id = v_loser;

      -- Now safe to delete the loser canonical row.
      delete from companies where id = v_loser;
    end loop;
  end loop;
end$$;

comment on table companies_pre_dedup_backup is
  'Snapshot of companies pre-canonical-dedup (Phase 1c, 2026-05-27). Drop after ~30 days.';
