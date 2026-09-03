---
description: Write this session's outcome back to the domain's HQ status file
argument-hint: "[domain]"
allowed-tools: ["Bash", "Read", "Edit"]
---

# Update the HQ status

The point of this command is that the *next* session — possibly tomorrow, possibly someone
else — does not repeat what this one just did.

## Steps

1. Resolve the domain: `$ARGUMENTS`, else `HQ_DOMAIN`, else `defaultDomain` in `hq.config.json`.
   If you still cannot tell, ask rather than guessing.

2. Read the current file before editing it:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/hq.mjs" inject --print --domain <domain>
   ```

3. **Edit the relevant `###` block in place.** Do not rewrite the file, and do not delete another
   session's entry — if something is now wrong, supersede it with a dated line.

4. Each block you touch must end up with all five fields:

   ```
   ### <workstream>
   - Status: <where it actually stands, one line>
   - Next: <the specific next action — a command, a file, a person; never "continue">
   - Blocked on: <what is waiting and on whom; "nothing" is a valid answer>
   - Ruled out: <what you tried that did not work, and the evidence>
   - Updated: YYYY-MM-DD (<domain>)
   ```

5. **Ruled out is mandatory when it applies.** If you spent this session proving that an
   approach does not work, that is the single most valuable line you will write today. Include
   the evidence in one clause — the error, the measurement, the refusal — not just "did not work".

6. Update the stamp on the first line of the file to the current UTC time:

   ```
   <!-- hq:updated 2026-01-31T09:15:00Z -->
   ```

7. If the user made a **decision** during this session, also run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/hq.mjs" decide "<one line>" --domain <domain>
   ```

## Anti-patterns

- Writing "worked on X" — that is not a status, it is a timesheet.
- Padding a block so it looks productive. A block that says "no change, still blocked on the
  same approval" is honest and useful.
- Recording an intention as an outcome.
