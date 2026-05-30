## Goal

Complete plans & tasks & revise if asked

You are iteration {{iteration}}

Working on: **Tab Ownership & Browser Self-Close Fix**
Plan: `flow/plans/2026-05-30_tab-ownership-and-browser-self-close.md`
Intention: `flow/intentions/2026-05-30_tab-ownership-and-browser-self-close.md`
Tasks: `.state/tab-ownership-and-browser-self-close_tasks.json` (14 tasks, Trello schema)

### Source Materials

| Ref | What |
|-----|------|
| `flow/intentions/2026-05-30_tab-ownership-and-browser-self-close.md` | Your as-is words |
| `flow/plans/2026-05-30_tab-ownership-and-browser-self-close.md` | Full plan with architecture, solution design, edge cases |
| `.state/tab-ownership-and-browser-self-close_tasks.json` | 14 tasks, Trello schema |

---

## Rules

- ALL works MUST BE sign off by verifier loop AND `claude -p`; DELEGATE to fix if there is ANY problem.
- MUST commit any of your works BEFORE completed / answering to human. Note that you are in CI, no one will hear you.
- TDD approach for all NEW implementations — write test first, then implement.
- NEVER push to remote unless explicitly told by human. All work stays local on `dev` branch.
- Conventional commits enforced by lefthook — format: `fix(navigation): guard last visible tab`.
- Extensionless imports (no `.js` in TypeScript imports). Bun resolves `.ts` automatically.
- Use `@browseros/shared/constants/*` for all magic numbers — ports, timeouts, limits.
- Biome for lint (`bun run lint`), `bun test` for testing, `bun run typecheck` for TS check.

---

## Workflow

1. Check hindsight and task JSON to have the context of what is been doing to be able to quickly pick up.
2. Read the plan file for architecture context if needed.
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
Phase P0 (no deps — can parallel): T01, T02, T04, T05
  T03 depends on T05
Phase P1 (depends on ALL P0): T06 → T07, T08, T09
Phase P2 (depends on T06): T10, T11
Phase P4 (depends on T06): T12, T13
Phase P3 (no deps): T14
```

### Development Workflow Per Task

For each task, follow this flow:

```
1. Read the task's target files (listed in task JSON `files` array)
2. Read the task's `checks` array — these are your acceptance criteria
3. Run gitnexus_impact on any symbol you're about to modify
4. Write test(s) first (TDD) — put in packages/browseros-agent/apps/server/tests/tools/
5. Implement the change
6. Run: bun test apps/server/tests/tools/<relevant-test>.test.ts
7. Run: bun run typecheck
8. Run: bun run lint
9. Verify ALL checks from the task pass
10. Commit with conventional commit message
11. Update task status in .state/*.json
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
- Read `.state/tab-ownership-and-browser-self-close_tasks.json` for current status.
- Read plan file for architecture context if needed.

### Commit Before Complete
- MUST commit any works BEFORE iteration ends.
- You are autonomous — no one will hear you if you fail silently.

### Verifier Loop
- ALL completed tasks MUST be verified by running `claude -p` as external reviewer.
- Delegate to fix any problems found.

### TDD
- For all NEW code: write test first → implement → verify → commit.
- Test files go in `packages/browseros-agent/apps/server/tests/tools/` matching the source file name.

### Retain Progress
- At end of iteration, retain progress into hindsight.
- Update task JSON with current status.

---

## Inventory & State

Task status tracked in `.state/tab-ownership-and-browser-self-close_tasks.json`.

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
| T01 | P0.1: Last-visible-tab guard in close_page | critical | — | pending |
| T02 | P0.2: Last-visible-window guard in close_window | critical | — | pending |
| T03 | P0.3: Sidepanel origin-tab guard | critical | T05 | pending |
| T04 | P0.4: close_tab_group guard | critical | — | pending |
| T05 | P0.5: Fix MCP session context | critical | — | pending |
| T06 | P1.1: TabOwnershipRegistry | high | T01-T05 | pending |
| T07 | P1.2: Enforce ownership in tools | high | T06 | pending |
| T08 | P1.3: Enrich list_pages with ownership | high | T06 | pending |
| T09 | P1.4: MCP lock_tab / unlock_tab tools | high | T06 | pending |
| T10 | P2.1: Extend glow.content indicator | medium | T06 | pending |
| T11 | P2.2: Wire ownership to glow dispatch | medium | T06, T10 | pending |
| T12 | P4.1: Idle lock release config | low | T06 | pending |
| T13 | P4.2: Strict mode toggle | low | T06, T07 | pending |
| T14 | V6: Neutralize window.close() | low | — | pending |

---

## Project Context

### Architecture

```
BrowserOS monorepo:
  packages/browseros-agent/       ← main package
    apps/server/src/tools/        ← MCP tool definitions (THIS IS WHERE WE WORK)
      navigation.ts               ← close_page, navigate_page, new_page, list_pages
      windows.ts                  ← close_window, create_window, list_windows
      tab-groups.ts               ← close_tab_group, group_tabs, ungroup_tabs
      framework.ts                ← ToolContext, defineTool, executeTool
      page-actions.ts             ← evaluate_script
      input.ts                    ← click, fill, type
      dom.ts                      ← DOM interaction tools
    apps/server/src/browser/      ← Browser class (CDP abstraction)
      browser.ts                  ← page tracking, CDP connection
    apps/server/src/api/          ← HTTP routes + MCP
      routes/mcp.ts               ← MCP route — creates per-request server
      services/mcp/register-mcp.ts ← Tool registration for MCP
    apps/agent/entrypoints/       ← Browser extension
      glow.content/               ← Visual overlay content script
      sidepanel/index/useNotifyActiveTab.tsx ← Glow message dispatch
```

### Test Infrastructure

| What | Command | Location |
|------|---------|----------|
| Run tests | `bun test` | `packages/browseros-agent/` |
| Single test | `bun test apps/server/tests/tools/navigation.test.ts` | Same |
| Type check | `bun run typecheck` | Same |
| Lint | `bun run lint` (Biome) | Same |
| Coding guard | `sg scan` (ast-grep) | Root — `.sg-rules/` + `sgconfig.yml` |
| Pre-commit | lefthook (biome + file-length + coding-guard) | Root — `lefthook.yml` |

### Key Files (target files for this goal)

| File | Role |
|------|------|
| `packages/browseros-agent/apps/server/src/tools/navigation.ts` | close_page, navigate_page, new_page, list_pages |
| `packages/browseros-agent/apps/server/src/tools/windows.ts` | close_window, create_window, list_windows |
| `packages/browseros-agent/apps/server/src/tools/tab-groups.ts` | close_tab_group, group_tabs, ungroup_tabs |
| `packages/browseros-agent/apps/server/src/tools/framework.ts` | ToolContext, defineTool, executeTool |
| `packages/browseros-agent/apps/server/src/browser/browser.ts` | Browser class — CDP abstraction, page tracking |
| `packages/browseros-agent/apps/server/src/api/routes/mcp.ts` | MCP route — creates per-request server |
| `packages/browseros-agent/apps/server/src/api/services/mcp/register-mcp.ts` | Tool registration for MCP |
| `packages/browseros-agent/apps/agent/entrypoints/glow.content/` | Visual overlay content script |
| `packages/browseros-agent/apps/agent/entrypoints/sidepanel/index/useNotifyActiveTab.tsx` | Glow message dispatch |

### Existing Tests for Target Files

| Test File | Tests |
|-----------|-------|
| `apps/server/tests/tools/navigation.test.ts` | ✅ exists |
| `apps/server/tests/tools/windows.test.ts` | ✅ exists |
| `apps/server/tests/tools/tab-groups.test.ts` | ✅ exists |
| `apps/server/tests/tools/page-actions.test.ts` | ✅ exists |
| `apps/server/tests/tools/input.test.ts` | ✅ exists |
| `apps/server/tests/tools/dom.test.ts` | ✅ exists |

---

## Edge Cases to Watch

- Hidden tabs/windows — should NOT count as "visible" for last-tab checks
- Scheduled tasks — operate on hidden pages, should NOT trigger last-tab guard
- Concurrent conversations — TOCTOU race on last-tab check (low risk, serialized per session)
- `evaluate_script` → `window.close()` — bypasses all tool guards (T14)
- `about:blank` / `data:` navigation — destroys content without closing tab
- DevTools/popup windows — counted as visible but not usable
- `EXCLUDED_URL_PREFIXES` — `chrome-extension://` tabs filtered from listPages
- Multiple MCP clients — each creates per-request server; ownership registry MUST be shared at Browser class level
