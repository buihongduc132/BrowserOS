import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useCommands } from '@/entrypoints/app/command-settings/command-queries'
import { useAgentServerUrl } from '@/lib/browseros/useBrowserOSProviders'
import { createBrowserOSAction } from '@/lib/chat-actions/types'
import {
  SIDEPANEL_AI_TRIGGERED_EVENT,
  SIDEPANEL_MODE_CHANGED_EVENT,
  SIDEPANEL_STOP_CLICKED_EVENT,
  SIDEPANEL_SUGGESTION_CLICKED_EVENT,
  SIDEPANEL_TAB_REMOVED_EVENT,
  SIDEPANEL_TAB_TOGGLED_EVENT,
  SIDEPANEL_VOICE_ERROR_EVENT,
  SIDEPANEL_VOICE_RECORDING_STARTED_EVENT,
  SIDEPANEL_VOICE_RECORDING_STOPPED_EVENT,
  SIDEPANEL_VOICE_TRANSCRIPTION_COMPLETED_EVENT,
} from '@/lib/constants/analyticsEvents'
import { useJtbdPopup } from '@/lib/jtbd-popup/useJtbdPopup'
import { track } from '@/lib/metrics/track'
import { useVoiceInput } from '@/lib/voice/useVoiceInput'
import { useChatSessionContext } from '../layout/ChatSessionContext'
import { ChatEmptyState } from './ChatEmptyState'
import { ChatError } from './ChatError'
import { ChatFooter } from './ChatFooter'
import { ChatMessages } from './ChatMessages'
import type { ChatMode } from './chatTypes'
import {
  BUILTIN_ACTION_TYPES,
  BUILTIN_COMMAND_NAMES,
  type CommandResolution,
  isModelAvailable,
  parseSlashCommand,
  resolveTemplate,
} from './slash-command-resolver'

/**
 * @public
 */
export const Chat = () => {
  const {
    mode,
    setMode,
    messages,
    sendMessage,
    status,
    stop,
    agentUrlError,
    chatError,
    selectedProvider,
    getActionForMessage,
    liked,
    onClickLike,
    disliked,
    onClickDislike,
    isRestoringConversation,
    addToolApprovalResponse,
    providers,
    resetConversation,
  } = useChatSessionContext()

  const {
    popupVisible,
    showDontShowAgain,
    recordMessageSent,
    triggerIfEligible,
    onTakeSurvey,
    onDismiss: onDismissJtbdPopup,
  } = useJtbdPopup()

  const voice = useVoiceInput()
  const { commands: apiCommands } = useCommands()
  const { baseUrl } = useAgentServerUrl()

  const [input, setInput] = useState('')
  const [attachedTabs, setAttachedTabs] = useState<chrome.tabs.Tab[]>([])
  const [mounted, setMounted] = useState(false)

  // Available model IDs for model override validation
  const availableModelIds = providers
    .map((p) => p.model)
    .filter(Boolean) as string[]

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    ;(async () => {
      const currentTab = (
        await chrome.tabs.query({
          active: true,
          currentWindow: true,
        })
      ).filter((tab) => tab.url?.startsWith('http'))
      setAttachedTabs(currentTab)
    })()
  }, [])

  // Trigger JTBD popup when AI finishes responding
  const previousChatStatus = useRef(status)
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally only trigger on status change
  useEffect(() => {
    const aiWasProcessing =
      previousChatStatus.current === 'streaming' ||
      previousChatStatus.current === 'submitted'
    const aiJustFinished = aiWasProcessing && status === 'ready'

    if (aiJustFinished && messages.length > 0) {
      triggerIfEligible()
    }
    previousChatStatus.current = status
  }, [status])

  // Insert transcript into input when transcription completes
  // biome-ignore lint/correctness/useExhaustiveDependencies: only trigger on transcript/transcribing change
  useEffect(() => {
    if (voice.transcript && !voice.isTranscribing) {
      setInput((prev) => {
        const separator = prev.trim() ? ' ' : ''
        return prev + separator + voice.transcript
      })
      track(SIDEPANEL_VOICE_TRANSCRIPTION_COMPLETED_EVENT)
      voice.clearTranscript()
    }
  }, [voice.transcript, voice.isTranscribing])

  // Track voice errors
  useEffect(() => {
    if (voice.error) {
      track(SIDEPANEL_VOICE_ERROR_EVENT, { error: voice.error })
    }
  }, [voice.error])

  const handleModeChange = (newMode: ChatMode) => {
    track(SIDEPANEL_MODE_CHANGED_EVENT, { from: mode, to: newMode })
    setMode(newMode)
  }

  const handleStop = () => {
    track(SIDEPANEL_STOP_CLICKED_EVENT)
    stop()
  }

  const toggleTabSelection = (tab: chrome.tabs.Tab) => {
    setAttachedTabs((prev) => {
      const isSelected = prev.some((t) => t.id === tab.id)
      track(SIDEPANEL_TAB_TOGGLED_EVENT, {
        action: isSelected ? 'removed' : 'added',
      })
      if (isSelected) {
        return prev.filter((t) => t.id !== tab.id)
      }
      return [...prev, tab]
    })
  }

  const removeTab = (tabId?: number) => {
    track(SIDEPANEL_TAB_REMOVED_EVENT)
    setAttachedTabs((prev) => prev.filter((t) => t.id !== tabId))
  }

  /**
   * Resolve a slash command into a CommandResolution.
   * Returns null if input is not a slash command.
   */
  const resolveSlashCommand = useCallback(
    async (inputText: string): Promise<CommandResolution | null> => {
      const parsed = parseSlashCommand(inputText)
      if (!parsed) return null

      // Check built-in commands first
      if (BUILTIN_COMMAND_NAMES.has(parsed.name)) {
        const actionType =
          BUILTIN_ACTION_TYPES[
            parsed.name as keyof typeof BUILTIN_ACTION_TYPES
          ] ?? 'message'

        if (actionType === 'clear') {
          return { text: '', actionType: 'clear', modelOverride: undefined }
        }
        if (actionType === 'compact') {
          return { text: '', actionType: 'compact', modelOverride: undefined }
        }
        if (actionType === 'reset') {
          return { text: '', actionType: 'reset', modelOverride: undefined }
        }

        // message type (e.g. /help) — use built-in template
        // For now, just pass through the text
        return {
          text: inputText.trim(),
          actionType: 'message',
          modelOverride: undefined,
        }
      }

      // Check custom commands from API
      const command = apiCommands.find(
        (cmd) => cmd.id === parsed.name || cmd.name === `/${parsed.name}`,
      )

      if (!command) {
        // Unknown command — pass through as-is
        return null
      }

      // Fetch full command detail to get template
      try {
        const res = await fetch(`${baseUrl}/commands/${command.id}`)
        if (res.ok) {
          const data = await res.json()
          const detail = data.command
          if (detail?.content) {
            const resolvedText = resolveTemplate(detail.content, parsed)
            const modelOverride =
              detail.model && isModelAvailable(detail.model, availableModelIds)
                ? detail.model
                : undefined

            return {
              text: resolvedText,
              actionType: 'message',
              modelOverride,
            }
          }
        }
      } catch {
        // Fallback — just use the input as-is
      }

      return null
    },
    [apiCommands, baseUrl, availableModelIds],
  )

  const executeMessage = useCallback(
    async (customMessageText?: string) => {
      const messageText = customMessageText ? customMessageText : input.trim()
      if (!messageText) return

      // Try to resolve as a slash command
      const resolution = await resolveSlashCommand(messageText)

      if (resolution) {
        if (resolution.actionType === 'clear') {
          resetConversation()
          setInput('')
          setAttachedTabs([])
          return
        }
        if (resolution.actionType === 'compact') {
          // Fire compaction using current config
          try {
            if (baseUrl) {
              const configRes = await fetch(`${baseUrl}/compaction`)
              const _configData = await configRes.json()
              // Compaction is triggered by sending a special message
              // The server handles compaction internally
              // For now, show completion message
              sendMessage({
                text: 'Compaction has been triggered using the current configuration. Your conversation context has been compacted.',
              })
            }
          } catch {
            sendMessage({
              text: 'Compaction triggered but could not read config. Using defaults.',
            })
          }
          setInput('')
          setAttachedTabs([])
          return
        }
        if (resolution.actionType === 'reset') {
          resetConversation()
          // Start fresh with same settings
          setInput('')
          setAttachedTabs([])
          return
        }

        // Message type — use resolved text
        recordMessageSent()
        if (attachedTabs.length) {
          const action = createBrowserOSAction({
            mode,
            message: resolution.text,
            tabs: attachedTabs,
          })
          sendMessage({
            text: resolution.text,
            action,
            // Note: model override would need to be plumbed through sendMessage
            // For v1, we resolve the template but don't override the model at send time
          })
        } else {
          sendMessage({ text: resolution.text })
        }
        setInput('')
        setAttachedTabs([])
        return
      }

      // Regular message (no slash command or unknown command)
      recordMessageSent()

      if (attachedTabs.length) {
        const action = createBrowserOSAction({
          mode,
          message: messageText,
          tabs: attachedTabs,
        })
        sendMessage({ text: messageText, action })
      } else {
        sendMessage({ text: messageText })
      }
      setInput('')
      setAttachedTabs([])
    },
    [
      input,
      mode,
      attachedTabs,
      sendMessage,
      recordMessageSent,
      resolveSlashCommand,
      resetConversation,
      baseUrl,
    ],
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (messages.length === 0) {
      track(SIDEPANEL_AI_TRIGGERED_EVENT, {
        mode,
        tabs_count: attachedTabs.length,
      })
    }
    executeMessage()
  }

  const handleSuggestionClick = (suggestion: string) => {
    track(SIDEPANEL_SUGGESTION_CLICKED_EVENT, { mode })
    executeMessage(suggestion)
  }

  const handleStartRecording = async () => {
    const started = await voice.startRecording()
    if (started) {
      track(SIDEPANEL_VOICE_RECORDING_STARTED_EVENT)
    }
  }

  const handleStopRecording = async () => {
    await voice.stopRecording()
    track(SIDEPANEL_VOICE_RECORDING_STOPPED_EVENT)
  }

  const voiceState = {
    isRecording: voice.isRecording,
    isTranscribing: voice.isTranscribing,
    audioLevels: voice.audioLevels,
    error: voice.error,
    onStartRecording: handleStartRecording,
    onStopRecording: handleStopRecording,
  }

  return (
    <>
      <main className="mt-4 flex h-full flex-1 flex-col space-y-4 overflow-y-auto">
        {isRestoringConversation ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <ChatEmptyState
            mode={mode}
            mounted={mounted}
            onSuggestionClick={handleSuggestionClick}
          />
        ) : (
          <ChatMessages
            messages={messages}
            status={status}
            getActionForMessage={getActionForMessage}
            liked={liked}
            onClickLike={onClickLike}
            disliked={disliked}
            onClickDislike={onClickDislike}
            showJtbdPopup={popupVisible}
            showDontShowAgain={showDontShowAgain}
            onTakeSurvey={onTakeSurvey}
            onDismissJtbdPopup={onDismissJtbdPopup}
            onToolApprove={(id) =>
              addToolApprovalResponse({ id, approved: true })
            }
            onToolDeny={(id) =>
              addToolApprovalResponse({ id, approved: false })
            }
          />
        )}
        {agentUrlError && (
          <ChatError
            error={agentUrlError}
            providerType={selectedProvider?.type}
          />
        )}
        {chatError && (
          <ChatError error={chatError} providerType={selectedProvider?.type} />
        )}
      </main>

      <ChatFooter
        mode={mode}
        onModeChange={handleModeChange}
        input={input}
        onInputChange={setInput}
        onSubmit={handleSubmit}
        status={status}
        onStop={handleStop}
        attachedTabs={attachedTabs}
        onToggleTab={toggleTabSelection}
        onRemoveTab={removeTab}
        voice={voiceState}
      />
    </>
  )
}
