import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAgentServerUrl } from '@/lib/browseros/useBrowserOSProviders'

export type CommandMeta = {
  id: string
  name: string
  description: string
  location: string
  enabled: boolean
  builtIn: boolean
}

export type CommandDetail = CommandMeta & {
  content: string
}

type CreateCommandInput = {
  name: string
  description: string
  content: string
}

type UpdateCommandInput = Partial<CreateCommandInput> & {
  enabled?: boolean
}

const COMMANDS_QUERY_KEY = 'commands'

async function fetchCommands(baseUrl: string): Promise<CommandMeta[]> {
  const res = await fetch(`${baseUrl}/commands`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.commands
}

async function fetchCommand(
  baseUrl: string,
  id: string,
): Promise<CommandDetail> {
  const res = await fetch(`${baseUrl}/commands/${id}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.command
}

async function postCommand(
  baseUrl: string,
  input: CreateCommandInput,
): Promise<CommandMeta> {
  const res = await fetch(`${baseUrl}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `HTTP ${res.status}`)
  }
  const data = await res.json()
  return data.command
}

async function putCommand(
  baseUrl: string,
  id: string,
  input: UpdateCommandInput,
): Promise<CommandMeta> {
  const res = await fetch(`${baseUrl}/commands/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `HTTP ${res.status}`)
  }
  const data = await res.json()
  return data.command
}

async function removeCommand(baseUrl: string, id: string): Promise<void> {
  const res = await fetch(`${baseUrl}/commands/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export function useCommands() {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()
  const queryClient = useQueryClient()

  const { data, isLoading, error, refetch } = useQuery<CommandMeta[], Error>({
    queryKey: [COMMANDS_QUERY_KEY, baseUrl],
    queryFn: () => fetchCommands(baseUrl as string),
    enabled: !!baseUrl && !urlLoading,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: [COMMANDS_QUERY_KEY] })

  const createMutation = useMutation({
    mutationFn: (input: CreateCommandInput) =>
      postCommand(baseUrl as string, input),
    onSuccess: invalidate,
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateCommandInput }) =>
      putCommand(baseUrl as string, id, input),
    onSuccess: invalidate,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => removeCommand(baseUrl as string, id),
    onSuccess: invalidate,
  })

  return {
    commands: data ?? [],
    isLoading: isLoading || urlLoading,
    error,
    refetch,
    createCommand: createMutation.mutateAsync,
    updateCommand: (id: string, input: UpdateCommandInput) =>
      updateMutation.mutateAsync({ id, input }),
    deleteCommand: deleteMutation.mutateAsync,
    fetchCommandDetail: (id: string) => fetchCommand(baseUrl as string, id),
  }
}
