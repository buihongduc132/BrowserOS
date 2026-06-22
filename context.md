# Code Context

## Files Retrieved
1. `packages/browseros-agent/apps/server/src/api/routes/commands.ts` (lines 1-80) — **Primary**: contains the exact Zod schemas (`CreateCommandSchema`, `UpdateCommandSchema`) and route handlers with `zValidator`.
2. `packages/browseros-agent/apps/server/src/commands/types.ts` (lines 34-38) — TypeScript `CreateCommandInput` type (mirrors the Zod schema).
3. `packages/browseros-agent/apps/server/src/commands/service.ts` (lines 136-164) — `createCommand()` service function that consumes the validated input.

## Key Code

### Zod Schema: `CreateCommandSchema` (POST /commands body)

```ts
// packages/browseros-agent/apps/server/src/api/routes/commands.ts:19-23
const CreateCommandSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  content: z.string().min(1).max(50_000),
})
```

### Field Details

| Field         | Type     | Required | Constraints              | Notes                                    |
|---------------|----------|----------|--------------------------|------------------------------------------|
| `name`        | `string` | ✅ Yes   | `min(1)`, `max(100)`     | Slugified via `slugify()` in service     |
| `description` | `string` | ✅ Yes   | `min(1)`, `max(500)`     | Written to frontmatter of `.md` file     |
| `content`     | `string` | ✅ Yes   | `min(1)`, `max(50_000)`  | Template body; supports `$ARGUMENTS`, `$1`..`$N` placeholders |
| `model`       | —        | ❌ No    | Not in Zod schema        | Exists in TS type but **not** validated by the API route |

### Zod Schema: `UpdateCommandSchema` (PUT /commands/:id body)

```ts
// packages/browseros-agent/apps/server/src/api/routes/commands.ts:25-30
const UpdateCommandSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(500).optional(),
  content: z.string().max(50_000).optional(),
  enabled: z.boolean().optional(),
})
```

### Route Registration

```ts
// packages/browseros-agent/apps/server/src/api/server.ts:294
.route('/commands', createCommandsRoutes())
```

### Validation Flow

1. Hono route `.post('/', zValidator('json', CreateCommandSchema), ...)` validates the body.
2. On success, `c.req.valid('json')` returns the typed object → passed to `createCommand()`.
3. `createCommand()` slugifies `name`, checks for duplicates, writes a `.md` file with gray-matter frontmatter.

## Architecture

```
POST /commands (body: JSON)
  → zValidator('json', CreateCommandSchema)     // Zod validation
  → createCommand(c.req.valid('json'))          // service layer
    → slugify(name)                             // name normalization
    → safeCommandPath(id)                       // path traversal guard
    → buildCommandMd(frontmatter, content)      // gray-matter serialization
    → writeFile(~/.browseros/commands/<id>.md)   // persisted to disk
  → Response: { command: CommandMeta } | { error: string }
```

## Start Here

`packages/browseros-agent/apps/server/src/api/routes/commands.ts` — contains the exact Zod schemas and route definitions. Everything needed to understand the POST /commands contract is in this single file.
