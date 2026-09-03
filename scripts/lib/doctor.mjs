// Checking the config, the folders, and the hook declarations.
import fs from 'node:fs';
import path from 'node:path';
import { isDir, isFile, readJson, safeSlug, hoursSince, PLUGIN_ROOT } from './util.mjs';
import { CONFIG_NAME, discoverConfig, validateConfig, statusPath } from './config.mjs';
import { lastUpdatedAt } from './status.mjs';
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
