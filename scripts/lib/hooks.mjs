// The hook payload on stdin, and the two hooks that only report.
import fs from 'node:fs';
import path from 'node:path';
import { isDir, isFile, safeReadJson, writeJson, nowIso, hoursSince } from './util.mjs';
import { discoverConfig, statusPath, statePath, resolveDomain, accountableDomain } from './config.mjs';
import { lastUpdatedAt, hashFile } from './status.mjs';
import { dispatchPath } from './dispatch.mjs';
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
export function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

/* ------------------------------------------------------------- PostToolUse */

export function cmdRemind() {
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

/* ------------------------------- Stop, and the same check run from a shell */

export function cmdUpdateCheck(flags = {}) {
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
  // Reporting a dispatched task finished is reporting back.
  const dispatchHash = hashFile(dispatchPath(hqRoot));
  if (dispatchHash && state.dispatchesHashAtStart && dispatchHash !== state.dispatchesHashAtStart) return;
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
