---
name: layered-memory
description: This skill should be used when writing, organising, or auditing persistent memory files — when the user says "remember this", "save that as a rule", "don't do that again", when a memory directory has grown unwieldy or full of duplicates, when deciding whether a fact deserves a file at all, or when running /memory-lint. Defines the index -> domain index -> one-fact-per-file layering, the frontmatter schema, the triage-first rule, and the Why / How-to-apply format for corrections.
version: 0.1.0
---

# Layered memory

## The problem this solves

Flat memory does not scale. A single growing file of everything the assistant should remember has
two failure modes and no third option: read it all every session and drown in irrelevance, or
skip it and remember nothing. Both get worse with every fact you add.

Layering fixes it by making the *cost of remembering* proportional to relevance rather than to
volume.

## The three layers

```
MEMORY.md                    always read. Always-apply rules + pointers to domain indexes.
  index-<domain>.md          read only when the session's work matches that domain.
    <type>-<topic>.md        read only when its one-line description says it is relevant.
```

**Layer 1 — `MEMORY.md`.** The only file read unconditionally. It holds two things: rules that
apply regardless of what the session is doing, and one-line pointers to the domain indexes.
Everything here is paid for on every session, so the bar for adding to it is high: a rule belongs
in layer 1 only if it spans two or more domains.

**Layer 2 — `index-<domain>.md`.** One per lane of work. The session reads the *one* index
matching the task at hand and no others. This is the whole saving. A domain index holds pointers
grouped by sub-area, plus anything a session must know before touching that domain at all.

**Layer 3 — the fact files.** One fact per file. If a file needs two headings for two unrelated
things, it is two files.

## Triage first

The rule that makes the rest work: **at the start of a session, identify the domain, read that
index, and read nothing else.** Not "read a few indexes to be safe" — that reintroduces the
problem the layering exists to solve. If no domain matches, do the work without an index, and ask
the user before inventing a new domain. Domains are cheap to add and expensive to have too many of.

## Frontmatter schema

Every file below `MEMORY.md` carries:

```yaml
---
name: kebab-case-file-name
description: One line. This is the only thing a session sees before deciding whether to open the file.
type: user | feedback | project | reference
---
```

- **`name`** matches the filename, minus `.md`. A `[[name]]` written anywhere in the directory
  must resolve to a file in it, so a rename breaks every link to the old name — `/memory-lint`
  reports each one, and the frontmatter `name` left behind by the rename.
- **`description`** is load-bearing. It is a *routing* line, not a title. Compare:
  - Useless: `description: notes about the deploy process`
  - Useful: `description: deploys need an explicit approval step; the CLI has no dry-run, so a mistake is live immediately`
  The second one tells a session both when to open the file and roughly what it will find.
- **`type`** drives the lint and tells the reader what kind of claim the file makes:

| type | Holds | Example |
|---|---|---|
| `user` | durable facts about the person you work for | working language, timezone, what they consider done |
| `feedback` | a correction they gave, and how not to repeat it | "never deploy without showing me first" |
| `project` | the state and shape of one project | stack, entry points, the one gotcha |
| `reference` | a tool, a credential location, an infrastructure detail | where keys live, which script wraps the build |

## The Why / How-to-apply format, for corrections

A `feedback` file needs three parts, and the last two are what make it survive.

```markdown
---
name: feedback-verify-before-reporting
description: Report only what you actually checked; say plainly what you did not check
type: feedback
---

The user's instruction (2026-01-14, said twice): report what was verified, and name what was not.

**Why:** A report that implies coverage it does not have is worse than a short one, because the
user stops checking. This came up after a summary claimed a suite passed when only part of it ran.

**How to apply:**
- Before reporting, list what you ran and what it output. Anything not on that list is unverified.
- Write the unverified items out explicitly. "I did not test X" is a required line, not a caveat.
- Never soften an unverified claim into "should work" — say it was not tested.
- No exceptions for small changes.
```

- **Why** stops the rule being argued away. A rule with no reason reads as arbitrary, and the next
  session will "improve" it. Quote what the user actually said, and date it.
- **How to apply** makes it checkable. Not "be careful about X" but "before X, do Y; if Y says Z,
  stop and ask." A rule you cannot check is a rule you cannot follow.
- Name the exception, or state that there is none. Unstated exceptions get invented under pressure.

## Writing a new memory: the checklist

1. **Is it durable?** Facts that expire in a week belong in the HQ status file, not in memory.
   Memory is for what will still be true next quarter.
2. **Does it already exist?** Search before writing. Two files saying the same thing differently
   is worse than either alone, because now they can disagree.
3. **Which layer?** Cross-domain rule to layer 1. Everything else to a domain index.
4. **Which type?** Pick from the four. If nothing fits, the fact is probably two facts.
5. **Write the description last**, once you know what the file says, and write it as a routing
   line rather than a title.
6. **Add the pointer to the domain index**, not to `MEMORY.md`. A file with no inbound link is a
   file nothing will ever read. `/memory-lint` flags these as orphans.

## Maintenance

Run `/memory-lint` periodically. It catches the failure modes that accumulate silently: missing
or vague frontmatter, orphaned files, unreachable domain indexes, files that have grown past one
fact, and links that no longer resolve. It also reports **value drift** — the same parameter
written with different numbers in different files — as an advisory, because that is the one
kind of rot where every file involved is perfectly well formed.

When a fact turns out to be wrong, correct the file — do not add a second file contradicting the
first. When a project ends, delete its files rather than leaving them to mislead. Memory that is
never pruned becomes memory that is never trusted.
