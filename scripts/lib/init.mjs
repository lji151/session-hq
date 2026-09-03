// Creating, and repairing, an HQ folder.
import fs from 'node:fs';
import path from 'node:path';
import { isFile, writeJson, expandHome, safeSlug, todayIso, nowIso, renderTemplate } from './util.mjs';
import { DEFAULT_CONFIG, CONFIG_NAME, discoverConfig } from './config.mjs';
import { DISPATCH_FILE } from './dispatch.mjs';
export function cmdInit(flags) {
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
}
