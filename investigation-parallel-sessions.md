# Investigation: BrowserOS ACP/Assistant Parallel Session Handling

## Executive Summary

The BrowserOS server manages sessions through **four independent store classes** that are not unified. The main risks are: (1) an unbounded `AcpxRuntime.runtimes` cache that never gets cleaned up, (2) a dual-store design for agent sessions where in-memory metadata can drift from ref-counted handles, (3) no server-shutdown cleanup for in-flight agent turns or MCP connections, and (4) CDP WebSocket reconnection logic that can leak timers. The codebase is well-structured overall — ref-counting, sweep timers, and file-based persistence are used correctly in most places — but the gaps identified below are real leak vectors under sustained parallel usage.

---

## 1. Session Lifecycle

### 1.1 Four independent session stores — no unified lifecycle

The server manages sessions through four separate store classes with **no shared lifecycle coordinator**:

| Store | File | Persistence | Purpose |
|-------|------|-------------|---------|
| `SessionStore` | `apps/server/src/agent/session-store.ts` | In-memory `Map` | Legacy AI SDK agent sessions (AiSdkAgent + browser context + MCP clients) |
| `AgentSessionStore` | `apps/server/src/agent/agent-session-store.ts` | In-memory `Map` (ref-counted) | ACP agent session handles + metadata |
| `AssistantSessionStore` | `apps/server/src/sessions/assistant-session-store.ts` | SQLite (Drizzle) | Chat/agent session metadata (title, tags, workspaces) |
| `TurnRegistry` | `apps/server/src/lib/agents/active-turn-registry.ts` | In-memory `Map` + sweep timer | Active agent turns with event buffering |

**Finding 1.1a — Dual agent session stores with potential drift**  
**Severity: MEDIUM**  
`apps/server/src/api/services/agents/agent-session-service.ts` (lines 39-42)

`AgentSessionService` maintains its own `sessions: Map<string, AgentSessionInfo>` alongside delegating to `AgentSessionStore` (the ref-counted store). The close path removes from both, but there is no garbage collection for sessions that exist in one but not the other (e.g., if `AgentSessionStore.close()` returns false due to non-zero refCount but the service's Map entry was already deleted, or vice versa).

```typescript
// agent-session-service.ts:108-117
async closeSession(sessionId: string): Promise<boolean> {
  const session = this.sessions.get(sessionId)
  if (!session) return false
  this.sessions.delete(sessionId)          // ← removed from local map
  return this.memStore.close(session.agentId, sessionId)  // ← may return false (refs remain)
}
```

If `memStore.close()` returns `false`, the in-memory `AgentSessionInfo` is already deleted, but the `AgentSessionStore` still holds a ref-counted handle. Subsequent `closeSession()` calls will return `false` (not found in local map) even though the ref-counted handle persists.

**Finding 1.1b — No orphaned session GC for `AgentSessionStore`**  
**Severity: LOW**  
`apps/server/src/agent/agent-session-store.ts`

`AgentSessionStore` uses ref-counting (`open`/`close`) but has no mechanism to detect sessions whose refCount is non-zero but all consumers have disconnected (e.g., client crash without sending close request). These will accumulate in the `sessions` and `sessionMeta` Maps indefinitely.

```typescript
// agent-session-store.ts:83-94
private sessions = new Map<string, ActiveSession>()
private sessionMeta = new Map<string, SessionMeta>()
// No TTL, no sweep timer, no max-size limit
```

**Finding 1.1c — `SessionStore.remove()` does not dispose resources**  
**Severity: MEDIUM**  
`apps/server/src/agent/session-store.ts` (lines 43-50)

`SessionStore` has two removal methods: `remove()` (no dispose) and `delete()` (with dispose). The `remove()` path leaks MCP clients and any associated resources.

```typescript
// session-store.ts:43-50
remove(conversationId: string): boolean {
  const existed = this.sessions.delete(conversationId)
  if (existed) {
    logger.info('Session removed from store (without dispose)', {  // ← explicit warning!
      conversationId,
      remainingSessions: this.sessions.size,
    })
  }
  return existed
}
```

The log message itself says "(without dispose)" — indicating the team is aware. Any caller using `remove()` instead of `delete()` will leak `AiSdkAgent` and its MCP client connections.

### 1.2 Server shutdown — no graceful turn/session cleanup

**Finding 1.2a — `Application.stop()` calls `process.exit()` without draining active turns**  
**Severity: HIGH**  
`apps/server/src/main.ts` (lines 193-210)

```typescript
stop(reason?: string): void {
  logger.info('Shutting down server...', { reason })
  stopSkillSync()
  getOpenClawService().shutdown().catch(() => {})
  getHermesRuntime()?.executeAction({ type: 'stop' }).catch(() => {})
  removeServerConfigSync()
  // Immediate exit — no TurnRegistry cleanup, no MCP client close, no SessionStore.dispose()
  process.exit(code)
}
```

The `TurnRegistry` has active `AbortController`s for in-flight turns. The `AcpxRuntime` has a `runtimes` Map that may hold `AcpCoreRuntime` instances with child processes. None of these are cleaned up. The `process.exit()` is documented as intentional ("Chromium may kill us"), but this means:
- Child agent processes (claude, codex, openclaw ACP bridge) may become orphans
- MCP client connections are not gracefully closed
- In-flight SSE subscribers get TCP RST instead of clean close

---

## 2. Resource Leaks

### 2.1 Unbounded `AcpxRuntime.runtimes` cache

**Finding 2.1a — Runtime instances cached forever, never evicted**  
**Severity: HIGH**  
`apps/server/src/lib/agents/acpx-runtime.ts` (lines 66-67, 276-312)

```typescript
private readonly runtimes = new Map<string, AcpxCoreRuntime>()

private getRuntime(input: { ... }): AcpxCoreRuntime {
  const key = JSON.stringify({ cwd, permissionMode, commandIdentity, ... })
  const existing = this.runtimes.get(key)
  if (existing) return existing  // ← returned and never cleaned up
  const runtime = this.runtimeFactory({ ... })
  this.runtimes.set(key, runtime)
  return runtime
}
```

The cache key is a JSON fingerprint of cwd + permission mode + command identity + MCP host + openclaw session key. Every unique combination creates a permanent entry. If a user changes working directory, permission mode, or switches agents, old entries accumulate. The `AcpxRuntime` instance lives for the server's lifetime.

Each `AcpxCoreRuntime` instance may hold references to: the session store, agent registry, MCP server connections, and subprocess handles (via acpx-core). This is the **highest-impact leak** — under normal usage with 3-5 agents using different cwds, this is manageable, but under automated/CI workloads with many distinct session keys, it will grow unboundedly.

**Recommendation:** Add an LRU eviction or TTL-based sweep, or at minimum cap the map size.

### 2.2 CDP WebSocket timer leak on reconnect

**Finding 2.2a — `keepaliveTimer` may not be cleared on all disconnect paths**  
**Severity: MEDIUM**  
`apps/server/src/browser/backends/cdp.ts` (lines 50, 225+)

```typescript
private keepaliveTimer: ReturnType<typeof setInterval> | null = null
```

The `keepaliveTimer` is created during `connect()` and during reconnection attempts. While the code does clear it in some paths, the reconnection loop (`reconnectLoop`) spawns new timers. If the reconnect loop exits abnormally (e.g., due to the `exitOnReconnectFailure` flag), the timer from the failed connection attempt may not be cleaned up. The timer uses `setInterval` which, if leaked, will keep firing against a dead WebSocket reference.

### 2.3 `MonitoringSessionRegistry` listener leak

**Finding 2.3a — `endListenersByAgent` entries not cleaned when agent is deleted**  
**Severity: LOW**  
`apps/server/src/monitoring/session-registry.ts` (lines 18-19, 62-70)

```typescript
private readonly endListenersByAgent = new Map<string, Set<SessionEndListener>>()
```

Listeners are cleaned up when they unsubscribe themselves, but if an agent is deleted from the system while listeners are still registered (e.g., a monitoring service that calls `onSessionEnd()` and never unsubscribes), the `endListenersByAgent` entry for that agentId persists forever. The `activeSessionsByAgent` map is cleaned on `clearIfMatches`, but `endListenersByAgent` has no corresponding cleanup path.

### 2.4 `ClawSession` states grow unbounded

**Finding 2.4a — Agent states in `ClawSession` are never removed**  
**Severity: LOW**  
`apps/server/src/api/services/openclaw/claw-session.ts` (line 16)

```typescript
private readonly states = new Map<string, AgentSessionState>()
```

Every agent that ever emits a WS event gets a permanent entry. Deleted agents' states persist. This is low impact (small objects) but is technically unbounded.

---

## 3. Concurrent Access Protection

### 3.1 AgentSessionStore — no locking

**Finding 3.1a — `AgentSessionStore` operations are not atomic**  
**Severity: MEDIUM**  
`apps/server/src/agent/agent-session-store.ts`

JavaScript is single-threaded, so individual Map operations are atomic. However, compound operations (check-then-act) are not:

```typescript
// closeSession() in agent-session-store.ts:193-199
async closeSession(agentId: string, sessionId: string): Promise<number> {
  const removed = this.close(agentId, sessionId)  // decrements refCount
  if (removed) {
    this.sessionMeta.delete(key)  // only deleted when refCount hits 0
  }
  const remaining = this.get(agentId, sessionId)
  return remaining?.refCount ?? 0
}
```

Between `this.close()` and `this.sessionMeta.delete()`, another async caller could call `open()` and get a stale or missing meta. In practice, this would require two HTTP requests to interleave within the same microtask queue tick, which is unlikely but possible with async middleware.

### 3.2 FileMessageQueue — proper serialization

**Finding 3.2a — Write lock is correctly implemented**  
**Severity: N/A (positive)**  
`apps/server/src/lib/agents/message-queue.ts` (lines 155-161)

```typescript
private withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = this.writeQueue.then(fn, fn)
  this.writeQueue = result.then(() => undefined, () => undefined)
  return result
}
```

The file-based message queue uses a promise chain as a mutex — serializing all writes. This is correct and prevents file corruption from concurrent enqueues. The chain never rejects (both `.then()` handlers return `undefined`), so it's resilient to individual operation failures.

### 3.3 TurnRegistry — correct single-turn-per-agent enforcement

**Finding 3.3a — Turn collision detection is correct**  
**Severity: N/A (positive)**  
`apps/server/src/lib/agents/active-turn-registry.ts` (lines 148-156)

```typescript
getActiveFor(agentId: string, sessionId: string): ActiveTurn | undefined {
  for (const turn of this.turns.values()) {
    if (turn.status === 'running' && turn.agentId === agentId && turn.sessionId === sessionId) {
      return turn
    }
  }
  return undefined
}
```

The `AgentHarnessService.startTurn()` checks this before registering, throwing `TurnAlreadyActiveError` on collision. This is correct for preventing concurrent turns for the same agent+session pair. However, the linear scan (`for...of this.turns.values()`) is O(n) — fine for typical workloads but could be slow with hundreds of active turns.

---

## 4. State Isolation Between Sessions

### 4.1 Composite keys prevent cross-agent collision

**Finding 4.1a — `AgentSessionStore` uses composite keys**  
**Severity: N/A (positive)**  
`apps/server/src/agent/agent-session-store.ts` (lines 50-52)

```typescript
private static key(agentId: string, sessionId: string): string {
  return `${agentId}::${sessionId}`
}
```

Sessions are properly namespaced by agentId. Two agents cannot collide on the same sessionId.

### 4.2 TurnRegistry properly isolates by agent+session

**Finding 4.2a — Turns are scoped to (agentId, sessionId) pairs**  
**Severity: N/A (positive)**  
`apps/server/src/lib/agents/active-turn-registry.ts`

The `getActiveFor()` method checks both `agentId` and `sessionId`, ensuring parallel sessions for different agents don't interfere. The `TurnRegistry.register()` creates an isolated `AbortController` per turn.

### 4.3 `AcpxRuntime.getRuntime()` — shared runtime instances

**Finding 4.3a — Runtime instances are shared when config matches**  
**Severity: MEDIUM**  
`apps/server/src/lib/agents/acpx-runtime.ts` (lines 276-312)

When two different agents have the same cwd + permission mode + command identity, they share the same `AcpxCoreRuntime` instance. This means they share the same agent registry and MCP server connections. While this is intentional (deduplication), it means:
- A long-running turn for agent A could affect the MCP connection state seen by agent B
- The shared runtime's internal state (acpx session store, subprocess pool) is not session-isolated

The isolation boundary is at the `AcpRuntimeHandle` level (per-session within a runtime), but the underlying process pool and MCP connections are shared.

---

## 5. Process Management for Spawned Agents

### 5.1 Agent processes managed by acpx-core

**Finding 5.1a — Agent child processes are managed by acpx-core, not BrowserOS**  
**Severity: MEDIUM**  
`apps/server/src/lib/agents/acpx-runtime.ts`

BrowserOS delegates process lifecycle to `acpx-core`'s `AcpRuntime`. The `AcpxRuntime.send()` method creates a `ReadableStream` with a `cancel()` handler that calls `activeTurn?.cancel()`. The `TurnRegistry.cancel()` calls `abortController.abort()`, which should signal the acpx runtime to terminate the subprocess.

However, there is no explicit `SIGTERM`/`SIGKILL` to child processes at the BrowserOS level. If acpx-core's cancellation is slow or fails (e.g., subprocess ignores signals), the child process becomes an orphan.

```typescript
// acpx-runtime.ts, createAcpxEventStream:
cancel() {
  void activeTurn?.cancel({ reason: 'BrowserOS stream cancelled' })
  // No process.kill() fallback
}
```

### 5.2 Terminal sessions — proper cleanup

**Finding 5.2a — Terminal sessions properly kill child processes**  
**Severity: N/A (positive)**  
`apps/server/src/api/services/terminal/terminal-session.ts` (lines 94-105)

```typescript
close() {
  if (closed) return
  closed = true
  try {
    proc.terminal?.close()
    proc.kill()
  } catch {
    logger.debug('Terminal session cleanup failed')
  }
}
```

Terminal sessions use a `closed` guard and call both `proc.terminal?.close()` and `proc.kill()`. This is correct. The question is whether all terminal sessions are closed on server shutdown — they are not (see Finding 1.2a).

### 5.3 OpenClaw container processes

**Finding 5.3a — Container stop is best-effort on shutdown**  
**Severity: LOW**  
`apps/server/src/main.ts` (lines 197-199)

```typescript
getOpenClawService().shutdown().catch(() => {})
getHermesRuntime()?.executeAction({ type: 'stop' }).catch(() => {})
```

Container stop is fire-and-forget with `.catch(() => {})`. If the container stop fails, the containers continue running but the server exits. This is acceptable for the use case (Chromium manages server lifecycle).

---

## 6. Client-Side Session Handling

### 6.1 useChatSession — no explicit cleanup of storage watchers

**Finding 6.1a — Storage watchers are properly cleaned up**  
**Severity: N/A (positive)**  
`apps/agent/entrypoints/sidepanel/index/useChatSession.ts`

All `useEffect` hooks that set up storage watchers (`selectedTextStorage.watch`, `selectedWorkspaceStorage.watch`, `searchActionsStorage.watch`, `stopAgentStorage.watch`, `approvalResponsesStorage.watch`) return cleanup functions. React will call these on unmount.

### 6.2 AgentSessionListStore — localStorage persistence without GC

**Finding 6.2a — Client-side session list grows unbounded in localStorage**  
**Severity: LOW**  
`apps/agent/entrypoints/app/agent-command/agent-session-list-store.ts`

Sessions are persisted to localStorage per agent. There is no TTL or max-size limit. Users who create many sessions will accumulate localStorage entries. This is low impact (localStorage is typically 5-10MB) but worth noting.

---

## Summary of Findings

| # | Finding | Severity | File | Line(s) |
|---|---------|----------|------|---------|
| 1.1a | Dual agent session stores can drift | MEDIUM | `agent-session-service.ts` | 108-117 |
| 1.1b | No orphaned session GC for AgentSessionStore | LOW | `agent-session-store.ts` | 83-94 |
| 1.1c | `SessionStore.remove()` leaks MCP clients | MEDIUM | `session-store.ts` | 43-50 |
| 1.2a | Server shutdown does not drain turns/processes | HIGH | `main.ts` | 193-210 |
| 2.1a | `AcpxRuntime.runtimes` cache grows unbounded | HIGH | `acpx-runtime.ts` | 66-67, 276-312 |
| 2.2a | CDP keepalive timer potential leak on reconnect | MEDIUM | `browser/backends/cdp.ts` | 50, 225+ |
| 2.3a | MonitoringSessionRegistry listener entries persist | LOW | `session-registry.ts` | 18-19, 62-70 |
| 2.4a | ClawSession states never removed | LOW | `claw-session.ts` | 16 |
| 3.1a | AgentSessionStore compound ops not atomic | MEDIUM | `agent-session-store.ts` | 193-199 |
| 3.2a | FileMessageQueue write lock correct | N/A | `message-queue.ts` | 155-161 |
| 3.3a | TurnRegistry collision detection correct | N/A | `active-turn-registry.ts` | 148-156 |
| 4.1a | Composite keys prevent collision | N/A | `agent-session-store.ts` | 50-52 |
| 4.3a | Shared runtime instances across agents | MEDIUM | `acpx-runtime.ts` | 276-312 |
| 5.1a | No direct process kill fallback for agent children | MEDIUM | `acpx-runtime.ts` | createAcpxEventStream cancel() |
| 5.2a | Terminal sessions properly cleaned up | N/A | `terminal-session.ts` | 94-105 |
| 5.3a | Container stop best-effort on shutdown | LOW | `main.ts` | 197-199 |
| 6.2a | Client session list unbounded in localStorage | LOW | `agent-session-list-store.ts` | all |

## Recommendations (Priority Order)

1. **Cap or sweep `AcpxRuntime.runtimes`** — Add LRU eviction or periodic TTL sweep. This is the highest-impact leak for long-running servers with varied session configurations.

2. **Unify `AgentSessionStore` and `AgentSessionService`** — Eliminate the dual-map design. The service should be the sole owner of session metadata, delegating ref-counting to a single store.

3. **Audit all callers of `SessionStore.remove()`** — Ensure they use `SessionStore.delete()` instead, which properly disposes MCP clients. Consider making `remove()` private or deprecated.

4. **Add graceful shutdown path** — Before `process.exit()`, iterate `TurnRegistry` to cancel active turns, close `SessionStore` sessions, and clear the `AcpxRuntime.runtimes` map. Even if Chromium kills the process, a best-effort cleanup reduces orphan processes.

5. **Add orphan session detection** — Implement a periodic sweep in `AgentSessionStore` that checks if sessions have been inactive beyond a threshold and auto-closes them (decrementing refCount).
