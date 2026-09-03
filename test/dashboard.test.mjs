import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseStatusFile, summariseDomain } from '../scripts/hq.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'scripts', 'hq.mjs');

let ROOT;

function hq(args, env = {}) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    input: '', encoding: 'utf8', cwd: ROOT, timeout: 15000,
    env: { ...process.env, HQ_ROOT: ROOT, HQ_DOMAIN: '', ...env },
  });
  if (res.error) throw res.error;
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '', code: res.status };
}

function hoursAgoStamp(h) {
  return new Date(Date.now() - h * 3600000).toISOString();
}

/** Three domains: one stale with a blocked item, one fresh, one untouched. */
before(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'session-hq-dash-'));
  hq(['init', '--root', ROOT, '--domains', 'video,apps,business']);

  fs.writeFileSync(path.join(ROOT, 'status-video.md'), [
    `<!-- hq:updated ${hoursAgoStamp(200)} -->`,
    '# video — status',
    '',
    '### Lantern Hours',
    '- Status: episodes 11 and 12 published on schedule.',
    '- Next: apply the cold-open structure to the ep. 13 draft',
    '- Blocked on: nothing',
    '- Ruled out: longer intros — ep. 8 and 9 lost a quarter of viewers before the first beat',
    '- Updated: 2026-01-31 (video)',
    '',
    '### Platform A collapse',
    '- Status: views flat since the move. Distribution, not content.',
    '- Next: pull the per-source traffic breakdown',
    '- Blocked on: support ticket response, opened five days ago',
    '- Ruled out:',
    '  - upload failure — all 14 uploads present and correct',
    '  - policy action — no notice on the account',
    '- Updated: 2026-01-31 (video)',
    '',
    '## Conventions for this file',
    '',
    '- One `###` block per workstream. Prose here must not be parsed as a workstream.',
    '- Update the `hq:updated` stamp at the top when you edit.',
    '',
  ].join('\n'));

  fs.writeFileSync(path.join(ROOT, 'status-apps.md'), [
    `<!-- hq:updated ${hoursAgoStamp(3)} -->`,
    '# apps — status',
    '',
    '### Payment retry queue',
    '- Status: fixed; fixture set green.',
    '- Next: promote to production after the Monday peak',
    '- Blocked on: nothing',
    '- Updated: 2026-01-31 (apps)',
    '',
  ].join('\n'));

  // business keeps the placeholder block that `init` writes: untouched.
  fs.appendFileSync(path.join(ROOT, 'ideas-inbox.md'),
    '- 2026-01-07 | a monthly recap cut from the best of each weekly episode | video\n' +
    '- 2026-01-11 | export straight into the notes app | apps\n');
  fs.appendFileSync(path.join(ROOT, 'decisions.md'),
    '- 2026-01-25 | Marlow is in maintenance | apps\n' +
    '- 2026-01-28 | export ships without streaming | apps\n' +
    '- 2026-01-30 | sample run before any volume order | business\n' +
    '- 2026-01-31 | cold opens replace framing intros | video\n');
});

after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe('status parser', () => {
  test('reads blocks and fields, including continued sub-bullets', () => {
    const blocks = parseStatusFile(fs.readFileSync(path.join(ROOT, 'status-video.md'), 'utf8'));
    assert.equal(blocks.length, 2, 'prose under a ## heading must not become a workstream');
    assert.equal(blocks[1].title, 'Platform A collapse');
    assert.match(blocks[1].fields['blocked on'], /support ticket/);
    assert.match(blocks[1].fields['ruled out'], /upload failure/);
    assert.match(blocks[1].fields['ruled out'], /policy action/, 'sub-bullets continue the field');
  });

  test('survives a file with no fields at all', () => {
    const blocks = parseStatusFile('# x\n\n### Bare\n\nsome prose\n');
    assert.equal(blocks.length, 1);
    assert.deepEqual(blocks[0].fields, {});
  });
});

describe('domain summary', () => {
  test('counts workstreams, blockers and next actions', () => {
    const r = summariseDomain(ROOT, 'video', 48);
    assert.equal(r.workstreams, 2);
    assert.equal(r.blocked.length, 1);
    assert.equal(r.nextActions, 2);
    assert.equal(r.stale, true);
    assert.equal(r.untouched, false);
  });

  test('treats the init placeholder as untouched', () => {
    const r = summariseDomain(ROOT, 'business', 48);
    assert.equal(r.untouched, true);
    assert.equal(r.workstreams, 0);
  });

  test('reports a missing domain rather than throwing', () => {
    const r = summariseDomain(ROOT, 'nosuch', 48);
    assert.equal(r.exists, false);
    assert.equal(r.workstreams, 0);
  });
});

describe('dashboard output', () => {
  test('terminal mode shows the table and all three lists', () => {
    const { stdout, code } = hq(['dashboard', '--terminal']);
    assert.equal(code, 0);
    assert.match(stdout, /session-hq dashboard/);
    assert.match(stdout, /DOMAIN\s+LAST UPDATED\s+WORK\s+BLOCKED\s+NEXT/);
    assert.match(stdout, /video\s+\d+d ago\s+⚠ STALE/);
    assert.match(stdout, /apps\s+\d+h ago/);

    assert.match(stdout, /STALE \(> 48h\)/);
    assert.match(stdout, /BLOCKED/);
    assert.match(stdout, /video · Platform A collapse — support ticket response/);
    assert.match(stdout, /UNTOUCHED/);
    assert.match(stdout, /business \(no workstreams yet\)/);

    assert.match(stdout, /INBOX\s+2 ideas waiting/);
    assert.match(stdout, /LATEST DECISIONS/);
    assert.match(stdout, /cold opens replace framing intros/, 'the newest decision must appear');
    assert.ok(!/Marlow is in maintenance/.test(stdout), 'only the last three decisions');
  });

  test('--stale-hours overrides the configured threshold', () => {
    const wide = hq(['dashboard', '--terminal', '--stale-hours', '9000']);
    assert.ok(!/⚠ STALE/.test(wide.stdout));
    assert.match(wide.stdout, /STALE \(> 9000h\)\s*\n\s*none/);

    const narrow = hq(['dashboard', '--terminal', '--stale-hours', '1']);
    assert.match(narrow.stdout, /apps\s+\d+h ago\s+⚠ STALE/);
  });

  test('--md renders the same picture as markdown', () => {
    const { stdout } = hq(['dashboard', '--md']);
    assert.match(stdout, /^# session-hq dashboard/m);
    assert.match(stdout, /\| Domain \| Last updated \| Workstreams \| Blocked \| Next \|/);
    assert.match(stdout, /\| video \| \d+d ago \*\*STALE\*\* \| 2 \| 1 \| 2 \|/);
    assert.match(stdout, /^## Blocked$/m);
    assert.match(stdout, /^## Untouched$/m);
    assert.match(stdout, /\*\*business\*\* — no workstreams yet/);
  });

  test('--html writes one self-contained file', () => {
    const out = path.join(ROOT, 'board.html');
    const { stdout, code } = hq(['dashboard', '--html', out]);
    assert.equal(code, 0);
    assert.match(stdout, /dashboard written to/);

    const html = fs.readFileSync(out, 'utf8');
    for (const d of ['video', 'apps', 'business']) assert.match(html, new RegExp(d));
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /<style>/);
    assert.ok(!/<script/i.test(html), 'no scripts');
    assert.ok(!/https?:\/\//i.test(html), 'no network references');
  });

  test('rejects a nonsense threshold', () => {
    const { code, stderr } = hq(['dashboard', '--stale-hours', 'soon']);
    assert.equal(code, 1);
    assert.match(stderr, /must be a non-negative number/);
  });
});

describe('the page, opened for you (default view)', () => {
  test('with no flags, writes <hqRoot>/dashboard.html and prints exactly one line', () => {
    const { stdout, code } = hq(['dashboard', '--no-open']);
    assert.equal(code, 0);
    const out = path.join(ROOT, 'dashboard.html');
    assert.ok(fs.existsSync(out), 'dashboard.html must be written at the HQ root');
    assert.equal(stdout.trim().split('\n').length, 1, 'exactly one line of output');
    assert.match(stdout, /dashboard\.html/, 'the line names the file');
    assert.match(stdout, /`hq dashboard`/, 'the line says how to refresh it');
  });

  test('the page leads with the what-did-I-miss lists, then the table, then inbox/decisions', () => {
    const { code } = hq(['dashboard', '--no-open']);
    assert.equal(code, 0);
    const html = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
    const at = (re) => { const m = html.search(re); assert.ok(m !== -1, `${re} not found`); return m; };
    const staleAt = at(/<h2>Stale/);
    const blockedAt = at(/<h2>Blocked/);
    const awaitingAt = at(/<h2>Awaiting review/);
    const untouchedAt = at(/<h2>Untouched/);
    const tableAt = at(/<table/);
    const inboxAt = at(/<h2>Inbox and decisions/);
    assert.ok(staleAt < blockedAt && blockedAt < awaitingAt && awaitingAt < untouchedAt,
      'the four lists must lead, in order: stale, blocked, awaiting review, untouched');
    assert.ok(untouchedAt < tableAt, 'the domain table follows the lists');
    assert.ok(tableAt < inboxAt, 'inbox and decisions come last');
  });

  test('without --watch, the page names the manual refresh path', () => {
    const { code } = hq(['dashboard', '--no-open']);
    assert.equal(code, 0);
    const html = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
    assert.ok(!/http-equiv="refresh"/.test(html), 'no auto-refresh without --watch');
    assert.match(html, /run <code>hq dashboard<\/code> again, or <code>--watch<\/code>, to refresh/);
  });

  test('--watch regenerates the file until --watch-iterations is reached, then the process exits', () => {
    const out = path.join(ROOT, 'dashboard.html');
    fs.writeFileSync(out, 'stale placeholder', 'utf8');
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(out, old, old);

    const { code, stdout } = hq(['dashboard', '--watch', '1', '--watch-iterations', '2', '--no-open']);
    assert.equal(code, 0, 'the process must exit cleanly once iterations are exhausted');
    assert.match(stdout, /refreshing every 1s/);

    const stat = fs.statSync(out);
    assert.ok(stat.mtimeMs > old.getTime(), 'the file must have been rewritten');
    const html = fs.readFileSync(out, 'utf8');
    assert.match(html, /<meta http-equiv="refresh" content="1">/);
  });
});

describe('latest decisions: newest by date, not last regex-matched line', () => {
  // Reproduces a real HQ's decisions.md: older entries in the plain
  // "- YYYY-MM-DD | ..." form, newer ones hand-written with bold emphasis and,
  // sometimes, a time tag before the "|" — both of which used to make a line
  // invisible to the "latest decisions" picker, so a stale line won a slot a
  // genuinely newer one should have had.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-hq-decisions-'));
  before(() => {
    hq(['init', '--root', dir, '--domains', 'apps'], { HQ_ROOT: dir });
    fs.appendFileSync(path.join(dir, 'decisions.md'), [
      '- 2026-08-13 | old plain decision one | apps',
      '- 2026-08-13 | old plain decision two | apps',
      '- 2026-08-17 | old plain decision three | apps',
      '- **2026-09-02 | bold decision, no time** — detail | apps',
      '- **2026-09-02 13:35 KST | bold decision with a time tag** — detail | apps',
      '- **2026-09-03 | newest bold decision** — detail | apps',
      '',
    ].join('\n'));
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('terminal: the true newest three win, oldest-of-the-three first', () => {
    const { stdout } = hq(['dashboard', '--terminal'], { HQ_ROOT: dir });
    assert.match(stdout, /bold decision, no time/);
    assert.match(stdout, /bold decision with a time tag/);
    assert.match(stdout, /newest bold decision/);
    assert.ok(!/old plain decision/.test(stdout),
      'stale entries that happen to match a stricter pattern must not crowd out real latest ones');

    const noTimeAt = stdout.indexOf('bold decision, no time');
    const withTimeAt = stdout.indexOf('bold decision with a time tag');
    const newestAt = stdout.indexOf('newest bold decision');
    assert.ok(noTimeAt < withTimeAt && withTimeAt < newestAt, 'oldest of the three first, newest last');
  });

  test('markdown and html agree with the terminal view (same helper)', () => {
    const md = hq(['dashboard', '--md'], { HQ_ROOT: dir }).stdout;
    assert.match(md, /newest bold decision/);
    assert.ok(!/old plain decision/.test(md));

    const out = path.join(dir, 'board.html');
    hq(['dashboard', '--html', out], { HQ_ROOT: dir });
    const html = fs.readFileSync(out, 'utf8');
    assert.match(html, /newest bold decision/);
    assert.ok(!/old plain decision/.test(html));
  });
});

describe('generated time is readable, not raw ISO', () => {
  test('the page header and footer use "YYYY-MM-DD HH:MM UTC", same as the terminal view', () => {
    const { code } = hq(['dashboard', '--no-open']);
    assert.equal(code, 0);
    const html = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
    const readable = /\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/;
    assert.match(html, readable, 'header meta line');
    assert.match(html.split('<footer>')[1] || '', readable, 'footer');
    assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/.test(html), 'no raw ISO timestamp anywhere on the page');
  });

  test('markdown uses the same readable form', () => {
    const md = hq(['dashboard', '--md']).stdout;
    assert.match(md, /\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
    assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/.test(md));
  });
});
