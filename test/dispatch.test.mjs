import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseDispatches } from '../scripts/hq.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'scripts', 'hq.mjs');

let ROOT;

function hq(args, { stdin = null, env = {} } = {}) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    input: stdin === null ? '' : JSON.stringify(stdin),
    encoding: 'utf8', cwd: ROOT,
    env: { ...process.env, HQ_ROOT: ROOT, HQ_DOMAIN: '', ...env },
  });
  if (res.error) throw res.error;
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '', code: res.status };
}

const dispatchFile = () => path.join(ROOT, 'dispatches.md');
const newId = (text, extra = []) => hq(['dispatch', '--to', 'video', ...extra, text]).stdout.split('\n')[0].trim();

before(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'session-hq-disp-'));
  hq(['init', '--root', ROOT, '--domains', 'video,apps,business']);
});
after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe('dispatch parsing', () => {
  test('reads an open line', () => {
    const [d] = parseDispatches('- [ ] d-a1b2c3 · 2026-02-04 · hq → video · re-render the intro');
    assert.equal(d.id, 'd-a1b2c3');
    assert.equal(d.from, 'hq');
    assert.equal(d.to, 'video');
    assert.equal(d.text, 're-render the intro');
    assert.equal(d.done, null);
    assert.equal(d.acked, null);
  });

  test('reads priority, done and acked', () => {
    const [d] = parseDispatches(
      '- [x] d-a1b2c3 · 2026-02-04 · hq → video · !high · re-render ↳ done 2026-02-05: shipped · acked 2026-02-06');
    assert.equal(d.priority, 'high');
    assert.equal(d.text, 're-render');
    assert.deepEqual(d.done, { date: '2026-02-05', note: 'shipped' });
    assert.equal(d.acked, '2026-02-06');
  });

  test('ignores examples inside a fenced code block', () => {
    const text = [
      '# Dispatches', '', '```',
      '- [ ] d-a1b2c3 · 2026-02-04 · hq → video · an example, not a task',
      '```', '',
      '- [ ] d-beef01 · 2026-02-07 · hq → apps · a real one',
    ].join('\n');
    const list = parseDispatches(text);
    assert.equal(list.length, 1, 'documentation must not become work');
    assert.equal(list[0].id, 'd-beef01');
  });

  test('a freshly initialised HQ has no dispatches', () => {
    assert.ok(fs.existsSync(dispatchFile()));
    assert.equal(parseDispatches(fs.readFileSync(dispatchFile(), 'utf8')).length, 0);
  });
});

describe('the dispatch lifecycle', () => {
  test('dispatch appends a line and returns the id', () => {
    const id = newId('re-render the intro with the fixed logo', ['--priority', 'high']);
    assert.match(id, /^d-[0-9a-f]{6}$/);
    const [d] = parseDispatches(fs.readFileSync(dispatchFile(), 'utf8')).filter((x) => x.id === id);
    assert.equal(d.to, 'video');
    assert.equal(d.from, 'hq', 'the orchestrator seat is the default sender');
    assert.equal(d.priority, 'high');
    assert.equal(d.done, null);
  });

  test('an unknown domain is refused', () => {
    const { code, stderr } = hq(['dispatch', '--to', 'nosuch', 'something']);
    assert.equal(code, 1);
    assert.match(stderr, /not a known domain/);
  });

  test('the target domain sees it at session start', () => {
    const id = newId('check the export handles files over 20 MB');
    const { stdout } = hq(['inject', '--print'], { env: { HQ_DOMAIN: 'video' } });
    assert.match(stdout, /### HQ asked you to:/);
    assert.match(stdout, new RegExp(id));
    assert.match(stdout, /hq\.mjs done <id>/);

    // Another domain is not told about it.
    const other = hq(['inject', '--print'], { env: { HQ_DOMAIN: 'business' } });
    assert.ok(!/HQ asked you to/.test(other.stdout));
  });

  test('done flips the line and puts it in the review queue', () => {
    const id = newId('add the missing alt text');
    hq(['done', id, '--note', 'added to all 12 images']);
    const [d] = parseDispatches(fs.readFileSync(dispatchFile(), 'utf8')).filter((x) => x.id === id);
    assert.equal(d.done.note, 'added to all 12 images');
    assert.equal(d.acked, null);

    const q = hq(['dispatches', '--awaiting-review']);
    assert.match(q.stdout, new RegExp(`review ${id}`));

    // and it drops out of the target's injection
    const { stdout } = hq(['inject', '--print'], { env: { HQ_DOMAIN: 'video' } });
    assert.ok(!new RegExp(id).test(stdout));
  });

  test('ack closes it, and refuses on work that is not done', () => {
    const id = newId('rebuild the caption file');
    const early = hq(['ack', id]);
    assert.equal(early.code, 1);
    assert.match(early.stderr, /not done yet/);

    hq(['done', id, '--note', 'rebuilt']);
    hq(['ack', id]);
    const [d] = parseDispatches(fs.readFileSync(dispatchFile(), 'utf8')).filter((x) => x.id === id);
    assert.match(d.acked, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(!new RegExp(`review ${id}`).test(hq(['dispatches', '--awaiting-review']).stdout));
  });

  test('an unknown id is reported, not silently ignored', () => {
    const { code, stderr } = hq(['done', 'd-000000']);
    assert.equal(code, 1);
    assert.match(stderr, /no dispatch d-000000/);
  });

  test('filters: default open, --awaiting-review, --all, --domain', () => {
    const all = hq(['dispatches', '--all']).stdout;
    const open = hq(['dispatches']).stdout;
    assert.ok(all.length > open.length, '--all includes closed work');
    assert.ok(!/acked /.test(open), 'the default view is open work only');
    const apps = hq(['dispatches', '--all', '--domain', 'apps']).stdout;
    assert.ok(!/→ video/.test(apps));
  });
});

describe('dispatch and the rest of the system', () => {
  test('the dashboard counts open asks and lists the review queue', () => {
    const id = newId('colour-grade the b-roll');
    hq(['done', id, '--note', 'graded and re-exported']);
    const open = newId('swap the outro card');

    const { stdout } = hq(['dashboard']);
    assert.match(stdout, /DOMAIN\s+LAST UPDATED\s+WORK\s+BLOCKED\s+NEXT\s+ASKED/);
    assert.match(stdout, /AWAITING REVIEW/);
    assert.match(stdout, new RegExp(`${id}\\s+video`));
    assert.match(stdout, /graded and re-exported/);

    const md = hq(['dashboard', '--md']).stdout;
    assert.match(md, /\| Domain \| Last updated \| Workstreams \| Blocked \| Next \| Asked \|/);
    assert.match(md, /^## Awaiting review$/m);
    // Open asks are a count in the table; only review items get a list entry.
    assert.match(md, /^\| video \|.*\| [1-9]\d* \|$/m, 'the Asked column counts open work');
    assert.ok(!md.includes(open), 'an open ask must not appear in Awaiting review');
  });

  test('the orchestrator seat sees the review queue in its injection', () => {
    const { stdout } = hq(['inject', '--print'], { env: { HQ_DOMAIN: 'hq' } });
    assert.match(stdout, /orchestrator session/);
    assert.match(stdout, /## Awaiting review/);
  });

  test('reporting a dispatch done counts as writing back', () => {
    const id = newId('trim the cold open');
    const sid = 'dispatch-writeback';
    hq(['inject', '--event', 'session-start'], { stdin: { session_id: sid, cwd: ROOT }, env: { HQ_DOMAIN: 'video' } });
    hq(['remind'], { stdin: { session_id: sid, cwd: ROOT }, env: { HQ_DOMAIN: 'video' } });

    hq(['done', id, '--note', 'trimmed to 4 seconds']);
    const quiet = hq(['update-check'], { stdin: { session_id: sid, cwd: ROOT }, env: { HQ_DOMAIN: 'video' } });
    assert.equal(quiet.stdout.trim(), '', 'a reported result is a report');
  });

  test('a session that did nothing at all is still reminded', () => {
    const sid = 'dispatch-silent';
    hq(['inject', '--event', 'session-start'], { stdin: { session_id: sid, cwd: ROOT }, env: { HQ_DOMAIN: 'business' } });
    hq(['remind'], { stdin: { session_id: sid, cwd: ROOT }, env: { HQ_DOMAIN: 'business' } });
    const { stdout } = hq(['update-check'], { stdin: { session_id: sid, cwd: ROOT }, env: { HQ_DOMAIN: 'business' } });
    assert.match(JSON.parse(stdout).systemMessage, /`status-business\.md` is unchanged/);
  });
});
