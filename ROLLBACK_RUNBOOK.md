# Deployment rollback runbook

How to revert a bad production deploy and verify recovery. Pre-launch gate from
BACKLOG.md ("Document how to roll back a deployment"). **Read this before you
need it** — the dangerous case (a deploy that includes a DB migration) is the
one people get wrong under pressure.

> Fill in the `‹…›` placeholders once for your setup, then this is copy-paste.

## Stack assumptions
- **App:** Next.js on **Vercel** (project `‹vercel-project›`, prod domain `‹arcova.app / app.arcova.bio›`).
- **DB:** Supabase Postgres (project ref `sbubqrsycbledkxjumjg`). Schema changes are
  forward-only migrations in `supabase/migrations/`.
- **Integrations that can be affected by a rollback:** Stripe (webhook + price IDs),
  Resend (`RESEND_AUTH_FROM`), Supabase auth (templates/SMTP), env vars in Vercel.

## First: classify the incident (decides the path)
1. **App-only bug** — bad UI/logic/route, **no new migration** in the deploy.
2. **Migration involved** — the deploy added a `supabase/migrations/*` file (schema/data change).
3. **Data corruption** — a migration or a bug wrote bad data.

Check fast: compare the deployed commit to the previous prod commit —
`git log --oneline ‹prev-prod-sha›..‹bad-prod-sha› -- supabase/migrations` →
any output = **migration involved** (path 2/3). Empty = **app-only** (path 1).

---

## Path 1 — App-only rollback (safe, ~2 min)
Vercel keeps every prior deployment. Roll the app back without touching the DB.

1. Vercel → project → **Deployments** → find the last-known-good deployment →
   **⋯ → Promote to Production** (a.k.a. Instant Rollback). *(CLI: `vercel rollback ‹good-deployment-url›`.)*
2. Confirm the prod domain now serves the old build (hard-refresh; check a changed element or `/api/health` if present).
3. **Verify** (smoke test, see checklist below).
4. Fix forward on a branch; redeploy when green.

No DB change happened, so app-only rollback is fully reversible and safe.

---

## Path 2 — Rollback when a migration shipped (careful)
**The trap:** promoting the old Vercel build does **not** undo the migration. The
old app then runs against a *newer* schema. Whether that's safe depends on the
migration:

- **Additive + backward-compatible** (new nullable column, new table, new index —
  most of ours): the old app ignores it. → **Just do Path 1 (app rollback); leave
  the schema.** Then fix forward. This is the common, safe case.
- **Breaking** (dropped/renamed column, narrowed type, NOT-NULL backfill the old
  app can't satisfy): the old app will error against the new schema. You must
  reverse the schema too — see below.

**Reversing a migration** (only if it's breaking):
1. Write a **down migration** — a new `supabase/migrations/<ts>_revert_<name>.sql`
   that reverses the change (drop the added column, restore the renamed one, etc.).
   We don't keep auto-down files, so author it from the up migration.
2. Apply it (Supabase MCP `apply_migration`, or dashboard SQL editor, or
   `supabase db push`).
3. Then Path 1 (app rollback).
> If you can't cleanly reverse it (data already transformed), go to Path 3 (restore).

**Prefer fixing forward** for breaking migrations when prod still basically works —
ship a corrective migration + app patch rather than reversing, since reversal can
lose data written under the new schema.

---

## Path 3 — Data corruption / unrecoverable migration (restore)
Last resort; **loses data written after the restore point**, so weigh it.
1. **Supabase → Database → Backups** (or Point-in-Time Recovery if enabled —
   ⚠️ **PITR is a BACKLOG gate; confirm it's actually on before you rely on it**).
   Restore to a timestamp just before the bad change.
2. Re-apply any *good* migrations that landed after the restore point, if any.
3. Path 1 (app rollback to the matching commit).
4. Verify, then communicate data loss window to the team.

---

## Smoke-test checklist (after any rollback)
- [ ] App loads; sign in works.
- [ ] `/today` renders (no 500s) — check Vercel logs for errors.
- [ ] A core read path: open `/accounts` or `/leads/contacts`.
- [ ] Auth email path intact: trigger a password reset to a test inbox → link works (`/auth/confirm`).
- [ ] Stripe webhook still 200s (Stripe dashboard → webhook → recent deliveries) — only if billing was in the change.
- [ ] No spike in errors (see Sentry once wired) for ~10 min.

## Who runs it
- **Decider / on-call:** `‹name›` — calls the rollback and which path.
- **Executor:** anyone with Vercel prod-promote + Supabase admin.
- **Comms:** post in `‹#incidents channel›` at start and after verify.

## Gotchas
- **Env vars don't roll back with the deploy.** If the incident was an env change
  (e.g. a wrong `RESEND_AUTH_FROM` or Stripe price ID), revert it in Vercel →
  Settings → Environment Variables and **redeploy** (env changes need a new build).
- **Migrations are forward-only by convention** — there are no auto-generated down
  files. Reversal is always hand-written. This is why additive/backward-compatible
  migrations are strongly preferred (the whole billing + auth schema this session
  was additive precisely so app rollback stays safe).
- **Webhooks:** a rollback that changes webhook routes/secrets can desync Stripe.
  Re-check the endpoint + signing secret after.
- **Prerequisite gaps (BACKLOG):** automated/tested backups, PITR, and a separate
  staging env aren't set up yet — until they are, Path 3 is fragile. Set those up
  before relying on this runbook for a data incident.
