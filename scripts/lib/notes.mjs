// The ideas inbox and the decision log: one appended line each.
import fs from 'node:fs';
import path from 'node:path';
import { isFile, todayIso, renderTemplate } from './util.mjs';
import { discoverConfig, resolveDomain } from './config.mjs';
export function appendLine(kind, flags, positional) {
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
