# AgentsPage Crash Investigation

## Verdict: Bug is FIXED in current code

The reported crash (`customCommand.trim()` on `undefined`) does **NOT** reproduce in the current codebase. All paths are guarded.

---

## 1. AgentsPage.tsx → NewAgentDialog Props

**File:** `packages/browseros-agent/apps/agent/entrypoints/app/agents/AgentsPage.tsx`

`customCommand` IS passed (line ~263):
```tsx
<NewAgentDialog
  customCommand={customCommand}   // ← PASSED (from useState(''))
  customArgs={customArgs}
  customLabel={customLabel}
  customProbeResult={customProbeResult}
  customProbeLoading={customProbeLoading}
  onCustomCommandChange={setCustomCommand}
  onCustomArgsChange={setCustomArgs}
  onCustomLabelChange={setCustomLabel}
  onProbeCustom={handleProbeCustom}
  onImportAcpx={handleImportAcpx}
  ...
/>
```

`customCommand` is initialized as empty string (line ~65):
```tsx
const [customCommand, setCustomCommand] = useState('')
```

## 2. NewAgentDialog.tsx — Prop Types & Defaults

**File:** `packages/browseros-agent/apps/agent/entrypoints/app/agents/NewAgentDialog.tsx`

The interface declares `customCommand` as **optional** but the destructured default is `''`:
```tsx
interface NewAgentDialogProps {
  customCommand?: string   // optional in interface
  ...
}

// Destructured with default '' — safe even if parent omits it:
({
  customCommand = '',       // ← default guards against undefined
  customArgs = '',
  customLabel = '',
  ...
})
```

All `.trim()` calls in NewAgentDialog are safe:
- **Line ~152:** `const customBlocked = isCustomRuntime && !customCommand.trim()` — `customCommand` defaults to `''`
- **Line ~160:** `canCreate` → `customCommand.trim().length > 0` — same guard
- **Line ~246:** `<Button disabled={... || !customCommand.trim()}>` — same guard

## 3. agent-api-url.ts — URL Construction

**File:** `packages/browseros-agent/apps/agent/entrypoints/app/agents/agent-api-url.ts`

```tsx
export function buildAgentApiUrl(baseUrl: string, path: string): string {
  const normalizedPath = path === '/' ? '' : path
  return `${baseUrl}/agents${normalizedPath}`
}
```

Simple path builder: `{baseUrl}/agents{path}`. E.g., `http://127.0.0.1:9200/agents/` or `http://127.0.0.1:9200/agents/probe-custom`.

**Base URL resolution** (`apps/agent/lib/browseros/helpers.ts`):
1. If `VITE_BROWSEROS_SERVER_PORT` is set → `http://127.0.0.1:{port}`
2. If app supports `UNIFIED_PORT_SUPPORT` → uses MCP port from BrowserOS prefs
3. Fallback → uses agent port from BrowserOS prefs (`BROWSEROS_PREFS.AGENT_PORT`)
4. If none found → throws `AgentPortError`

## 4. agents-page-actions.ts — API Calls

**File:** `packages/browseros-agent/apps/agent/entrypoints/app/agents/agents-page-actions.ts`

The `AgentPageActionInput` interface types custom fields as **optional**:
```tsx
export interface AgentPageActionInput {
  customArgs?: string
  customCommand?: string
  customLabel?: string
  ...
}
```

In `handleHarnessCreate`, nullish coalescing protects against `undefined`:
```tsx
customCommand: isCustom ? (input.customCommand ?? '').trim() : undefined,
customArgs: isCustom
  ? (input.customArgs ?? '')
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean)
  : undefined,
customLabel: isCustom ? (input.customLabel ?? '').trim() || undefined : undefined,
```

API calls made by `createAgentPageActions`:
| Handler | Action | API Path |
|---------|--------|----------|
| `handleSetup` | Setup OpenClaw gateway | Via `setupOpenClaw()` mutation |
| `handleOpenClawCreate` | Create OpenClaw agent | Via `createOpenClawAgent()` mutation |
| `handleHarnessCreate` | Create harness/custom/hermes agent | `POST /agents` via `createHarnessAgent()` |
| `handleDelete` | Delete agent | `DELETE /agents/{id}` or OpenClaw delete |

## 5. GatewayStatusBar.tsx — Status Fetching

**File:** `packages/browseros-agent/apps/agent/entrypoints/app/agents/GatewayStatusBar.tsx`

GatewayStatusBar does **NOT** fetch data itself — it receives `status` as a prop:
```tsx
interface GatewayStatusBarProps {
  status: OpenClawStatus | null   // passed from parent
  actionInProgress: boolean
  onOpenTerminal: () => void
  onRestart: () => void
}
```

The actual fetch happens in **`useHarnessAgents`** (`useAgents.ts`, line 83):
```tsx
export function useHarnessAgents(enabled = true) {
  const query = useQuery<HarnessAgentsResponse, Error>({
    queryKey: [AGENT_QUERY_KEYS.agents, baseUrl],
    queryFn: async () => {
      const data = await agentsFetch<HarnessAgentsResponse>(baseUrl, '/')
      return {
        agents: data.agents ?? [],
        gateway: data.gateway ?? null,   // ← gateway status comes from GET /agents
      }
    },
    refetchInterval: 5_000,   // polls every 5s
  })

  return {
    harnessAgents: query.data?.agents ?? [],
    gateway: query.data?.gateway ?? null,   // ← this is what AgentsPage passes to GatewayStatusBar
    ...
  }
}
```

Gateway status comes from `GET /agents` (the `gateway` field in the response), polled every 5 seconds. No separate `/claw/status` poll from the agents page.

---

## Root Cause Analysis

The reported bug (`customCommand.trim()` crash on `undefined`) has been **fixed** by a triple defense:

1. **AgentsPage** initializes `customCommand` as `useState('')` and passes it to NewAgentDialog
2. **NewAgentDialog** destructures with `customCommand = ''` default
3. **agents-page-actions** uses `(input.customCommand ?? '').trim()` nullish coalescing

If the crash still occurs, it would be from a **different call site** not covered by this investigation, or from a stale build that hasn't picked up the defaults.

## Files Retrieved

1. `packages/browseros-agent/apps/agent/entrypoints/app/agents/AgentsPage.tsx` — Main page, passes customCommand=''
2. `packages/browseros-agent/apps/agent/entrypoints/app/agents/NewAgentDialog.tsx` — Dialog with defaults guarding .trim()
3. `packages/browseros-agent/apps/agent/entrypoints/app/agents/agent-api-url.ts` — Simple URL builder
4. `packages/browseros-agent/apps/agent/entrypoints/app/agents/agents-page-actions.ts` — Create/delete handlers with ?? guards
5. `packages/browseros-agent/apps/agent/entrypoints/app/agents/GatewayStatusBar.tsx` — Display-only, receives status as prop
6. `packages/browseros-agent/apps/agent/entrypoints/app/agents/useAgents.ts` (lines 1-150) — useHarnessAgents fetches GET /agents with gateway field
7. `packages/browseros-agent/apps/agent/lib/browseros/helpers.ts` — getAgentServerUrl port resolution

## Start Here

Open `packages/browseros-agent/apps/agent/entrypoints/app/agents/NewAgentDialog.tsx` — the `.trim()` crash site. All three guard layers are visible there.
