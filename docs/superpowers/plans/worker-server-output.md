# Server Worker Output — Slash Commands

**Date:** 2026-05-14
**Status:** COMPLETE — 52 tests pass, 0 regressions

## Files Created

### Server Module (`apps/server/src/commands/`)

| File | Lines | Purpose |
|------|-------|---------|
| `types.ts` | 47 | CommandFrontmatter, CommandMeta, CommandDetail, CreateCommandInput, UpdateCommandInput, ParsedCommand, ResolvedCommand, BuiltinCommandDef |
| `builtin.ts` | 58 | `getBuiltinCommands()` → 6 commands: /clear, /compact, /mode, /model, /help, /reset |
| `loader.ts` | 130 | `loadAllCommands()` from disk + external dirs. `isValidCommandFrontmatter()`. Priority: user > external > built-in |
| `service.ts` | 233 | CRUD (listCommands, getCommand, createCommand, updateCommand, deleteCommand) + resolution (parseCommandInput, resolveTemplate, resolveCommand) |

### API Routes

| File | Purpose |
|------|---------|
| `apps/server/src/api/routes/commands.ts` | GET/POST/PUT/DELETE /commands — mirrors skills routes exactly |

### Tests

| File | Cases | Status |
|------|-------|--------|
| `apps/server/tests/commands/command-types.test.ts` | 11 (suites 1, 2) | ✅ All pass |
| `apps/server/tests/commands/command-service.test.ts` | 30 (suites 3, 5, 6) | ✅ All pass |
| `apps/server/tests/api/routes/commands.test.ts` | 11 (suite 4) | ✅ All pass |

### Modified Files

| File | Change |
|------|--------|
| `apps/server/src/api/server.ts` | Added import + route `/commands` next to `/skills` |
| `apps/server/src/lib/browseros-dir.ts` | Added `getCommandsDir()`, mkdir in `ensureBrowserosDir()` |
| `packages/shared/src/constants/paths.ts` | Added `COMMANDS_DIR_NAME: 'commands'` |

## TDD Coverage

| Suite | Cases | Pass |
|-------|-------|------|
| S1: Frontmatter parsing | 7 | 7 ✅ |
| S2: Built-in definitions | 4 | 4 ✅ |
| S3: CRUD service | 6 | 6 ✅ |
| S4: API routes | 11 | 11 ✅ |
| S5: External dir loading | 3 | 3 ✅ |
| S6: Command resolution | 11 | 11 ✅ |

## Design Decisions

1. **Flat .md files** (not dir-per-command like skills) — simpler, one file = one command
2. **User commands override built-in** — user can shadow /help with custom version
3. **Model field persisted in frontmatter** — conditional on presence (avoids YAML undefined error)
4. **`!`cmd`` stays as literal text** — zero shell execution, per user requirement
5. **External dirs read from server.json** → `commands.externalDirs` array
6. **Built-in commands have no file on disk** — hardcoded in `builtin.ts`, returned by loader as `builtIn: true`
