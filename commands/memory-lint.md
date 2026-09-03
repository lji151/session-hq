---
description: Lint a layered-memory directory for missing frontmatter, orphaned facts, and oversized files
argument-hint: "[--dir <path>]"
allowed-tools: ["Bash", "Read", "Edit"]
---

# Lint the memory layer

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hq.mjs" memory-lint $ARGUMENTS
```

Defaults to `~/.claude/memory`; override with `--dir` or the `HQ_MEMORY_DIR` environment variable.

What the findings mean:

- **no frontmatter / missing `description`** — a fact file with no description is invisible.
  Sessions decide what to open from the description alone, so a vague one is as bad as none.
- **orphan** — the file is not linked from `MEMORY.md` or any `index-*.md`. Nothing will ever
  read it. Either link it from the right domain index or delete it.
- **domain index not linked from MEMORY.md** — the whole domain is unreachable.
- **N lines, consider splitting** — layered memory is one fact per file. A long file means the
  session either loads a lot of irrelevance or skips the file entirely.
- **feedback file has no Why / How to apply** — a correction without a reason gets argued
  with, and one without concrete steps gets forgotten.

Fix findings with the user's agreement, one file at a time, smallest first. Do not bulk-rewrite
someone's memory directory; propose the edits and let them confirm.
