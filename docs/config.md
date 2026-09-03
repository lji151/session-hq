# Configuration

Everything session-hq does is driven by one file: `hq.config.json`, at the root of the HQ folder.

## Discovery order

The first of these that resolves wins:

1. **`HQ_ROOT` environment variable** — treated as the HQ root. If it contains a `hq.config.json`,
   that file is used; if not, built-in defaults apply. This is the override to reach for when a
   session must use a specific HQ regardless of where it was launched.
2. **Walking up from the current directory** — the first ancestor containing `hq.config.json`.
   This is what makes a repo-local HQ work: commit `hq.config.json` at the repo root and every
   session started inside that tree finds it.
3. **`~/.session-hq/hq.config.json`** — the per-user fallback.

If none resolve, the hooks stay silent. An unconfigured machine is never nagged; only `/hq-doctor`
and the CLI commands will tell you nothing is set up.

### Where the HQ root actually is

- Discovered via `HQ_ROOT`: the root is that path.
- Discovered by walk-up or home fallback: if the config sets `hqRoot`, that path is the root
  (with `~` expanded); otherwise **the directory containing the config file** is the root.

That second rule is what lets you drop a config file into a folder and have it just work, while
`hqRoot` still lets `~/.session-hq/hq.config.json` point at an HQ living somewhere else.

## Environment variables

| Variable | Effect |
|---|---|
| `HQ_ROOT` | Forces the HQ root; highest-priority discovery. |
| `HQ_DOMAIN` | This session's domain. Overrides `defaultDomain`. Usually set per terminal or per launcher. |
| `HQ_MEMORY_DIR` | Directory `memory-lint` scans by default. Falls back to `~/.claude/memory`. |

## The file

```json
{
  "hqRoot": "~/hq",
  "domains": ["video", "apps", "business"],
  "defaultDomain": null,
  "inject":    { "on": "session-start", "maxLines": 60, "staleAfterHours": 48 },
  "update":    { "mode": "on-stop", "everyNTools": 0, "minMinutesBetween": 20, "enforce": false },
  "inbox":     { "file": "ideas-inbox.md" },
  "decisions": { "file": "decisions.md" },
  "language":  "en"
}
```

Unknown keys are preserved and ignored. Missing keys fall back to the defaults above, so a partial
config is valid.

---

### `hqRoot`

**Type** string · **Default** `"~/hq"`

Where the HQ lives. `~` is expanded. Ignored when `HQ_ROOT` is set. Omit it entirely and the
config file's own directory becomes the root, which is usually what you want for a repo-local HQ.

Good candidates: a folder inside a git repo the team already shares; a synced drive folder; a
notes vault. It is plain markdown — anything that gets the files to the other sessions works.

### `domains`

**Type** string array · **Default** `["video", "apps", "business"]`

The lanes of work. Each becomes `status-<domain>.md`. Names are lowercased and slugified for the
filename, so keep them lowercase kebab-case to avoid surprises.

A domain is a lane a whole session tends to be about, not a single project. Three to seven is the
useful range: fewer and each status file becomes a junk drawer nobody reads; more and nobody keeps
them current. If you are unsure whether something is a new domain, it is not — put it in the
closest existing one and split later when the file actually gets unwieldy.

### `defaultDomain`

**Type** string or `null` · **Default** `null`

Domain to assume when `HQ_DOMAIN` is not set. Must be a member of `domains`. With `null` (the
default), a session that gives no domain is injected with the domain list and asked to pick via
`/hq-status <domain>`.

Set it on a machine that mostly does one kind of work. Leave it `null` when you routinely run
sessions across several domains — a wrong default is worse than no default, because it silently
writes the right update into the wrong file.

---

### `inject.on`

**Type** `"session-start"` · `"session-start+compact"` · `"off"` · **Default** `"session-start"`

When the status file is injected into context.

- `session-start` — once, at the top of the session.
- `session-start+compact` — also on `PreCompact`. Worth turning on for long sessions: compaction
  is exactly when a session loses the thread it was handed at the start.
- `off` — no automatic injection. `/hq-status` still works. Note that with injection off, no
  session state is recorded at start, so `on-stop` checking falls back to state created at the
  first tool call and cannot detect a change made before that point.

### `inject.maxLines`

**Type** positive integer · **Default** `60`

Line budget for the injected file. Beyond it the injection is truncated with a note pointing at
the full file. This is a context-cost control: a status file that has grown to 400 lines should be
pruned, not injected in full every session.

### `inject.staleAfterHours`

**Type** number ≥ 0 · **Default** `48`

Past this age, the injection carries a stale banner telling the session to verify anything it is
about to depend on.

Age comes from the `<!-- hq:updated ... -->` stamp on the first line of the status file, falling
back to the file's modification time when no stamp is present. Prefer the stamp: a git checkout,
a sync client, or a backup restore all rewrite mtimes and will make a stale file look fresh.

Tune it to your rhythm. A team pushing daily wants ~24. A solo project touched weekly wants ~168,
or the banner becomes wallpaper.

---

### `update.mode`

**Type** `"on-stop"` · `"periodic"` · `"manual"` · **Default** `"on-stop"`

- **`on-stop`** — when the session tries to stop, compare the status file against its hash at
  session start. If the session made tool calls and the file is unchanged, say so. At most one
  reminder per session.
- **`periodic`** — nudge during the session, every `everyNTools` tool calls, throttled by
  `minMinutesBetween`. Useful while a habit is forming, or for very long sessions where waiting
  until the end means writing the update from a compacted memory of what happened.
- **`manual`** — no reminders at all. Injection still happens; the commands still work. For people
  who already have the habit and find any nudge irritating.

### `update.everyNTools`

**Type** integer ≥ 0 · **Default** `0`

`periodic` only. Nudge every N tool calls. `0` disables nudging (and `doctor` warns if you set
`periodic` with `0`, since that combination does nothing). Sensible range: 30–60. Below ~20 you
will interrupt real work.

### `update.minMinutesBetween`

**Type** number ≥ 0 · **Default** `20`

`periodic` only. Minimum wall-clock minutes between nudges, regardless of the counter. This is
what stops a burst of fast tool calls producing a burst of nudges.

### `update.enforce`

**Type** boolean · **Default** `false`

`on-stop` only.

- `false` — a soft `systemMessage`. The session sees it and may act on it. This is the default,
  deliberately: a reminder that can be ignored is a reminder people leave switched on.
- `true` — the Stop hook returns a blocking decision, so the session must respond before it can
  stop. Real teeth, and it will feel like it. Reasonable when a missed handoff costs a colleague a
  morning; obnoxious for solo experimentation.

Two safeguards apply in both cases: a session that made no tool calls is never reminded, and a
re-entering Stop hook (`stop_hook_active`) is ignored so enforcement cannot loop.

---

### `inbox.file` / `decisions.file`

**Type** string · **Defaults** `"ideas-inbox.md"` / `"decisions.md"`

Filenames, relative to the HQ root, used by `/hq-inbox` and `/hq-decide`. Both are append-only by
convention: one dated line each, newest at the bottom. Point them into an existing notes system if
you have one.

### `language`

**Type** string · **Default** `"en"`

Language hint for generated templates and prose. It does not change the CLI's own output.

---

## Session state

Each session gets `<hqRoot>/.state/<session-id>.json`:

```json
{
  "sessionId": "…",
  "domain": "apps",
  "startedAt": "2026-01-31T09:00:00.000Z",
  "toolCalls": 34,
  "lastNudgeAt": null,
  "remindedAt": null,
  "statusHashAtStart": "…sha256…",
  "hqRoot": "…"
}
```

Bookkeeping only, safe to delete — you lose the current session's counter and nothing else. Add
`.state/` to `.gitignore` if the HQ lives in a repo; the shipped `.gitignore` already does.

There is no automatic cleanup. If you run many sessions, prune old files occasionally:

```bash
# POSIX
find "$HQ_ROOT/.state" -name '*.json' -mtime +30 -delete
```

```powershell
# Windows PowerShell
Get-ChildItem "$env:HQ_ROOT\.state\*.json" |
  Where-Object LastWriteTime -lt (Get-Date).AddDays(-30) |
  Remove-Item
```

## Verifying a setup

```bash
node scripts/hq.mjs doctor          # config, folders, staleness, hook declarations
node scripts/hq.mjs doctor --json   # same, machine-readable
```

`doctor` reads files. It cannot see the running session, so for "is the plugin actually loaded and
are its hooks registered", `claude plugin list` and the `/hooks` command are authoritative.
