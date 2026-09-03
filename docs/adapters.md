# Adapters

The HQ is a folder of markdown files and `scripts/hq.mjs` is a dependency-free Node CLI. Together
they are the product. An **adapter** is whatever connects a particular agent to them.

There are three, and they differ in exactly one way: how much they can guarantee actually happens.

## The matrix

| | **Claude Code hooks** | **`wrap`** | **Instruction file** |
|---|---|---|---|
| Setup | install the plugin, `/hq-init` | `hq.mjs wrap -- <cmd>` | paste 3 lines into `AGENTS.md` etc. |
| Works with | Claude Code | any command-line agent | any agent that reads an instruction file |
| Status read at start | **guaranteed** — injected before the first turn | **guaranteed** — printed before the agent starts | best effort — the agent may skip it |
| Activity signal | **per tool call** (`PostToolUse`) | elapsed wall-clock time | none |
| Nudge during the session | yes (`update.mode: "periodic"`) | no | no |
| Omission noticed at the end | **guaranteed** — `Stop` hook | **guaranteed** — after the process exits | no |
| Can refuse to end the session | yes (`update.enforce: true`) | no — the agent has already exited | no |
| Survives context compaction | yes (`inject.on: "session-start+compact"`) | no | no |
| Writes the status content | never — a human or the session does | never | never |

Two things are true of all three: **the read is the easy part, and the write-back is the hard
part.** Anything that can only ask nicely will lose entries on the days when it matters most —
which is precisely the days a session ends tired, late, and with a dead end to report.

### Claude Code hooks

The only fully automatic adapter, because Claude Code exposes the two moments the protocol needs:
`SessionStart` (and optionally `PreCompact`) to inject, and `Stop` to check. `PostToolUse` supplies
a real activity signal, which is what makes it possible to distinguish a session that did nothing
from one that did thirty-four things and wrote none of them down.

`update.enforce: true` is available only here, since only a hook can refuse a stop.

### `wrap`

The generic adapter, and the one to reach for with anything else:

```bash
node scripts/hq.mjs wrap --domain apps -- <your agent command>
```

It prints the injection, runs the command with the terminal attached, and after the process exits
checks whether the status file changed. The child's exit code is propagated and the reminder goes
to stderr, so it composes in scripts and pipelines.

What it cannot do: see inside the session. It has no idea whether the agent ran two tools or two
hundred, so it substitutes elapsed time (`--min-seconds`, default 60) for the tool counter, and it
cannot nudge mid-session or block the exit. By the time `wrap` regains control the agent is gone.

Full option reference in [config.md](config.md#running-an-agent-inside-an-hq-session-wrap).

### Instruction file

Paste the protocol into whatever file the agent reads before working — `AGENTS.md`, `GEMINI.md`,
`.cursorrules`, a system prompt:

```markdown
At the start of a session, run: node ~/session-hq/scripts/hq.mjs inject --print --domain apps
Record ideas with `hq.mjs inbox "<line>"` and decisions with `hq.mjs decide "<line>"`.
Before finishing, update status-apps.md: Status, Next, Blocked on, Ruled out, Updated.
```

This is a **convention, not enforcement**. It costs nothing and it is better than no protocol at
all, but nothing verifies compliance, and compliance is exactly what degrades under time pressure.
Combine it with `wrap` where you can: the instruction file tells the agent what good looks like,
`wrap` makes sure the file is read and the omission is noticed.

Pointing the same instruction file at [`skills/hq-protocol/SKILL.md`](../skills/hq-protocol/SKILL.md)
is worth doing — it is plain markdown and contains the actual standard for a good entry.

## Writing an adapter

An adapter makes **two calls**. Everything else is packaging.

**1. At session start — read.**

```bash
node scripts/hq.mjs inject --print --domain <d>
```

Prints the trimmed status file with a staleness banner. Put the output in front of the model
however your tool does that: injected context, a prepended message, a file it is told to read.

For a tool with a real hook system, pipe the hook's JSON payload to stdin and use
`inject --event session-start` instead: it emits `{"hookSpecificOutput": {...}}`, records
`.state/<session-id>.json`, and stays silent when nothing is configured.

**2. At session end — check.**

```bash
echo '{"session_id":"<id>","cwd":"<dir>"}' | node scripts/hq.mjs update-check
```

Prints nothing if the session wrote back, if it did no work, or if it has already been reminded.
Otherwise it emits a `systemMessage`, or a blocking `decision` when `update.enforce` is set. It
needs the state file written at step 1, keyed by the same `session_id`.

**Rules for a well-behaved adapter:**

- **Never crash the session.** Every path exits 0 on unexpected input. A plugin that can break
  someone's workflow over a malformed config is worse than no plugin.
- **Stay silent when there is nothing to say.** No config, no domain, no work done: print nothing.
  Noise is what gets an adapter removed.
- **Never write status content.** Create the file, read it, ask for an update. A generated entry
  is a plausible-sounding entry, and one of those is all it takes for the file to stop being
  trusted.
- **Do not block the user's actual work.** `wrap` runs the command even when the HQ is missing,
  and warns on stderr instead.

Adapters for other agents are welcome as contributions — see
[CONTRIBUTING.md](../CONTRIBUTING.md). The useful ones are those built on a tool's own lifecycle
events, since that is the only way to get past best-effort.
