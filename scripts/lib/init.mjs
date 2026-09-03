// Creating, and repairing, an HQ folder.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { isFile, writeJson, expandHome, safeSlug, todayIso, nowIso, renderTemplate,
         safeReadJson, deepMerge } from './util.mjs';
import { DEFAULT_CONFIG, CONFIG_NAME, discoverConfig } from './config.mjs';
import { DISPATCH_FILE } from './dispatch.mjs';
import { collectDashboard, renderHtml, resolveDashboardOptions } from './dashboard.mjs';

/**
 * update.* for each profile. Existing config keys only — a profile is a named
 * shortcut for a combination people actually run, not a new setting.
 */
export const PROFILES = {
  gentle:       { mode: 'on-stop',  everyNTools: 0,  minMinutesBetween: 20, enforce: false },
  coaching:     { mode: 'periodic', everyNTools: 40, minMinutesBetween: 20, enforce: false },
  strict:       { mode: 'on-stop',  everyNTools: 0,  minMinutesBetween: 20, enforce: true },
  // Same cadence as gentle; what makes it "orchestrator" is running one session
  // with HQ_DOMAIN=hq, which `init` prints a reminder about below.
  orchestrator: { mode: 'on-stop',  everyNTools: 0,  minMinutesBetween: 20, enforce: false },
};
const ANSWER_TO_PROFILE = { '': 'gentle', '1': 'gentle', '2': 'coaching', '3': 'strict' };

const Q1 = 'Where should the HQ live? [~/hq] ';
const Q2 = 'What are your domains? (projects, clients, or life areas — you can rename later) ' +
  '[video, apps, business] ';
const Q3 =
  'How should sessions be reminded?\n' +
  '  [1] gentle — one reminder at session end (default)\n' +
  '  [2] coaching — a nudge every 40 tool calls\n' +
  '  [3] strict — a session cannot end without updating\n' +
  '> ';

export async function cmdInit(flags) {
  const existing = discoverConfig();

  let rootAnswer = typeof flags.root === 'string' ? flags.root : null;
  let domainsAnswer = typeof flags.domains === 'string' ? flags.domains : null;
  let profileName = typeof flags.profile === 'string' ? safeSlug(flags.profile) : null;
  if (profileName && !PROFILES[profileName]) {
    console.error(`hq init: --profile must be one of ${Object.keys(PROFILES).join(' | ')}`);
    process.exitCode = 1;
    return;
  }

  // A TTY with no --yes gets asked; everything else (a script, CI, --yes) gets
  // silent defaults. Flags always win over a question, one at a time.
  const interactive = Boolean(process.stdin.isTTY) && !flags.yes;
  if (interactive && (rootAnswer === null || domainsAnswer === null || profileName === null)) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (rootAnswer === null) rootAnswer = (await rl.question(Q1)).trim() || '~/hq';
      if (domainsAnswer === null) domainsAnswer = (await rl.question(Q2)).trim() || 'video, apps, business';
      if (profileName === null) {
        const answer = (await rl.question(Q3)).trim();
        profileName = ANSWER_TO_PROFILE[answer] || 'gentle';
      }
    } finally {
      rl.close();
    }
  }
  profileName = profileName || 'gentle';

  const root = path.resolve(expandHome(
    rootAnswer || process.env.HQ_ROOT || (existing && existing.hqRoot) || DEFAULT_CONFIG.hqRoot
  ));
  const domains = (domainsAnswer || DEFAULT_CONFIG.domains.join(','))
    .split(',')
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

  // An answer/flag that differs from the placeholder default pins the absolute
  // path; the untouched default keeps `hqRoot` portable (config-directory-relative).
  const rootIsExplicit = Boolean(rootAnswer) && rootAnswer !== DEFAULT_CONFIG.hqRoot;
  const config = {
    ...DEFAULT_CONFIG,
    hqRoot: rootIsExplicit ? root : DEFAULT_CONFIG.hqRoot,
    domains,
    update: { ...DEFAULT_CONFIG.update, ...PROFILES[profileName] },
  };
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
    [DISPATCH_FILE, 'dispatches.md', { DATE: todayIso() }],
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

  if (profileName === 'orchestrator') {
    console.log('');
    console.log('Orchestrator profile: start one coordinating session with HQ_DOMAIN=hq set');
    console.log('(for example: HQ_DOMAIN=hq claude) to see the whole HQ instead of one domain.');
  }

  // Something to look at from the first run. Read the config back from disk —
  // on a kept (not overwritten) config this reflects what is actually there.
  try {
    const onDisk = deepMerge(DEFAULT_CONFIG, safeReadJson(cfgPath));
    const dashOut = path.join(root, 'dashboard.html');
    const data = collectDashboard(onDisk, root, onDisk.inject.staleAfterHours);
    const look = resolveDashboardOptions(onDisk, {}, { warn: () => {} });
    fs.writeFileSync(dashOut, renderHtml(data, look), 'utf8');
    console.log('');
    console.log(`dashboard written to ${dashOut}`);
  } catch {
    // Never let a dashboard render hiccup take `init` down with it.
  }
}
