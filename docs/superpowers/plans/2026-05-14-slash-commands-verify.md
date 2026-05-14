# Verification Report: Slash Commands UI Plan

**Verifier:** @V
**Date:** 2026-05-14
**Plan:** `2026-05-14-slash-commands-ui.md`

---

## A. Theatering Items (impressive but purposeless)

| # | Item | Location | Verdict | Reason |
|---|------|----------|---------|--------|
| T1 | "optional keyboard shortcut" display in autocomplete | §1 line 52 | **THEATER** | No shortcuts are defined for any command. No plan to implement them. Showing a column that will always be empty is UI noise. **Remove.** |
| T2 | "fuzzy match on name + description" | §1 line 53 | **THEATER** | For ~10 commands, fuzzy matching adds complexity with zero UX gain. Plain prefix/string match is sufficient. Adding a fuzzy library dependency for this is over-engineering. **Replace with `includes()` filter.** |
| T3 | `/help` command renders "command list as a system message in chat" | §2 line 76 | **MARGINAL THEATER** | The autocomplete popover already shows all commands. A `/help` that dumps the same list into chat history is redundant. **Demote to nice-to-have. Implement only if trivial.** |
| T4 | "Streaming status while compacting" for `/compact` | §2 line 86 | **THEATER** | Compaction is fast (30ms–2s). A streaming status indicator for sub-second operations is performative UI. The command can just be fire-and-forget with a completion message. **Replace with simple completion message.** |
| T5 | "defaults/ directory ← optional built-in custom commands (future)" | §4 file tree | **THEATER** | An empty directory with an `index.ts` that does nothing. This is a placeholder for nothing. **Remove until needed.** |
| T6 | `external-dirs.ts` as a separate file | §4 file tree | **THEATER** | External dir loading is ~20 lines that could live in `loader.ts`. Splitting it into its own file adds indirection for no benefit at this scope. **Merge into `loader.ts`.** |

**Verdict: 4 items to remove/replace, 2 to merge/simplify.**

---

## B. Alignment Check Against User Requirements

### B1. "FOLLOW the Opencode approach" (markdown config)

**ALIGNED** ✅  
Plan uses markdown frontmatter for command definitions. Structure mirrors OpenCode's pattern.

**Fix needed:** The plan says "OpenCode-whitelisted fields only" but the actual OpenCode spec also includes `tools` (allowed tools list) and `output` (output format). Verify against `https://opencode.ai/docs/commands/` and add any missing fields to the whitelist, or explicitly document why they're excluded.

---

### B2. "/compact must follow exact current configured compaction"

**ALIGNED** ✅  
§2 `/compact` explicitly states: "Reads current compaction config from server (`GET /compaction`), Uses the configured `method` (default or vcc) and any `vccConfig` overrides."

**No fix needed.** Correctly defers to existing compaction settings.

---

### B3. "WHITELIST opencode fields"

**MISALIGNED** ⚠️  
The whitelist table (§3) includes:

| Field | Present | Issue |
|-------|---------|-------|
| `description` | ✅ | — |
| `model` | ✅ | — |
| `agent` | ⚠️ | Marked "Future: target agent (deferred)" — fine, but if it's deferred, don't include in the whitelist table. Remove from v1, add when agent-targeting is built. |
| `subtask` | ⚠️ | Same issue. No implementation planned. Include only if the field is actually consumed. If it's ignored at runtime, it's theater. |

**Fix:** Remove `agent` and `subtask` from the v1 whitelist. Add a "Deferred fields" note that lists them for future reference. Only include fields the server actually processes.

---

### B4. "Shell output → do not run it, just output it as-is"

**ALIGNED** ✅  
§3 template placeholders: `` !`command` `` is described as "Shell output — rendered as-is (NOT executed, just show the template literally)."

**Minor fix:** The wording is ambiguous. "Rendered as-is" could mean "show the backtick syntax in the prompt" or "capture shell output and insert it." The user clearly meant "just show the template literally, don't execute." The plan text says this but should be even more explicit: **"The `` !`cmd` `` syntax is a static template marker. The LLM sees it as literal text. No shell execution occurs at command resolution time."**

---

### B5. "IF model NOT available → use CURRENT model"

**ALIGNED** ✅  
§4 command resolution step 5: "If `model` NOT available: use current model (per user requirement)."

**No fix needed.**

---

### B6. "Add the directory to LOAD the others cmd" (external dirs)

**ALIGNED** ✅  
§4 `external-dirs.ts` + loader: "User can configure additional command directories in config. Each directory scanned for `*.md` files."

**Minor fix:** The plan doesn't specify *where* the external directories are configured. Add a config key reference (e.g., `commands.externalDirs` in `config.json` or similar). Without this, implementation is ambiguous.

---

### B7. "Defer: arg completion, streaming"

**ALIGNED** ✅  
§4 Conflict check: "No streaming, no arg completion (deferred)."

**But** — `/compact` §2 says "Shows streaming status while compacting" which contradicts the deferral. See T4 above. **Remove streaming status from `/compact`.**

---

## C. Overlap with Existing Plans

### C1. `2026-05-10-advanced-config.md` (Advanced Config Plan)

**NO OVERLAP** ✅  
Advanced config exposes numeric runtime constants (timeouts, limits, retention). Slash commands are a separate feature (markdown-defined commands with autocomplete). They share the settings page pattern (sidebar + route) but no code overlap.

**Dependency:** The `/compact` command references `GET /compaction` which is a *separate* route from `/config`. No conflict.

---

### C2. `2026-05-12-compaction-settings-ui-design.md` (Compaction Settings Spec)

**OVERLAP — /compact command** ⚠️  
The slash commands plan §2 describes `/compact` calling the compaction API. The compaction settings spec defines that API.

**Verdict: BENIGN OVERLAP.** The slash plan correctly references `GET /compaction` as defined by the compaction spec. No re-definition occurs. The `/compact` command is a *consumer* of the compaction API, not a re-implementation.

**Fix:** Add an explicit dependency note: "Requires: compaction-settings API (`GET /compaction`) to be implemented first."

---

### C3. `2026-05-10-advanced-config-design.md` (Advanced Config Design Spec)

**NO OVERLAP** ✅  
Design spec covers ConfigStore, schema, and settings page layout. Slash commands plan creates a separate `commands/` server directory and separate settings page. No shared files except `SettingsSidebar.tsx` and `App.tsx` (both additive — adding new nav items/routes, not modifying existing ones).

---

## Summary

| Category | Count | Items |
|----------|-------|-------|
| Theatering (remove) | 4 | T1 shortcuts display, T2 fuzzy match, T4 streaming status, T5 empty defaults/ |
| Theatering (simplify) | 2 | T3 /help, T6 external-dirs split |
| ALIGNED | 5 | B1, B2, B4, B5, B6 |
| MISALIGNED | 2 | B3 (whitelist includes deferred unused fields), B7 (/compact streaming contradicts deferral) |
| Overlap — benign | 1 | C2 (compaction API dependency) |
| Overlap — conflict | 0 | — |

### Required Fixes Before Implementation

1. **Remove** keyboard shortcut display from autocomplete (T1)
2. **Replace** fuzzy match with plain string `includes()` (T2)
3. **Remove** streaming status from `/compact` (T4, fixes B7)
4. **Remove** `agent` and `subtask` from v1 whitelist (B3)
5. **Remove** `defaults/` directory placeholder (T5)
6. **Merge** `external-dirs.ts` into `loader.ts` (T6)
7. **Add** config key reference for external directories (B6)
8. **Add** dependency note: compaction API must exist first (C2)
9. **Clarify** `` !`cmd` `` is static text, no execution (B4)
