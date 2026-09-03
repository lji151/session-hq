# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-01-31

Initial release.

### Added

- **HQ folder protocol.** Per-domain `status-<domain>.md` files, an ideas inbox, and a decision
  log, created and repaired by `/hq-init`.
- **SessionStart injection.** The session's domain status file is injected at session start,
  trimmed to `inject.maxLines`, with a staleness banner past `inject.staleAfterHours`. Staleness
  is read from an explicit `<!-- hq:updated ... -->` stamp, falling back to file mtime.
- **PreCompact injection**, opt-in via `inject.on: "session-start+compact"`, so a long session
  does not lose the thread at compaction.
- **Configurable write-back cadence** — `update.mode` of `on-stop`, `periodic`, or `manual`;
  `everyNTools` and `minMinutesBetween` for periodic nudging; `update.enforce` to turn the
  on-stop reminder into a blocking Stop decision. Soft reminder is the default.
- **Slash commands**: `/hq-init`, `/hq-status`, `/hq-update`, `/hq-inbox`, `/hq-decide`,
  `/hq-doctor`, `/memory-lint`.
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
- **Templates** for the HQ files, the memory layer, and subagent briefs.
- **Recipes** for a chat notifier, multi-shot deadline reminders across three schedulers, a
  conversation archiver, and screen capture.
- **Docs**: design and tradeoffs, a full config reference, and three case studies.
- **Example HQ** under `examples/hq-example/` with three fictional domains and filled-in entries.
- Korean README.

### Fixed

- Pre-release: the PostToolUse tool counter only incremented in `periodic` mode, so `on-stop` —
  the default — could never tell a session that did nothing from one that did real work and
  wrote nothing back, and its reminder would never have fired. The counter is now maintained in
  every non-manual mode. Caught by end-to-end testing against a live session; the cadence tests
  now assert both directions.

### Notes

- Requires Node 18 or newer, which Claude Code already requires. No other dependencies.
- Hooks load at session start, so Claude Code must be restarted after installing.
- Hooks stay silent on a machine with no HQ configured.

[Unreleased]: https://github.com/your-github-username/session-hq/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/your-github-username/session-hq/releases/tag/v0.1.0
