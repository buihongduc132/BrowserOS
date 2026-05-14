# Code Context

## Files Retrieved
1. `packages/browseros-agent/apps/server/src/api/routes/mcp.ts` (full, 101 lines) — MCP route with GET (SSE+health) and POST handlers
2. `packages/browseros-agent/apps/server/tests/api/routes/health.test.ts` (full, 17 lines) — simplest route test pattern
3. `packages/browseros-agent/apps/server/tests/api/routes/commands.test.ts` (full, 170 lines) — route test with temp dir setup, Hono app.request pattern
4. `packages/browseros-agent/apps/server/tests/api/routes/agents.test.ts` (lines 1-50) — route test with dependency injection
5. `packages/browseros-agent/apps/server/src/api/types.ts` (full) — Env type definition
6. `packages/browseros-agent/apps/server/src/api/services/mcp/mcp-server.ts` (lines 1-40) — McpServiceDeps interface
7. `packages/browseros-agent/apps/server/src/api/services/acl/resolve-acl-policy.ts` (full) — simple delegation to policyService.getEnabledRules()
8. `packages/browseros-agent/apps/server/tests/__helpers__/test-env.ts` (full) — shared test env setup

## Key Code

### McpRouteDeps (required mock shape)
```typescript
interface McpRouteDeps {
  version: string              // e.g. 'test'
  registry: ToolRegistry       // new ToolRegistry([])
  browser: Browser             // needs complex mock — see below
  executionDir: string         // temp dir
  resourcesDir: string         // temp dir
  policyService: GlobalAclPolicyService  // needs mock with getEnabledRules()
  klavisRef?: KlavisProxyRef   // optional, omit
}
```

### McpServiceDeps (what createMcpServer actually uses)
```typescript
interface McpServiceDeps {
  version: string
  registry: ToolRegistry
  browser: Browser
  executionDir: string
  resourcesDir: string
  aclRules?: AclRule[]
  klavisRef?: KlavisProxyRef
  observer?: ToolExecutionObserver
}
```

### resolveAclPolicyForMcpRequest
Simply calls `policyService.getEnabledRules()` — returns `AclRule[]`.

## Architecture

### Test patterns
1. **Simple routes** (health.test.ts): Call `route.request('/')` directly on the return of `createXxxRoute()`. No setup.
2. **Routes with deps** (commands.test.ts): Wrap in `new Hono<Env>().route('/path', createXxxRoutes())`. Use `beforeEach`/`afterEach` with temp dirs + `process.env.BROWSEROS_DIR`.
3. **All tests** use `bun:test` imports (`describe`, `it`, `test`, `expect`, `beforeEach`, `afterEach`).
4. **Hono app.request()** pattern: `app.request('http://localhost/path', { method, headers, body })`.

### Testable surface for MCP spec compliance
The GET handler branches on `Accept` header:
- `Accept: text/event-stream` → creates MCP server + StreamableHTTPTransport → `transport.handleRequest(c)` → SSE response
- Other Accept → JSON `{"status":"ok","message":"..."}`

The POST handler creates MCP server + transport per request.

### Minimal mocks needed

**For GET health check test** (no SSE):
- No deps needed if we only test the JSON branch (Accept NOT text/event-stream)
- The GET handler checks Accept header BEFORE touching any deps

**For GET SSE test**:
- Need: `version`, `registry` (ToolRegistry with empty array), `browser` (mock), `executionDir`, `resourcesDir`, `policyService` (mock with `getEnabledRules`)
- `Browser` class is complex (109+ lines, imports CDP backends). Must mock as object: `{}` cast or `as unknown as Browser`
- `GlobalAclPolicyService` needs `getEnabledRules(): Promise<AclRule[]>` → mock returning `[]`

**For POST test**:
- Same deps as GET SSE
- POST handler also calls `getMonitoringService()` singleton — may need module mock or it works without setup

### Critical observation for test strategy
The GET health check path (non-SSE) requires ZERO deps. This makes the spec-compliance regression test trivially simple:
```
GET / without Accept: text/event-stream → 200 JSON ✅
GET / with Accept: text/event-stream → needs full mock → 200 SSE ✅
```

## Start Here
Open `packages/browseros-agent/apps/server/tests/api/routes/mcp.test.ts` — this is where the new test file should be created. Follow the `health.test.ts` pattern for the simple GET test, and the `commands.test.ts` pattern for the full-mock GET SSE + POST tests.
