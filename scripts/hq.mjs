#!/usr/bin/env node
/**
 * session-hq — a shared, file-based headquarters for many Claude Code sessions.
 *
 * Single entry point for every hook and slash command in the plugin.
 * Node built-ins only. ESM. No dependencies.
 *
 *   node hq.mjs init          [--root <dir>] [--domains a,b,c] [--profile gentle|coaching|strict|orchestrator] [--yes] [--force]
 *   node hq.mjs inject        [--event session-start|compact|manual] [--domain d] [--print]
 *   node hq.mjs remind                        (PostToolUse: periodic nudge)
 *   node hq.mjs update-check   [--domain d]     (Stop hook, or a manual report from a shell)
 *   node hq.mjs inbox         <text...>       [--domain d]
 *   node hq.mjs decide        <text...>       [--domain d]
 *   node hq.mjs dispatch      --to <domain> [--from d] [--priority p] "<task>"
 *   node hq.mjs done          <id> [--note "<line>"]
 *   node hq.mjs ack           <id>
 *   node hq.mjs dispatches    [--domain d] [--open|--awaiting-review|--all]
 *   node hq.mjs dashboard     [--watch [seconds]] [--no-open] [--terminal | --md | --html <file>]
 *                             [--theme auto|paper|terminal|slate] [--density comfortable|compact]
 *                             [--labels en|ko]
 *   node hq.mjs doctor        [--json]
 *   node hq.mjs memory-lint   [--dir <dir>] [--json]
 *   node hq.mjs leak-check    [--denylist <file>] [--dir <dir>]
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseArgs } from './lib/args.mjs';
import { cmdInit } from './lib/init.mjs';
import { cmdInject } from './lib/inject.mjs';
import { cmdRemind, cmdUpdateCheck } from './lib/hooks.mjs';
import { cmdWrap } from './lib/wrap.mjs';
import { cmdDispatch, cmdDone, cmdAck, cmdDispatches } from './lib/dispatch.mjs';
import { cmdDashboard } from './lib/dashboard.mjs';
import { appendLine } from './lib/notes.mjs';
import { cmdDoctor } from './lib/doctor.mjs';
import { cmdMemoryLint } from './lib/memory.mjs';

// The surface the tests and any other tooling import.
export { DEFAULT_CONFIG, CONFIG_NAME, discoverConfig, validateConfig, statusPath,
         resolveDomain, accountableDomain, isOrchestratorDomain } from './lib/config.mjs';
export { expandHome, safeSlug } from './lib/util.mjs';
export { collectDashboard, renderHtml, renderMarkdown, renderTerminal,
         resolveDashboardOptions } from './lib/dashboard.mjs';
export { THEMES, THEME_NAMES, DENSITIES, DENSITY_NAMES, SECTION_NAMES,
         DEFAULT_SECTIONS, buildCss } from './lib/theme.mjs';
export { LABEL_SETS, LABEL_SET_NAMES, LABELS_EN, LABELS_KO, resolveLabels } from './lib/labels.mjs';
export { lastUpdatedAt, hashFile, parseStatusFile, summariseDomain } from './lib/status.mjs';
export { dispatchPath, parseDispatches, readDispatches, openDispatchesFor,
         awaitingReview } from './lib/dispatch.mjs';
export { readHookInput } from './lib/hooks.mjs';
export { trimToLines } from './lib/inject.mjs';
export { lintMemoryDir } from './lib/memory.mjs';
export { cmdDoctor } from './lib/doctor.mjs';
export { parseArgs } from './lib/args.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function cmdLeakCheck(argv) {
  const mod = await import(pathToFileURL(path.join(HERE, 'leak-check.mjs')).href);
  await mod.main(argv);
}

const USAGE = `session-hq

  hq.mjs init          [--root <dir>] [--domains a,b,c] [--profile <name>] [--yes] [--force]
                                                three questions on a TTY; flags take precedence
  hq.mjs inject        [--event session-start|compact|manual] [--domain d] [--print]
  hq.mjs remind                                  PostToolUse counter / periodic nudge
  hq.mjs update-check  [--domain d]              Stop hook; from a shell, reports on the domain
  hq.mjs wrap          --domain <d> [--quiet] [--expect-update] -- <command> [args...]
  hq.mjs inbox         "<one line>" [--domain d]
  hq.mjs decide        "<one line>" [--domain d]
  hq.mjs dispatch      --to <domain> [--priority high] "<task>"   hand work to a department
  hq.mjs done          <id> [--note "<line>"]      report a dispatched task finished
  hq.mjs ack           <id>                        review and close a finished dispatch
  hq.mjs dispatches    [--domain d] [--awaiting-review|--all]
  hq.mjs dashboard     [--watch [seconds]] [--no-open] [--terminal | --md]   one page, opened for you
                       [--theme auto|paper|terminal|slate] [--density comfortable|compact]
                       [--labels en|ko]                    pick a look for this run
  hq.mjs doctor        [--json]
  hq.mjs memory-lint   [--dir <dir>] [--json]
  hq.mjs leak-check    [--denylist <file>] [--dir <dir>]
`;

export async function run(argv) {
  const [cmd, ...rest] = argv;
  const { flags, positional } = parseArgs(rest);
  switch (cmd) {
    case 'init': return cmdInit(flags);
    case 'inject': return cmdInject(flags);
    case 'remind': return cmdRemind();
    case 'update-check': return cmdUpdateCheck(flags);
    case 'wrap': return cmdWrap(rest);
    case 'inbox': return appendLine('inbox', flags, positional);
    case 'decide': return appendLine('decide', flags, positional);
    case 'dispatch': return cmdDispatch(flags, positional);
    case 'done': return cmdDone(flags, positional);
    case 'ack': return cmdAck(flags, positional);
    case 'dispatches': return cmdDispatches(flags);
    case 'dashboard': return cmdDashboard(flags);
    case 'doctor': return cmdDoctor(flags);
    case 'memory-lint': return cmdMemoryLint(flags);
    case 'leak-check': return cmdLeakCheck(rest);
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(USAGE);
      return;
    default:
      console.error(`hq: unknown command "${cmd}"\n`);
      console.error(USAGE);
      process.exitCode = 1;
  }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  run(process.argv.slice(2)).catch((err) => {
    // A hook must never take the session down with it.
    console.error(`session-hq: ${err.message}`);
    process.exitCode = 1;
  });
}
