# Repository instructions

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

## Worktree completion protocol

- Every agent working in a separate worktree owns closing out that worktree.
  Do not consider the task complete while important work exists only as
  uncommitted files in a worktree.
- Before stopping, leave the work in one of these states:
  - committed and pushed to a named branch, with the PR link recorded;
  - committed locally on a named branch, with a clear note that it still needs
    push/PR;
  - stashed with a descriptive message, with the worktree path and stash name
    recorded;
  - explicitly marked as abandoned/discardable.
- Before ending a task, report:
  - worktree path;
  - branch name;
  - `git status --short --branch`;
  - latest commit SHA;
  - whether the branch is pushed;
  - PR URL, if any;
  - any uncommitted or stashed work.
- If an agent creates a worktree, that agent is responsible for documenting
  how to resume, merge, park, or remove it.
