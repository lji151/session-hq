// What a session is shown before its first turn.
import fs from 'node:fs';
import path from 'node:path';
import { isFile, writeJson, nowIso, cliCmd, hoursSince, safeSlug } from './util.mjs';
import { discoverConfig, statusPath, statePath, resolveDomain, accountableDomain,
         isOrchestratorDomain } from './config.mjs';
import { lastUpdatedAt, hashFile } from './status.mjs';
import { dispatchPath, dispatchBlock } from './dispatch.mjs';
import { collectDashboard, renderMarkdown } from './dashboard.mjs';
import { readHookInput, emit } from './hooks.mjs';
export function cmdInject(flags) {
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
      dispatchesHashAtStart: hashFile(dispatchPath(hqRoot)),
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

/* ---------------------------------------------------- a department session */

export function buildDomainContext({ config, hqRoot, domain, adapter = 'hooks' }) {
  const file = statusPath(hqRoot, domain);
  const head = [
    '## session-hq — HQ status for this session',
    '',
    `Domain: **${domain}**   ·   HQ root: \`${hqRoot}\``,
  ];
  // Anything HQ handed this domain comes before its own notes.
  const asked = dispatchBlock(hqRoot, domain);
  if (asked) head.push('', asked);

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
export function buildIndexContext({ config, hqRoot, adapter = 'hooks' }) {
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

/* --------------------------------------------------- the orchestrator seat */

export function buildOrchestratorContext({ config, hqRoot, domain, adapter = 'hooks' }) {
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
