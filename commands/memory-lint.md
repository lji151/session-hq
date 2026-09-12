---
description: Lint a layered-memory directory for missing frontmatter, orphaned facts, broken links, oversized files, and values that disagree between files
argument-hint: "[--dir <path>] [--drift] [--drift-min-files <n>]"
allowed-tools: ["Bash", "Read", "Edit"]
---

# Lint the memory layer

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hq.mjs" memory-lint $ARGUMENTS
```

Defaults to `~/.claude/memory`; override with `--dir` or the `HQ_MEMORY_DIR` environment variable.
The lint only reads. It never edits the directory it is pointed at.

Findings come at three levels. `FAIL` fails the lint (exit 1), `warn` does not, and `info` is
advisory — see value drift below.

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
- **broken link `[[name]]` — no such file** — nothing in the directory is called `name.md`. This
  is what a rename leaves behind: the file that points at the old name still looks correct.
  *To fix:* if the finding offers *did you mean `[[feedback-episode-length]]`?*, the file was
  renamed with a type prefix and the link just needs the prefix. Otherwise the target is gone —
  delete the link or point it somewhere that exists. Bracket pairs that are plainly not links
  (`[[0.3,7.4]]`, `[[see the notes]]`) and links inside code blocks or code spans are ignored.
- **broken pointer link `(file.md)` — no such file** — a `[Text](file.md)` pointer in `MEMORY.md`
  or a domain index names a file that is not there. A dead end for every session that follows it.
  *To fix:* correct the filename, or drop the pointer if the fact was deleted.
- **frontmatter `name` does not match filename** — links to that `name` cannot resolve, and the
  next session writing a pointer will copy the wrong one. *To fix:* set `name` to the filename
  without `.md` (renaming the file instead means fixing every inbound link, so prefer the
  frontmatter).
- **value drift** (`info`, **only with `--drift`**) — the same parameter appears with different
  numbers in two or more files: `value drift: "gate °C" = 55 (a.md), 72 (b.md)`. Every one of
  those files is well formed, which is why nothing else catches it; the check exists because a
  hardware temperature gate was once written in eight files with seven different values.
  *To fix:* decide which value is current, pick one file as the source of truth, and make the
  others point at it instead of repeating the number.

  Drift is **off by default** and is a **heuristic advisory** when switched on. It never fails the
  lint, the list stops at ten keys followed by a line saying how many were held back
  (`12 more — raise --drift-min-files or fix these first`), and it will regularly pair two
  unrelated numbers that happen to share a word and a unit — read it as a list of things to look
  at, not a list of defects. `--drift-min-files <n>` (default 2) only reports a parameter that
  disagrees across at least *n* files, which is the quickest way to shorten a noisy list on a
  large directory. Run it when auditing a directory, not on every lint.

Fix findings with the user's agreement, one file at a time, smallest first. Do not bulk-rewrite
someone's memory directory; propose the edits and let them confirm. For drift in particular, ask
before changing a number — the lint knows the values disagree, not which one is right.
