import dayjs from 'dayjs'

/**
 * A workspace associated with a session.
 */
export interface SessionWorkspace {
  id: string
  name: string
  path: string
}

/**
 * A session with workspace and tag metadata for grouping.
 */
export interface AssistantSession {
  id: string
  title: string | null
  workspaces: SessionWorkspace[]
  tags: string[]
  updatedAt: number
  createdAt: number
}

/**
 * Grouping mode for session history display.
 */
export type GroupingMode = 'workspace' | 'tag' | 'date'

/**
 * Icon type for group header rendering.
 */
export type GroupIcon = 'workspace' | 'tag' | 'date'

/**
 * A group of sessions under a common key.
 */
export interface SessionGroup {
  key: string
  label: string
  icon: GroupIcon
  color?: string
  sessions: AssistantSession[]
}

// ─── Date grouping helpers ───

type TimeGroup = 'today' | 'thisWeek' | 'thisMonth' | 'older'

const TIME_GROUP_LABELS: Record<TimeGroup, string> = {
  today: 'Today',
  thisWeek: 'This Week',
  thisMonth: 'This Month',
  older: 'Older',
}

function getTimeGroup(timestamp: number): TimeGroup {
  const date = dayjs(timestamp)
  const now = dayjs()

  if (date.isSame(now, 'day')) return 'today'
  if (date.isSame(now, 'week')) return 'thisWeek'
  if (date.isSame(now, 'month')) return 'thisMonth'
  return 'older'
}

// ─── Main grouping function ───

/**
 * Group sessions by the given mode.
 *
 * Rules:
 * - workspace: group by workspace ID. Multi-workspace sessions appear in N groups.
 *   Sessions with 0 workspaces → "No workspace" group.
 *   Falls back to date grouping if NO sessions have workspaces.
 * - tag: group by tag string. Multi-tag sessions appear in N groups.
 *   Untagged → "Untagged" group.
 * - date: group by today/this week/this month/older.
 */
export function groupSessions(
  sessions: AssistantSession[],
  mode: GroupingMode,
): SessionGroup[] {
  if (sessions.length === 0) return []

  switch (mode) {
    case 'workspace':
      return groupByWorkspace(sessions)
    case 'tag':
      return groupByTag(sessions)
    case 'date':
      return groupByDate(sessions)
  }
}

function sortByUpdatedAtDesc(sessions: AssistantSession[]): AssistantSession[] {
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
}

function groupByWorkspace(sessions: AssistantSession[]): SessionGroup[] {
  // Check if ANY session has workspaces — if not, fall back to date
  const hasAnyWorkspace = sessions.some((s) => s.workspaces.length > 0)
  if (!hasAnyWorkspace) {
    return groupByDate(sessions)
  }

  const groupMap = new Map<
    string,
    { label: string; color: string; sessions: AssistantSession[] }
  >()

  for (const session of sessions) {
    if (session.workspaces.length === 0) {
      // No-workspace group
      const key = '__no_workspace__'
      if (!groupMap.has(key)) {
        groupMap.set(key, { label: 'No workspace', color: '', sessions: [] })
      }
      groupMap.get(key)?.sessions.push(session)
    } else {
      for (const ws of session.workspaces) {
        if (!groupMap.has(ws.id)) {
          groupMap.set(ws.id, { label: ws.name, color: '', sessions: [] })
        }
        groupMap.get(ws.id)?.sessions.push(session)
      }
    }
  }

  // Sort sessions within groups, then sort groups by count desc
  const groups: SessionGroup[] = []
  for (const [key, data] of groupMap) {
    groups.push({
      key,
      label: data.label,
      icon: 'workspace',
      sessions: sortByUpdatedAtDesc(data.sessions),
    })
  }

  groups.sort((a, b) => b.sessions.length - a.sessions.length)
  return groups
}

function groupByTag(sessions: AssistantSession[]): SessionGroup[] {
  const groupMap = new Map<string, AssistantSession[]>()

  for (const session of sessions) {
    if (session.tags.length === 0) {
      const key = '__untagged__'
      if (!groupMap.has(key)) groupMap.set(key, [])
      groupMap.get(key)?.push(session)
    } else {
      for (const tag of session.tags) {
        const key = `tag:${tag}`
        if (!groupMap.has(key)) groupMap.set(key, [])
        groupMap.get(key)?.push(session)
      }
    }
  }

  const groups: SessionGroup[] = []
  for (const [key, sessionsInGroup] of groupMap) {
    const label = key === '__untagged__' ? 'Untagged' : key.replace('tag:', '')
    groups.push({
      key,
      label,
      icon: 'tag',
      sessions: sortByUpdatedAtDesc(sessionsInGroup),
    })
  }

  groups.sort((a, b) => b.sessions.length - a.sessions.length)
  return groups
}

function groupByDate(sessions: AssistantSession[]): SessionGroup[] {
  const groupMap = new Map<TimeGroup, AssistantSession[]>()

  for (const session of sessions) {
    const tg = getTimeGroup(session.updatedAt)
    if (!groupMap.has(tg)) groupMap.set(tg, [])
    groupMap.get(tg)?.push(session)
  }

  // Fixed order: today, thisWeek, thisMonth, older
  const order: TimeGroup[] = ['today', 'thisWeek', 'thisMonth', 'older']
  const groups: SessionGroup[] = []

  for (const tg of order) {
    const sessionsInGroup = groupMap.get(tg)
    if (sessionsInGroup && sessionsInGroup.length > 0) {
      groups.push({
        key: `date:${tg}`,
        label: TIME_GROUP_LABELS[tg],
        icon: 'date',
        sessions: sortByUpdatedAtDesc(sessionsInGroup),
      })
    }
  }

  return groups
}
