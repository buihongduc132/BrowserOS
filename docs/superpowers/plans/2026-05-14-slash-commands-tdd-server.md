<!-- status: DONE — merged via PR #15 (feat(slash-commands): /command autocomplete + settings page + custom commands) -->
# TDD: Slash Commands — Server Side

**Date:** 2026-05-14
**Plan:** `2026-05-14-slash-commands-ui.md`

---

## 1. Command Types & Frontmatter Parsing

### TC-S1.1: Valid frontmatter parses correctly
```
GIVEN: a markdown file with frontmatter { description: "Run tests", model: "gpt-4" }
WHEN:  parseCommandMd(raw) is called
THEN:  returns { id: "test", description: "Run tests", model: "gpt-4", content: "..." }
```

### TC-S1.2: Missing description rejects
```
GIVEN: markdown with frontmatter { model: "gpt-4" } (no description)
WHEN:  parseCommandMd(raw) is called
THEN:  throws validation error "description is required"
```

### TC-S1.3: Unknown fields ignored
```
GIVEN: markdown with frontmatter { description: "x", unknownField: "y" }
WHEN:  parseCommandMd(raw) is called
THEN:  returns parsed command, unknownField silently dropped
```

### TC-S1.4: Deferred fields accepted but not validated
```
GIVEN: markdown with frontmatter { description: "x", agent: "build", subtask: true }
WHEN:  parseCommandMd(raw) is called
THEN:  returns parsed command with agent/subtask preserved but not processed
```

### TC-S1.5: Empty content body
```
GIVEN: markdown with frontmatter only, empty body
WHEN:  parseCommandMd(raw) is called
THEN:  content = "" — valid, some commands have no template body
```

---

## 2. Built-in Command Definitions

### TC-S2.1: All built-in commands have required fields
```
GIVEN: getBuiltinCommands() is called
WHEN:  iterating over returned array
THEN:  each command has: name (starts with /), description, isBuiltIn=true
```

### TC-S2.2: Built-in command names are unique
```
GIVEN: getBuiltinCommands() is called
WHEN:  extracting names
THEN:  no duplicate names
```

### TC-S2.3: Built-in list matches spec
```
GIVEN: getBuiltinCommands()
WHEN:  map to names
THEN:  contains exactly: /clear, /compact, /mode, /model, /help, /reset
```

---

## 3. Command CRUD Service

### TC-S3.1: Create custom command
```
GIVEN: valid { name: "analyze", description: "Analyze code", content: "..." }
WHEN:  createCommand(input) is called
THEN:  writes .md file to user commands dir, returns CommandMeta
```

### TC-S3.2: Duplicate name rejects
```
GIVEN: existing command named "analyze"
WHEN:  createCommand({ name: "analyze", ... })
THEN:  throws "Command already exists"
```

### TC-S3.3: Custom command overrides built-in
```
GIVEN: built-in command "/help" exists
WHEN:  createCommand({ name: "help", ... }) then listCommands()
THEN:  custom "help" appears, built-in is shadowed
```

### TC-S3.4: Update command preserves file
```
GIVEN: existing custom command "analyze"
WHEN:  updateCommand("analyze", { description: "New desc" })
THEN:  only description changes, content and other fields preserved
```

### TC-S3.5: Delete built-in rejects
```
GIVEN: built-in command "/clear"
WHEN:  deleteCommand("clear")
THEN:  throws "Cannot delete built-in command"
```

### TC-S3.6: Delete custom command
```
GIVEN: custom command "analyze" exists
WHEN:  deleteCommand("analyze")
THEN:  directory removed, listCommands() no longer contains it
```

---

## 4. API Routes

### TC-S4.1: GET /commands returns merged list
```
GIVEN: 3 built-in + 2 custom commands
WHEN:  GET /commands
THEN:  returns { commands: [...5 items] } with builtIn flag correct
```

### TC-S4.2: POST /commands creates
```
GIVEN: valid input
WHEN:  POST /commands { name: "foo", description: "bar", content: "baz" }
THEN:  returns 201 + command meta
```

### TC-S4.3: POST /commands rejects missing description
```
GIVEN: input without description
WHEN:  POST /commands
THEN:  returns 400 validation error
```

### TC-S4.4: GET /commands/:id returns detail
```
GIVEN: command "analyze" exists
WHEN:  GET /commands/analyze
THEN:  returns { command: { id, name, description, content, ... } }
```

### TC-S4.5: GET /commands/:id 404
```
GIVEN: no command "nonexistent"
WHEN:  GET /commands/nonexistent
THEN:  returns 404
```

### TC-S4.6: PUT /commands/:id updates
```
GIVEN: custom command "analyze"
WHEN:  PUT /commands/analyze { description: "Updated" }
THEN:  returns 200 + updated meta
```

### TC-S4.7: DELETE /commands/:id deletes custom
```
GIVEN: custom command "analyze"
WHEN:  DELETE /commands/analyze
THEN:  returns 200 { ok: true }
```

### TC-S4.8: DELETE /commands/:id rejects built-in
```
GIVEN: built-in command "clear"
WHEN:  DELETE /commands/clear
THEN:  returns 403 "Cannot delete built-in command"
```

---

## 5. External Directory Loading

### TC-S5.1: Load from external dir
```
GIVEN: config has commands.externalDirs = ["/tmp/test-cmds/"]
       AND /tmp/test-cmds/deploy.md exists with valid frontmatter
WHEN:  loadAllCommands()
THEN:  returned list includes "deploy" command from external dir
```

### TC-S5.2: Invalid .md files skipped
```
GIVEN: external dir contains "broken.md" with invalid YAML frontmatter
WHEN:  loadAllCommands()
THEN:  logs warning, skips broken.md, continues loading others
```

### TC-S5.3: Non-existent external dir skipped
```
GIVEN: config has commands.externalDirs = ["/nonexistent/path/"]
WHEN:  loadAllCommands()
THEN:  no error thrown, dir silently skipped
```

### TC-S5.4: Priority: user dir > external > built-in
```
GIVEN: built-in "/help", external dir has "help.md", user dir has "help.md"
WHEN:  listCommands()
THEN:  user dir "help" wins (highest priority)
```

---

## 6. Command Resolution (Chat Submit)

### TC-S6.1: Parse /command args
```
GIVEN: input = "/analyze Button.tsx"
WHEN:  parseCommandInput(input)
THEN:  { commandName: "analyze", args: "Button.tsx" }
```

### TC-S6.2: Parse /command with no args
```
GIVEN: input = "/clear"
WHEN:  parseCommandInput(input)
THEN:  { commandName: "clear", args: "" }
```

### TC-S6.3: Non-command input passes through
```
GIVEN: input = "Hello world"
WHEN:  parseCommandInput(input)
THEN:  { commandName: null, args: "" }
```

### TC-S6.4: URL-like input not treated as command
```
GIVEN: input = "https://example.com"
WHEN:  parseCommandInput(input)
THEN:  { commandName: null, args: "" } — no leading / at word boundary
```

### TC-S6.5: $ARGUMENTS placeholder resolved
```
GIVEN: command template = "Analyze $ARGUMENTS in detail"
       AND args = "Button.tsx"
WHEN:  resolveTemplate(template, args)
THEN:  "Analyze Button.tsx in detail"
```

### TC-S6.6: Positional args resolved
```
GIVEN: command template = "Compare $1 with $2"
       AND args = "Button.tsx Input.tsx"
WHEN:  resolveTemplate(template, args)
THEN:  "Compare Button.tsx with Input.tsx"
```

### TC-S6.7: !`cmd` NOT executed — literal text
```
GIVEN: command template = "Run !`npm test` and report"
WHEN:  resolveTemplate(template, "")
THEN:  "Run !`npm test` and report" — NO shell execution, text preserved as-is
```

### TC-S6.8: Model specified AND available → override
```
GIVEN: command has model = "gpt-4" AND "gpt-4" is in available models
WHEN:  resolveCommand(command, args, availableModels)
THEN:  returns { resolvedTemplate, modelOverride: "gpt-4" }
```

### TC-S6.9: Model specified but NOT available → fallback to current
```
GIVEN: command has model = "claude-opus-99" AND it's NOT in available models
WHEN:  resolveCommand(command, args, availableModels)
THEN:  returns { resolvedTemplate, modelOverride: null } — uses current model
```

### TC-S6.10: No model specified → no override
```
GIVEN: command has no model field
WHEN:  resolveCommand(command, args, availableModels)
THEN:  returns { resolvedTemplate, modelOverride: null }
```

### TC-S6.11: /compact reads current compaction config
```
GIVEN: compaction config = { method: "vcc", vccConfig: { maxTranscriptLines: 50 } }
WHEN:  resolveCommand("/compact", ...)
THEN:  triggers compaction with method="vcc" and vccConfig from settings
```

### TC-S6.12: /compact with default method
```
GIVEN: compaction config = { method: "default" }
WHEN:  resolveCommand("/compact", ...)
THEN:  triggers compaction with default strategy
```
