import { type FC, useMemo } from 'react'
import { useNavigate } from 'react-router'
import type {
  HarnessAdapterDescriptor,
  HarnessAgent,
  HarnessAgentAdapter,
} from '@/entrypoints/app/agents/agent-harness-types'
import type { AgentAdapterHealth } from '@/entrypoints/app/agents/agent-row/agent-row.types'
import { orderAgentsByPinThenRecency } from '@/entrypoints/app/agents/agents-list-order'
import { Separator } from '@/components/ui/separator'
import { AgentSessionList } from './AgentSessionList'
import { AgentRailRow } from './AgentRailRow'
import { useAgentSessionList } from './useAgentSessionList'

interface AgentRailProps {
  agents: HarnessAgent[]
  adapters: HarnessAdapterDescriptor[]
  activeAgentId: string
  activeSessionId?: string
  onSelectAgent: (agent: HarnessAgent) => void
  onPinToggle: (agent: HarnessAgent, next: boolean) => void
}

/**
 * Left-column scrollable list of agents. The "Agents" label + back
 * button live in the shared top band above (so the rail header and
 * the chat header sit on a single aligned strip rather than as two
 * separately-sized headers per column). Sort matches `/agents`:
 * pinned-first → recency, so the rail doesn't reshuffle as turns
 * transition every 5 s.
 */
export const AgentRail: FC<AgentRailProps> = ({
  agents,
  adapters,
  activeAgentId,
  activeSessionId,
  onSelectAgent,
  onPinToggle,
}) => {
  const navigate = useNavigate()
  const sessionList = useAgentSessionList(activeAgentId)
  const adapterHealth = useMemo(() => {
    const map = new Map<HarnessAgentAdapter, AgentAdapterHealth>()
    for (const adapter of adapters) {
      if (adapter.health) {
        map.set(adapter.id, {
          healthy: adapter.health.healthy,
          reason: adapter.health.reason,
        })
      }
    }
    return map
  }, [adapters])

  const ordered = useMemo(() => orderAgentsByPinThenRecency(agents), [agents])

  const handleSessionSelect = (sessionId: string) => {
    if (sessionId === 'main') {
      navigate(`/home/agents/${activeAgentId}`)
    } else {
      navigate(`/home/agents/${activeAgentId}/s/${sessionId}`)
    }
  }

  const handleNewSession = () => {
    const newId = sessionList.createSession()
    navigate(`/home/agents/${activeAgentId}/s/${newId}`)
  }

  return (
    <aside className="hidden min-h-0 flex-col border-border/50 border-r bg-background/70 lg:flex">
      <div className="styled-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="space-y-1.5">
          {ordered.map((agent) => (
            <AgentRailRow
              key={agent.id}
              agent={agent}
              active={agent.id === activeAgentId}
              adapterHealth={adapterHealth.get(agent.adapter) ?? null}
              onSelect={() => onSelectAgent(agent)}
              onPinToggle={(next) => onPinToggle(agent, next)}
            />
          ))}
        </div>

        {/* Session list — only shown when an agent is active */}
        {activeAgentId ? (
          <>
            <Separator className="my-3" />
            <AgentSessionList
              agentId={activeAgentId}
              activeSessionId={activeSessionId ?? 'main'}
              sessions={sessionList.sessions}
              filteredSessions={sessionList.filteredSessions}
              search={sessionList.search}
              setSearch={sessionList.setSearch}
              onSessionSelect={handleSessionSelect}
              onNewSession={handleNewSession}
            />
          </>
        ) : null}
      </div>
    </aside>
  )
}
