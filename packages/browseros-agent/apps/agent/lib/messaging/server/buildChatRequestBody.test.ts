import { describe, expect, it } from 'bun:test'
import type { LlmProviderConfig } from '@/lib/llm-providers/types'
import { buildChatRequestBody } from './buildChatRequestBody'

const provider: LlmProviderConfig = {
  id: 'browseros',
  type: 'browseros',
  name: 'BrowserOS',
  modelId: 'browseros-auto',
  supportsImages: true,
  contextWindow: 200000,
  temperature: 0,
  createdAt: 0,
  updatedAt: 0,
}

describe('buildChatRequestBody', () => {
  it('preserves browser context and chat metadata', () => {
    const body = buildChatRequestBody({
      conversationId: '6ff46e3b-e45a-40a4-9157-ca520e800f43',
      provider,
      mode: 'agent',
      browserContext: {
        windowId: 2,
        activeTab: {
          id: 10,
          url: 'https://amazon.com',
          title: 'Amazon',
        },
        enabledMcpServers: ['slack'],
      },
      userSystemPrompt: 'Stay in the current tab.',
      declinedApps: ['gmail'],
    })

    expect(body.browserContext).toEqual({
      windowId: 2,
      activeTab: {
        id: 10,
        url: 'https://amazon.com',
        title: 'Amazon',
      },
      enabledMcpServers: ['slack'],
    })
    expect(body.userSystemPrompt).toBe('Stay in the current tab.')
    expect(body.declinedApps).toEqual(['gmail'])
  })

  it('includes userWorkspaces when provided', () => {
    const workspaces = [
      { id: 'ws-1', path: '/home/user/frontend', name: 'frontend' },
      { id: 'ws-2', path: '/home/user/backend', name: 'backend' },
    ]
    const body = buildChatRequestBody({
      conversationId: '6ff46e3b-e45a-40a4-9157-ca520e800f43',
      provider,
      userWorkspaces: workspaces,
    })

    expect(body.userWorkspaces).toEqual(workspaces)
  })

  it('includes userWorkspaces as undefined when not provided', () => {
    const body = buildChatRequestBody({
      conversationId: '6ff46e3b-e45a-40a4-9157-ca520e800f43',
      provider,
    })

    expect(body.userWorkspaces).toBeUndefined()
  })

  it('sends both userWorkingDir and userWorkspaces for backward compat', () => {
    const body = buildChatRequestBody({
      conversationId: '6ff46e3b-e45a-40a4-9157-ca520e800f43',
      provider,
      userWorkingDir: '/home/user/frontend',
      userWorkspaces: [
        { id: 'ws-1', path: '/home/user/frontend', name: 'frontend' },
      ],
    })

    expect(body.userWorkingDir).toBe('/home/user/frontend')
    expect(body.userWorkspaces).toEqual([
      { id: 'ws-1', path: '/home/user/frontend', name: 'frontend' },
    ])
  })

  it('includes userWorkspaces when provided', () => {
    const workspaces = [
      { id: 'ws-1', path: '/home/user/frontend', name: 'frontend' },
      { id: 'ws-2', path: '/home/user/backend', name: 'backend' },
    ]
    const body = buildChatRequestBody({
      conversationId: '6ff46e3b-e45a-40a4-9157-ca520e800f43',
      provider,
      userWorkspaces: workspaces,
    })

    expect(body.userWorkspaces).toEqual(workspaces)
  })

  it('includes userWorkspaces as undefined when not provided', () => {
    const body = buildChatRequestBody({
      conversationId: '6ff46e3b-e45a-40a4-9157-ca520e800f43',
      provider,
    })

    expect(body.userWorkspaces).toBeUndefined()
  })

  it('sends both userWorkingDir and userWorkspaces for backward compat', () => {
    const body = buildChatRequestBody({
      conversationId: '6ff46e3b-e45a-40a4-9157-ca520e800f43',
      provider,
      userWorkingDir: '/home/user/frontend',
      userWorkspaces: [
        { id: 'ws-1', path: '/home/user/frontend', name: 'frontend' },
      ],
    })

    expect(body.userWorkingDir).toBe('/home/user/frontend')
    expect(body.userWorkspaces).toEqual([
      { id: 'ws-1', path: '/home/user/frontend', name: 'frontend' },
    ])
  })
})
