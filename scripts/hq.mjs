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
 *   node hq.mjs update-check                  (Stop: did this session update its status file?)
 *   node hq.mjs inbox         <text...>       [--domain d]
 *   node hq.mjs decide        <text...>       [--domain d]
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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, '..');
const TEMPLATES = path.join(PLUGIN_ROOT, 'templates');
const CONFIG_NAME = 'hq.config.json';

export const DEFAULT_CONFIG = {
  hqRoot: '~/hq',
  domains: ['video', 'apps', 'business'],
  defaultDomain: null,
  inject: { on: 'session-start', maxLines: 60, staleAfterHours: 48 },
  update: { mode: 'on-stop', everyNTools: 0, minMinutesBetween: 20, enforce: false },
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
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
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
    if (printMode) console.log('session-hq: no hq.config.json found. Run /hq-init to create one.');
    return;
  }
  const { config, hqRoot } = found;

  if (config.inject.on === 'off' && !printMode) return;
  if (event === 'compact' && config.inject.on !== 'session-start+compact') return;

  const domain = resolveDomain({ config, explicit: typeof flags.domain === 'string' ? flags.domain : null });
  const body = domain
    ? buildDomainContext({ config, hqRoot, domain })
    : buildIndexContext({ config, hqRoot });

  // Record session state so `update-check` can tell whether anything changed.
  if (hook.session_id) {
    const file = domain ? statusPath(hqRoot, domain) : null;
    writeJson(statePath(hqRoot, hook.session_id), {
      sessionId: hook.session_id,
      domain,
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

function buildDomainContext({ config, hqRoot, domain }) {
  const file = statusPath(hqRoot, domain);
  const head = [
    '## session-hq — HQ status for this session',
    '',
    `Domain: **${domain}**   ·   HQ root: \`${hqRoot}\``,
  ];
  if (!isFile(file)) {
    head.push('', `No status file yet at \`${path.basename(file)}\`. Run \`/hq-update ${domain}\` at the end of this session to create one.`);
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
  head.push(
    '',
    'Read this before planning. At the end of the session update it with `/hq-update` —',
    'what changed, what is next, what is blocked, and what you *ruled out*.',
    '',
    '---',
    ''
  );
  return head.join('\n') + trimToLines(fs.readFileSync(file, 'utf8'), config.inject.maxLines);
}

function buildIndexContext({ config, hqRoot }) {
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
  lines.push(
    '',
    'Pick one with `/hq-status <domain>` before doing project work, or set `HQ_DOMAIN`',
    'in the environment / `defaultDomain` in `hq.config.json` so it happens automatically.'
  );
  return lines.join('\n');
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
  const domain = resolveDomain({ config });
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

function cmdUpdateCheck() {
  const hook = readHookInput();
  // Never fight a Stop hook that is already re-entering, or the session loops forever.
  if (hook.stop_hook_active) return;

  const found = discoverConfig({ cwd: hook.cwd || process.cwd() });
  if (!found) return;
  const { config, hqRoot } = found;
  if (config.update.mode !== 'on-stop') return;
  if (!hook.session_id) return;

  const sp = statePath(hqRoot, hook.session_id);
  if (!isFile(sp)) return;
  const state = safeReadJson(sp);
  if (!state.domain) return;
  if (!state.toolCalls) return;    // A session that did nothing owes nothing.
  if (state.remindedAt) return;    // One reminder per session, always.

  const file = statusPath(hqRoot, state.domain);
  const now = hashFile(file);
  if (now && now !== state.statusHashAtStart) return;  // Already updated. Nothing to say.

  state.remindedAt = nowIso();
  writeJson(sp, state);

  const reason =
    `session-hq: this session used ${state.toolCalls} tools but \`status-${state.domain}.md\` is unchanged. ` +
    'Append what happened — outcome, next step, blockers, and anything you ruled out — then stop. ' +
    'Negative results matter: they stop the next session repeating your work.';

  if (config.update.enforce) emit({ decision: 'block', reason });
  else emit({ systemMessage: reason });
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
    console.error('hq: no hq.config.json found. Run /hq-init first.');
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

/* ------------------------------------------------------------- cmd:doctor */

export function cmdDoctor(flags = {}) {
  const report = { ok: true, checks: [] };
  const add = (level, name, detail) => {
    report.checks.push({ level, name, detail });
    if (level === 'error') report.ok = false;
  };

  const found = discoverConfig();
  if (!found) {
    add('error', 'config', `no ${CONFIG_NAME} found via HQ_ROOT, cwd walk-up, or ~/.session-hq/. Run /hq-init.`);
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
      add('warn', `status-${safeSlug(d)}`, `missing — run /hq-update ${d}, or /hq-init --force`);
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
    console.log(domain ? buildDomainContext({ config, hqRoot, domain }) : buildIndexContext({ config, hqRoot }));
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
      console.error(`session-hq: node hq.mjs inject --print --domain ${domain}   # to see the current file`);
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
  hq.mjs update-check                            Stop: did this session update its status file?
  hq.mjs wrap          --domain <d> [--quiet] [--expect-update] -- <command> [args...]
  hq.mjs inbox         "<one line>" [--domain d]
  hq.mjs decide        "<one line>" [--domain d]
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
    case 'update-check': return cmdUpdateCheck();
    case 'wrap': return cmdWrap(rest);
    case 'inbox': return appendLine('inbox', flags, positional);
    case 'decide': return appendLine('decide', flags, positional);
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
