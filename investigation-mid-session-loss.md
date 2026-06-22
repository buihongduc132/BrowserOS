# Investigation: Mid-Session State Loss in BrowserOS

**Date:** 2026-05-19  
**Scope:** Why BrowserOS loses running process and conversation state when a session is stopped mid-session.

---

## Executive Summary

BrowserOS has **six critical gaps** that cause state loss on session interruption. The root cause is an architecture that keeps all live conversation state in **in-memory data structures** with **no periodic persistence**, combined with a **graceless shutdown** that calls `process.exit()` without flushing state. When the server process is killed (SIGTERM from Chromium update/restart, user-initiated stop, or crash), all in-flight conversations, agent processes, and partial responses are permanently lost.

---

## Findings

### 1. SessionStore is Purely In-Memory — No Persistence

**Severity: HIGH**  
**File:** `packages/browseros-agent/apps/server/src/agent/session-store.ts:1-60`

The `SessionStore` class uses a plain `Map<string, AgentSession>` with no disk persistence:

```typescript
export class SessionStore {
  private sessions = new Map<string, AgentSession>()
  // ... get/set/remove/delete — all in-memory
}
```

`AgentSession` holds the live `AiSdkAgent` instance and its message array (`session.agent.messages`). When the server process exits, this map is garbage-collected and all data is lost.

**Impact:** Every active conversation — including full message history — vanishes on server restart.

**Recommendation:** Periodically flush session messages to SQLite (which already exists for session metadata). Use WAL mode for non-blocking writes. On startup, rehydrate sessions from the DB.

---

### 2. No Periodic State Persistence During Agent Execution

**Severity: HIGH**  
**File:** `packages/browseros-agent/apps/server/src/api/services/chat-service.ts:361-376`

Messages are only saved to `session.agent.messages` inside the `onFinish` callback:

```typescript
onFinish: async ({ messages }: { messages: UIMessage[] }) => {
  session.agent.messages = filterValidMessages(restored)
  logger.info('Agent execution complete', { ... })
}
```

If the server dies mid-stream (during `createAgentUIStreamResponse`), `onFinish` never fires, and **no partial response is saved anywhere** — not on the server, not on the client.

**Impact:** Partial responses during tool calls, long-running tasks, or LLM streaming are lost. The user sees no trace of what was being processed.

**Recommendation:** Implement a checkpoint mechanism that writes partial messages to disk at regular intervals (e.g., every N tokens or every tool call result). The `TurnRegistry` already buffers events in a `RingBuffer` — flush these to SQLite periodically.

---

### 3. Graceful Shutdown Does Not Save State

**Severity: HIGH**  
**File:** `packages/browseros-agent/apps/server/src/main.ts:197-213`

The `stop()` method does **immediate exit without graceful shutdown**:

```typescript
stop(reason?: string): void {
  logger.info('Shutting down server...', { reason })
  stopSkillSync()
  getOpenClawService().shutdown().catch(() => {})
  getHermesRuntime()?.executeAction({ type: 'stop' }).catch(() => {})
  removeServerConfigSync()

  // Immediate exit without graceful shutdown
  const code = reason === 'SIGTERM' || reason === 'SIGINT'
    ? EXIT_CODES.SIGNAL_KILL
    : EXIT_CODES.SUCCESS
  process.exit(code)
}
```

The comment explicitly states this is intentional for port-release speed. No agent sessions are flushed, no in-progress turns are checkpointed, and the `SessionStore` is not drained to disk.

**Impact:** SIGTERM from Chromium updates, `POST /shutdown`, or Ctrl+C all lose all active sessions.

**Recommendation:** Add a pre-exit hook that:
1. Iterates all sessions in `SessionStore`
2. Writes messages + metadata to SQLite
3. Records which turns were in-flight (for potential resume)
4. Then calls `process.exit()`. This should take <100ms for typical session counts.

---

### 4. SIGTERM/SIGINT Handlers Only Forward to `stop()`

**Severity: HIGH**  
**File:** `packages/browseros-agent/apps/server/src/index.ts:51-52`

```typescript
process.on('SIGINT', () => app.stop('SIGINT'))
process.on('SIGTERM', () => app.stop('SIGTERM'))
```

These handlers call `stop()` which does `process.exit()`. There is no `beforeExit` or `SIGHUP` handler that could save state. The `SIGTERM` handler explicitly exits with `EXIT_CODES.SIGNAL_KILL` (non-zero) to trigger Chromium restart, but still doesn't save state.

**Impact:** Same as finding #3 — all state lost on signal.

**Recommendation:** Before calling `process.exit()`, serialize all active sessions. Consider using `process.on('beforeExit')` as a last-resort safety net (though it won't fire on `process.exit()`).

---

### 5. Client-Side Saves Only on `ready` Status — Abort Skips Save

**Severity: MEDIUM**  
**File:** `packages/browseros-agent/apps/agent/entrypoints/sidepanel/index/useChatSession.ts:557-587`

The client only saves conversation when `status` transitions from `streaming`/`submitted` to `ready`:

```typescript
const wasStreaming =
  previousStatusRef.current === 'streaming' ||
  previousStatusRef.current === 'submitted'
const justFinished = wasStreaming && status === 'ready'

if (!justFinished) return
// ... save conversation
```

When the user clicks stop (which calls `stop()` → abort), the status transitions to `ready` BUT the `onFinish` callback fires with `isAbort: true`. The `@ai-sdk/react` hook's behavior on abort: the `messages` array may contain the partial assistant response **if** the SDK appended it before the abort signal propagated. However, there's no guarantee — the partial message may have empty parts, which are then **filtered out** by a subsequent `useEffect`:

```typescript
// Remove messages with empty parts (e.g. interrupted assistant responses)
useEffect(() => {
  if (status === 'streaming') return
  if (messages.some((m) => !m.parts?.length)) {
    setMessages(messages.filter((m) => m.parts?.length > 0))
  }
}, [messages, status, setMessages])
```

This means even if a partial response was captured, it gets silently deleted if it has empty parts.

**Impact:** User-initiated stops may lose partial responses. The client-side `conversationStorage` (chrome.storage.local) won't have the latest state.

**Recommendation:** 
1. Save the current `messages` snapshot on abort before filtering.
2. Use `beforeunload` event on the sidepanel window to flush state.
3. Don't filter out partial assistant messages — instead mark them as interrupted.

---

### 6. No Session Resume/Recovery Mechanism

**Severity: HIGH**  
**Files:**
- `packages/browseros-agent/apps/server/src/agent/session-store.ts` — in-memory only
- `packages/browseros-agent/apps/server/src/lib/db/schema/` — no `messages` table
- `packages/browseros-agent/apps/server/src/api/routes/assistant-sessions.ts:122-134` — compaction endpoint is a stub

The `POST /assistant/sessions/:id/compact` endpoint exists but is a **stub**:

```typescript
.post('/:id/compact', async (c) => {
  // Compaction is handled by the existing compaction system.
  // This endpoint is a future hook for manual trigger.
  return c.json({ success: true, message: 'Compaction scheduled' })
})
```

The compaction route (`/compaction`) has a `getConversationMessages` dep that always returns `null`:

```typescript
getConversationMessages: async (conversationId: string) => {
  return null  // NOTE: SessionStore is not shared with chat routes here.
},
```

There is no database table for storing messages. The `AssistantSessionStore` only stores metadata (title, mode, tags, workspaces, message count). The `previousConversation` field in `ChatRequest` is a **client-to-server injection mechanism** — the client sends previously saved messages on session rebuild, not the server loading them from disk.

**Impact:** After a server restart, there is no way to resume a session. The user sees an empty chat unless the client-side storage has the messages (and even then, the server-side agent state — MCP connections, tool configs, compaction state — is lost).

**Recommendation:**
1. Add a `messages` table to the SQLite schema for server-side message persistence.
2. On session creation, check for existing messages in DB and load them.
3. Wire the `getConversationMessages` in the compaction route to the actual SessionStore.
4. Implement the compact endpoint properly.

---

### 7. ACP Agent Turn Registry is Ephemeral

**Severity: MEDIUM**  
**File:** `packages/browseros-agent/apps/server/src/lib/agents/active-turn-registry.ts:1-300`

The `TurnRegistry` is an in-memory registry with a ring buffer. Turns are retained for 5 minutes after completion (`DEFAULT_RETAIN_AFTER_DONE_MS = 5 * 60 * 1000`), then swept. On server restart, all turn history is lost.

The ring buffer has a 5000-frame capacity with drop-oldest policy. For long-running agent tasks, older frames are silently dropped.

```typescript
const DEFAULT_BUFFER_CAPACITY = 5000
const DEFAULT_RETAIN_AFTER_DONE_MS = 5 * 60 * 1000
```

**Impact:** If the user navigates away and returns after >5 minutes, or if the server restarts, all turn event history is gone. The user can't see what the agent was doing.

**Recommendation:** Persist turn frames to SQLite for the duration of the session. The ring buffer can still be used for hot-path reads, but should be backed by durable storage.

---

### 8. No `beforeunload` Handler in Sidepanel

**Severity: LOW**  
**File:** `packages/browseros-agent/apps/agent/entrypoints/sidepanel/index/useChatSession.ts` (entire file — no beforeunload handler)

The sidepanel does not register a `beforeunload` or `pagehide` event handler. When the user closes the sidepanel, refreshes it, or Chromium kills it, no state is flushed to storage. The periodic save (on `ready` status) only fires if the streaming completes cleanly.

**Impact:** Closing the sidepanel mid-stream loses any un-saved messages from that turn.

**Recommendation:** Add a `beforeunload` handler that synchronously writes current messages to `chrome.storage.local`.

---

### 9. Compaction State is Transient

**Severity: LOW**  
**File:** `packages/browseros-agent/apps/server/src/agent/compaction.ts:337-426`

The compaction system maintains a `CompactionState` (summary + count) that is passed as `experimental_context` through the AI SDK pipeline. This state is ephemeral — it lives only in the `prepareStep` closure for the current turn.

```typescript
const state: CompactionState = isCompactionState(experimental_context)
  ? experimental_context
  : { existingSummary: null, compactionCount: 0 }
```

If the server restarts mid-conversation, the compaction summary is lost. The next turn starts fresh without the previous summary, potentially hitting context limits sooner.

**Impact:** Long conversations lose their compaction summaries on restart, leading to context overflow or unnecessary re-compaction.

**Recommendation:** Persist the compaction state (summary text + count) alongside the messages in the database. Load it when rebuilding a session.

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT (Sidepanel)                          │
│                                                                     │
│  useChat() → messages[] (React state)                              │
│       │                                                             │
│       ├── onSave (on status='ready' only)                          │
│       │   ├── conversationStorage (chrome.storage.local)            │
│       │   └── useRemoteConversationSave (GraphQL → Hasura)         │
│       │                                                             │
│       └── No beforeunload / visibilitychange handler                │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ HTTP POST /chat
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         SERVER (Bun)                                │
│                                                                     │
│  SessionStore (Map<string, AgentSession>) ← IN-MEMORY ONLY         │
│       │                                                             │
│       ├── AgentSession.agent (AiSdkAgent)                           │
│       │   └── messages: UIMessage[] ← IN-MEMORY ONLY               │
│       │                                                             │
│       └── No periodic flush to disk                                │
│                                                                     │
│  TurnRegistry (RingBuffer, 5k frames, 5min retain) ← EPHEMERAL     │
│                                                                     │
│  AssistantSessionStore (SQLite) ← METADATA ONLY                    │
│       └── title, mode, tags, workspaces, messageCount              │
│       └── NO messages table                                         │
│                                                                     │
│  SIGTERM/SIGINT → stop() → process.exit() ← NO STATE FLUSH         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Prioritized Recommendations

| Priority | Finding | Effort | Impact |
|----------|---------|--------|--------|
| P0 | Add messages table to SQLite + periodic flush | Medium | Prevents all message loss on restart |
| P0 | Flush sessions to disk before `process.exit()` | Low | Saves state on graceful shutdown |
| P1 | Save partial messages on abort (client + server) | Medium | Preserves interrupted work |
| P1 | Wire `getConversationMessages` in compaction route | Low | Enables on-demand compaction |
| P1 | Implement the `POST /assistant/sessions/:id/compact` stub | Medium | Enables manual compaction |
| P2 | Add `beforeunload` handler in sidepanel | Low | Saves state on panel close |
| P2 | Persist turn frames for active sessions | Medium | Enables turn history after restart |
| P3 | Persist compaction state across restarts | Low | Improves long conversation resilience |

---

## Files Requiring Changes

| File | Change |
|------|--------|
| `apps/server/src/lib/db/schema/` | Add `messages` table |
| `apps/server/src/agent/session-store.ts` | Add periodic flush to SQLite |
| `apps/server/src/main.ts:197-213` | Add pre-exit state flush |
| `apps/server/src/api/services/chat-service.ts:361-376` | Save partial messages on abort |
| `apps/server/src/api/routes/compaction.ts:160-166` | Wire real `getConversationMessages` |
| `apps/server/src/api/routes/assistant-sessions.ts:122-134` | Implement compact endpoint |
| `apps/server/src/api/server.ts:195-210` | Wire SessionStore to compaction route |
| `apps/agent/entrypoints/sidepanel/index/useChatSession.ts:557-587` | Save on abort, add beforeunload |
| `apps/server/src/lib/agents/active-turn-registry.ts` | Add SQLite backing for turn frames |
