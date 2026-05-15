<!-- status: DONE — worker output from team run for slash commands -->
# @chat-worker Output

**Date:** 2026-05-14
**Status:** Complete
**Worktree:** `/home/bhd/Documents/Projects/bhd/wt-BrowserOS-slash-cmds/`

## Files Created

| File | Purpose |
|------|---------|
| `entrypoints/sidepanel/index/SlashCommandMenu.tsx` | Autocomplete popover using cmdk Command. Groups (Built-in/Custom), includes() filter, keyboard nav |
| `entrypoints/sidepanel/index/command-queries.ts` | React-query hooks for `GET /commands` (created by other worker, used by ChatInput + Chat) |
| `entrypoints/sidepanel/index/slash-command-resolver.ts` | Pure functions: parseSlashCommand(), resolveTemplate(), isModelAvailable() (created by other worker) |
| `entrypoints/sidepanel/index/slash-command-resolver.test.ts` | 24 tests — TDD suites 3 (command parsing) |
| `entrypoints/sidepanel/index/SlashCommandMenu.test.ts` | 9 tests — TDD suite 2 (filter logic) |
| `entrypoints/sidepanel/index/chat-input-slash-state.test.ts` | 15 tests — TDD suites 1 + 6 (state machine + coexistence) |
| `entrypoints/sidepanel/index/ChatInput.slash.test.ts` | 15 tests — TDD suites 1 + 6 (alternative test file, created by other worker) |

## Files Modified

| File | Change |
|------|--------|
| `entrypoints/sidepanel/index/ChatInput.tsx` | Added SlashCommandState machine + SlashCommandMenu integration + mutual exclusion with @ mention |
| `entrypoints/sidepanel/index/Chat.tsx` | Added command resolution in executeMessage: /clear, /compact, /reset, /help built-ins + custom template resolution |
| `entrypoints/sidepanel/index/ChatFooter.tsx` | Cleaned up: removed dead slashCommands prop (ChatInput uses useCommands hook internally) |

## Files Removed

| File | Reason |
|------|--------|
| `entrypoints/sidepanel/index/commandResolution.ts` | Duplicate of slash-command-resolver.ts |
| `entrypoints/sidepanel/index/useSlashCommands.ts` | Duplicate of command-queries.ts |

## Test Results

```
63 pass, 0 fail, 114 expect() calls
Ran across 4 test files in 42ms
```

## TDD Coverage

| Suite | Tests | Status |
|-------|-------|--------|
| Suite 1: Slash Command State Machine | TC-C1.1 through TC-C1.10 | ✅ All pass |
| Suite 2: SlashCommandMenu Rendering | TC-C2.1 through TC-C2.4 | ✅ All pass |
| Suite 3: Chat.tsx Command Parsing | TC-C3.1 through TC-C3.8 | ✅ All pass |
| Suite 6: Slash Menu + @ Mention Coexistence | TC-C6.1 through TC-C6.5 | ✅ All pass |

## Key Design Decisions

1. **ChatInput fetches commands via `useCommands()` hook** — no prop threading through ChatFooter
2. **Chat.tsx also calls `useCommands()`** for command resolution in executeMessage
3. **Mutual exclusion**: Both `@` and `/` detection check the other's state before triggering
4. **`/compact`** calls `GET /compaction` to read current config, then sends a completion message (NO streaming)
5. **`/clear` and `/reset`** call `resetConversation()` directly
6. **Unknown commands** pass through as-is text (no error)
7. **`!\`cmd\``** is static literal text — NO shell execution (verified in resolver tests)
8. **Model fallback** — if specified model not in available models, silently uses current model

## Notes

- Another worker (`@server-worker` presumably) had already created `command-queries.ts`, `slash-command-resolver.ts`, and partial Chat.tsx/ChatInput modifications
- I consolidated the data flow, removed duplicates, and wrote the missing test suites
- The `Chat.tsx` `/compact` implementation currently sends a message to trigger compaction — the actual server-side compaction trigger would need the compaction API to support a POST trigger endpoint
