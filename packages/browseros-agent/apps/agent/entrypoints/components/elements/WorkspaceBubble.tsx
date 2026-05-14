import { type FC, useMemo } from 'react'
import { colorFromPath } from '../../sidepanel/history/components/workspace-bubble-colors'

export interface WorkspaceBubbleProps {
  name: string
  path: string
  color?: string
  size?: 'sm' | 'md'
  onClick?: () => void
}

export const WorkspaceBubble: FC<WorkspaceBubbleProps> = ({
  name,
  path,
  color,
  size = 'sm',
  onClick,
}) => {
  const resolvedColor = color ?? colorFromPath(path)

  const sizeClass = size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-sm px-2 py-1'

  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${sizeClass} cursor-default select-none`}
      style={{
        backgroundColor: `${resolvedColor}20`,
        color: resolvedColor,
        border: `1px solid ${resolvedColor}40`,
      }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter') onClick() } : undefined}
    >
      {name}
    </span>
  )
}
