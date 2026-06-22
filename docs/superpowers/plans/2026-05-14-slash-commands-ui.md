<!-- status: DONE — merged via PR #15 (feat(slash-commands): /command autocomplete + settings page + custom commands) -->
# Plan: Slash Commands in BrowserOS Chat UI

**Date:** 2026-05-14
**Status:** Verified (9 fixes applied from @V)
**Verifier:** `docs/superpowers/plans/2026-05-14-slash-commands-verify.md`
**Branch:** dev
**Scope:** Add `/` command trigger + autocomplete to sidepanel ChatInput + config page for custom commands

## User Context (verbatim)

> 1: ok;
> 2: /compact as well (REMEMBER to follow the exact current configured compaction)
> 3. Defer this
> 4. Defer
> 5. add the page in the configuration that to be able to config command as well;
> FOLLOW the Opencode approach `https://opencode.ai/docs/commands/` (but only that it is configured only in markdown)
> ALSO similarity to the SKILL plan, that we can add the directory to LOAD the others cmd;
> WHITELIST opencode fields, use the same description, if it is having the `Shell output` (do not run it, just output it as-is)
> IF model is NOT available, then just use the CURRENT model;

## Project State Check

| Check | Result |
|-------|--------|
| Branch | `dev` |
| DRY: cmdk library | ✅ `components/ui/command.tsx` exists, used by model-selector |
| DRY: @ mention pattern | ✅ `ChatInput.tsx` has MentionState + TabPickerPopover |
| DRY: Skills system | ✅ Server-side `skills/` service with CRUD API, markdown frontmatter |
| DRY: Settings page pattern | ✅ `SettingsSidebarLayout` → `SettingsSidebar` → route → page |
| DRY: Compaction | ✅ Server `compaction-config.ts` + `compaction-settings/` page |
| YAGNI | ✅ Only: /clear, /compact, /mode, /model, /help, /reset + custom commands |

## Existing Plans

- `2026-05-12-compaction-settings-ui-design.md` — compaction settings page (relevant: /compact command must invoke this)
- `2026-05-10-advanced-config.md` — advanced config page pattern (reference for new settings page)

## Chunk Count

7 leaf items → within limit (9)

---

## Declarative Final State

### 1. ChatInput Slash Command Autocomplete

**File:** `apps/agent/entrypoints/sidepanel/index/ChatInput.tsx`

WHEN user types `/` at word boundary in the textarea:
- A `CommandList` popover appears anchored below cursor position
- Shows all available commands grouped as: "Built-in" and "Custom"
- Each item shows: command name + description only (no empty shortcut column)
- Typing after `/` filters the list by plain `includes()` match on name + description (no fuzzy library needed for ~10 items)
- Arrow Up/Down navigates, Enter/Tab selects, Escape dismisses
- Selecting a command replaces `/query` in the input with the command invocation
- For commands with `$ARGUMENTS`, the command is inserted + space for args

**Behavior:**
- `/` at position 0 or after whitespace triggers the menu
- Does NOT trigger inside words (e.g., `https://`)
- If only one match remains and user presses Tab, auto-complete it
- Menu dismisses on: Escape, click outside, Backspace removing `/`

### 2. Built-in Commands

**File:** `apps/server/src/commands/builtin.ts` (new)

These commands are always available, hardcoded:

| Command | Description | Action |
|---------|-------------|--------|
| `/clear` | Clear conversation history | Calls `sendMessage` with a clear-action marker |
| `/compact` | Trigger compaction using current config | Calls compaction API with currently configured method (reads from compaction settings) |
| `/mode` | Switch chat mode | Shows sub-menu: `chat` / `agent` (maps to ChatModeToggle) |
| `/model` | Switch model | Shows sub-menu from available models list |
| `/help` | Show available commands | Nice-to-have. Autocomplete already shows all commands. Only implement if trivial |
| `/reset` | Reset conversation + context | New conversation with same settings |

**`/compact` specifics:**
- Reads current compaction config from server (`GET /compaction`)
- Uses the configured `method` (default or vcc) and any `vccConfig` overrides
- Fires compaction and shows a simple completion message in chat
- No streaming status (compaction is sub-second; streaming deferred per user requirement)

**Dependency:** Requires compaction-settings API (`GET /compaction`) to be implemented first. See `2026-05-12-compaction-settings-ui-design.md`.

### 3. Custom Command Configuration Page

**Route:** `/settings/commands`
**File:** `apps/agent/entrypoints/app/command-settings/CommandSettingsPage.tsx` (new)

Follows exact same pattern as `SkillsPage.tsx`:
- Grid of command cards with enable/disable toggle
- Create/Edit dialog with markdown editor
- "Built-in" vs "My Commands" sections
- Delete with confirmation

**Markdown frontmatter (OpenCode-whitelisted fields only):**

```markdown
---
description: Run tests with coverage
model: anthropic/claude-3-5-sonnet-20241022
---

Run the full test suite with coverage report and show any failures.
Focus on the failing tests and suggest fixes.
```

**Whitelisted frontmatter fields (from OpenCode spec, v1):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | string | Yes | Shown in autocomplete menu |
| `model` | string | No | Override model. If NOT available → use current model |

**Deferred fields** (accepted in frontmatter but not processed at runtime in v1):
- `agent` — target agent routing
- `subtask` — force subagent invocation

**Template placeholders (from OpenCode spec):**

| Placeholder | Description |
|-------------|-------------|
| `$ARGUMENTS` | All arguments as single string |
| `$1`, `$2`, ... | Positional arguments |
| `` !`command` `` | **Static template marker only.** The LLM sees the backtick syntax as literal text. No shell execution occurs at command resolution time. |
| `@filepath` | File reference — rendered as-is (static text) |

### 4. Custom Command Loading (Server)

**File:** `apps/server/src/commands/` (new directory)

Mirrors the skills loading pattern exactly:

```
apps/server/src/commands/
├── builtin.ts          ← built-in command definitions
├── service.ts          ← CRUD (mirrors skills/service.ts)
├── loader.ts           ← loadAllCommands from disk + external dirs (mirrors skills/loader.ts)
└── types.ts            ← CommandMeta, CommandDetail, CreateCommandInput
```

**External directory loading (like skills pattern):**
- User can configure additional command directories via `commands.externalDirs` array in `config.json`
- Each directory scanned for `*.md` files → command name = filename without extension
- Commands loaded from: built-in → user dir (`~/.browseros/commands/`) → project dir (`.browseros/commands/`) → external dirs
- Later sources override earlier ones (user can override built-in)

**API routes:** `apps/server/src/api/routes/commands.ts` (new)

```
GET    /commands           → list all commands (built-in + custom)
GET    /commands/:id       → get command detail
POST   /commands           → create custom command
PUT    /commands/:id       → update custom command
DELETE /commands/:id       → delete custom command
```

**Command resolution on chat submit:**
1. Parse input: if starts with `/word`, extract command name + args
2. Look up command (built-in first, then custom)
3. If found: replace input with resolved template
4. If `model` specified AND available: override model for this message
5. If `model` NOT available: use current model (per user requirement)
6. Send resolved message to LLM

### 5. Settings Sidebar Entry

**File:** `apps/agent/components/sidebar/SettingsSidebar.tsx`

Add to "Other" section:

```tsx
{ name: 'Commands', to: '/settings/commands', icon: Terminal }
```

### 6. App Route Registration

**File:** `apps/agent/entrypoints/app/App.tsx`

Add route inside `<Route path="settings">`:

```tsx
<Route path="commands" element={<CommandSettingsPage />} />
```

### 7. ChatInput Integration

**File:** `apps/agent/entrypoints/sidepanel/index/ChatInput.tsx`

Add slash command state machine alongside existing `@mention` state:

```tsx
interface SlashCommandState {
  isOpen: boolean
  filterText: string
  startPosition: number
}
```

- `/` keystroke detection mirrors `@` detection
- Reuses `cmdk` `Command` component for the dropdown (already in `components/ui/command.tsx`)
- Positioned via Popover anchored to textarea cursor
- Fetches commands from `GET /commands` (cached via react-query)

**Coexistence with @ mention:**
- Both state machines are independent
- Only one can be active at a time
- `/` triggers slash menu, `@` triggers tab mention
- If slash menu is open and user types `@`, slash menu closes first

---

## File Change Summary

### New Files (server)

| File | Purpose |
|------|---------|
| `apps/server/src/commands/types.ts` | CommandMeta, CommandDetail types |
| `apps/server/src/commands/builtin.ts` | Built-in command definitions |
| `apps/server/src/commands/loader.ts` | Load commands from disk (gray-matter) |
| `apps/server/src/commands/service.ts` | CRUD operations |
| `apps/server/src/commands/external-dirs.ts` | Scan external directories |
| `apps/server/src/api/routes/commands.ts` | REST API routes |

### New Files (agent UI)

| File | Purpose |
|------|---------|
| `apps/agent/entrypoints/app/command-settings/CommandSettingsPage.tsx` | Settings page |
| `apps/agent/entrypoints/app/command-settings/command-queries.ts` | React-query hooks |
| `apps/agent/entrypoints/app/command-settings/CommandDialog.tsx` | Create/Edit dialog |
| `apps/agent/entrypoints/sidepanel/index/SlashCommandMenu.tsx` | Autocomplete popover |

### Modified Files

| File | Change |
|------|--------|
| `apps/agent/entrypoints/sidepanel/index/ChatInput.tsx` | Add SlashCommandState + menu integration |
| `apps/agent/entrypoints/sidepanel/index/Chat.tsx` | Parse `/command` on submit, resolve template |
| `apps/agent/entrypoints/app/App.tsx` | Add `/settings/commands` route |
| `apps/agent/components/sidebar/SettingsSidebar.tsx` | Add Commands nav item |
| `apps/server/src/index.ts` (or main entry) | Register commands routes |

---

## Conflict / Over-Engineering Check

⚠️ **CONFLICT CHECK:** None detected. Slash commands are orthogonal to skills system.
- Skills = agent behavior triggers (matched by AI)
- Commands = user-explicit `/` invocations (matched by text parsing)

⚠️ **OVER-ENGINEERING CHECK:** Minimal. 6 built-in commands + markdown-based custom commands mirroring existing skills pattern. No streaming, no arg completion (deferred), no extension API (deferred).

---

## TDD

| File | Scope | Cases |
|------|-------|-------|
| `docs/superpowers/plans/2026-05-14-slash-commands-tdd-server.md` | Server-side | 30 cases (6 suites) |
| `docs/superpowers/plans/2026-05-14-slash-commands-tdd-client.md` | Client-side | 27 cases (6 suites) |
| `docs/superpowers/plans/2026-05-14-slash-commands-verify.md` | @V verification report | 9 fixes applied |

---

## Dependency Graph

```
[3. Server command loading] ──→ [4. API routes] ──→ [5. Settings page]
                    │                                      │
                    └──→ [2. Built-in commands]             │
                                                          │
[1. ChatInput autocomplete] ←── [6. Sidebar entry] ←─────┘
                    │
                    └──→ [7. ChatInput integration]
                              ↑
                    [Chat.tsx command parsing]
```

Implementation order: 3 → 4 → 2 → 5 → 6 → 1 → 7
