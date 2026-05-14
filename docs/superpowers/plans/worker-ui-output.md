# @ui-worker Output

**Date:** 2026-05-14
**Task:** Client-side settings page for slash commands (Plan items 5, 6)

## Files Created

| File | Lines | Description |
|------|-------|-------------|
| `apps/agent/entrypoints/app/command-settings/command-queries.ts` | 116 | React-query hooks for GET/POST/PUT/DELETE /commands API. Mirrors useSkills.ts exactly. |
| `apps/agent/entrypoints/app/command-settings/CommandDialog.tsx` | 178 | Create/Edit/View dialog with name, description, markdown content editor. Built-in commands are read-only. Cmd+Enter submits. |
| `apps/agent/entrypoints/app/command-settings/CommandSettingsPage.tsx` | 290 | Settings page mirroring SkillsPage.tsx. Grid layout, Built-in vs My Commands sections, toggle, delete confirmation. Cards show `/{name}` + description. |
| `apps/agent/entrypoints/app/command-settings/__tests__/command-settings.test.ts` | 259 | TDD suites 4 (7 cases) + 5 (5 cases) + API contract (4 cases) = 16 tests |

## Files Modified

| File | Change |
|------|--------|
| `apps/agent/entrypoints/app/App.tsx` | Added import + route `<Route path="commands" element={<CommandSettingsPage />} />` after compaction route |
| `apps/agent/components/sidebar/SettingsSidebar.tsx` | Added `Terminal` icon import + `{ name: 'Commands', to: '/settings/commands', icon: Terminal }` nav item |

## Validation

- ✅ **16/16 tests pass** (bun test)
- ✅ **0 type errors** (tsc --noEmit on new files)
- ✅ Pattern alignment with SkillsPage.tsx verified
- ✅ Route registered at `/settings/commands`
- ✅ Sidebar entry in "Other" section

## TDD Coverage

| Suite | Cases | Status |
|-------|-------|--------|
| TC-C4 (CRUD) | 7/7 | ✅ All pass |
| TC-C5 (Dialog) | 5/5 | ✅ All pass |
| API contract | 4/4 | ✅ All pass |

## Notes for Integrator

- The `command-queries.ts` expects `GET /commands` to return `{ commands: CommandMeta[] }` — must match server route format
- The dialog shows a "Placeholders" tip box listing `$ARGUMENTS`, `$1, $2`, `` !`cmd` ``
- Cards display `/{name}` (with slash prefix) instead of just the name, to match how commands are invoked in chat
- The `CommandDialog` is exported as a separate component so the chat-worker can potentially reuse it
