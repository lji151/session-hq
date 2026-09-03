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
    input: '', encoding: 'utf8', cwd: ROOT,
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
    const { stdout, code } = hq(['dashboard']);
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
    const wide = hq(['dashboard', '--stale-hours', '9000']);
    assert.ok(!/⚠ STALE/.test(wide.stdout));
    assert.match(wide.stdout, /STALE \(> 9000h\)\s*\n\s*none/);

    const narrow = hq(['dashboard', '--stale-hours', '1']);
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
