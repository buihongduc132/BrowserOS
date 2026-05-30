# Plan: Tab Ownership & Browser Self-Close Fix

Date: 2026-05-30
Status: DRAFT
Origin intention: `flow/intentions/2026-05-30_tab-ownership-and-browser-self-close.md`

---

## Problem Summary

3 interconnected problems discovered during investigation:

1. **Browser self-closes** — LLM can close the last tab / its own host tab, causing the browser to exit
2. **No tab ownership** — multiple LLM sessions can operate on the same tabs simultaneously with zero coordination
3. **No visual indicator** — users and other LLM sessions cannot see which tabs are under active control

---

## 7 Attack Vectors Found

| # | Vector | Guarded? | Severity | Source |
|---|--------|----------|----------|--------|
| V1 | `close_page` — no last-visible-tab guard | ❌ sidepanel/MCP | Critical | Original analysis |
| V2 | `close_window` — zero guards | ❌ everywhere | Critical | Original analysis |
| V3 | `close_tab_group` — zero guards, bypasses `close_page` | ❌ everywhere | Critical | Claude delegation |
| V4 | MCP callers — `ctx.session` undefined, all guards bypassed | ❌ MCP | Critical | Claude delegation |
| V5 | `navigate_page` — sidepanel active-tab destruction | ❌ sidepanel | High | Original analysis |
| V6 | `evaluate_script` → `window.close()` bypasses tool guards | ❌ everywhere | Medium | Claude delegation |
| V7 | `navigate_page` over-blocks back/forward/reload in newtab | ⚠️ false positive | Low | Claude delegation |

---

## Architecture Context

### What exists
- `ToolContext.session` has `origin` (`'sidepanel' | 'newtab'`) and `originPageId`
- `close_page` / `navigate_page` guard ONLY for `origin === 'newtab'`
- `glow.content` content script already injects pulsing orange border on controlled tabs
- `useNotifyActiveTab.tsx` already tracks which tab the LLM is operating on
- Tool output metadata includes `tabId` — already wired through MCP
- MCP route receives `X-BrowserOS-Agent-Id` and `X-BrowserOS-Default-Window-Id` headers

### What's missing
- `TabOwnershipRegistry` — no concept of "tab X is locked by conversation Y"
- Last-visible-tab guard in `close_page`
- Any guard in `close_window`, `close_tab_group`
- Session context passed to MCP tool handlers (`ctx.session` is undefined)
- Persistent visual indicator showing ownership/lock status
- Idle-based auto-release for tab locks

### Key files
| File | Role |
|------|------|
| `apps/server/src/tools/navigation.ts` | `close_page`, `navigate_page`, `new_page`, `list_pages` |
| `apps/server/src/tools/windows.ts` | `close_window`, `create_window`, `list_windows` |
| `apps/server/src/tools/tab-groups.ts` | `close_tab_group`, `group_tabs`, `ungroup_tabs` |
| `apps/server/src/tools/framework.ts` | `ToolContext`, `defineTool`, `executeTool` |
| `apps/server/src/browser/browser.ts` | `Browser` class — CDP abstraction, page tracking |
| `apps/server/src/api/routes/mcp.ts` | MCP route — creates per-request server |
| `apps/server/src/api/services/mcp/register-mcp.ts` | Tool registration for MCP |
| `apps/agent/entrypoints/glow.content/` | Visual overlay content script |
| `apps/agent/entrypoints/sidepanel/index/useNotifyActiveTab.tsx` | Glow message dispatch |

---

## Solution Design

### Phase 1: P0 — Prevent Browser Self-Close (Critical)

#### 1.1 Last-visible-tab guard in `close_page`
- Before closing, check: is this the last visible tab in the last visible window?
- If yes → reject with error: "Cannot close the last visible tab — this would close the browser"
- Applies to ALL modes (sidepanel, newtab, MCP)
- File: `navigation.ts`

#### 1.2 Last-visible-window guard in `close_window`
- Before closing, check: is this the last visible window?
- If yes → reject with error: "Cannot close the last visible window"
- File: `windows.ts`

#### 1.3 Origin-tab guard for sidepanel mode
- Extend existing newtab guard to also protect sidepanel active tab from `close_page` and `navigate_page`
- In sidepanel mode, the active tab from `browserContext` is the origin tab
- File: `navigation.ts`

#### 1.4 `close_tab_group` guard
- Before closing a tab group, check if it contains the last visible tab(s)
- If closing the group would leave no visible tabs → reject
- File: `tab-groups.ts`

#### 1.5 Fix MCP session context
- Pass `ToolSessionContext` through MCP route so guards work for MCP callers
- MCP route already has `X-BrowserOS-Agent-Id` — extend to include origin info
- Files: `mcp.ts`, `register-mcp.ts`, `framework.ts`

### Phase 2: P1 — Tab Ownership Registry

#### 2.1 `TabOwnershipRegistry` in `Browser` class
```
Map<pageId, {
  ownerConversationId: string,
  ownerAgentId?: string,
  lockedAt: number,
  lastActivityAt: number
}>
```
- `claim(conversationId, pageId, agentId?)` — claim ownership
- `release(conversationId, pageId)` — release ownership
- `isLocked(pageId)` — check if locked by another conversation
- `getOwner(pageId)` — get owner info
- `releaseIdle(maxIdleMs)` — auto-release stale locks
- `refreshActivity(pageId)` — touch lastActivityAt

#### 2.2 Enforce ownership in tool handlers
- `close_page`, `navigate_page`, `click`, `fill`, `type`, `evaluate` — check ownership before executing
- If tab is owned by another conversation → reject with error showing owner info
- Opt-in: configurable per-conversation

#### 2.3 Enrich `list_pages` response
- Add `controlledBy: { conversationId, agentId } | null` to each page in response
- LLM sessions can see which tabs are taken

#### 2.4 MCP tab ownership tools
- `lock_tab(page)` / `unlock_tab(page)` — explicit locking for MCP callers
- `list_pages` includes ownership info

### Phase 3: P2 — Visual Indicator

#### 3.1 Extend `glow.content` content script
- Enrich `GlowMessage` type: add `{ agentName, lockHeld, controlledBy }`
- Add persistent indicator (small badge/chip) showing:
  - Agent name controlling the tab
  - Lock status
  - Conversation ID (truncated)
- Keep existing pulsing border behavior
- File: `entrypoints/glow.content/`

#### 3.2 Wire ownership to glow
- `TabOwnershipRegistry` changes emit events
- Sidepanel `useNotifyActiveTab` listens and enriches `GlowMessage`
- MCP callers also trigger glow via server → extension messaging

### Phase 4: Configuration

#### 4.1 Idle lock release
- Config key: `tab_lock_idle_timeout_ms` (default: 3600000 = 1 hour)
- Periodic sweep (60s interval) releases locks idle beyond threshold
- On tool call, refresh `lastActivityAt`

#### 4.2 Toggle for strict mode
- Config key: `tab_ownership_strict` (default: false)
- When true: reject tool calls on locked tabs
- When false: warn but allow (non-blocking)

---

## Implementation Order

```
P0.1 (last-tab guard)     ──┐
P0.2 (last-window guard)  ──┤── no dependencies between these
P0.3 (sidepanel guard)    ──┤
P0.4 (tab-group guard)    ──┤
P0.5 (MCP session fix)    ──┘
                              │
                              ▼
P1.1 (TabOwnershipRegistry) ──┤
P1.2 (enforce ownership)    ◄─┘ depends on P1.1
P1.3 (enrich list_pages)   ◄─┘ depends on P1.1
P1.4 (MCP ownership tools) ◄─┘ depends on P1.1
                              │
                              ▼
P2.1 (extend glow.content) ◄── depends on P1.1
P2.2 (wire ownership)      ◄── depends on P1.1 + P2.1
                              │
                              ▼
P4.1 (idle lock release)   ◄── depends on P1.1
P4.2 (strict mode config)  ◄── depends on P1.1 + P1.2
```

## Edge Cases

- Hidden tabs/windows — should not count as "visible" for last-tab checks
- Scheduled tasks — operate on hidden pages, should not trigger last-tab guard
- Concurrent conversations — TOCTOU race on last-tab check (low risk, serialized per session)
- `evaluate_script` → `window.close()` — tool-level guard cannot prevent this; consider injecting `Object.defineProperty(window, 'close', ...)` override
- `about:blank` / `data:` navigation — destroys content without closing tab
- DevTools/popup windows — counted as visible but not usable; last-normal-window check should filter
- `EXCLUDED_URL_PREFIXES` — `chrome-extension://` tabs are filtered from `listPages()`; origin-tab guard must not rely solely on `listPages`
- Multiple MCP clients — each creates per-request server with no shared session; ownership registry must be shared at `Browser` class level
