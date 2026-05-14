import { type FC, useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MarkdownEditor } from '@/components/ui/MarkdownEditor'
import { Textarea } from '@/components/ui/textarea'
import type { CommandDetail } from './command-queries'

type CommandDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingCommand: CommandDetail | null
  readOnly?: boolean
  onSave: (data: {
    name: string
    description: string
    content: string
  }) => Promise<void>
}

export const CommandDialog: FC<CommandDialogProps> = ({
  open,
  onOpenChange,
  editingCommand,
  readOnly,
  onSave,
}) => {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setSaving(false)
    if (!open) return
    setName(editingCommand?.name ?? '')
    setDescription(editingCommand?.description ?? '')
    setContent(editingCommand?.content ?? '')
  }, [editingCommand, open])

  const isValid =
    name.trim().length > 0 &&
    description.trim().length > 0 &&
    content.trim().length > 0

  const handleSubmit = async () => {
    if (!isValid || saving) return
    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        content,
      })
    } finally {
      setSaving(false)
    }
  }

  const handleContentKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (
    event,
  ) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleSubmit()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle>
            {readOnly
              ? 'View Command'
              : editingCommand
                ? 'Edit Command'
                : 'Create Command'}
          </DialogTitle>
          <DialogDescription>
            {readOnly
              ? 'This command is built into BrowserOS.'
              : editingCommand
                ? 'Update the slash command template and its description.'
                : 'Define a slash command your agent can invoke with /name in chat.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[280px_minmax(0,1fr)] lg:overflow-hidden">
          <div className="space-y-5 border-b bg-muted/20 px-6 py-5 lg:border-r lg:border-b-0">
            <div className="space-y-2">
              <Label htmlFor="cmd-name">Name</Label>
              <Input
                id="cmd-name"
                placeholder="e.g., analyze"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                readOnly={readOnly}
              />
              <p className="text-muted-foreground text-xs leading-5">
                Used as /{name || 'name'} in chat. Keep it short.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cmd-description">Description</Label>
              <Textarea
                id="cmd-description"
                placeholder="Describe when to use this command."
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={500}
                className="min-h-28 resize-none bg-background"
                readOnly={readOnly}
              />
              <p className="text-muted-foreground text-xs leading-5">
                Shown in the autocomplete menu when typing /.
              </p>
            </div>

            {!readOnly ? (
              <div className="mt-auto rounded-lg border border-border/60 border-dashed bg-muted/30 px-3 py-2.5">
                <p className="font-medium text-muted-foreground text-xs">
                  Placeholders
                </p>
                <ul className="mt-1.5 list-disc space-y-1 pl-4 text-muted-foreground text-xs leading-5">
                  <li>$ARGUMENTS — all arguments as a string</li>
                  <li>$1, $2 — positional arguments</li>
                  <li>
                    !{'`'}cmd{'`'} — static text, not executed
                  </li>
                </ul>
              </div>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-col px-6 py-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <Label htmlFor="cmd-content">Template (Markdown)</Label>
              <Badge variant="outline" className="border-border bg-background">
                {content.length} characters
              </Badge>
            </div>

            {readOnly ? (
              <div className="prose prose-sm dark:prose-invert mt-4 min-h-[320px] max-w-none flex-1 overflow-y-auto rounded-md border p-4 text-sm">
                <Markdown>{content}</Markdown>
              </div>
            ) : (
              <MarkdownEditor
                id="cmd-content"
                value={content}
                onChange={setContent}
                onKeyDown={handleContentKeyDown}
                placeholder="Write the command template. Use $ARGUMENTS for user input."
                className="mt-4 min-h-[320px] flex-1 overflow-y-auto text-sm"
              />
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground text-xs">
            {readOnly
              ? 'This command is built into BrowserOS.'
              : 'Saved locally and available immediately in chat.'}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {readOnly ? (
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button onClick={handleSubmit} disabled={!isValid || saving}>
                  {saving
                    ? 'Saving...'
                    : editingCommand
                      ? 'Update Command'
                      : 'Create Command'}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
