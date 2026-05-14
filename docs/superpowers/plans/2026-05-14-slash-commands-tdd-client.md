# TDD: Slash Commands — Client Side

**Date:** 2026-05-14
**Plan:** `2026-05-14-slash-commands-ui.md`

---

## 1. Slash Command State Machine (ChatInput)

### TC-C1.1: `/` at word boundary opens menu
```
GIVEN: empty textarea
WHEN:  user types `/`
THEN:  slashState = { isOpen: true, filterText: "", startPosition: 0 }
```

### TC-C1.2: `/` after space opens menu
```
GIVEN: input = "hello "
WHEN:  user types `/` (cursor at end)
THEN:  slashState = { isOpen: true, filterText: "", startPosition: 6 }
```

### TC-C1.3: `/` mid-word does NOT open menu
```
GIVEN: input = "https://"
WHEN:  user types at end (cursor at position 8)
THEN:  slashState = { isOpen: false } — no trigger
```

### TC-C1.4: Typing filters commands
```
GIVEN: slash menu open, filterText = ""
WHEN:  user types "cl" → input becomes "/cl"
THEN:  slashState = { isOpen: true, filterText: "cl" }
       AND visible commands = [/clear, /compact] (includes() match)
```

### TC-C1.5: Escape closes menu
```
GIVEN: slash menu open
WHEN:  user presses Escape
THEN:  slashState = { isOpen: false }, `/filterText` removed from input
```

### TC-C1.6: Backspace past `/` closes menu
```
GIVEN: slash menu open, input = "/cl"
WHEN:  user presses Backspace twice → input becomes ""
THEN:  slashState = { isOpen: false }
```

### TC-C1.7: Arrow Up/Down navigates list
```
GIVEN: slash menu open with [/clear, /compact, /help]
       AND /clear is selected
WHEN:  user presses ArrowDown
THEN:  /compact becomes selected
```

### TC-C1.8: Enter selects command
```
GIVEN: slash menu open, /clear is selected
WHEN:  user presses Enter
THEN:  input becomes "/clear ", menu closes, cursor after space
```

### TC-C1.9: Tab auto-completes single match
```
GIVEN: slash menu open, filterText = "cle", only /clear matches
WHEN:  user presses Tab
THEN:  input becomes "/clear ", menu closes
```

### TC-C1.10: Click outside closes menu
```
GIVEN: slash menu open
WHEN:  user clicks outside textarea and menu
THEN:  slashState = { isOpen: false }, `/filterText` removed
```

---

## 2. SlashCommandMenu Rendering

### TC-C2.1: Groups rendered correctly
```
GIVEN: 3 built-in + 2 custom commands
WHEN:  SlashCommandMenu renders
THEN:  two groups visible: "Built-in" with 3 items, "Custom" with 2 items
```

### TC-C2.2: Empty filter shows no results
```
GIVEN: filter text = "zzz", no matches
WHEN:  SlashCommandMenu renders
THEN:  shows "No commands found" empty state
```

### TC-C2.3: Each item shows name + description
```
GIVEN: command { name: "/clear", description: "Clear history" }
WHEN:  rendered in list
THEN:  shows "/clear" as name, "Clear history" as description
```

### TC-C2.4: Keyboard navigation wraps
```
GIVEN: last item selected, user presses ArrowDown
WHEN:  at end of list
THEN:  selection wraps to first item
```

---

## 3. Chat.tsx Command Parsing

### TC-C3.1: `/command args` detected
```
GIVEN: input = "/analyze Button.tsx performance"
WHEN:  handleSubmit is called
THEN:  command resolution triggered with name="analyze", args="Button.tsx performance"
```

### TC-C3.2: Regular message passes through
```
GIVEN: input = "Hello, can you help?"
WHEN:  handleSubmit is called
THEN:  sendMessage called with original text, no command resolution
```

### TC-C3.3: Unknown command passes through as text
```
GIVEN: input = "/foobar something"
WHEN:  handleSubmit is called AND "foobar" is not a known command
THEN:  sendMessage called with "/foobar something" as-is (not an error)
```

### TC-C3.4: Built-in /clear executes action
```
GIVEN: input = "/clear"
WHEN:  handleSubmit is called
THEN:  conversation is cleared, no message sent to LLM
```

### TC-C3.5: Built-in /compact triggers compaction
```
GIVEN: input = "/compact"
WHEN:  handleSubmit is called
THEN:  compaction API called with current config, completion message shown
```

### TC-C3.6: Custom command template resolved
```
GIVEN: custom command "analyze" with template "Deep analysis of $ARGUMENTS"
       AND input = "/analyze Button.tsx"
WHEN:  handleSubmit is called
THEN:  sendMessage called with "Deep analysis of Button.tsx"
```

### TC-C3.7: Model override applied
```
GIVEN: custom command with model="gpt-4" AND "gpt-4" is available
       AND input = "/analyze Button.tsx"
WHEN:  handleSubmit is called
THEN:  message sent with model override = "gpt-4"
```

### TC-C3.8: Model fallback when unavailable
```
GIVEN: custom command with model="nonexistent-model"
       AND input = "/analyze Button.tsx"
WHEN:  handleSubmit is called
THEN:  message sent with NO model override (uses current model)
```

---

## 4. CommandSettingsPage CRUD

### TC-C4.1: Page loads commands list
```
GIVEN: API returns 4 commands (2 built-in, 2 custom)
WHEN:  CommandSettingsPage mounts
THEN:  renders 4 cards in "Built-in" and "My Commands" sections
```

### TC-C4.2: Toggle enable/disable
```
GIVEN: custom command "analyze" is enabled
WHEN:  user clicks toggle
THEN:  PUT /commands/analyze { enabled: false } called
```

### TC-C4.3: Create new command
```
GIVEN: user clicks "New Command" button
WHEN:  fills name, description, content and clicks "Create"
THEN:  POST /commands called, new card appears in grid
```

### TC-C4.4: Edit existing command
```
GIVEN: custom command "analyze" exists
WHEN:  user clicks Edit, changes description, clicks "Update"
THEN:  PUT /commands/analyze called with updated fields
```

### TC-C4.5: Delete custom command
```
GIVEN: custom command "analyze" exists
WHEN:  user clicks delete, confirms
THEN:  DELETE /commands/analyze called, card removed from grid
```

### TC-C4.6: Cannot delete built-in
```
GIVEN: built-in command "/clear"
WHEN:  rendered
THEN:  no delete button visible, card shows "Built-in" badge
```

### TC-C4.7: Built-in commands are read-only
```
GIVEN: built-in command "/clear"
WHEN:  user clicks on card
THEN:  "View" button (not "Edit"), content shown read-only
```

---

## 5. CommandDialog

### TC-C5.1: Validation rejects empty name
```
GIVEN: dialog open for new command
WHEN:  user submits with empty name
THEN:  submit button disabled
```

### TC-C5.2: Validation rejects empty description
```
GIVEN: name filled, description empty
WHEN:  checking validity
THEN:  submit button disabled
```

### TC-C5.3: Validation rejects empty content
```
GIVEN: name + description filled, content empty
WHEN:  checking validity
THEN:  submit button disabled
```

### TC-C5.4: Cmd+Enter submits
```
GIVEN: all fields valid
WHEN:  user presses Cmd+Enter in content editor
THEN:  form submitted
```

### TC-C5.5: Dialog resets on close
```
GIVEN: dialog was showing command "analyze"
WHEN:  dialog closes then reopens for new command
THEN:  all fields empty
```

---

## 6. Slash Menu + @ Mention Coexistence

### TC-C6.1: `/` closes open @ mention
```
GIVEN: @ mention menu is open
WHEN:  user types `/`
THEN:  @ mention closes first, slash menu does NOT open (same keystroke consumed)
```

### TC-C6.2: `@` closes open slash menu
```
GIVEN: slash menu is open
WHEN:  user types `@`
THEN:  slash menu closes first, @ mention opens
```

### TC-C6.3: Only one menu active at a time
```
GIVEN: either menu is open
WHEN:  checking state
THEN:  invariant: !(mentionState.isOpen && slashState.isOpen)
```

### TC-C6.4: Submit closes both menus
```
GIVEN: slash menu is open
WHEN:  user presses Enter to select a command AND then submits the form
THEN:  slash menu closes, message sent with resolved command
```

### TC-C6.5: `/` does not trigger in middle of @ mention
```
GIVEN: @ mention menu is open, input = "hello @"
WHEN:  user continues typing
THEN:  slash menu never opens while @ mention is active
```
