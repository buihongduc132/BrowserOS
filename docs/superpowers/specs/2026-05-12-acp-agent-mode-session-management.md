# ACP Agent Mode — Session Management Spec

Date: 2026-05-12
Status: DRAFT v2 (post-verifier fixes)
Mode: **Agent Mode** (agent-command, harness, external agents)
Scope: Multi-session lifecycle for ACP-connected agents

---

## 1. Current State — Agent Mode

### What Exists

| Feature | File | Status |
|---------|------|--------|
| Agent CRUD (create/delete/config) | `agents.ts`, `AgentsPage.tsx` | ✅ |
| Agent conversation (harness) | `AgentCommandConversation.tsx` | ✅ |
| Harness chat history (hardcoded `'main'`) | `agent-harness-service.ts` L765-777 | ✅ |
| Queue (pending messages) | `QueuePanel.tsx` | ✅ |
| Outputs rail | `agent-conversation.outputs-rail.tsx` | ✅ |
| Cancel turn | `cancelHarnessTurn()` | ✅ |
| Active turn registry (per agent) | `active-turn-registry.ts` | ✅ |
| Agent definitions DB (Drizzle) | `lib/db/schema/agents.ts` | ✅ |

### Critical Existing Constraint: `sessionId: 'main'`

The entire harness stack hardcodes `sessionId: 'main'`:

```
agents.ts L328,409,417,655        → X-Session-Id: 'main'
agent-harness-service.ts L299,365,368,454,504,765,777,889,894,954,1023
                                  → sessionId: 'main' everywhere
active-turn-registry.ts           → registry keyed by (agentId, sessionId='main')
acpx-runtime.ts                   → getHistory/getRowSnapshot take sessionId
```

**The primary task is generalizing from single `'main'` to multi-session** — not building from zero.

### What's Missing

| Feature | Zed Equivalent | Priority |
|---------|----------------|----------|
| Multi-session per agent (beyond `'main'`) | `AgentConnection.new_session()` | P0 |
| Session list per agent | `AgentSessionList.list_sessions()` | P0 |
| Session search | cursor-based search | P0 |
| Resume session (no replay) | `AgentConnection.resume_session()` | P0 |
| Load session (history replay) | `AgentConnection.load_session()` | P0 |
| Close session (ref-counted) | `AgentConnection.close_session()` | P0 |
| Session modes | `AgentSessionModes` | P1 |
| Per-session model selector | `AgentModelSelector` | P1 |
| Per-session config options | `AgentSessionConfigOptions` | P1 |
| Conversation truncation | `AgentSessionTruncate` (trait object) | P2 |
| Retry last turn | `AgentSessionRetry` (trait object) | P2 |
| Set session title | `AgentSessionSetTitle` (trait object) | P2 |
| Manual compaction trigger | (User requested) | P2 |
| Protocol debug log | `AcpDebugLog` | P3 |

---

## 2. Zed ACP Reference

### Capabilities Structure (from `acp.rs`)

Zed uses **nested capability objects**, not a flat struct:

```typescript
// Mirrors Zed's AgentCapabilities → SessionCapabilities nesting
interface AgentCapabilities {
  load_session: boolean
  prompt_capabilities: PromptCapabilities
  session_capabilities: SessionCapabilities
}

interface SessionCapabilities {
  list?: SessionListCapabilities      // { cursor: bool }
  close?: SessionCloseCapabilities    // { ... }
  resume?: SessionResumeCapabilities  // { ... }
}
```

### Trait Object Pattern (from `connection.rs`)

`retry`, `truncate`, `setTitle` are **separate trait objects**, not direct methods:

```typescript
// Zed pattern: connection returns trait objects for lifecycle ops
interface AgentConnection {
  // Core session lifecycle
  new_session(project, workDirs): Task<Session>
  load_session(id, ...): Task<Session>
  resume_session(id, ...): Task<Session>
  close_session(id): Task<void>

  // Capability queries
  supports_load_session(): boolean
  supports_resume_session(): boolean
  supports_close_session(): boolean
  session_list(): AgentSessionList | null

  // Trait object accessors (return null if unsupported)
  retry(sessionId): AgentSessionRetry | null
  truncate(sessionId): AgentSessionTruncate | null
  set_title(sessionId): AgentSessionSetTitle | null
  model_selector(sessionId): AgentModelSelector | null
  session_modes(sessionId): AgentSessionModes | null
  session_config_options(sessionId): AgentSessionConfigOptions | null
}
```

---

## 3. Implementation — Generalizing `sessionId: 'main'`

### 3.1 Scope of Change

Files that hardcode `'main'` and need parameterization:

| File | Lines | Change |
|------|-------|--------|
| `api/routes/agents.ts` | L328,409,417,655 | Accept `sessionId` param from route/header |
| `api/services/agents/agent-harness-service.ts` | L299,365,368,454,504,765,777,889,894,954,1023 | `sessionId` parameter on all methods |
| `lib/agents/active-turn-registry.ts` | — | Already keyed by `(agentId, sessionId)` — just needs callers to pass real IDs |
| `lib/agents/acpx-runtime.ts` | — | `getHistory()`/`getRowSnapshot()` already accept `sessionId` param |

### 3.2 Route Changes

```typescript
// Current: all sessions use 'main'
// Target: sessionId from URL param or header

// NEW routes (extend existing createAgentRoutes):
router.get('/:agentId/sessions', listSessions)              // list
router.post('/:agentId/sessions', createSession)            // new
router.get('/:agentId/sessions/:sessionId', getSession)     // get
router.post('/:agentId/sessions/:sessionId/load', load)     // load+replay
router.post('/:agentId/sessions/:sessionId/resume', resume) // resume
router.delete('/:agentId/sessions/:sessionId', close)       // close

// Existing routes gain sessionId param:
// POST /:agentId/chat → now reads X-Session-Id header (defaults to 'main' for compat)
```

### 3.3 File Locations (aligned with existing convention)

```
server/src/
├── api/
│   ├── routes/
│   │   └── agents.ts                    # EXTEND: add session routes
│   └── services/agents/
│       ├── agent-harness-service.ts      # MODIFY: parameterize sessionId
│       └── agent-session-service.ts      # NEW: session CRUD logic
├── lib/
│   ├── agents/
│   │   ├── active-turn-registry.ts       # MODIFY: callers pass sessionId
│   │   ├── agent-session-types.ts        # NEW: session types + capabilities
│   │   └── agent-session-store.ts        # NEW: ref-counted store (matches existing session-store.ts in agent/)
│   └── db/
│       ├── schema/
│       │   ├── agent-sessions.ts         # NEW: Drizzle schema
│       │   └── index.ts                  # MODIFY: export new schema
│       └── migrations/
│           └── 0003_agent_sessions.sql   # NEW: migration
```

### 3.4 Drizzle Schema

```typescript
// server/src/lib/db/schema/agent-sessions.ts
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

export const agentSessions = sqliteTable(
  'agent_sessions',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id').notNull(),
    title: text('title'),
    cwd: text('cwd'),
    mode: text('mode', { enum: ['code', 'ask', 'agent'] }).notNull().default('agent'),
    model: text('model'),
    turnCount: integer('turn_count').notNull().default(0),
    lastMessagePreview: text('last_message_preview'),
    lastMessageAt: integer('last_message_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    meta: text('meta'), // JSON
  },
  (table) => [
    index('agent_sessions_agent_id_idx').on(table.agentId, table.updatedAt),
  ],
)
```

### 3.5 Ref-Counted Session Store (In-Memory)

This complements the existing `SessionStore` — it tracks **active session handles**, not agent state:

```typescript
// server/src/agent/agent-session-store.ts
// Located alongside existing session-store.ts (same module boundary)

interface ActiveSession {
  sessionId: string
  agentId: string
  refCount: number
  createdAt: number
}

class AgentSessionStore {
  private sessions = new Map<string, ActiveSession>()
  private pendingLoads = new Map<string, Promise<ActiveSession>>()

  async openSession(agentId: string, sessionId: string): Promise<ActiveSession>
  async closeSession(sessionId: string): Promise<void>  // ref-counted
  async listSessions(agentId: string, cursor?: string, limit?: number): Promise<SessionListResponse>
}
```

Relationship with existing `SessionStore` (from `src/agent/session-store.ts`):
- `SessionStore` = agent runtime state (AiSdkAgent, browser context, MCP servers)
- `AgentSessionStore` = session metadata + ref-counting + listing
- `AgentSessionStore` wraps `SessionStore` — when ref count hits 0, calls `SessionStore.delete(sessionId)`

### 3.6 Session Capabilities (Mirrors Zed Nesting)

```typescript
interface AgentCapabilities {
  load_session: boolean
  session_capabilities: SessionCapabilities
}

interface SessionCapabilities {
  list?: { cursor: boolean }
  close?: {}
  resume?: {}
}
```

### 3.7 Trait Objects for Lifecycle Ops

```typescript
// Separate from session store — these are operation handles
interface AgentSessionRetry {
  run(sessionId: string): Promise<PromptResponse>
}

interface AgentSessionTruncate {
  run(sessionId: string, messageId: string): Promise<void>
}

interface AgentSessionSetTitle {
  run(sessionId: string, title: string): Promise<void>
}
```

### 3.8 Session Modes (Dynamic Discovery)

Modes are NOT hardcoded. They're discovered from the agent adapter:

```typescript
interface AgentSessionModes {
  currentMode(): SessionModeId
  allModes(): SessionMode[]
  setMode(modeId: SessionModeId): Promise<void>
}

interface SessionMode {
  id: string
  name: string
  description?: string
}
```

Available modes come from the agent's capabilities response. If the adapter doesn't expose modes, the switcher is hidden.

---

## 4. Frontend

### 4.1 Files

```
entrypoints/app/agent-command/
├── AgentSessionList.tsx          # Session list for selected agent
├── AgentSessionList.test.tsx
├── AgentSessionItem.tsx          # Single session row
├── AgentSessionItem.test.tsx
├── AgentSessionSearch.tsx        # Search bar
├── NewAgentSessionButton.tsx     # "New Chat" button
├── useAgentSessionList.ts        # React Query hook
├── useAgentSessionList.test.ts
├── AgentSessionListEmpty.tsx
├── AgentModeSwitch.tsx           # Dynamic mode toggle (P1)
└── useAgentSessionModes.ts       # Mode management (P1)
```

### 4.2 Flow

1. `AgentCommandHome.tsx` renders `AgentSessionList` instead of `RecentThreads`
2. User clicks session → navigate to `/agents/:agentId/chat/:sessionId`
3. `AgentCommandConversation` loads session via `load_session` or `resume_session`
4. "New Chat" → `POST /agents/:agentId/sessions` → navigate to new session
5. Existing `/:agentId/chat` route gains optional `sessionId` param (defaults to `'main'`)

---

## 5. Effort

| Layer | Files | Hours |
|-------|-------|-------|
| Generalize 'main' → multi-session | 4 files modify | 8h |
| Drizzle schema + migration | 2 new, 1 modify | 3h |
| Server: session service + routes | 3 new, 1 modify | 8h |
| Frontend: session list UI | 8 new | 12h |
| Frontend: mode + config | 3 new | 8h |
| Frontend: truncate + retry + debug | 4 new | 7h |
| **Total** | **~26** | **~46h** |

### Priority

```
P0: Generalize 'main' → multi-session + session list/search + new/load/resume/close
P1: Mode switcher (dynamic) + model selector + config
P2: Truncation + retry + title + manual compact
P3: Debug log
```
