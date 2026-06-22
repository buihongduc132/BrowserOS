import { Calendar, Folder, Tag } from 'lucide-react'
import { type FC, useCallback } from 'react'
import { cn } from '@/lib/utils'
import type { GroupingMode } from '../useSessionGrouping'

interface GroupingToggleProps {
  mode: GroupingMode
  onModeChange: (mode: GroupingMode) => void
  /** Whether any conversations have workspaces — hides workspace option if not */
  hasWorkspaces?: boolean
}

const OPTIONS: Array<{
  mode: GroupingMode
  label: string
  icon: typeof Folder
  requiresWorkspaces?: boolean
}> = [
  {
    mode: 'workspace',
    label: 'Workspace',
    icon: Folder,
    requiresWorkspaces: true,
  },
  { mode: 'tag', label: 'Tags', icon: Tag },
  { mode: 'date', label: 'Date', icon: Calendar },
]

export const GroupingToggle: FC<GroupingToggleProps> = ({
  mode,
  onModeChange,
  hasWorkspaces = false,
}) => {
  const handleClick = useCallback(
    (newMode: GroupingMode) => {
      onModeChange(newMode)
    },
    [onModeChange],
  )

  const visibleOptions = OPTIONS.filter(
    (opt) => !opt.requiresWorkspaces || hasWorkspaces,
  )

  // Don't render if only one option (date only)
  if (visibleOptions.length <= 1) return null

  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-0.5">
      {visibleOptions.map(({ mode: optMode, label, icon: Icon }) => (
        <button
          key={optMode}
          type="button"
          onClick={() => handleClick(optMode)}
          className={cn(
            'flex items-center gap-1 rounded-md px-2 py-1 font-medium text-xs transition-colors',
            mode === optMode
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
          title={`Group by ${label.toLowerCase()}`}
        >
          <Icon className="h-3 w-3" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}
