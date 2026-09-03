# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] — 2026-02-06

Most people are not power users. Three dashboard renderings and a wall of config is how the
project went unused rather than used daily; this release gives them one thing to look at and an
easy way to choose how they want to be reminded. File formats, the protocol, and the hooks are
unchanged — every 0.1.0 HQ folder keeps working exactly as it did.

### Added

- **`hq.mjs dashboard` opens a page.** With no flags, it now writes `<hqRoot>/dashboard.html` and
  opens it in the default browser (`cmd /c start` on Windows, `open` on macOS, `xdg-open` on
  Linux — spawned detached, never waited on), printing one line: where the file is and how to
  keep it fresh. `--watch [seconds=30]` keeps regenerating the file and has the page auto-refresh
  itself via `<meta http-equiv="refresh">`; no server, no port, Ctrl-C ends it. `--no-open` (or an
  open failure) still prints that same one line. The previous default text view moves behind
  `--terminal` (byte-for-byte unchanged); `--md` and `--html <file>` are unchanged.
- **The page leads with what you missed.** Stale, Blocked, Awaiting review and Untouched now come
  before the domain table and the inbox/decisions counts, and it wraps at phone width.
- **`hq.mjs init` asks three questions.** On a TTY, with no `--root`/`--domains`/`--profile`
  given, `init` asks where the HQ lives, what the domains are, and how sessions should be
  reminded — defaults in brackets, Enter accepts them. A non-TTY run or `--yes` skips straight to
  the defaults. Flags still take precedence over their matching question, one at a time.
- **`--profile gentle|coaching|strict|orchestrator`**, for `init` or as the third question's
  answer, sets `update.*` to a named cadence people actually run (see
  [docs/config.md](docs/config.md#profiles)). `orchestrator` uses the same cadence as `gentle`
  and prints how to start the coordinating session (`HQ_DOMAIN=hq`).
- **`init` ends with something to look at.** Every run now (re)writes `dashboard.html` from
  whatever configuration is actually on disk and prints its path.

### Changed

- **README Quick start is three commands per path**, nothing else. Every other flag, the
  instruction-file example, and the terminal/markdown dashboard views moved to
  [docs/config.md](docs/config.md) and [docs/adapters.md](docs/adapters.md), which are now the
  first place to look for anything beyond the two quick-start paths.
- `/hq-dashboard` opens the page and separately replies in chat with the four lists (via
  `--terminal`), instead of reading a table back row by row.
- `/hq-init` now asks the same three questions itself, in one chat message, and passes the
  answers through as `--root`/`--domains`/`--profile`.

### Notes

- Two 0.1.0 tests asserted terminal output from a bare `dashboard` call, which is now the
  page-opening default; both were updated to pass `--terminal` rather than weakened or dropped.
- 106 tests (up from 93), still no network calls and no committed fixtures.

## [0.1.0] — 2026-01-31

Initial release.

### Added

- **HQ folder protocol.** Per-domain `status-<domain>.md` files, an ideas inbox, and a decision
  log, created and repaired by `hq.mjs init` (or `/hq-init` under Claude Code). Plain markdown and
  a dependency-free Node CLI are the product; adapters connect agents to them.
- **`hq.mjs wrap`** — the agent-neutral adapter. Prints the injection, runs any agent command with
  the terminal attached, propagates its exit code, and checks on exit whether anything was written
  back. Handles Windows `.cmd`/`.bat` shims via a shell fallback.
- **SessionStart injection.** The session's domain status file is injected at session start,
  trimmed to `inject.maxLines`, with a staleness banner past `inject.staleAfterHours`. Staleness
  is read from an explicit `<!-- hq:updated ... -->` stamp, falling back to file mtime.
- **PreCompact injection**, opt-in via `inject.on: "session-start+compact"`, so a long session
  does not lose the thread at compaction.
- **Configurable write-back cadence** — `update.mode` of `on-stop`, `periodic`, or `manual`;
  `everyNTools` and `minMinutesBetween` for periodic nudging; `update.enforce` to turn the
  on-stop reminder into a blocking Stop decision. Soft reminder is the default.
- **`hq.mjs dashboard`** — every domain on one screen: a table of last-updated, workstream,
  blocker and next-action counts, then the three lists that answer "what have I missed" (stale,
  blocked, untouched), the inbox count and the last decisions. `--md`, and `--html <file>` for a
  self-contained page with no scripts or network references.
- **Dispatch.** `dispatches.md` carries work handed from one seat to a department and the result
  handed back: `dispatch --to <domain> "<task>"`, `done <id> --note "<result>"`, `ack <id>`, and
  `dispatches` to list. A domain's open dispatches lead its session injection; reporting one done
  counts as writing back; the dashboard gains an `ASKED` column and an **Awaiting review** queue.
  The file is the channel, so a dispatch works when the target session is closed.
- **Slash commands**: `/hq-init`, `/hq-status`, `/hq-update`, `/hq-inbox`, `/hq-decide`,
  `/hq-doctor`, `/hq-dashboard`, `/hq-dispatch`, `/hq-done`, `/hq-ack`, `/memory-lint`.
- **Skills**: `hq-protocol` (when to read and write, what a real status entry contains, why
  negative results are mandatory), `layered-memory` (index to domain index to one fact per file,
  with the frontmatter schema and the Why / How-to-apply format), `orchestrator-routing`
  (coordinator, coder and researcher tiers, the brief template, the review-before-showing
  checklist).
- **`scripts/hq.mjs`** — one dependency-free ESM CLI behind every hook and command:
  `init`, `inject`, `remind`, `update-check`, `inbox`, `decide`, `doctor`, `memory-lint`,
  `leak-check`.
- **`scripts/leak-check.mjs`** — scans tracked files against an out-of-repo denylist and exits 1
  on any hit, so personal data cannot be published by accident.
- **Orchestrator session.** A session whose domain is `orchestrator.domain` (`hq` by default, or
  `HQ_DOMAIN=all`) is injected with the whole HQ — the dashboard in markdown plus its own
  `status-hq.md` — instead of a single status file. For that seat, a write to either its own file
  or `decisions.md` counts as reporting back. Because the record is on disk rather than in a
  transcript, department sessions can be closed and reopened freely.
- **Templates** for the HQ files, the orchestrator seat, the memory layer, and subagent briefs.
- **Recipes** for a chat notifier, multi-shot deadline reminders across three schedulers, a
  conversation archiver, and screen capture.
- **Docs**: an adapter matrix with a "writing an adapter" guide, design and tradeoffs, a full
  config reference, and three case studies.
- **Example HQ** under `examples/hq-example/` with three fictional domains and filled-in entries.
- Korean README.

- **An animated `docs/demo.svg`** in both READMEs: the 60-second transcript played line by line
  over 25 seconds and looping. Self-contained SMIL, no scripts, no external fonts, no network
  requests; the fenced transcript stays below it for text readers.
- **`scripts/lib/`.** `hq.mjs` is now a thin CLI over one module per concern, with a one-way
  dependency direction. No behaviour, output, exit code or file format changed.

- **`llms.txt`** at the repo root, and an **At a glance** block in both READMEs: the project's
  claims with the command or file that checks each one — no dependencies, no network calls, the
  four environment variables it reads, the files it writes, the test count, the CI matrix.
- **[docs/security.md](docs/security.md)** — what executes and when, the HQ folder as the trust
  boundary, secrets and the leak-check gate, and how to report a vulnerability.
- **A "Compared with" table** in both READMEs, by category rather than product: what each kind
  of tool stores, who reads it, how long it lives, and what it does not do.

### Fixed

- Pre-release: the PostToolUse tool counter only incremented in `periodic` mode, so `on-stop` —
  the default — could never tell a session that did nothing from one that did real work and
  wrote nothing back, and its reminder would never have fired. The counter is now maintained in
  every non-manual mode. Caught by end-to-end testing against a live session; the cadence tests
  now assert both directions.

### Notes

- Requires Node 18 or newer. Claude Code is needed only for the plugin adapter.
- Hooks load at session start, so Claude Code must be restarted after installing.
- Every adapter stays silent on a machine with no HQ configured; `wrap` runs the command anyway.

[Unreleased]: https://github.com/lji151/session-hq/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/lji151/session-hq/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/lji151/session-hq/releases/tag/v0.1.0
