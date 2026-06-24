# Repository instructions

## Agent git workflow

- For every task, branch from the latest `main`: `git switch main`, `git pull`,
  then `git switch -c codex/<task>`.
- Commit work regularly to the task branch as private checkpoints. Do not open a
  PR until the work is complete.
- When the work is done and verified with `tsc` and the relevant tests green,
  run `git fetch` and `git rebase origin/main` on the task branch. Resolve any
  conflicts on that branch.
- Open exactly one PR, and only at the end.
- Squash-merge after approval/completion, then delete the branch. Never reuse a
  branch unless absolutely necessary.

## Supabase migrations

- Create new migration files with `supabase migration new <descriptive_name>`.
- Prefer `supabase db push` to apply file-backed migrations because it records
  the migration file's existing 14-digit version in remote migration history.
- If production DDL must be applied with Supabase MCP `apply_migration`, note
  that MCP generates the remote version independently. After it succeeds,
  immediately rename the matching local migration file to the exact version
  returned by MCP.
- Before considering migration work complete, compare local migration versions
  with remote migration history and resolve every mismatch. Never leave the
  same migration under different local and remote versions.
- Do not re-run an already-applied migration merely to reconcile its version.
  Reconcile migration history or rename the local file without executing its
  SQL again.
- Do not delete or rewrite an applied migration to change production state.
  Add a new forward migration instead.
