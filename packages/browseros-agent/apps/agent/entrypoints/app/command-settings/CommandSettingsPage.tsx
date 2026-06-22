import { AlertCircle, Eye, Pencil, Plus, Terminal, Trash2 } from 'lucide-react'
import { type FC, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { CommandDialog } from './CommandDialog'
import {
  type CommandDetail,
  type CommandMeta,
  useCommands,
} from './command-queries'

const loadingCommandCards = [
  'loading-a',
  'loading-b',
  'loading-c',
  'loading-d',
  'loading-e',
  'loading-f',
]

export const CommandSettingsPage: FC = () => {
  const {
    commands,
    isLoading,
    error,
    refetch,
    createCommand,
    updateCommand,
    deleteCommand,
    fetchCommandDetail,
  } = useCommands()

  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingCommand, setEditingCommand] = useState<CommandDetail | null>(
    null,
  )
  const [commandToDelete, setCommandToDelete] = useState<CommandMeta | null>(
    null,
  )

  const enabledCount = commands.filter((cmd) => cmd.enabled).length

  const handleCreate = () => {
    setEditingCommand(null)
    setIsDialogOpen(true)
  }

  const handleEdit = async (cmd: CommandMeta) => {
    try {
      const detail = await fetchCommandDetail(cmd.id)
      setEditingCommand(detail)
      setIsDialogOpen(true)
    } catch {
      toast.error('Failed to load command details')
    }
  }

  const handleToggle = async (cmd: CommandMeta, enabled: boolean) => {
    try {
      await updateCommand(cmd.id, { enabled })
    } catch {
      toast.error('Failed to toggle command')
    }
  }

  const handleDelete = async () => {
    if (!commandToDelete) return
    try {
      await deleteCommand(commandToDelete.id)
      toast.success(`Deleted "/${commandToDelete.id}"`)
    } catch {
      toast.error('Failed to delete command')
    }
    setCommandToDelete(null)
  }

  return (
    <div className="fade-in slide-in-from-bottom-5 animate-in space-y-6 duration-500">
      <CommandsHeader
        commandCount={commands.length}
        enabledCount={enabledCount}
        onCreateClick={handleCreate}
      />

      {isLoading ? <CommandsLoadingState /> : null}

      {!isLoading && error ? (
        <CommandsErrorState onRetry={() => void refetch()} />
      ) : null}

      {!isLoading && !error && commands.length === 0 ? (
        <EmptyCommandsState onCreateClick={handleCreate} />
      ) : null}

      {!isLoading && !error && commands.length > 0 ? (
        <CommandSections
          commands={commands}
          onEdit={handleEdit}
          onDelete={(cmd) => setCommandToDelete(cmd)}
          onToggle={handleToggle}
        />
      ) : null}

      <CommandDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        editingCommand={editingCommand}
        readOnly={editingCommand?.builtIn}
        onSave={async (data) => {
          try {
            if (editingCommand) {
              await updateCommand(editingCommand.id, data)
              toast.success('Command updated')
            } else {
              await createCommand(data)
              toast.success('Command created')
            }
            setIsDialogOpen(false)
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to save')
          }
        }}
      />

      <AlertDialog
        open={!!commandToDelete}
        onOpenChange={(open) => !open && setCommandToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Command</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;/{commandToDelete?.id}
              &quot;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

const CommandsHeader: FC<{
  commandCount: number
  enabledCount: number
  onCreateClick: () => void
}> = ({ commandCount, enabledCount, onCreateClick }) => {
  const cmdLabel = `${commandCount} command${commandCount === 1 ? '' : 's'}`
  const enabledLabel = `${enabledCount} enabled`

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">Commands</h1>
        <p className="text-muted-foreground text-sm">
          Slash commands you can type in chat with / to invoke.
        </p>
        <p className="mt-1 text-muted-foreground text-xs">
          {cmdLabel} &bull; {enabledLabel}
        </p>
      </div>
      <Button onClick={onCreateClick} size="sm" className="shrink-0">
        <Plus className="mr-1.5 size-4" />
        New Command
      </Button>
    </div>
  )
}

const CommandsLoadingState: FC = () => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
    {loadingCommandCards.map((cardKey) => (
      <Card key={cardKey} className="h-full py-0">
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="size-10 animate-pulse rounded-xl bg-muted" />
            <div className="h-6 w-11 animate-pulse rounded-full bg-muted" />
          </div>
          <div className="space-y-2">
            <div className="h-4 w-28 animate-pulse rounded bg-muted" />
            <div className="h-4 w-full animate-pulse rounded bg-muted" />
            <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-8 w-16 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    ))}
  </div>
)

const CommandsErrorState: FC<{ onRetry: () => void }> = ({ onRetry }) => (
  <Card className="border-destructive/20 bg-destructive/5 py-0">
    <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
          <AlertCircle className="size-4" />
        </div>
        <div className="space-y-1">
          <h2 className="font-semibold">Couldn&apos;t load commands</h2>
          <p className="text-destructive/80 text-sm">
            Check that the local agent services are running, then retry.
          </p>
        </div>
      </div>
      <Button variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </CardContent>
  </Card>
)

const EmptyCommandsState: FC<{ onCreateClick: () => void }> = ({
  onCreateClick,
}) => (
  <Card className="border-dashed py-0">
    <CardContent className="flex flex-col items-center justify-center py-14 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-[var(--accent-orange)]/10 text-[var(--accent-orange)]">
        <Terminal className="size-5" />
      </div>
      <h3 className="mb-1 font-medium text-lg">No commands yet</h3>
      <p className="mb-5 max-w-sm text-muted-foreground text-sm leading-6">
        Create slash commands to quickly trigger actions or inject prompt
        templates in chat.
      </p>
      <Button onClick={onCreateClick} size="sm">
        <Plus className="mr-1.5 size-4" />
        Create your first command
      </Button>
    </CardContent>
  </Card>
)

const CommandGrid: FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
    {children}
  </div>
)

const CommandSections: FC<{
  commands: CommandMeta[]
  onEdit: (cmd: CommandMeta) => void
  onDelete: (cmd: CommandMeta) => void
  onToggle: (cmd: CommandMeta, enabled: boolean) => void
}> = ({ commands, onEdit, onDelete, onToggle }) => {
  const userCommands = commands.filter((c) => !c.builtIn)
  const builtInCommands = commands.filter((c) => c.builtIn)

  const renderCard = (cmd: CommandMeta) => (
    <CommandCard
      key={cmd.id}
      command={cmd}
      onEdit={() => onEdit(cmd)}
      onDelete={() => onDelete(cmd)}
      onToggle={(enabled) => onToggle(cmd, enabled)}
    />
  )

  return (
    <div className="space-y-6">
      {userCommands.length > 0 ? (
        <div className="space-y-3">
          <h3 className="font-semibold text-sm">My Commands</h3>
          <CommandGrid>{userCommands.map(renderCard)}</CommandGrid>
        </div>
      ) : null}

      {builtInCommands.length > 0 ? (
        <div className="space-y-3">
          <h3 className="font-semibold text-sm">Built-in Commands</h3>
          <CommandGrid>{builtInCommands.map(renderCard)}</CommandGrid>
        </div>
      ) : null}
    </div>
  )
}

const CommandCard: FC<{
  command: CommandMeta
  onEdit: () => void
  onDelete: () => void
  onToggle: (enabled: boolean) => void
}> = ({ command, onEdit, onDelete, onToggle }) => (
  <Card className="h-full py-0 shadow-sm">
    <CardContent className="flex h-full flex-col p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-sm leading-5">/{command.name}</h2>
          {command.builtIn ? (
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
              Built-in
            </Badge>
          ) : null}
        </div>
        <Switch
          checked={command.enabled}
          onCheckedChange={onToggle}
          aria-label={`Toggle /${command.name}`}
        />
      </div>

      <div className="mt-3 flex-1">
        <p className="line-clamp-3 text-muted-foreground text-sm leading-5">
          {command.description}
        </p>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onEdit}
          className="-ml-2 h-7 px-2 text-muted-foreground hover:bg-transparent hover:text-foreground"
        >
          {command.builtIn ? (
            <>
              <Eye className="size-3.5" />
              View
            </>
          ) : (
            <>
              <Pencil className="size-3.5" />
              Edit
            </>
          )}
        </Button>
        {!command.builtIn ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onDelete}
            className="size-7 text-muted-foreground hover:bg-transparent hover:text-destructive"
            aria-label={`Delete /${command.name}`}
          >
            <Trash2 className="size-4" />
          </Button>
        ) : null}
      </div>
    </CardContent>
  </Card>
)
