# Intentions: Mid-Turn Session Persist

Date: 2026-05-29
Captured from user's as-is wording.

---

## User's Words

> Sometimes I am seeing that the browser even closing by itself (while there are LLM operating)
> It is because of the LLM closing the tab that is currently housing itself ?
> troubleshoot , find the problem , verifier loop for me ;

---

## Investigation Findings

Full investigation documented in `investigation-mid-session-loss.md`.

**9 findings, 6 critical gaps:**

1. **SessionStore is purely in-memory** — no disk persistence. `Map<string, AgentSession>` dies with process.
2. **No periodic state persistence** during agent execution — messages only saved in `onFinish`, which never fires on crash.
3. **Graceful shutdown does not save state** — `stop()` calls `process.exit()` immediately, no session flush.
4. **SIGTERM/SIGINT handlers only forward to `stop()`** — no `beforeExit` safety net.
5. **Client-side saves only on `ready` status** — abort skips save, partial messages filtered out.
6. **No session resume/recovery** — no messages table in SQLite, compaction is a stub.
7. **ACP Turn Registry is ephemeral** — ring buffer, 5min retain, lost on restart.
8. **No `beforeunload` handler in sidepanel** — closing panel loses un-saved messages.
9. **Compaction state is transient** — summary lost on restart.

---

## Follow-up

> P0: Add messages table to SQLite + periodic flush
> P0: Flush sessions to disk before process.exit()
> P1: Save partial messages on abort
> P1: Wire getConversationMessages in compaction route
> P2: Add beforeunload handler in sidepanel
