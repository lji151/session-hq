#!/usr/bin/env node
/**
 * session-hq — a shared, file-based headquarters for many Claude Code sessions.
 *
 * Single entry point for every hook and slash command in the plugin.
 * Node built-ins only. ESM. No dependencies.
 *
 *   node hq.mjs init          [--root <dir>] [--domains a,b,c] [--force]
 *   node hq.mjs inject        [--event session-start|compact|manual] [--domain d] [--print]
 *   node hq.mjs remind                        (PostToolUse: periodic nudge)
 *   node hq.mjs update-check   [--domain d]     (Stop hook, or a manual report from a shell)
 *   node hq.mjs inbox         <text...>       [--domain d]
 *   node hq.mjs decide        <text...>       [--domain d]
 *   node hq.mjs dashboard     [--stale-hours N] [--md | --html <file>]
 *   node hq.mjs doctor        [--json]
 *   node hq.mjs memory-lint   [--dir <dir>] [--json]
 *   node hq.mjs leak-check    [--denylist <file>] [--dir <dir>]
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const HERE = path.dirname(SELF);
const PLUGIN_ROOT = path.resolve(HERE, '..');
const TEMPLATES = path.join(PLUGIN_ROOT, 'templates');
const CONFIG_NAME = 'hq.config.json';

export const DEFAULT_CONFIG = {
  hqRoot: '~/hq',
  domains: ['video', 'apps', 'business'],
  defaultDomain: null,
  inject: { on: 'session-start', maxLines: 60, staleAfterHours: 48 },
  update: { mode: 'on-stop', everyNTools: 0, minMinutesBetween: 20, enforce: false },
  orchestrator: { domain: 'hq', injectDashboard: true, maxLines: 80 },
  inbox: { file: 'ideas-inbox.md' },
  decisions: { file: 'decisions.md' },
  language: 'en',
};

const INJECT_MODES = ['session-start', 'session-start+compact', 'off'];
const UPDATE_MODES = ['on-stop', 'periodic', 'manual'];
const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'];

/* ------------------------------------------------------------------ utils */

export function expandHome(p) {
  if (typeof p !== 'string' || p.length === 0) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}
function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function safeReadJson(p) {
  try { return readJson(p); } catch { return {}; }
}
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}
function deepMerge(base, override) {
  const out = { ...base };
  for (const [k, v] of Object.entries(override || {})) {
    const bothPlainObjects =
      v && typeof v === 'object' && !Array.isArray(v) &&
      base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]);
    if (bothPlainObjects) out[k] = deepMerge(base[k], v);
    else if (v !== undefined) out[k] = v;
  }
  return out;
}
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function nowIso() {
  return new Date().toISOString();
}
/** Cross-platform slug so a domain name can never escape the HQ root. */
export function safeSlug(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64);
}

/* ----------------------------------------------------------------- config */

/**
 * Discovery order: HQ_ROOT env -> walk up from cwd -> ~/.session-hq/hq.config.json
 * Returns { config, configPath, hqRoot, source } or null when nothing is configured.
 */
export function discoverConfig({ cwd = process.cwd(), env = process.env } = {}) {
  if (env.HQ_ROOT) {
    const root = path.resolve(expandHome(env.HQ_ROOT));
    const cfgPath = path.join(root, CONFIG_NAME);
    const config = isFile(cfgPath) ? deepMerge(DEFAULT_CONFIG, safeReadJson(cfgPath)) : { ...DEFAULT_CONFIG };
    return { config, configPath: isFile(cfgPath) ? cfgPath : null, hqRoot: root, source: 'HQ_ROOT' };
  }

  let dir = path.resolve(cwd);
  for (;;) {
    const cfgPath = path.join(dir, CONFIG_NAME);
    if (isFile(cfgPath)) return fromConfigFile(cfgPath, 'cwd-walk');
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const homeCfg = path.join(os.homedir(), '.session-hq', CONFIG_NAME);
  if (isFile(homeCfg)) return fromConfigFile(homeCfg, 'home');

  return null;
}

function fromConfigFile(cfgPath, source) {
  const raw = safeReadJson(cfgPath);
  const config = deepMerge(DEFAULT_CONFIG, raw);
  // An explicit hqRoot wins; otherwise the config file's own directory is the root.
  const hqRoot = raw.hqRoot ? path.resolve(expandHome(raw.hqRoot)) : path.dirname(cfgPath);
  return { config, configPath: cfgPath, hqRoot, source };
}

export function validateConfig(config) {
  const errors = [];
  const warnings = [];
  if (!config || typeof config !== 'object') return { errors: ['config is not an object'], warnings };

  if (!Array.isArray(config.domains) || config.domains.length === 0) {
    errors.push('domains must be a non-empty array');
  } else if (config.domains.some((d) => safeSlug(d) !== String(d).toLowerCase())) {
    warnings.push('domain names should be lowercase kebab-case (they become file names)');
  }
  if (config.defaultDomain !== null && config.defaultDomain !== undefined) {
    if (!Array.isArray(config.domains) || !config.domains.includes(config.defaultDomain)) {
      errors.push(`defaultDomain "${config.defaultDomain}" is not in domains`);
    }
  }
  if (!INJECT_MODES.includes(config.inject?.on)) errors.push(`inject.on must be one of ${INJECT_MODES.join(' | ')}`);
  if (!Number.isInteger(config.inject?.maxLines) || config.inject.maxLines < 1) errors.push('inject.maxLines must be a positive integer');
  if (typeof config.inject?.staleAfterHours !== 'number' || config.inject.staleAfterHours < 0) errors.push('inject.staleAfterHours must be a non-negative number');
  if (!UPDATE_MODES.includes(config.update?.mode)) errors.push(`update.mode must be one of ${UPDATE_MODES.join(' | ')}`);
  if (!Number.isInteger(config.update?.everyNTools) || config.update.everyNTools < 0) errors.push('update.everyNTools must be a non-negative integer');
  if (config.update?.mode === 'periodic' && config.update.everyNTools === 0) {
    warnings.push('update.mode is "periodic" but update.everyNTools is 0, so no nudge will ever fire');
  }
  if (typeof config.update?.minMinutesBetween !== 'number' || config.update.minMinutesBetween < 0) errors.push('update.minMinutesBetween must be a non-negative number');
  if (typeof config.update?.enforce !== 'boolean') errors.push('update.enforce must be a boolean');
  if (!config.orchestrator?.domain) errors.push('orchestrator.domain is required');
  if (typeof config.orchestrator?.injectDashboard !== 'boolean') errors.push('orchestrator.injectDashboard must be a boolean');
  if (!Number.isInteger(config.orchestrator?.maxLines) || config.orchestrator.maxLines < 1) errors.push('orchestrator.maxLines must be a positive integer');
  if (Array.isArray(config.domains) && config.domains.map(safeSlug).includes(safeSlug(config.orchestrator?.domain))) {
    warnings.push('orchestrator.domain is also listed in domains; it is a seat, not a department, and will appear as a dashboard row');
  }
  if (!config.inbox?.file) errors.push('inbox.file is required');
  if (!config.decisions?.file) errors.push('decisions.file is required');
  return { errors, warnings };
}

/* ------------------------------------------------------------------ paths */

export function statusPath(hqRoot, domain) {
  return path.join(hqRoot, `status-${safeSlug(domain)}.md`);
}
function statePath(hqRoot, sessionId) {
  return path.join(hqRoot, '.state', `${safeSlug(sessionId) || 'unknown'}.json`);
}

/* ------------------------------------------------- hook stdin / stdout IO */

export function readHookInput() {
  try {
    // A terminal never sends EOF, so reading fd 0 there would block forever.
    if (process.stdin.isTTY) return {};
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** A copy-pasteable invocation of this very script, for adapters with no slash commands. */
function cliCmd(rest) {
  return `node "${SELF}" ${rest}`;
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

/* ------------------------------------------------------------- templating */

function renderTemplate(name, vars) {
  let text = fs.readFileSync(path.join(TEMPLATES, name), 'utf8');
  for (const [k, v] of Object.entries(vars)) {
    text = text.split(`{{${k}}}`).join(String(v));
  }
  return text;
}

/* -------------------------------------------------------- status metadata */

const STAMP_RE = /<!--\s*hq:updated\s+([0-9T:.\-Z]+)\s*-->/;

/** Last-updated time for a status file: explicit stamp first, mtime as fallback. */
export function lastUpdatedAt(file) {
  if (!isFile(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(STAMP_RE);
  if (m) {
    const d = new Date(m[1]);
    if (!Number.isNaN(d.getTime())) return { at: d, source: 'stamp' };
  }
  return { at: fs.statSync(file).mtime, source: 'mtime' };
}

function hashFile(file) {
  if (!isFile(file)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function hoursSince(date) {
  return (Date.now() - date.getTime()) / 3600000;
}

/* ------------------------------------------------------- domain selection */

export function resolveDomain({ config, env = process.env, explicit = null }) {
  if (explicit) return safeSlug(explicit);
  if (env.HQ_DOMAIN) return safeSlug(env.HQ_DOMAIN);
  if (config.defaultDomain) return safeSlug(config.defaultDomain);
  return null;
}

/* ------------------------------------------------------------- arg parser */

export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) flags[a.slice(2)] = true;
        else { flags[a.slice(2)] = next; i++; }
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

/* --------------------------------------------------------------- cmd:init */

function cmdInit(flags) {
  const existing = discoverConfig();
  const root = path.resolve(expandHome(
    flags.root || process.env.HQ_ROOT || (existing && existing.hqRoot) || DEFAULT_CONFIG.hqRoot
  ));
  const domains = (typeof flags.domains === 'string' ? flags.domains.split(',') : DEFAULT_CONFIG.domains)
    .map(safeSlug)
    .filter(Boolean);
  if (domains.length === 0) {
    console.error('hq init: at least one domain is required (--domains a,b,c)');
    process.exitCode = 1;
    return;
  }

  const cfgPath = path.join(root, CONFIG_NAME);
  const created = [];
  const skipped = [];

  fs.mkdirSync(path.join(root, '.state'), { recursive: true });

  const config = { ...DEFAULT_CONFIG, hqRoot: flags.root ? root : DEFAULT_CONFIG.hqRoot, domains };
  if (!isFile(cfgPath) || flags.force) {
    writeJson(cfgPath, config);
    created.push(cfgPath);
  } else {
    skipped.push(cfgPath);
  }

  const domainTable = domains.map((d) => `| \`status-${d}.md\` | ${d} |`).join('\n');
  const files = [
    ['README.md', 'HQ-README.md', { DOMAIN_TABLE: domainTable, DATE: todayIso(), HQ_ROOT: root }],
    [config.inbox.file, 'ideas-inbox.md', { DATE: todayIso() }],
    [config.decisions.file, 'decisions.md', { DATE: todayIso() }],
  ];
  for (const d of domains) {
    files.push([`status-${d}.md`, 'status-domain.md', { DOMAIN: d, DATE: todayIso(), STAMP: nowIso() }]);
  }
  // The orchestrator seat is not a department, so it is not in `domains` and gets its own file.
  const seat = safeSlug(config.orchestrator.domain);
  if (seat && !domains.includes(seat)) {
    files.push([`status-${seat}.md`, 'status-orchestrator.md', { DOMAIN: seat, DATE: todayIso(), STAMP: nowIso() }]);
  }

  for (const [dest, tpl, vars] of files) {
    const out = path.join(root, dest);
    if (isFile(out) && !flags.force) { skipped.push(out); continue; }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, renderTemplate(tpl, vars), 'utf8');
    created.push(out);
  }

  console.log(`session-hq initialised at ${root}`);
  for (const c of created) console.log(`  created  ${path.relative(root, c) || path.basename(c)}`);
  for (const s of skipped) console.log(`  kept     ${path.relative(root, s) || path.basename(s)} (already existed; pass --force to overwrite)`);
  console.log('');
  console.log('Next: set HQ_DOMAIN per session, or set "defaultDomain" in hq.config.json.');
  console.log('Then run: node scripts/hq.mjs doctor');
}

/* ------------------------------------------------------------- cmd:inject */

function cmdInject(flags) {
  const event = flags.event || 'manual';
  const printMode = flags.print === true || event === 'manual';
  const hook = printMode ? {} : readHookInput();
  const cwd = hook.cwd || process.cwd();

  const found = discoverConfig({ cwd });
  if (!found) {
    // Stay silent inside hooks: an unconfigured machine should never be nagged.
    if (printMode) console.log('session-hq: no hq.config.json found. Run `hq.mjs init` to create one.');
    return;
  }
  const { config, hqRoot } = found;

  if (config.inject.on === 'off' && !printMode) return;
  if (event === 'compact' && config.inject.on !== 'session-start+compact') return;

  const domain = resolveDomain({ config, explicit: typeof flags.domain === 'string' ? flags.domain : null });
  const adapter = printMode ? 'cli' : 'hooks';
  const body = !domain
    ? buildIndexContext({ config, hqRoot, adapter })
    : isOrchestratorDomain(domain, config)
      ? buildOrchestratorContext({ config, hqRoot, domain, adapter })
      : buildDomainContext({ config, hqRoot, domain, adapter });

  // Record session state so `update-check` can tell whether anything changed.
  if (hook.session_id) {
    const owner = domain ? accountableDomain(domain, config) : null;
    const file = owner ? statusPath(hqRoot, owner) : null;
    writeJson(statePath(hqRoot, hook.session_id), {
      sessionId: hook.session_id,
      domain: owner,
      orchestrator: domain ? isOrchestratorDomain(domain, config) : false,
      decisionsHashAtStart: domain && isOrchestratorDomain(domain, config)
        ? hashFile(path.join(hqRoot, config.decisions.file))
        : null,
      startedAt: nowIso(),
      toolCalls: 0,
      lastNudgeAt: null,
      remindedAt: null,
      statusHashAtStart: file ? hashFile(file) : null,
      hqRoot,
    });
  }

  if (printMode) { console.log(body); return; }

  if (event === 'compact') {
    emit({ systemMessage: body, suppressOutput: true });
  } else {
    emit({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: body },
      suppressOutput: true,
    });
  }
}

export function trimToLines(text, maxLines) {
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join('\n') +
    `\n\n… trimmed to ${maxLines} lines (inject.maxLines). Read the full file for the rest.`;
}

function buildDomainContext({ config, hqRoot, domain, adapter = 'hooks' }) {
  const file = statusPath(hqRoot, domain);
  const head = [
    '## session-hq — HQ status for this session',
    '',
    `Domain: **${domain}**   ·   HQ root: \`${hqRoot}\``,
  ];
  if (!isFile(file)) {
    head.push('', adapter === 'hooks'
      ? `No status file yet at \`${path.basename(file)}\`. Run \`/hq-update ${domain}\` at the end of this session to create one.`
      : `No status file yet. Create it at \`${file}\` before this session ends.`);
    return head.join('\n');
  }
  const stamp = lastUpdatedAt(file);
  const age = hoursSince(stamp.at);
  if (age > config.inject.staleAfterHours) {
    head.push(
      '',
      `> **Stale:** last updated ${Math.round(age)}h ago (threshold ${config.inject.staleAfterHours}h, from ${stamp.source}).`,
      '> Treat the entries below as possibly out of date and verify anything you rely on.'
    );
  } else {
    head.push('', `Last updated ${Math.round(age)}h ago (from ${stamp.source}).`);
  }
  head.push('');
  if (adapter === 'hooks') {
    head.push(
      'Read this before planning. At the end of the session update it with `/hq-update` —',
      'what changed, what is next, what is blocked, and what you *ruled out*.'
    );
  } else {
    // No slash commands here: this text is printed by `wrap`, or by `inject --print` in a shell.
    head.push(
      `Read this before planning. At the end of the session edit \`${path.basename(file)}\` directly —`,
      'what changed, what is next, what is blocked, and what you *ruled out*. Then check with:',
      '',
      `    ${cliCmd(`update-check --domain ${domain}`)}`
    );
  }
  head.push('', '---', '');
  return head.join('\n') + trimToLines(fs.readFileSync(file, 'utf8'), config.inject.maxLines);
}

function buildIndexContext({ config, hqRoot, adapter = 'hooks' }) {
  const lines = [
    '## session-hq — no domain selected',
    '',
    `HQ root: \`${hqRoot}\`. This session has no domain, so no status file was injected.`,
    '',
    'Known domains:',
  ];
  for (const d of config.domains) {
    const stamp = lastUpdatedAt(statusPath(hqRoot, safeSlug(d)));
    lines.push(`- **${d}** — ${stamp ? `${Math.round(hoursSince(stamp.at))}h ago` : 'no status file yet'}`);
  }
  lines.push('', adapter === 'hooks'
    ? 'Pick one with `/hq-status <domain>` before doing project work, or set `HQ_DOMAIN`'
    : 'Pass `--domain <domain>` before doing project work, or set `HQ_DOMAIN`',
    'in the environment / `defaultDomain` in `hq.config.json` so it happens automatically.');
  return lines.join('\n');
}

/* ------------------------------------------------------- orchestrator seat */

/**
 * The CEO seat can be a person reading `dashboard`, or a session.
 * A session whose domain is `orchestrator.domain` (or the literal `all`) is
 * given the whole HQ instead of one status file.
 */
/** The status file a session is accountable for. The seat owns `status-<seat>.md`. */
export function accountableDomain(domain, config) {
  return isOrchestratorDomain(domain, config) ? safeSlug(config.orchestrator?.domain || 'hq') : domain;
}

export function isOrchestratorDomain(domain, config) {
  if (!domain) return false;
  const seat = safeSlug(config.orchestrator?.domain || 'hq');
  return domain === seat || domain === 'all';
}

function buildOrchestratorContext({ config, hqRoot, domain, adapter = 'hooks' }) {
  const seat = safeSlug(config.orchestrator?.domain || 'hq');
  const maxLines = config.orchestrator?.maxLines || 80;
  const out = [
    '## session-hq — orchestrator session',
    '',
    `You are the coordinating session. HQ root: \`${hqRoot}\`.`,
    'You hold the whole picture. The department sessions hold their own areas and know them',
    'better than you do. Read this, then dispatch, review, and record — do not do their work.',
    '',
  ];

  if (config.orchestrator?.injectDashboard !== false) {
    const data = collectDashboard(config, hqRoot, config.inject.staleAfterHours);
    out.push(trimToLines(renderMarkdown(data), maxLines));
    out.push('');
  }

  const own = statusPath(hqRoot, seat);
  if (isFile(own)) {
    out.push('---', '', `### Your own notes (\`${path.basename(own)}\`)`, '');
    out.push(trimToLines(fs.readFileSync(own, 'utf8'), maxLines));
    out.push('');
  }

  out.push('---', '');
  out.push(adapter === 'hooks'
    ? 'Record decisions with `/hq-decide`, and keep your own file current with `/hq-update`.'
    : `Record decisions with \`${cliCmd('decide "<line>"')}\`, and edit \`${path.basename(own)}\` directly.`);
  out.push('A write to either your own status file or the decision log counts as reporting back.');
  return out.join('\n');
}

/* ------------------------------------------------------------- cmd:remind */

function cmdRemind() {
  const hook = readHookInput();
  const found = discoverConfig({ cwd: hook.cwd || process.cwd() });
  if (!found) return;
  const { config, hqRoot } = found;
  if (config.update.mode === 'manual') return;
  if (!hook.session_id) return;

  const sp = statePath(hqRoot, hook.session_id);
  // The counter is maintained in every non-manual mode: `on-stop` needs it to tell
  // "this session did nothing" from "this session did work and wrote nothing back".
  const domain = accountableDomain(resolveDomain({ config }), config);
  const state = isFile(sp)
    ? safeReadJson(sp)
    : {
        sessionId: hook.session_id,
        domain,
        startedAt: nowIso(),
        toolCalls: 0,
        lastNudgeAt: null,
        remindedAt: null,
        statusHashAtStart: domain ? hashFile(statusPath(hqRoot, domain)) : null,
        hqRoot,
      };
  state.toolCalls = (state.toolCalls || 0) + 1;

  let message = null;
  if (config.update.mode === 'periodic' && config.update.everyNTools > 0 &&
      state.toolCalls % config.update.everyNTools === 0) {
    const last = state.lastNudgeAt ? new Date(state.lastNudgeAt) : null;
    const minutes = last ? (Date.now() - last.getTime()) / 60000 : Infinity;
    if (minutes >= config.update.minMinutesBetween) {
      state.lastNudgeAt = nowIso();
      const domain = state.domain || resolveDomain({ config }) || '<domain>';
      message =
        `session-hq: ${state.toolCalls} tool calls into this session and \`status-${domain}.md\` has not been ` +
        'updated. If anything is now settled — a result, a dead end, a decision — append it with `/hq-update` ' +
        'so the next session does not redo it.';
    }
  }
  writeJson(sp, state);
  if (message) emit({ systemMessage: message });
}

/* ------------------------------------------------------- cmd:update-check */

function cmdUpdateCheck(flags = {}) {
  const explicitDomain = typeof flags.domain === 'string' ? flags.domain : null;
  if (explicitDomain) {
    // Invoked from a shell: a report on the domain, not a check on a session.
    const cfg = discoverConfig();
    if (!cfg) {
      console.error('hq: no hq.config.json found. Run `hq.mjs init` first.');
      process.exitCode = 1;
      return;
    }
    return manualUpdateCheck({ config: cfg.config, hqRoot: cfg.hqRoot, explicitDomain });
  }

  const hook = readHookInput();
  // Never fight a Stop hook that is already re-entering, or the session loops forever.
  if (hook.stop_hook_active) return;

  const found = discoverConfig({ cwd: hook.cwd || process.cwd() });
  if (!found) return;
  const { config, hqRoot } = found;
  // No session id: a bare shell invocation. Fall back to the domain report.
  if (!hook.session_id) return manualUpdateCheck({ config, hqRoot, explicitDomain: null });
  if (config.update.mode !== 'on-stop') return;

  const sp = statePath(hqRoot, hook.session_id);
  if (!isFile(sp)) return;
  const state = safeReadJson(sp);
  if (!state.domain) return;
  if (!state.toolCalls) return;    // A session that did nothing owes nothing.
  if (state.remindedAt) return;    // One reminder per session, always.

  const file = statusPath(hqRoot, state.domain);
  const now = hashFile(file);
  if (now && now !== state.statusHashAtStart) return;  // Already updated. Nothing to say.
  if (state.orchestrator) {
    // The seat reports by recording a decision just as much as by writing its own notes.
    const decisions = hashFile(path.join(hqRoot, config.decisions.file));
    if (decisions && decisions !== state.decisionsHashAtStart) return;
  }

  state.remindedAt = nowIso();
  writeJson(sp, state);

  const reason =
    `session-hq: this session used ${state.toolCalls} tools but \`status-${state.domain}.md\` is unchanged. ` +
    'Append what happened — outcome, next step, blockers, and anything you ruled out — then stop. ' +
    'Negative results matter: they stop the next session repeating your work.';

  if (config.update.enforce) emit({ decision: 'block', reason });
  else emit({ systemMessage: reason });
}

/**
 * `update-check --domain <d>` with no hook payload: compare the status file against
 * the newest recorded session for that domain and say, in plain language, whether
 * anything has been written back since. Always exits 0 — this is a report, and
 * failing a shell pipeline over an unwritten note would be obnoxious.
 */
function manualUpdateCheck({ config, hqRoot, explicitDomain }) {
  const domain = resolveDomain({ config, explicit: explicitDomain });
  if (!domain) {
    console.error('hq update-check: no domain. Pass --domain <d>, or set HQ_DOMAIN / defaultDomain.');
    process.exitCode = 1;
    return;
  }
  const file = statusPath(hqRoot, domain);
  if (!isFile(file)) {
    console.log(`status-${domain}.md does not exist yet at ${file}`);
    return;
  }

  const stateDir = path.join(hqRoot, '.state');
  let newest = null;
  if (isDir(stateDir)) {
    for (const f of fs.readdirSync(stateDir).filter((n) => n.endsWith('.json'))) {
      const st = safeReadJson(path.join(stateDir, f));
      if (st.domain !== domain || !st.startedAt) continue;
      if (!newest || st.startedAt > newest.startedAt) newest = st;
    }
  }

  const stamp = lastUpdatedAt(file);
  const age = Math.round(hoursSince(stamp.at));
  if (newest && newest.statusHashAtStart && newest.statusHashAtStart === hashFile(file)) {
    console.log(`status-${domain}.md is UNCHANGED since the session that started ${newest.startedAt}.`);
    console.log('Append what happened - outcome, next step, blockers, and anything you ruled out.');
    console.log('Negative results matter: they stop the next session repeating your work.');
    console.log(`  ${file}`);
    return;
  }
  console.log(`status-${domain}.md was last updated ${age}h ago (${stamp.source}). Nothing outstanding.`);
}

/* ------------------------------------------------------- cmd:inbox/decide */

function appendLine(kind, flags, positional) {
  const text = positional.join(' ').trim();
  if (!text) {
    console.error(`hq ${kind}: nothing to record. Usage: hq.mjs ${kind} "<one line>" [--domain d]`);
    process.exitCode = 1;
    return;
  }
  const found = discoverConfig();
  if (!found) {
    console.error('hq: no hq.config.json found. Run `hq.mjs init` first.');
    process.exitCode = 1;
    return;
  }
  const { config, hqRoot } = found;
  const file = path.join(hqRoot, kind === 'inbox' ? config.inbox.file : config.decisions.file);
  const domain = resolveDomain({ config, explicit: typeof flags.domain === 'string' ? flags.domain : null }) || 'unfiled';
  const line = `- ${todayIso()} | ${text.replace(/\s*\n\s*/g, ' ')} | ${domain}\n`;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!isFile(file)) {
    fs.writeFileSync(file, renderTemplate(kind === 'inbox' ? 'ideas-inbox.md' : 'decisions.md', { DATE: todayIso() }), 'utf8');
  }
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\s*$/, '\n') + line, 'utf8');
  console.log(`appended to ${file}:`);
  console.log(line.trimEnd());
}

/* ---------------------------------------------------------- status parser */

const NOTHING_RE = /^(nothing|none|n\/a|-+|tbd)\.?$/i;
const PLACEHOLDER_RE = /delete me|nothing has happened yet/i;

/**
 * Parse a status file into `###` workstream blocks.
 *
 * Deliberately forgiving: a field may be missing, bold, or continued across
 * indented lines, and prose sections under a `##` heading are not workstreams.
 */
export function parseStatusFile(text) {
  const blocks = [];
  let cur = null;
  let lastKey = null;

  for (const line of String(text).split(/\r?\n/)) {
    const heading = line.match(/^(#{1,6})\s+(.*\S)\s*$/);
    if (heading) {
      if (heading[1].length === 3) {
        cur = { title: heading[2].replace(/\s*—\s*delete me\s*$/i, '').trim(), raw: heading[2], fields: {} };
        blocks.push(cur);
      } else {
        cur = null; // a `##` section is prose, not a workstream
      }
      lastKey = null;
      continue;
    }
    if (!cur) continue;

    const field = line.match(/^\s*[-*]\s*\*{0,2}([A-Za-z][A-Za-z ]*?)\*{0,2}\s*:\s*(.*)$/);
    if (field) {
      lastKey = field[1].trim().toLowerCase();
      cur.fields[lastKey] = field[2].trim();
      continue;
    }
    // An indented line continues the previous field (sub-bullets under Ruled out).
    if (lastKey && /^\s{2,}\S/.test(line)) {
      cur.fields[lastKey] = `${cur.fields[lastKey]} ${line.trim()}`.trim();
    }
  }
  return blocks;
}

function hasContent(value) {
  return typeof value === 'string' && value.length > 0 && !NOTHING_RE.test(value.trim());
}

/** One domain's numbers, for a dashboard row. */
export function summariseDomain(hqRoot, domain, staleAfterHours) {
  const file = statusPath(hqRoot, domain);
  const row = {
    domain,
    file,
    exists: isFile(file),
    updatedAt: null,
    ageHours: null,
    source: null,
    stale: false,
    workstreams: 0,
    blocked: [],
    nextActions: 0,
    untouched: true,
  };
  if (!row.exists) return row;

  const stamp = lastUpdatedAt(file);
  row.updatedAt = stamp.at;
  row.ageHours = hoursSince(stamp.at);
  row.source = stamp.source;
  row.stale = row.ageHours > staleAfterHours;

  const blocks = parseStatusFile(fs.readFileSync(file, 'utf8'));
  const real = blocks.filter((b) => !PLACEHOLDER_RE.test(b.raw) && !PLACEHOLDER_RE.test(b.fields.status || ''));
  row.workstreams = real.length;
  row.untouched = real.length === 0;
  for (const b of real) {
    if (hasContent(b.fields['blocked on'])) row.blocked.push({ workstream: b.title, on: b.fields['blocked on'] });
    if (hasContent(b.fields.next)) row.nextActions++;
  }
  return row;
}

/* ---------------------------------------------------------- cmd:dashboard */

function relTime(hours) {
  if (hours === null) return 'never';
  if (hours < 1) return 'just now';
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function collectDashboard(config, hqRoot, staleAfterHours) {
  const rows = (config.domains || []).map((d) => summariseDomain(hqRoot, safeSlug(d), staleAfterHours));
  const inboxFile = path.join(hqRoot, config.inbox?.file || 'ideas-inbox.md');
  const decisionsFile = path.join(hqRoot, config.decisions?.file || 'decisions.md');
  return {
    hqRoot,
    staleAfterHours,
    generatedAt: new Date(),
    rows,
    stale: rows.filter((r) => r.stale).sort((a, b) => b.ageHours - a.ageHours),
    blocked: rows.flatMap((r) => r.blocked.map((b) => ({ domain: r.domain, ...b }))),
    untouched: rows.filter((r) => r.untouched),
    inboxCount: countEntries(inboxFile),
    decisions: lastEntries(decisionsFile, 3),
  };
}

/** Count `- ` list entries, ignoring the explanatory header of the file. */
function countEntries(file) {
  if (!isFile(file)) return 0;
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^-\s+\d{4}-\d{2}-\d{2}\s*\|/.test(l))
    .length;
}

function lastEntries(file, n) {
  if (!isFile(file)) return [];
  const lines = fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^-\s+\d{4}-\d{2}-\d{2}\s*\|/.test(l));
  return lines.slice(-n);
}

function pad(s, width) {
  const t = String(s);
  return t.length >= width ? t : t + ' '.repeat(width - t.length);
}
function padLeft(s, width) {
  const t = String(s);
  return t.length >= width ? t : ' '.repeat(width - t.length) + t;
}

function renderTerminal(d) {
  const out = [];
  out.push(`session-hq dashboard — ${d.hqRoot}`);
  out.push(`${d.rows.length} domain${d.rows.length === 1 ? '' : 's'} · stale after ${d.staleAfterHours}h · generated ${d.generatedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC`);
  out.push('');

  const cells = d.rows.map((r) => [
    r.domain,
    r.exists ? `${relTime(r.ageHours)}${r.stale ? '  ⚠ STALE' : ''}` : 'no file',
    String(r.workstreams),
    String(r.blocked.length),
    String(r.nextActions),
  ]);
  const head = ['DOMAIN', 'LAST UPDATED', 'WORK', 'BLOCKED', 'NEXT'];
  const widths = head.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));

  // The three count columns read better right-aligned.
  const fit = (v, i) => (i >= 2 ? padLeft(v, widths[i]) : pad(v, widths[i]));
  out.push(head.map(fit).join('  ').trimEnd());
  out.push(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const c of cells) out.push(c.map(fit).join('  ').trimEnd());
  out.push('');

  out.push(`STALE (> ${d.staleAfterHours}h)`);
  if (d.stale.length === 0) out.push('  none');
  for (const r of d.stale) out.push(`  ${pad(r.domain, 12)} ${relTime(r.ageHours)}`);
  out.push('');

  out.push('BLOCKED');
  if (d.blocked.length === 0) out.push('  none');
  for (const b of d.blocked) out.push(`  ${b.domain} · ${b.workstream} — ${truncate(b.on, 70)}`);
  out.push('');

  out.push('UNTOUCHED');
  if (d.untouched.length === 0) out.push('  none');
  for (const r of d.untouched) out.push(`  ${r.domain}${r.exists ? ' (no workstreams yet)' : ' (no status file)'}`);
  out.push('');

  out.push(`INBOX  ${d.inboxCount} idea${d.inboxCount === 1 ? '' : 's'} waiting`);
  out.push('LATEST DECISIONS');
  if (d.decisions.length === 0) out.push('  none recorded');
  for (const line of d.decisions) out.push(`  ${truncate(line.replace(/^-\s*/, ''), 90)}`);

  return out.join('\n');
}

function truncate(s, n) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function renderMarkdown(d) {
  const out = [];
  out.push('# session-hq dashboard');
  out.push('');
  out.push(`\`${d.hqRoot}\` · ${d.rows.length} domains · stale after ${d.staleAfterHours}h · generated ${d.generatedAt.toISOString()}`);
  out.push('');
  out.push('| Domain | Last updated | Workstreams | Blocked | Next |');
  out.push('|---|---|---:|---:|---:|');
  for (const r of d.rows) {
    const when = r.exists ? `${relTime(r.ageHours)}${r.stale ? ' **STALE**' : ''}` : 'no file';
    out.push(`| ${r.domain} | ${when} | ${r.workstreams} | ${r.blocked.length} | ${r.nextActions} |`);
  }
  out.push('');
  out.push(`## Stale (> ${d.staleAfterHours}h)`);
  out.push('');
  if (d.stale.length === 0) out.push('None.');
  for (const r of d.stale) out.push(`- **${r.domain}** — ${relTime(r.ageHours)}`);
  out.push('');
  out.push('## Blocked');
  out.push('');
  if (d.blocked.length === 0) out.push('None.');
  for (const b of d.blocked) out.push(`- **${b.domain}** · ${b.workstream} — ${truncate(b.on, 160)}`);
  out.push('');
  out.push('## Untouched');
  out.push('');
  if (d.untouched.length === 0) out.push('None.');
  for (const r of d.untouched) out.push(`- **${r.domain}** — ${r.exists ? 'no workstreams yet' : 'no status file'}`);
  out.push('');
  out.push(`## Inbox and decisions`);
  out.push('');
  out.push(`${d.inboxCount} idea${d.inboxCount === 1 ? '' : 's'} waiting.`);
  out.push('');
  if (d.decisions.length === 0) out.push('No decisions recorded.');
  for (const line of d.decisions) out.push(line);
  return out.join('\n') + '\n';
}

function esc(s) {
  return String(s)
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;');
}

/** A single self-contained file: inline CSS, no script, no network. */
function renderHtml(d) {
  const rows = d.rows.map((r) => {
    const when = r.exists ? `${relTime(r.ageHours)}${r.stale ? ' <span class="tag">STALE</span>' : ''}` : 'no file';
    return `<tr${r.stale ? ' class="stale"' : ''}><td>${esc(r.domain)}</td><td>${when}</td>` +
      `<td class="n">${r.workstreams}</td><td class="n">${r.blocked.length}</td><td class="n">${r.nextActions}</td></tr>`;
  }).join('\n');

  const list = (items, empty) => (items.length === 0
    ? `<p class="empty">${empty}</p>`
    : `<ul>${items.join('')}</ul>`);

  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>session-hq dashboard</title>
<style>
  :root { color-scheme: light dark; --fg:#1a1a1a; --bg:#fbfbf9; --mut:#666; --line:#dcdcd6; --warn:#8a4b00; --warnbg:#fdf0dd; }
  @media (prefers-color-scheme: dark) {
    :root { --fg:#e8e8e4; --bg:#16171a; --mut:#9a9a95; --line:#33343a; --warn:#f0b775; --warnbg:#3a2a12; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:2rem 1.25rem; background:var(--bg); color:var(--fg);
         font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
  main { max-width: 60rem; margin: 0 auto; }
  h1 { font-size:1.1rem; margin:0 0 .25rem; letter-spacing:.01em; }
  h2 { font-size:.8rem; text-transform:uppercase; letter-spacing:.08em; color:var(--mut);
       margin:2rem 0 .5rem; border-bottom:1px solid var(--line); padding-bottom:.35rem; }
  .meta { color:var(--mut); margin:0 0 1.5rem; font-size:.85rem; }
  table { border-collapse:collapse; width:100%; }
  th { text-align:left; font-size:.72rem; text-transform:uppercase; letter-spacing:.08em;
       color:var(--mut); border-bottom:1px solid var(--line); padding:.4rem .6rem .4rem 0; font-weight:600; }
  td { padding:.45rem .6rem .45rem 0; border-bottom:1px solid var(--line); }
  td.n, th.n { text-align:right; padding-right:1.2rem; }
  tr.stale td:first-child { font-weight:700; }
  .tag { background:var(--warnbg); color:var(--warn); padding:.05rem .4rem; border-radius:3px;
         font-size:.7rem; letter-spacing:.06em; }
  ul { margin:.25rem 0; padding-left:1.1rem; }
  li { margin:.3rem 0; }
  .dom { font-weight:700; }
  .empty { color:var(--mut); margin:.25rem 0; }
  footer { margin-top:2.5rem; color:var(--mut); font-size:.78rem; }
</style>
<main>
  <h1>session-hq dashboard</h1>
  <p class="meta">${esc(d.hqRoot)} &middot; ${d.rows.length} domains &middot; stale after ${d.staleAfterHours}h &middot; generated ${esc(d.generatedAt.toISOString())}</p>

  <table>
    <thead><tr><th>Domain</th><th>Last updated</th><th class="n">Work</th><th class="n">Blocked</th><th class="n">Next</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>

  <h2>Stale (over ${d.staleAfterHours}h)</h2>
  ${list(d.stale.map((r) => `<li><span class="dom">${esc(r.domain)}</span> &mdash; ${esc(relTime(r.ageHours))}</li>`), 'Nothing stale.')}

  <h2>Blocked</h2>
  ${list(d.blocked.map((b) => `<li><span class="dom">${esc(b.domain)}</span> &middot; ${esc(b.workstream)} &mdash; ${esc(truncate(b.on, 200))}</li>`), 'Nothing blocked.')}

  <h2>Untouched</h2>
  ${list(d.untouched.map((r) => `<li><span class="dom">${esc(r.domain)}</span> &mdash; ${r.exists ? 'no workstreams yet' : 'no status file'}</li>`), 'Every domain has work recorded.')}

  <h2>Inbox and decisions</h2>
  <p>${d.inboxCount} idea${d.inboxCount === 1 ? '' : 's'} waiting.</p>
  ${list(d.decisions.map((l) => `<li>${esc(l.replace(/^-\s*/, ''))}</li>`), 'No decisions recorded.')}

  <footer>Static snapshot. Regenerate with <code>hq.mjs dashboard --html &lt;file&gt;</code>.</footer>
</main>
</html>
`;
}

function cmdDashboard(flags) {
  const found = discoverConfig();
  if (!found) {
    console.error('hq: no hq.config.json found. Run `hq.mjs init` first.');
    process.exitCode = 1;
    return;
  }
  const { config, hqRoot } = found;
  const staleAfterHours = flags['stale-hours'] !== undefined
    ? Number(flags['stale-hours'])
    : config.inject.staleAfterHours;
  if (!Number.isFinite(staleAfterHours) || staleAfterHours < 0) {
    console.error('hq dashboard: --stale-hours must be a non-negative number');
    process.exitCode = 1;
    return;
  }

  const data = collectDashboard(config, hqRoot, staleAfterHours);

  if (typeof flags.html === 'string') {
    const out = path.resolve(expandHome(flags.html));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, renderHtml(data), 'utf8');
    console.log(`dashboard written to ${out}`);
    return;
  }
  console.log(flags.md ? renderMarkdown(data) : renderTerminal(data));
}

/* ------------------------------------------------------------- cmd:doctor */

export function cmdDoctor(flags = {}) {
  const report = { ok: true, checks: [] };
  const add = (level, name, detail) => {
    report.checks.push({ level, name, detail });
    if (level === 'error') report.ok = false;
  };

  const found = discoverConfig();
  if (!found) {
    add('error', 'config', `no ${CONFIG_NAME} found via HQ_ROOT, cwd walk-up, or ~/.session-hq/. Run \`hq.mjs init\` (or /hq-init).`);
    return finishDoctor(report, flags);
  }
  const { config, configPath, hqRoot, source } = found;
  add('ok', 'config', `${configPath || '(defaults; HQ_ROOT set without a config file)'} — discovered via ${source}`);

  const { errors, warnings } = validateConfig(config);
  for (const e of errors) add('error', 'config.schema', e);
  for (const w of warnings) add('warn', 'config.schema', w);
  if (errors.length === 0) add('ok', 'config.schema', 'all keys valid');

  if (!isDir(hqRoot)) {
    add('error', 'hqRoot', `${hqRoot} does not exist`);
  } else {
    try {
      const probe = path.join(hqRoot, `.hq-doctor-${process.pid}`);
      fs.writeFileSync(probe, 'x');
      fs.unlinkSync(probe);
      add('ok', 'hqRoot', `${hqRoot} exists and is writable`);
    } catch (e) {
      add('error', 'hqRoot', `${hqRoot} is not writable: ${e.message}`);
    }
  }

  add(isDir(path.join(hqRoot, '.state')) ? 'ok' : 'warn', 'state',
    isDir(path.join(hqRoot, '.state')) ? '.state/ present' : '.state/ missing — it will be created on the next session');

  for (const d of config.domains || []) {
    const f = statusPath(hqRoot, d);
    if (!isFile(f)) {
      add('warn', `status-${safeSlug(d)}`, `missing - create it, or re-run init with --force`);
    } else {
      const stamp = lastUpdatedAt(f);
      const age = Math.round(hoursSince(stamp.at));
      const stale = age > config.inject.staleAfterHours;
      add(stale ? 'warn' : 'ok', `status-${safeSlug(d)}`, `${age}h old (${stamp.source})${stale ? ' — STALE' : ''}`);
    }
  }
  for (const [label, rel] of [['inbox', config.inbox?.file], ['decisions', config.decisions?.file]]) {
    if (!rel) continue;
    add(isFile(path.join(hqRoot, rel)) ? 'ok' : 'warn', label, path.join(hqRoot, rel));
  }

  const hooksFile = path.join(PLUGIN_ROOT, 'hooks', 'hooks.json');
  if (!isFile(hooksFile)) {
    add('error', 'hooks.json', `missing at ${hooksFile}`);
  } else {
    try {
      const h = readJson(hooksFile);
      const events = Object.keys(h.hooks || {});
      for (const required of ['SessionStart', 'Stop', 'PostToolUse', 'PreCompact']) {
        add(events.includes(required) ? 'ok' : 'warn', `hooks.${required}`, events.includes(required) ? 'declared' : 'not declared');
      }
      const serialised = JSON.stringify(h);
      const portable = serialised.includes('${CLAUDE_PLUGIN_ROOT}');
      add(portable ? 'ok' : 'error', 'hooks.paths',
        portable ? 'all commands use ${CLAUDE_PLUGIN_ROOT}' : 'hook commands must use ${CLAUDE_PLUGIN_ROOT}');
    } catch (e) {
      add('error', 'hooks.json', `unparseable: ${e.message}`);
    }
  }

  if (process.env.CLAUDE_PLUGIN_ROOT) {
    add('ok', 'plugin.loaded', `CLAUDE_PLUGIN_ROOT=${process.env.CLAUDE_PLUGIN_ROOT}`);
  } else {
    add('warn', 'plugin.loaded', 'CLAUDE_PLUGIN_ROOT not set (normal outside a hook). `claude plugin list` is authoritative.');
  }

  return finishDoctor(report, flags);
}

function finishDoctor(report, flags) {
  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const mark = { ok: '  ok ', warn: 'warn ', error: 'FAIL ' };
    for (const c of report.checks) console.log(`${mark[c.level]} ${c.name}: ${c.detail}`);
    console.log('');
    console.log(report.ok ? 'doctor: no errors.' : 'doctor: errors found (see FAIL lines above).');
  }
  process.exitCode = report.ok ? 0 : 1;
  return report;
}

/* -------------------------------------------------------- cmd:memory-lint */

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const LINK_RE = /\(([^)]+\.md)\)|\[\[([^\]]+)\]\]/g;

function linkedTargets(text) {
  const out = new Set();
  for (const m of text.matchAll(LINK_RE)) {
    const raw = m[1] || `${m[2]}.md`;
    out.add(raw.split(/[\\/]/).pop());
  }
  return out;
}

export function lintMemoryDir(dir) {
  const findings = [];
  if (!isDir(dir)) return [{ level: 'error', file: dir, message: 'memory directory not found' }];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  const INDEX = 'MEMORY.md';
  const hasIndex = files.includes(INDEX);
  if (!hasIndex) findings.push({ level: 'error', file: INDEX, message: 'top-level index missing — layered memory needs exactly one entry point' });

  const rootLinks = hasIndex ? linkedTargets(fs.readFileSync(path.join(dir, INDEX), 'utf8')) : new Set();
  const domainIndexes = files.filter((f) => /^index-.+\.md$/.test(f));

  const allLinks = new Set(rootLinks);
  for (const di of domainIndexes) {
    if (!rootLinks.has(di)) {
      findings.push({ level: 'warn', file: di, message: `domain index not linked from ${INDEX} — sessions will never find it` });
    }
    for (const t of linkedTargets(fs.readFileSync(path.join(dir, di), 'utf8'))) allLinks.add(t);
  }

  for (const f of files) {
    if (f === INDEX) continue;
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const fm = text.match(FRONTMATTER_RE);
    if (!fm) {
      findings.push({ level: 'error', file: f, message: 'no YAML frontmatter (needs name, description, type)' });
    } else {
      const block = fm[1];
      if (!/^name:\s*\S/m.test(block)) findings.push({ level: 'error', file: f, message: 'frontmatter missing `name`' });
      if (!/^description:\s*\S/m.test(block)) {
        findings.push({ level: 'error', file: f, message: 'frontmatter missing `description` — that line is what a session reads to decide whether to open the file' });
      }
      const typeMatch = block.match(/^\s*type:\s*(\S+)/m);
      if (!typeMatch) {
        findings.push({ level: 'warn', file: f, message: `frontmatter missing \`type\` (one of ${MEMORY_TYPES.join(', ')})` });
      } else if (!MEMORY_TYPES.includes(typeMatch[1].replace(/["']/g, ''))) {
        findings.push({ level: 'warn', file: f, message: `unknown type "${typeMatch[1]}" — expected one of ${MEMORY_TYPES.join(', ')}` });
      }
      if (/^\s*type:\s*["']?feedback/m.test(block)) {
        const body = text.slice(fm[0].length);
        if (!/\bwhy\b/i.test(body)) findings.push({ level: 'warn', file: f, message: 'feedback file has no "Why" section — a rule without a reason gets argued with' });
        if (!/how to apply/i.test(body)) findings.push({ level: 'warn', file: f, message: 'feedback file has no "How to apply" section' });
      }
    }
    if (!/^index-.+\.md$/.test(f) && !allLinks.has(f)) {
      findings.push({ level: 'warn', file: f, message: 'orphan — not linked from the root index or any domain index' });
    }
    const lineCount = text.split(/\r?\n/).length;
    if (lineCount > 120) {
      findings.push({ level: 'warn', file: f, message: `${lineCount} lines — one fact per file; consider splitting` });
    }
  }
  return findings;
}

function cmdMemoryLint(flags) {
  const dir = path.resolve(expandHome(
    typeof flags.dir === 'string' ? flags.dir : (process.env.HQ_MEMORY_DIR || path.join(os.homedir(), '.claude', 'memory'))
  ));
  const findings = lintMemoryDir(dir);
  if (flags.json) {
    console.log(JSON.stringify({ dir, findings }, null, 2));
  } else {
    console.log(`memory-lint: ${dir}`);
    if (findings.length === 0) console.log('  clean.');
    for (const f of findings) console.log(`  ${f.level === 'error' ? 'FAIL' : 'warn'} ${f.file}: ${f.message}`);
  }
  process.exitCode = findings.some((f) => f.level === 'error') ? 1 : 0;
}

/* --------------------------------------------------------------- cmd:wrap */

/**
 * Run any agent CLI inside an HQ session.
 *
 * The generic adapter: no hooks, no plugin, no Claude Code. Prints the same
 * context the SessionStart hook would inject, runs the command with the
 * terminal attached, then checks on the way out whether anything was written
 * back. Exits with the child's exit code so it composes in scripts.
 */
function cmdWrap(rawArgs) {
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

/* --------------------------------------------------------- cmd:leak-check */

async function cmdLeakCheck(argv) {
  const mod = await import(pathToFileURL(path.join(HERE, 'leak-check.mjs')).href);
  await mod.main(argv);
}

/* ------------------------------------------------------------------- main */

const USAGE = `session-hq

  hq.mjs init          [--root <dir>] [--domains a,b,c] [--force]
  hq.mjs inject        [--event session-start|compact|manual] [--domain d] [--print]
  hq.mjs remind                                  PostToolUse counter / periodic nudge
  hq.mjs update-check  [--domain d]              Stop hook; from a shell, reports on the domain
  hq.mjs wrap          --domain <d> [--quiet] [--expect-update] -- <command> [args...]
  hq.mjs inbox         "<one line>" [--domain d]
  hq.mjs decide        "<one line>" [--domain d]
  hq.mjs dashboard     [--stale-hours N] [--md | --html <file>]   every domain on one screen
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
