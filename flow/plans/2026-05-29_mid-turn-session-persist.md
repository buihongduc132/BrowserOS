# Plan: Mid-Turn Session Persist

Date: 2026-05-29
Status: DRAFT
Origin intention: `flow/intentions/2026-05-29_mid-turn-session-persist.md`
Investigation: `investigation-mid-session-loss.md`

---

## Problem Summary

BrowserOS loses all running process and conversation state when a session is stopped mid-session. Root cause: all live conversation state lives in **in-memory data structures** with **no periodic persistence**, combined with a **graceless shutdown** that calls `process.exit()` without flushing state.

9 findings documented, 6 critical gaps.

---

## Architecture Overview

```
CLIENT (Sidepanel)
  useChat() → messages[] (React state)
  ├── onSave (on status='ready' only)
  │   ├── conversationStorage (chrome.storage.local)
  │   └── useRemoteConversationSave (GraphQL → Hasura)
  └── No beforeunload / visibilitychange handler

SERVER (Bun)
  SessionStore (Map<string, AgentSession>) ← IN-MEMORY ONLY
  ├── AgentSession.agent (AiSdkAgent)
  │   └── messages: UIMessage[] ← IN-MEMORY ONLY
  └── No periodic flush to disk

  TurnRegistry (RingBuffer, 5k frames, 5min retain) ← EPHEMERAL
  AssistantSessionStore (SQLite) ← METADATA ONLY (no messages table)

  SIGTERM/SIGINT → stop() → process.exit() ← NO STATE FLUSH
```

---

## Solution Design

### Phase P0 — Prevent Data Loss on Shutdown

#### 1. Add messages table to SQLite
- New table in `apps/server/src/lib/db/schema/`
- Columns: conversationId, role, parts (JSON), createdAt, metadata
- WAL mode for non-blocking writes
- On startup, rehydrate sessions from DB

#### 2. Periodic message flush during execution
- In `chat-service.ts`, add checkpoint every N tokens or every tool call result
- Flush TurnRegistry ring buffer to SQLite periodically
- Use debounced writes (batch every 5s, not per-message)

#### 3. Pre-exit state flush in `stop()`
- In `main.ts`, before `process.exit()`:
  1. Iterate all sessions in SessionStore
  2. Write messages + metadata to SQLite
  3. Record which turns were in-flight (for potential resume)
  4. Then call `process.exit()`
- Should take <100ms for typical session counts

#### 4. SIGTERM/SIGINT → graceful flush
- In `index.ts`, add pre-exit hook
- Consider `process.on('beforeExit')` as last-resort safety net

### Phase P1 — Save Partial Work

#### 5. Save partial messages on abort (client + server)
- Server: save current messages snapshot on abort signal
- Client: save current `messages` on abort before filtering
- Don't filter out partial assistant messages — mark as interrupted

#### 6. Wire getConversationMessages in compaction route
- `apps/server/src/api/server.ts` — wire SessionStore to compaction route
- `apps/server/src/api/routes/compaction.ts` — replace `return null` with actual lookup

#### 7. Implement compact endpoint
- `apps/server/src/api/routes/assistant-sessions.ts:122-134` — implement the stub

### Phase P2 — Client-Side Resilience

#### 8. Add beforeunload handler in sidepanel
- `apps/agent/entrypoints/sidepanel/index/useChatSession.ts`
- Synchronously write current messages to `chrome.storage.local`
- Also handle `visibilitychange` for mobile/tablet scenarios

#### 9. Persist compaction state across restarts
- Store summary text + count alongside messages in DB
- Load when rebuilding a session

---

## Key Files

| File | Role |
|------|------|
| `apps/server/src/agent/session-store.ts` | SessionStore — in-memory sessions map |
| `apps/server/src/api/services/chat-service.ts` | Chat service — onFinish only saves |
| `apps/server/src/main.ts` | Server stop() — immediate exit |
| `apps/server/src/index.ts` | SIGTERM/SIGINT handlers |
| `apps/server/src/lib/db/schema/` | SQLite schema — needs messages table |
| `apps/server/src/lib/agents/active-turn-registry.ts` | Turn registry — ring buffer |
| `apps/server/src/api/routes/compaction.ts` | Compaction route — getConversationMessages stub |
| `apps/server/src/api/routes/assistant-sessions.ts` | Sessions route — compact endpoint stub |
| `apps/agent/entrypoints/sidepanel/index/useChatSession.ts` | Client chat hook — save on ready only |

---

## Implementation Order

```
P0.1 (messages table)       ──┐
P0.2 (periodic flush)        ──┤
P0.3 (pre-exit flush)        ──┤── P0 parallel, no deps
P0.4 (SIGTERM graceful)      ──┘
                               │
                               ▼
P1.5 (save on abort)          ──┤── depends on P0.1
P1.6 (wire compaction)        ──┤── depends on P0.1
P1.7 (implement compact)      ──┘── depends on P0.1 + P1.6
                               │
                               ▼
P2.8 (beforeunload handler)   ──┤── standalone
P2.9 (persist compaction)     ──┘── depends on P0.1
```

---

## Edge Cases

- **Server crash (SIGKILL)** — cannot catch, periodic flush is the only defense
- **Chromium auto-update restart** — SIGTERM gives ~5s window, must flush within
- **Multiple concurrent sessions** — flush must iterate all sessions atomically
- **WAL mode contention** — SQLite WAL handles concurrent reads; writes are serialized
- **Partial message parts** — interrupted responses may have empty parts; must preserve
- **Client-side storage limits** — `chrome.storage.local` has 10MB limit per extension
- **Session rehydration race** — on startup, must not start serving until DB load completes
