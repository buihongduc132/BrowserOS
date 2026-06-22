# Investigation: BrowserOS Stuck Sessions

## Summary

BrowserOS sessions can get stuck in a "loading/processing" state due to several interacting issues across the client, transport, and server layers. The most likely root causes are: **no client-side timeout on streaming responses**, **no automatic recovery from `submitted` state**, and a **server-side turn lock with no expiry**.

---

## Findings

### 1. No Client-Side Timeout on Streaming Fetch (HIGH)

**File:** AI SDK `DefaultChatTransport` (vendored `ai` package, `HttpChatTransport.sendMessages`)

**Description:** The `DefaultChatTransport.sendMessages()` uses `fetch()` with an `abortSignal` but **no timeout**. The `useChat` hook creates an `AbortController` per request, but never sets a timeout on it. The only way to abort is the user clicking Stop or closing the tab.

**Root cause:** `useChatSession.ts` line 355 constructs `new DefaultChatTransport(...)` with no `timeout` option. The AI SDK's `makeRequest` (line ~13045 of `ai/dist/index.js`) creates `new AbortController()` but never calls `setTimeout` → `abort()`.

**Impact:** If the server accepts the connection but never sends data (e.g., MCP client hangs, LLM provider stalls, network goes half-open), the client stays in `submitted` or `streaming` state **indefinitely**. The user sees a loading spinner with no way to recover except clicking Stop.

**Severity:** HIGH — This is the primary cause of "stuck" sessions.

---

### 2. `submitted` State Has No Timeout or Auto-Error (HIGH)

**File:** `packages/browseros-agent/apps/agent/entrypoints/sidepanel/index/ChatInput.tsx:167`

**Description:** The `isBusy` check is:
```ts
const isBusy = status !== 'ready' && status !== 'error'
```

This means both `submitted` and `streaming` block input. The `submitted` state persists until the first chunk arrives from the server. If the server hangs before sending any chunk, the client is stuck in `submitted` forever.

**File:** `packages/browseros-agent/apps/agent/entrypoints/sidepanel/index/Chat.tsx:323`

**Description:** When `isRestoringConversation` is true, a spinner is shown. This depends on `conversationIdParam` matching `restoredConversationId`. If the GraphQL query hangs or returns no data for a valid `conversationIdParam`, this spinner persists.

**Root cause:** AI SDK `makeRequest` sets `status: 'submitted'` at line ~13037, then waits for `transport.sendMessages()` to resolve. If `fetch()` hangs, the status stays `submitted`.

**Severity:** HIGH — Blocks all user interaction.

---

### 3. Server-Side Turn Lock Has No Expiry (MEDIUM)

**File:** `packages/browseros-agent/apps/server/src/lib/agents/active-turn-registry.ts:122-340`

**Description:** The `TurnRegistry.getActiveFor()` returns any turn with `status === 'running'`. The `runDetachedTurn` method (`agent-harness-service.ts:1005`) pushes events into the registry, but if the runtime call itself hangs (e.g., MCP server unresponsive, LLM API stalled), the turn stays `running` forever.

The sweeper (`sweep()`) only evicts terminal turns after `retainAfterDoneMs` (5 minutes). It explicitly skips `running` turns:
```ts
if (turn.status === 'running') continue
```

**Root cause:** No turn-level timeout. The `AbortController` is created per-turn (`turn.abortController`) but nothing ever calls `abort()` automatically — only `cancelTurn()` from an HTTP endpoint or stream cancellation.

**Impact:** If a turn hangs on the server, subsequent `startTurn()` calls throw `TurnAlreadyActiveError` (409), permanently blocking new turns for that agent/session pair until server restart.

**Severity:** MEDIUM — Server-side blocking. The sidepanel client doesn't use the agent harness directly (it uses the `/chat` route), so this affects the `app.html` agent command interface more than the sidepanel.

---

### 4. MCP Client Connection Can Block Agent Creation (MEDIUM)

**File:** `packages/browseros-agent/apps/server/src/agent/mcp-builder.ts:47-73`

**Description:** `connectMcpClient` has a `Promise.race` timeout (`TIMEOUTS.MCP_CLIENT_CONNECT`, default 15s). This is good. However, the timeout produces a `null` return which is silently skipped — the agent is still created without those tools.

The issue is in `AiSdkAgent.create()` (`ai-sdk-agent.ts:100-101`):
```ts
const { clients, tools: customMcpTools } = await createMcpClients(specs)
```

This blocks agent creation until ALL MCP clients resolve or timeout. If there are many custom MCP servers, the sequential timeout stacking (15s each, but concurrent via `Promise.all`) could delay the response start by up to 15 seconds — keeping the client in `submitted` state.

**Root cause:** Not a hang per se, but a long delay during agent creation that makes the session *appear* stuck.

**Severity:** MEDIUM — User perceives stuckness for 15+ seconds.

---

### 5. `useSyncRemoteIntegrations` Gates Message Sending (MEDIUM)

**File:** `packages/browseros-agent/apps/agent/lib/mcp/useSyncRemoteIntegrations.ts`

**Description:** The `ChatSessionProvider` passes `isIntegrationsSynced: hasSynced` to `useChatSession`. Until `hasSynced` is true, messages are queued in `pendingMessageRef` (line ~760-770 of `useChatSession.ts`).

The sync depends on `useGetUserMCPIntegrations()` (a GraphQL query). If this query:
- Never resolves (network issue)
- Returns `isIntegrationsLoading: true` indefinitely
- Has no timeout

Then `hasSynced` stays `false` and **all messages are queued forever**.

**Root cause:** No fallback timeout. If the integration query fails silently (GraphQL error swallowed), `hasSynced` never flips to `true`.

**Severity:** MEDIUM — Messages silently queued with no UI indication of the blockage.

---

### 6. Provider Change Triggers `resetConversationState` Mid-Session (LOW)

**File:** `packages/browseros-agent/apps/agent/entrypoints/sidepanel/index/useChatSession.ts:783-793`

**Description:** When the user switches providers (`handleSelectProvider`), if there are existing messages, `resetConversationState()` is called which:
1. Calls `stop()` — aborts any in-flight request
2. Resets `conversationId` 
3. Clears messages
4. Clears liked/disliked state

If `stop()` fails or the abort doesn't propagate cleanly, the old streaming response may still be updating state after the reset. The `baseSendMessage` from AI SDK's `useChat` may have internal state referencing the old conversation.

**Root cause:** `stop()` only aborts the `AbortController` — it doesn't guarantee the AI SDK internal state machine has fully reset before `setMessages([])` is called.

**Severity:** LOW — Race condition that could cause transient weirdness.

---

### 7. No WebSocket Keep-Alive / Reconnection for Gateway (LOW)

**File:** `packages/browseros-agent/apps/server/src/services/openclaw/gateway-client.ts:168-326`

**Description:** The gateway WebSocket client has `tryReconnect()` but uses `rejectAllPending` on disconnect, which rejects all pending RPC promises. If the WS drops mid-turn, all pending calls fail but the turn registry entry stays `running`.

The RPC timeout is 15 seconds (`RPC_TIMEOUT_MS`), so pending calls will eventually timeout. But if the WS silently dies (half-open connection), the `onclose` handler may not fire immediately.

**Root cause:** No WebSocket ping/pong keep-alive to detect half-open connections.

**Severity:** LOW — Affects OpenClaw gateway only, not the main chat flow.

---

### 8. Server-Side Chat Route Passes `abortSignal` Directly (LOW)

**File:** `packages/browseros-agent/apps/server/src/api/routes/chat.ts:46`

**Description:** `service.processMessage(request, c.req.raw.signal)` passes the raw Hono request signal. When the client disconnects, this signal aborts the `createAgentUIStreamResponse` which stops the agent loop. However, the `SessionStore` entry persists — the next request for the same `conversationId` reuses the same agent session with stale messages.

**Root cause:** No cleanup of the session store entry when the stream is aborted. The stale session may have partial messages or be in an inconsistent state.

**Severity:** LOW — The session is reused, which is correct, but the state may be slightly inconsistent.

---

### 9. Conversation Restore Can Loop (LOW)

**File:** `packages/browseros-agent/apps/agent/entrypoints/sidepanel/index/useChatSession.ts:717-760`

**Description:** The conversation restore effect depends on `conversationIdParam`, `remoteConversationData`, and `isLoggedIn`. If the GraphQL query returns `null` (conversation not found), the effect sets `restoredConversationId` and clears the param. But if something re-sets the param (e.g., browser back button, race with URL update), the effect re-triggers.

The `isRestoringConversation` flag shows a spinner during this, which could flash if the effect re-triggers.

**Root cause:** Biome's `useExhaustiveDependencies` is suppressed for this effect, making it fragile.

**Severity:** LOW — Intermittent spinner flash, not a true hang.

---

## State Machine Analysis

### AI SDK `useChat` Status Machine

```
ready ──→ submitted ──→ streaming ──→ ready
  ↑                          │           ↑
  │                          ↓           │
  │                       error ─────────┘
  │                          │
  └──────────────────────────┘
```

- `submitted`: fetch() in-flight, waiting for first byte
- `streaming`: receiving chunks
- `ready`: complete or aborted
- `error`: fetch failed or stream errored

**Gap:** No transition from `submitted`/`streaming` back to `ready` on timeout. Only abort or completion triggers the transition.

### Server Turn Registry State Machine

```
registered(running) ──→ done
                      ──→ error
                      ──→ cancelled
```

**Gap:** `running` has no timeout-based transition. Only `cancel()` or terminal events move it out.

---

## Recommended Fixes (Priority Order)

1. **Add client-side request timeout** in `useChatSession.ts`:
   - Wrap `DefaultChatTransport` with a timeout that aborts the `AbortController` after e.g. 120s of no data
   - Or use `AbortSignal.timeout()` as a composed signal

2. **Add server-side turn timeout** in `active-turn-registry.ts`:
   - In `sweep()`, also check `running` turns that exceed a max duration (e.g. 10 minutes) and auto-cancel them

3. **Add integration sync fallback timeout** in `useSyncRemoteIntegrations.ts`:
   - If sync hasn't completed within 10s, set `hasSynced: true` anyway and log a warning

4. **Add health check / keep-alive for streaming responses**:
   - Server sends periodic heartbeat events; client detects silence and auto-aborts

5. **Add pending-message queue overflow protection**:
   - If `pendingMessageRef` is set for too long (>30s), auto-send it regardless of sync state

---

## Files Examined

| File | Lines | Role |
|------|-------|------|
| `apps/agent/entrypoints/sidepanel/index/useChatSession.ts` | 1-850 | Main chat session hook (client) |
| `apps/agent/entrypoints/sidepanel/index/Chat.tsx` | 1-400 | Chat UI component |
| `apps/agent/entrypoints/sidepanel/index/ChatInput.tsx` | 1-280 | Input with isBusy gating |
| `apps/agent/entrypoints/sidepanel/layout/ChatSessionContext.tsx` | 1-30 | Session context provider |
| `apps/agent/entrypoints/sidepanel/layout/ChatLayout.tsx` | 1-60 | Layout with loading state |
| `apps/agent/lib/mcp/useSyncRemoteIntegrations.ts` | 1-80 | Integration sync gating |
| `apps/agent/lib/browseros/useBrowserOSProviders.ts` | 1-50 | Agent server URL resolution |
| `apps/server/src/lib/agents/active-turn-registry.ts` | 1-340 | Server turn state machine |
| `apps/server/src/api/services/agents/agent-harness-service.ts` | 280-1120 | Agent harness (ACP turns) |
| `apps/server/src/agent/ai-sdk-agent.ts` | 1-250 | Agent creation (MCP, tools) |
| `apps/server/src/agent/session-store.ts` | 1-70 | In-memory session store |
| `apps/server/src/agent/mcp-builder.ts` | 1-90 | MCP client creation with timeout |
| `apps/server/src/api/services/chat-service.ts` | 1-340 | Legacy chat service |
| `apps/server/src/api/routes/agents.ts` | 268-430, 1027-1040 | ACP sidepanel chat route |
| `apps/server/src/api/routes/chat.ts` | 1-60 | Legacy chat route |
| `apps/server/src/monitoring/service.ts` | 1-100 | Monitoring with waitForSessionFree |
| `apps/server/src/services/openclaw/gateway-client.ts` | 280-360 | WebSocket gateway client |
| `apps/agent/entrypoints/app/agent-command/useAgentConversation.ts` | 250-410 | Agent command conversation (409 handling) |
