# Commands CRUD Investigation Report

**Date:** 2026-05-17  
**Status:** TWO CRITICAL BUGS FOUND

---

## Bug #1 (BLOCKER): CORS `PUT` method not allowed

**File:** `packages/browseros-agent/apps/server/src/api/utils/cors.ts` (line 40)  
**Severity:** CRITICAL — all update/toggle/modify operations fail silently

The CORS configuration only allows these HTTP methods:
```typescript
allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
```

**`PUT` is missing.** The commands route handler uses `PUT` for updates:

| Route | Method | Works? | Reason |
|-------|--------|--------|--------|
| `GET /commands` | GET | ✅ | In CORS allowMethods |
| `GET /commands/:id` | GET | ✅ | In CORS allowMethods |
| `POST /commands` | POST | ✅ | In CORS allowMethods |
| `PUT /commands/:id` | PUT | ❌ | **NOT in CORS allowMethods** |
| `DELETE /commands/:id` | DELETE | ✅ | In CORS allowMethods |

All command update operations (edit, toggle enable/disable, modify) go through `PUT /commands/:id`. The browser's CORS preflight (`OPTIONS`) returns without `PUT` in `Allow-Methods`, so the browser blocks the actual request before it reaches the server.

### Fix
In `packages/browseros-agent/apps/server/src/api/utils/cors.ts`, line 40:
```typescript
// Before (broken):
allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],

// After (fixed):
allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
```

---

## Bug #2: `enabled` field never persisted

**Files:**
- `packages/browseros-agent/apps/server/src/commands/service.ts` (lines 170-203)
- `packages/browseros-agent/apps/server/src/commands/loader.ts` (line 58)
- `packages/browseros-agent/apps/server/src/commands/types.ts` (lines 6-12)

**Severity:** HIGH — even after fixing CORS, enable/disable toggle won't persist

### The Problem

The `enabled` field is accepted in the API (`UpdateCommandInput` has `enabled?: boolean`) but is **never stored on disk**:

1. **`CommandFrontmatter` type** (types.ts:6-12) does NOT include `enabled`:
   ```typescript
   export type CommandFrontmatter = {
     description: string
     model?: string
     agent?: string
     subtask?: boolean
   }
   ```

2. **`updateCommand` service** (service.ts:170-203) **ignores `enabled`** from input:
   - Reads file, rebuilds frontmatter with only `description` and `model`
   - Returns `enabled: true` **hardcoded** on line 203

3. **`parseCommandFile` loader** (loader.ts:58) **hardcodes `enabled: true`**:
   ```typescript
   return {
     ...
     enabled: true,  // always true, never reads from file
     ...
   }
   ```

4. **`createCommand` service** (service.ts:164) also hardcodes `enabled: true`.

5. **`getCommand` service** (service.ts:101, 121) also hardcodes `enabled: true`.

### Data Flow (broken)

```
UI toggle → PUT /commands/:id { enabled: false }
  → service.updateCommand() reads file
  → builds frontmatter: { description, model } ← enabled NOT included
  → writes file without enabled
  → returns { enabled: true } ← hardcoded
  → UI sees enabled=true immediately (toggle snaps back)
  → On next page load: loader reads file, finds no enabled field → returns true
```

### Fix

1. **Add `enabled` to `CommandFrontmatter`** in `types.ts`:
   ```typescript
   export type CommandFrontmatter = {
     description: string
     model?: string
     enabled?: boolean    // <-- add this
     agent?: string
     subtask?: boolean
   }
   ```

2. **Read `enabled` from frontmatter** in `loader.ts` `parseCommandFile`:
   ```typescript
   enabled: data.enabled !== false,  // default true if missing
   ```

3. **Persist `enabled` in `service.ts` `updateCommand`**:
   ```typescript
   const enabled = input.enabled ?? existing.enabled ?? true
   const frontmatter: CommandFrontmatter = { description, enabled }
   if (model) frontmatter.model = model
   ```

4. **Return actual `enabled` value** from all service functions instead of hardcoded `true`.

---

## Summary of All Files Involved

| # | File | Lines | Role |
|---|------|-------|------|
| 1 | `packages/browseros-agent/apps/server/src/api/utils/cors.ts` | 40 | **Bug #1: missing PUT in allowMethods** |
| 2 | `packages/browseros-agent/apps/server/src/commands/types.ts` | 6-12 | **Bug #2: CommandFrontmatter missing `enabled`** |
| 3 | `packages/browseros-agent/apps/server/src/commands/service.ts` | 170-203 | **Bug #2: updateCommand ignores `enabled`, hardcodes `true`** |
| 4 | `packages/browseros-agent/apps/server/src/commands/loader.ts` | 58 | **Bug #2: parseCommandFile hardcodes `enabled: true`** |
| 5 | `packages/browseros-agent/apps/server/src/commands/service.ts` | 101, 121, 164 | Also hardcode `enabled: true` |
| 6 | `packages/browseros-agent/apps/server/src/api/routes/commands.ts` | 1-85 | Route definitions — correct (PUT exists) |
| 7 | `packages/browseros-agent/apps/server/src/api/server.ts` | 294 | Route registration at `/commands` — correct |
| 8 | `packages/browseros-agent/apps/agent/entrypoints/app/command-settings/command-queries.ts` | 1-127 | Extension-side API client — correct |
| 9 | `packages/browseros-agent/apps/agent/entrypoints/app/command-settings/CommandSettingsPage.tsx` | 71-73 | UI toggle handler — correct |

---

## Route Registration — Verified Working

The route is properly registered at `server.ts:294`:
```typescript
.route('/commands', createCommandsRoutes())
```

No auth middleware is applied to the commands route (unlike `/config` which has `requireTrustedAppOrigin()`). The global CORS middleware applies to all routes including `/commands`.

---

## Root Cause Priority

1. **Bug #1 (CORS)** is the immediate blocker. Fix it first — one line change in `cors.ts`.
2. **Bug #2 (enabled persistence)** is a data integrity issue. The toggle will appear to work after Bug #1 is fixed (no CORS error), but the state won't persist across server restarts and will snap back to `true` on the next `listCommands` call.
