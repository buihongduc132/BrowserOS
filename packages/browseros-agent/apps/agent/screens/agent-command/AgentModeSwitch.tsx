import type { FC } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAgentSessionModes } from './useAgentSessionModes'

interface AgentModeSwitchProps {
  agentId: string
  sessionId: string
}

/**
 * Compact mode toggle (Code | Ask | Agent) that renders ONLY when
 * the agent adapter supports session modes.
 *
 * Self-hides when `isSupported` is false — safe to wire into any
 * header or toolbar without conditional rendering at the call site.
 */
export const AgentModeSwitch: FC<AgentModeSwitchProps> = ({
  agentId,
  sessionId,
}) => {
  const { modes, currentMode, setMode, isSupported } = useAgentSessionModes(
    agentId,
    sessionId,
  )

  if (!isSupported || modes.length === 0) return null

  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-lg border bg-muted/50 p-0.5"
      role="group"
      aria-label="Session mode"
    >
      {modes.map((mode) => {
        const active = mode.id === currentMode
        return (
          <Button
            key={mode.id}
            variant="ghost"
            size="sm"
            onClick={() => setMode(mode.id)}
            aria-pressed={active}
            className={cn(
              'h-6 rounded-md px-2.5 font-medium text-[11px]',
              active && 'bg-background text-foreground shadow-sm',
              !active && 'text-muted-foreground hover:text-foreground',
            )}
            title={mode.description ?? mode.name}
          >
            {mode.name}
          </Button>
        )
      })}
    </div>
  )
}
