#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

const rawArgs = process.argv.slice(2)
const dryRun = rawArgs.includes("--dry-run") || rawArgs.includes("--print")
const includeMain = rawArgs.includes("--include-main")
const allWorktrees = rawArgs.includes("--all-worktrees")
const passThroughArgs = rawArgs.filter(
  (arg) => !["--dry-run", "--print", "--include-main", "--all-worktrees"].includes(arg),
)

function git(args, cwd = process.cwd()) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
}

function parseWorktrees(output) {
  return output
    .split(/\n(?=worktree )/)
    .map((block) => {
      const entry = {}

      for (const line of block.split("\n")) {
        const [key, ...rest] = line.split(" ")
        if (!key) continue
        entry[key] = rest.join(" ")
      }

      if (entry.branch?.startsWith("refs/heads/")) {
        entry.branch = entry.branch.slice("refs/heads/".length)
      }

      return entry
    })
    .filter((entry) => entry.worktree && entry.HEAD && entry.branch)
}

function getCommitInfo(worktreePath) {
  const format = "%ct%x00%h%x00%cs%x00%s"
  const [timestamp, shortHash, date, subject] = git(["log", "-1", `--format=${format}`], worktreePath).split("\0")

  return {
    timestamp: Number(timestamp),
    shortHash,
    date,
    subject,
  }
}

function hasDevScript(worktreePath) {
  const packageJsonPath = path.join(worktreePath, "package.json")

  if (!existsSync(packageJsonPath)) {
    return false
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
  return Boolean(packageJson.scripts?.dev)
}

const repoRoot = git(["rev-parse", "--show-toplevel"])
const workspaceRoot = path.dirname(repoRoot)
const worktrees = parseWorktrees(git(["worktree", "list", "--porcelain"], repoRoot))
const excludedBranches = includeMain ? new Set() : new Set(["main", "master"])

const candidates = worktrees
  .filter((entry) => allWorktrees || path.resolve(entry.worktree).startsWith(`${workspaceRoot}${path.sep}`))
  .filter((entry) => !excludedBranches.has(entry.branch))
  .filter((entry) => hasDevScript(entry.worktree))
  .map((entry) => ({
    ...entry,
    commit: getCommitInfo(entry.worktree),
  }))
  .sort((a, b) => {
    if (b.commit.timestamp !== a.commit.timestamp) {
      return b.commit.timestamp - a.commit.timestamp
    }

    return a.branch.localeCompare(b.branch)
  })

const selected = candidates[0]

if (!selected) {
  console.error("No branch worktree with a package.json was found.")
  console.error("By default this skips main/master. Use --include-main to include them.")
  console.error(`By default this only scans worktrees under ${workspaceRoot}. Use --all-worktrees to include temp paths.`)
  process.exit(1)
}

console.log("Starting dev server from latest worktree:")
console.log(`  branch: ${selected.branch}`)
console.log(`  path:   ${selected.worktree}`)
console.log(`  commit: ${selected.commit.shortHash} ${selected.commit.date} ${selected.commit.subject}`)

if (dryRun) {
  process.exit(0)
}

const child = spawn("npm", ["run", "dev", "--", ...passThroughArgs], {
  cwd: selected.worktree,
  stdio: "inherit",
  shell: process.platform === "win32",
})

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
  }

  process.exit(code ?? 1)
})
