import { Plus } from 'lucide-react'
import type { FC } from 'react'
import { Button } from '@/components/ui/button'

export interface NewAgentSessionButtonProps {
  onClick: () => void
  label?: string
}

/**
 * "New Chat" button for creating a fresh agent session.
 * Used in the session list header area.
 */
export const NewAgentSessionButton: FC<NewAgentSessionButtonProps> = ({
  onClick,
  label = 'New Chat',
}) => {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="h-7 gap-1.5 rounded-lg px-2 text-[12px]"
    >
      <Plus className="size-3.5" />
      <span>{label}</span>
    </Button>
  )
}
