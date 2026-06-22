import { Loader2 } from 'lucide-react'
import { type FC, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { useLlmProviders } from '@/lib/llm-providers/useLlmProviders'
import { AgentList } from './AgentList'
import { AgentsHeader } from './AgentsHeader'
import { buildAgentApiUrl } from './agent-api-url'
import type { HarnessAgent, HarnessAgentAdapter } from './agent-harness-types'
import { createAgentPageActions } from './agents-page-actions'
import {
  useDefaultAgentName,
  useHarnessAgentDefaults,
  useHermesProviderSelection,
} from './agents-page-hooks'
import {
  type CreateAgentRuntime,
  DEFAULT_CREATE_RUNTIME,
  DEFAULT_HARNESS_ADAPTER,
} from './agents-page-types'
import {
  getAgentsLoading,
  getInlineError,
  toHarnessListItem,
} from './agents-page-utils'
import { NewAgentDialog } from './NewAgentDialog'
import { InlineErrorAlert } from './PageAlerts'
import {
  useAgentAdapters,
  useCreateHarnessAgent,
  useDeleteHarnessAgent,
  useHarnessAgents,
  useUpdateHarnessAgent,
} from './useAgents'

export const AgentsPage: FC = () => {
  const navigate = useNavigate()
  const { providers, defaultProviderId } = useLlmProviders()
  const {
    adapters,
    loading: adaptersLoading,
    error: adaptersError,
  } = useAgentAdapters()
  const {
    harnessAgents,
    loading: harnessAgentsLoading,
    error: harnessAgentsError,
    refetch: refetchHarnessAgents,
  } = useHarnessAgents()
  const createHarnessAgent = useCreateHarnessAgent()
  const deleteHarnessAgent = useDeleteHarnessAgent()
  const updateHarnessAgent = useUpdateHarnessAgent()

  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [createRuntime, setCreateRuntime] = useState<CreateAgentRuntime>(
    DEFAULT_CREATE_RUNTIME,
  )
  const [harnessAdapterId, setHarnessAdapterId] = useState<HarnessAgentAdapter>(
    DEFAULT_HARNESS_ADAPTER,
  )
  const [harnessModelId, setHarnessModelId] = useState('')
  const [harnessReasoningEffort, setHarnessReasoningEffort] = useState('')
  const [createHermesProviderId, setCreateHermesProviderId] = useState('')
  const [customCommand, setCustomCommand] = useState('')
  const [customArgs, setCustomArgs] = useState('')
  const [customLabel, setCustomLabel] = useState('')
  const [customProbeResult, setCustomProbeResult] = useState<{
    healthy: boolean
    error?: string
  } | null>(null)
  const [customProbeLoading, setCustomProbeLoading] = useState(false)
  const [_showTerminal, _setShowTerminal] = useState(false)
  const [_cliAuthModalOpen, setCliAuthModalOpen] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [deletingAgentKey, setDeletingAgentKey] = useState<string | null>(null)

  const { selectableHermesProviders } = useHermesProviderSelection({
    providers,
    defaultProviderId,
    createOpen,
    createRuntime,
    createHermesProviderId,
    setCreateHermesProviderId,
  })
  useDefaultAgentName(createOpen, setNewName)
  useHarnessAgentDefaults({
    adapters,
    createOpen,
    harnessAdapterId,
    setHarnessAdapterId,
    setHarnessModelId,
    setHarnessReasoningEffort,
  })

  const agentListItems = useMemo(
    () => harnessAgents.map(toHarnessListItem),
    [harnessAgents],
  )
  const harnessAgentLookup = useMemo(() => {
    const map = new Map<string, HarnessAgent>()
    for (const agent of harnessAgents) map.set(agent.id, agent)
    return map
  }, [harnessAgents])
  const agentActivity = useMemo(() => {
    const map: Record<
      string,
      {
        status: 'working' | 'idle' | 'asleep' | 'error'
        lastUsedAt: number | null
      }
    > = {}
    for (const agent of harnessAgents) {
      if (!agent.status) continue
      map[agent.id] = {
        status: agent.status,
        lastUsedAt: agent.lastUsedAt ?? null,
      }
    }
    return map
  }, [harnessAgents])
  const inlineError = getInlineError({
    pageError,
    adaptersError,
    harnessAgentsError,
  })
  const agentsLoading = getAgentsLoading({
    adaptersLoading,
    harnessAgentsLoading,
  })
  const creatingAgent = createHarnessAgent.isPending
  const deletingAgent = deleteHarnessAgent.isPending

  const handleProbeCustom = async () => {
    if (!customCommand.trim()) return
    setCustomProbeLoading(true)
    setCustomProbeResult(null)
    try {
      const baseUrl = await getAgentServerUrl()
      const response = await fetch(buildAgentApiUrl(baseUrl, '/probe-custom'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: customCommand.trim(),
          args: customArgs
            .split(/\s+/)
            .map((value) => value.trim())
            .filter(Boolean),
        }),
      })
      const result = (await response.json()) as {
        healthy?: boolean
        error?: string
      }
      setCustomProbeResult({
        healthy: Boolean(result.healthy),
        ...(result.error ? { error: result.error } : {}),
      })
    } catch (err) {
      setCustomProbeResult({
        healthy: false,
        error: err instanceof Error ? err.message : 'Probe failed',
      })
    } finally {
      setCustomProbeLoading(false)
    }
  }

  const handleImportAcpx = async () => {
    try {
      const baseUrl = await getAgentServerUrl()
      const response = await fetch(buildAgentApiUrl(baseUrl, '/import-acpx'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const result = (await response.json()) as {
        results?: Array<{ imported?: boolean; reason?: string }>
        error?: string
      }
      if (!response.ok || result.error) {
        setCreateError(result.error ?? 'Failed to import ACPX agents')
        return
      }
      const importedCount =
        result.results?.filter((entry) => entry.imported).length ?? 0
      if (importedCount === 0) {
        setCreateError(
          result.results?.[0]?.reason ?? 'No ACPX agents available to import',
        )
        return
      }
      setCreateError(null)
      setCreateOpen(false)
      await refetchHarnessAgents()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleHarnessAdapterChange = (adapter: HarnessAgentAdapter) => {
    const descriptor = adapters.find((entry) => entry.id === adapter)
    setHarnessAdapterId(adapter)
    setHarnessModelId(descriptor?.defaultModelId ?? '')
    setHarnessReasoningEffort(descriptor?.defaultReasoningEffort ?? '')
  }

  const { handleCreate, handleDelete } = createAgentPageActions({
    createProviderId,
    createRuntime,
    createHermesProviderId,
    customArgs,
    customCommand,
    customLabel,
    harnessModelId,
    harnessReasoningEffort,
    navigate,
    newName,
    selectableOpenClawProviders,
    selectableHermesProviders,
    setupProviderId,
    createHarnessAgent: createHarnessAgent.mutateAsync,
    createOpenClawAgent,
    deleteHarnessAgent: deleteHarnessAgent.mutateAsync,
    deleteOpenClawAgent,
    setCliAuthModalOpen,
    setCreateError,
    setCreateOpen,
    setDeletingAgentKey,
    setNewName,
    setPageError,
    setSetupOpen,
    setupOpenClaw,
  })

  if (harnessAgentsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="min-h-full bg-background px-6 py-8">
      <div className="fade-in slide-in-from-bottom-5 mx-auto flex w-full max-w-5xl animate-in flex-col gap-6 duration-500">
        <AgentsHeader onCreateAgent={() => setCreateOpen(true)} />

        {inlineError ? (
          <InlineErrorAlert
            message={inlineError}
            onDismiss={() => setPageError(null)}
          />
        ) : null}

        <AgentList
          agents={agentListItems}
          activity={agentActivity}
          harnessAgentLookup={harnessAgentLookup}
          adapters={adapters}
          loading={agentsLoading}
          deletingAgentKey={deletingAgent ? deletingAgentKey : null}
          onCreateAgent={() => setCreateOpen(true)}
          onDeleteAgent={(agent) => {
            void handleDelete(agent)
          }}
          onPinToggle={(agent, next) => {
            if (!harnessAgentLookup.has(agent.agentId)) return
            updateHarnessAgent.mutate({
              agentId: agent.agentId,
              patch: { pinned: next },
            })
          }}
        />

        <NewAgentDialog
          adapters={adapters}
          createError={createError}
          createRuntime={createRuntime}
          creating={creatingAgent}
          defaultProviderId={defaultProviderId}
          harnessAdapterId={harnessAdapterId}
          harnessModelId={harnessModelId}
          harnessReasoningEffort={harnessReasoningEffort}
          hermesProviders={selectableHermesProviders}
          hermesSelectedProviderId={createHermesProviderId}
          name={newName}
          open={createOpen}
          providers={selectableOpenClawProviders}
          selectedCliProvider={selectedCliProvider}
          selectedProviderId={createProviderId}
          cliAuthError={cliAuthError ?? null}
          cliAuthLoading={cliAuthLoading}
          cliAuthStatus={cliAuthStatus}
          customCommand={customCommand}
          customArgs={customArgs}
          customLabel={customLabel}
          customProbeResult={customProbeResult}
          customProbeLoading={customProbeLoading}
          onConnectCliProvider={() => setCliAuthModalOpen(true)}
          onCreate={handleCreate}
          onOpenChange={(open) => {
            setCreateOpen(open)
            if (!open) {
              setCreateError(null)
              createHarnessAgent.reset()
              setCreateHermesProviderId('')
              setCustomCommand('')
              setCustomArgs('')
              setCustomLabel('')
              setCustomProbeResult(null)
              setCustomProbeLoading(false)
            }
          }}
          onRuntimeChange={setCreateRuntime}
          onHarnessAdapterChange={handleHarnessAdapterChange}
          onHarnessModelChange={setHarnessModelId}
          onHarnessReasoningChange={setHarnessReasoningEffort}
          onHermesProviderChange={setCreateHermesProviderId}
          onNameChange={setNewName}
          onProviderChange={setCreateProviderId}
          onCustomCommandChange={setCustomCommand}
          onCustomArgsChange={setCustomArgs}
          onCustomLabelChange={setCustomLabel}
          onProbeCustom={handleProbeCustom}
          onImportAcpx={handleImportAcpx}
        />
      </div>
    </div>
  )
}
