// Running any agent CLI inside an HQ session: the adapter for tools with no hooks.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeJson, nowIso, cliCmd } from './util.mjs';
import { discoverConfig, statusPath, statePath, resolveDomain, isOrchestratorDomain } from './config.mjs';
import { hashFile } from './status.mjs';
import { buildDomainContext, buildIndexContext, buildOrchestratorContext } from './inject.mjs';
import { parseArgs } from './args.mjs';
/**
 * Run any agent CLI inside an HQ session.
 *
 * The generic adapter: no hooks, no plugin, no Claude Code. Prints the same
 * context the SessionStart hook would inject, runs the command with the
 * terminal attached, then checks on the way out whether anything was written
 * back. Exits with the child's exit code so it composes in scripts.
 */
export function cmdWrap(rawArgs) {
  const sep = rawArgs.indexOf('--');
  const ownArgs = sep === -1 ? rawArgs : rawArgs.slice(0, sep);
  const childArgs = sep === -1 ? [] : rawArgs.slice(sep + 1);
  const { flags } = parseArgs(ownArgs);

  if (childArgs.length === 0) {
    console.error('hq wrap: nothing to run.');
    console.error('usage: hq.mjs wrap --domain <d> [--quiet] [--expect-update] [--min-seconds N] -- <command> [args...]');
    process.exitCode = 1;
    return;
  }

  const found = discoverConfig();
  if (!found) {
    // Never block the user's real work over a missing config.
    console.error('session-hq: no hq.config.json found — running the command without an HQ session.');
    console.error('session-hq: run `hq.mjs init` to set one up.');
    process.exitCode = runChild(childArgs);
    return;
  }

  const { config, hqRoot } = found;
  const domain = resolveDomain({ config, explicit: typeof flags.domain === 'string' ? flags.domain : null });

  if (!flags.quiet) {
    console.log(!domain
      ? buildIndexContext({ config, hqRoot, adapter: 'cli' })
      : isOrchestratorDomain(domain, config)
        ? buildOrchestratorContext({ config, hqRoot, domain, adapter: 'cli' })
        : buildDomainContext({ config, hqRoot, domain, adapter: 'cli' }));
    console.log('');
  }

  const file = domain ? statusPath(hqRoot, domain) : null;
  const hashAtStart = file ? hashFile(file) : null;
  const startedAt = Date.now();
  const sessionId = `wrap-${crypto.randomUUID()}`;

  if (domain) {
    writeJson(statePath(hqRoot, sessionId), {
      sessionId,
      domain,
      startedAt: nowIso(),
      toolCalls: 0,
      lastNudgeAt: null,
      remindedAt: null,
      statusHashAtStart: hashAtStart,
      hqRoot,
      wrapped: childArgs[0],
    });
  }

  const code = runChild(childArgs);
  const ranSeconds = (Date.now() - startedAt) / 1000;

  if (domain && config.update.mode !== 'manual') {
    const minSeconds = Number(flags['min-seconds'] ?? 60);
    const worthReminding = flags['expect-update'] === true || ranSeconds >= minSeconds;
    const now = hashFile(file);
    const unchanged = !now || now === hashAtStart;
    if (worthReminding && unchanged) {
      // stderr, so it never contaminates a piped stdout.
      console.error('');
      console.error(
        `session-hq: that session ran for ${Math.round(ranSeconds)}s but \`status-${domain}.md\` is unchanged. ` +
        'Append what happened — outcome, next step, blockers, and anything you ruled out. ' +
        'Negative results matter: they stop the next session repeating your work.'
      );
      console.error(`session-hq: ${cliCmd(`inject --print --domain ${domain}`)}   # to see the current file`);
    }
  }

  process.exitCode = code;
}
/** Spawn with the terminal attached. Returns the exit code to propagate. */
function runChild(argv) {
  const [cmd, ...args] = argv;
  let res = spawnSync(cmd, args, { stdio: 'inherit', shell: false });

  // On Windows a .cmd/.bat shim is not a real executable and cannot be spawned
  // directly. Retry through the shell, but only for that failure.
  const needsShell = res.error && process.platform === 'win32' &&
    (res.error.code === 'ENOENT' || res.error.code === 'EINVAL');
  if (needsShell) {
    res = spawnSync(cmd, args, { stdio: 'inherit', shell: true });
  }

  if (res.error) {
    console.error(`session-hq: could not run "${cmd}": ${res.error.message}`);
    return 127;
  }
  if (res.signal) return 1;
  return res.status ?? 1;
}
