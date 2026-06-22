# Commands CRUD Investigation — Progress

## Status: COMPLETE

### Two Critical Bugs Found

**Bug #1 (BLOCKER):** CORS config in `packages/browseros-agent/apps/server/src/api/utils/cors.ts:40` is missing `PUT` from `allowMethods`. All command update/toggle/modify operations use `PUT /commands/:id`, which is blocked by CORS preflight.

**Bug #2 (DATA LOSS):** `enabled` field is never persisted to disk. `CommandFrontmatter` type doesn't include it, `updateCommand()` ignores it, `parseCommandFile()` hardcodes `enabled: true`. Enable/disable toggle appears to work but snaps back.

### Files to Change
1. `packages/browseros-agent/apps/server/src/api/utils/cors.ts` — add `PUT` and `PATCH` to `allowMethods`
2. `packages/browseros-agent/apps/server/src/commands/types.ts` — add `enabled` to `CommandFrontmatter`
3. `packages/browseros-agent/apps/server/src/commands/loader.ts` — read `enabled` from frontmatter
4. `packages/browseros-agent/apps/server/src/commands/service.ts` — persist `enabled` in all write operations

### Full Report
See: `commands-investigation.md`
