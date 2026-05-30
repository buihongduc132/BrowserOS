## Goal

Complete plans & tasks & revise if asked

You are iteration {{iteration}}

Working on: **Mid-Turn Session Persist**
Investigation: `investigation-mid-session-loss.md`
Plan: `flow/plans/2026-05-29_mid-turn-session-persist.md`
Intention: `flow/intentions/2026-05-29_mid-turn-session-persist.md`
Tasks: `.state/mid-turn-session-persist_tasks.json` (12 tasks, Trello schema)

### Source Materials

| Ref | What |
|-----|------|
| `investigation-mid-session-loss.md` | Full 9-finding investigation with code snippets |
| `flow/intentions/2026-05-29_mid-turn-session-persist.md` | User's as-is words |
| `flow/plans/2026-05-29_mid-turn-session-persist.md` | Verified plan with architecture, solution design, edge cases |
| `.state/mid-turn-session-persist_tasks.json` | 12 tasks, Trello schema |

---

## Rules

- ALL works MUST BE sign off by verifier loop AND `claude -p`; DELEGATE to fix if there is ANY problem.
- MUST commit any of your works BEFORE completed / answering to human. Note that you are in CI, no one will hear you.
- TDD approach for all NEW implementations — write test first, then implement.
- NEVER push to remote unless explicitly told by human. All work stays local on `dev` branch.
- Conventional commits enforced by lefthook — format: `feat(session): add messages table to SQLite`.
- Extensionless imports (no `.js` in TypeScript imports). Bun resolves `.ts` automatically.
- Use `@browseros/shared/constants/*` for all magic numbers — ports, timeouts, limits.
- Biome for lint (`bun run lint`), `bun test` for testing, `bun run typecheck` for TS check.

---

## Workflow

1. Check hindsight and task JSON to have the context of what is been doing to be able to quickly pick up.
2. Read the investigation doc and plan file for architecture context if needed.
3. Pick next work using priority-ordered logic below.

### Priority Pick Loop (every iteration)

For each iteration, execute in this order — fall through only if current step has no work:

```
1. PICK 1 task deemed BLOCKED
   → probe if REALLY blocked (read code, check deps)
   → IF not blocked → update task status → start working on it
   → IF really blocked → re-probe, update notes, PASS

2. PICK 1 task that is TESTED with no outstanding problems
   (no failed probes, no TODO notes, all checks passing)
   → PROMOTE to completed
   → IF no tested items without problems, PASS
   → IF all tested items already completed, PASS

3. PICK 1 task with LEAST implemented progress (non-blocking group)
   → IF all equal → pick EARLIEST in plan sequence (T01 first)
   → IF ALL non-blocking are completed → PASS

4. PICK 1 task with LEAST test coverage → increase by target knob
   → IF all >= 90% → PASS

5. ONLY THEN → pick next new task to start
```

### Order

MUST fix the problem found (failing tests, coding guard violations, edge cases, bugs) first.
ONLY starting NEW works / implement new functionalities IF current inventory
DO NOT have ANY problem in the previous works.

### Implementation Dependency Order

Tasks have explicit dependencies in the task JSON. Respect them:

```
Phase P0: T01 (messages table) → T02, T03, T04 (parallel after T01)
Phase P1: T05, T06 (after T01) → T07 (after T06)
  T08 (standalone, no deps)
Phase P2: T09, T10, T11 (after T01)
Phase P3: T12 (after T01, T02)
```

### Development Workflow Per Task

For each task, follow this flow:

```
1. Read the investigation doc for the specific finding
2. Read the task's target files (listed in task JSON `files` array)
3. Read the task's `checks` array — these are your acceptance criteria
4. Run gitnexus_impact on any symbol you're about to modify
5. Write test(s) first (TDD) — put in packages/browseros-agent/apps/server/tests/
6. Implement the change
7. Run: bun test apps/server/tests/<relevant-test>.test.ts
8. Run: bun run typecheck
9. Run: bun run lint
10. Verify ALL checks from the task pass
11. Commit with conventional commit message
12. Update task status in .state/*.json
```

---

## If you are iteration (I)

- **I % 5 == 0**: Rebase current works with dev branch BEFORE starting other works. THEN commit current works.

- **I % 7 == 0 (General Audit + Verifier Loop)** — consolidated from I%7/I%9/I%11:
  Project has ast-grep coding guard (`.sg-rules/`, 14 rules, 9 pre-commit gates) but NO mutator/Stryker, NO E2E worktrees, NO CodeQL. Per consolidation rule: all inapplicable modulos merged into single I%7 with verifier loop.
  1. Run `sg scan` against all modified files
  2. Run verifier loop (`claude -p` or equivalent) against ALL completed tasks
  3. Run ALL existing tests: `bun test` in `packages/browseros-agent/`
  4. Review edge cases from plan — audit only, record findings
  5. Check for regressions in previously completed work
  6. Update task status and inventory
  7. If ANY test fails or verifier finds problems → BLOCKER. Fix before next iteration.

### Every non-ceremony iteration

At the END of every normal iteration (not I%5/%7), you MUST:
1. Run relevant tests for the files you changed.
2. Pick the task with LOWEST check-completion rate.
3. Write 1 new test that covers an unmet check from that task's `checks` array.
4. Run `bun test` + `bun run typecheck` to confirm nothing broke. Commit.

---

## Mandatories

### Context Pickup (always first step)
- Check hindsight for previous iteration context.
- Read `.state/mid-turn-session-persist_tasks.json` for current status.
- Read `investigation-mid-session-loss.md` for architecture context.

### Commit Before Complete
- MUST commit any works BEFORE iteration ends.
- You are autonomous — no one will hear you if you fail silently.

### Verifier Loop
- ALL completed tasks MUST be verified by running `claude -p` as external reviewer.
- Delegate to fix any problems found.

### TDD
- For all NEW code: write test first → implement → verify → commit.
- Test files go in `packages/browseros-agent/apps/server/tests/` matching the source file name.

### Retain Progress
- At end of iteration, retain progress into hindsight.
- Update task JSON with current status.

---

## Inventory & State

Task status tracked in `.state/mid-turn-session-persist_tasks.json`.

Every task has these fields to track:

```yaml
status: pending | in_progress | completed
checks_passed: <count>/<total>
tests_written: <count>
files_modified: <list>
last_iteration: <number>
notes: "<continuation context>"
```

### Task Summary

| ID | Name | Priority | Deps | Status |
|----|------|----------|------|--------|
| T01 | P0.1: Add messages table to SQLite schema | critical | — | pending |
| T02 | P0.2: Periodic message flush during execution | critical | T01 | pending |
| T03 | P0.3: Pre-exit state flush in stop() | critical | T01 | pending |
| T04 | P0.4: SIGTERM/SIGINT graceful flush | critical | T03 | pending |
| T05 | P1.5: Save partial messages on abort (server) | high | T01 | pending |
| T06 | P1.6: Wire getConversationMessages in compaction | high | T01 | pending |
| T07 | P1.7: Implement compact endpoint | high | T06 | pending |
| T08 | P1.8: Save partial messages on abort (client) | high | — | pending |
| T09 | P2.9: Add beforeunload handler in sidepanel | medium | — | pending |
| T10 | P2.10: Persist compaction state across restarts | medium | T01 | pending |
| T11 | P2.11: Persist turn frames for active sessions | medium | T01 | pending |
| T12 | P3.12: Session rehydration on startup | low | T01, T02 | pending |

---

## Project Context

### Architecture

```
BrowserOS monorepo:
  packages/browseros-agent/       ← main package
    apps/server/src/agent/        ← SessionStore, AiSdkAgent, compaction
      session-store.ts            ← IN-MEMORY Map<string, AgentSession>
      compaction.ts               ← CompactionState (ephemeral)
    apps/server/src/api/
      services/chat-service.ts    ← onFinish only saves
      routes/compaction.ts        ← getConversationMessages stub
      routes/assistant-sessions.ts ← compact endpoint stub
    apps/server/src/lib/
      db/schema/                  ← SQLite schema (NO messages table)
      agents/active-turn-registry.ts ← TurnRegistry (ring buffer, 5min retain)
    apps/server/src/
      main.ts                     ← stop() → process.exit() (NO flush)
      index.ts                    ← SIGTERM/SIGINT handlers
    apps/agent/entrypoints/sidepanel/index/
      useChatSession.ts           ← Client chat hook (save on ready only)
```

### Test Infrastructure

| What | Command | Location |
|------|---------|----------|
| Run tests | `bun test` | `packages/browseros-agent/` |
| Single test | `bun test apps/server/tests/agent/session-store.test.ts` | Same |
| Type check | `bun run typecheck` | Same |
| Lint | `bun run lint` (Biome) | Same |
| Coding guard | `sg scan` (ast-grep) | Root — `.sg-rules/` + `sgconfig.yml` |
| Pre-commit | lefthook (biome + file-length + coding-guard) | Root — `lefthook.yml` |

### Key Files (target files for this goal)

| File | Role |
|------|------|
| `packages/browseros-agent/apps/server/src/agent/session-store.ts` | SessionStore — in-memory sessions map |
| `packages/browseros-agent/apps/server/src/api/services/chat-service.ts` | Chat service — onFinish only saves |
| `packages/browseros-agent/apps/server/src/main.ts` | Server stop() — immediate exit |
| `packages/browseros-agent/apps/server/src/index.ts` | SIGTERM/SIGINT handlers |
| `packages/browseros-agent/apps/server/src/lib/db/schema/` | SQLite schema — needs messages table |
| `packages/browseros-agent/apps/server/src/lib/agents/active-turn-registry.ts` | Turn registry — ring buffer |
| `packages/browseros-agent/apps/server/src/api/routes/compaction.ts` | Compaction route — getConversationMessages stub |
| `packages/browseros-agent/apps/server/src/api/routes/assistant-sessions.ts` | Sessions route — compact endpoint stub |
| `packages/browseros-agent/apps/agent/entrypoints/sidepanel/index/useChatSession.ts` | Client chat hook — save on ready only |

### Existing Tests for Target Areas

| Test File | Tests |
|-----------|-------|
| `apps/server/tests/agent/compaction.test.ts` | ✅ exists |
| `apps/server/tests/agent/compaction-config.test.ts` | ✅ exists |
| `apps/server/tests/agent/compaction-vcc.test.ts` | ✅ exists |
| `apps/server/tests/agent/compaction-strategy.test.ts` | ✅ exists |
| `apps/server/tests/agent/compaction-e2e.test.ts` | ✅ exists |
| `apps/server/tests/sessions/agents-md-loader.test.ts` | ✅ exists |
| `apps/server/tests/server.integration.test.ts` | ✅ exists |

---

## Edge Cases to Watch

- **Server crash (SIGKILL)** — cannot catch, periodic flush is the only defense
- **Chromium auto-update restart** — SIGTERM gives ~5s window, must flush within
- **Multiple concurrent sessions** — flush must iterate all sessions atomically
- **WAL mode contention** — SQLite WAL handles concurrent reads; writes are serialized
- **Partial message parts** — interrupted responses may have empty parts; must preserve
- **Client-side storage limits** — `chrome.storage.local` has 10MB limit per extension
- **Session rehydration race** — on startup, must not start serving until DB load completes
- **Compaction state loss** — summary lost on restart leads to context overflow
- **Turn registry ring buffer overflow** — 5k frame limit drops oldest frames silently
