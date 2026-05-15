import { type FC } from 'react'
import { WorkspaceBubble } from './WorkspaceBubble'

export interface WorkspaceBubbleGroupProps {
  workspaces: Array<{ id: string; name: string; path: string }>
  size?: 'sm' | 'md'
  onWorkspaceClick?: (workspaceId: string) => void
  maxVisible?: number
}

export const WorkspaceBubbleGroup: FC<WorkspaceBubbleGroupProps> = ({
  workspaces,
  size = 'sm',
  onWorkspaceClick,
  maxVisible = 3,
}) => {
  if (workspaces.length === 0) {
    return (
      <span className="inline-flex items-center text-muted-foreground" title="No workspace">
        🌐
      </span>
    )
  }

  const visible = workspaces.slice(0, maxVisible)
  const overflow = workspaces.length - maxVisible

  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {visible.map((ws) => (
        <WorkspaceBubble
          key={ws.id}
          name={ws.name}
          path={ws.path}
          size={size}
          onClick={onWorkspaceClick ? () => onWorkspaceClick(ws.id) : undefined}
        />
      ))}
      {overflow > 0 && (
        <span className="inline-flex items-center text-xs text-muted-foreground font-medium">
          +{overflow}
        </span>
      )}
    </span>
  )
}
