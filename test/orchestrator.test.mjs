import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

before(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'session-hq-orch-'));
  hq(['init', '--root', ROOT, '--domains', 'video,apps,business']);
});
after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe('the orchestrator seat', () => {
  test('init lays down status-hq.md and leaves it out of domains', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'status-hq.md')));
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'hq.config.json'), 'utf8'));
    assert.deepEqual(cfg.domains, ['video', 'apps', 'business']);
    assert.equal(cfg.orchestrator.domain, 'hq');
    assert.equal(cfg.orchestrator.injectDashboard, true);

    const seat = fs.readFileSync(path.join(ROOT, 'status-hq.md'), 'utf8');
    assert.match(seat, /## Dispatched/);
    assert.match(seat, /## Awaiting review/);
    assert.match(seat, /## Decisions/);
  });

  test('a seat session is injected with the dashboard and its own notes', () => {
    const { stdout } = hq(['inject', '--print'], { env: { HQ_DOMAIN: 'hq' } });
    assert.match(stdout, /orchestrator session/);
    assert.match(stdout, /# session-hq dashboard/);
    assert.match(stdout, /\| Domain \| Last updated \|/);
    for (const d of ['video', 'apps', 'business']) assert.match(stdout, new RegExp(`\\| ${d} \\|`));
    assert.match(stdout, /Your own notes/);
    assert.match(stdout, /## Awaiting review/);
    assert.ok(!/HQ status for this session/.test(stdout), 'the seat gets the HQ, not one file');
  });

  test('HQ_DOMAIN=all reaches the same seat', () => {
    const { stdout } = hq(['inject', '--print'], { env: { HQ_DOMAIN: 'all' } });
    assert.match(stdout, /orchestrator session/);
    assert.match(stdout, /# session-hq dashboard/);
  });

  test('a department session is unaffected', () => {
    const { stdout } = hq(['inject', '--print'], { env: { HQ_DOMAIN: 'apps' } });
    assert.match(stdout, /HQ status for this session/);
    assert.ok(!/orchestrator session/.test(stdout));
    assert.ok(!/# session-hq dashboard/.test(stdout));
  });

  test('injectDashboard:false gives the seat only its own notes', () => {
    const p = path.join(ROOT, 'hq.config.json');
    const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
    fs.writeFileSync(p, JSON.stringify({ ...cfg, orchestrator: { ...cfg.orchestrator, injectDashboard: false } }, null, 2));
    const { stdout } = hq(['inject', '--print'], { env: { HQ_DOMAIN: 'hq' } });
    assert.match(stdout, /orchestrator session/);
    assert.ok(!/# session-hq dashboard/.test(stdout));
    assert.match(stdout, /Your own notes/);
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  });

  test('the dashboard is trimmed to orchestrator.maxLines', () => {
    const p = path.join(ROOT, 'hq.config.json');
    const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
    fs.writeFileSync(p, JSON.stringify({ ...cfg, orchestrator: { ...cfg.orchestrator, maxLines: 6 } }, null, 2));
    const { stdout } = hq(['inject', '--print'], { env: { HQ_DOMAIN: 'hq' } });
    assert.match(stdout, /trimmed to 6 lines/);
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  });

  test('wrap --domain hq gives the seat view too, with no slash commands', () => {
    const { stdout } = hq(['wrap', '--domain', 'hq', '--', process.execPath, '-e', "console.log('CHILD')"]);
    assert.match(stdout, /orchestrator session/);
    assert.match(stdout, /# session-hq dashboard/);
    assert.match(stdout, /CHILD/);
    assert.ok(!/\/hq-decide/.test(stdout), 'the CLI voice must not advertise slash commands');
    assert.match(stdout, /hq\.mjs" decide/);
  });

  test('the seat is accountable for status-hq.md, and a decision counts as reporting back', () => {
    const sid = 'seat-decides';
    hq(['inject', '--event', 'session-start'], { stdin: { session_id: sid, cwd: ROOT }, env: { HQ_DOMAIN: 'hq' } });

    const state = JSON.parse(fs.readFileSync(path.join(ROOT, '.state', `${sid}.json`), 'utf8'));
    assert.equal(state.domain, 'hq', 'HQ_DOMAIN=hq is accounted to the seat file');
    assert.equal(state.orchestrator, true);
    assert.equal(typeof state.decisionsHashAtStart, 'string');

    hq(['remind'], { stdin: { session_id: sid, cwd: ROOT }, env: { HQ_DOMAIN: 'hq' } });

    // Nothing written yet: the seat is reminded like anyone else.
    const nagged = hq(['update-check'], { stdin: { session_id: sid, cwd: ROOT }, env: { HQ_DOMAIN: 'hq' } });
    assert.match(JSON.parse(nagged.stdout).systemMessage, /`status-hq\.md` is unchanged/);

    // A recorded decision is the seat reporting back, even with its own file untouched.
    const sid2 = 'seat-decides-2';
    hq(['inject', '--event', 'session-start'], { stdin: { session_id: sid2, cwd: ROOT }, env: { HQ_DOMAIN: 'hq' } });
    hq(['remind'], { stdin: { session_id: sid2, cwd: ROOT }, env: { HQ_DOMAIN: 'hq' } });
    hq(['decide', 'ship the export behind a flag', '--domain', 'apps']);
    const quiet = hq(['update-check'], { stdin: { session_id: sid2, cwd: ROOT }, env: { HQ_DOMAIN: 'hq' } });
    assert.equal(quiet.stdout.trim(), '', 'a decision is reporting back');
  });

  test('doctor warns if the seat is also listed as a department', () => {
    const p = path.join(ROOT, 'hq.config.json');
    const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
    fs.writeFileSync(p, JSON.stringify({ ...cfg, domains: [...cfg.domains, 'hq'] }, null, 2));
    const { stdout } = hq(['doctor']);
    assert.match(stdout, /orchestrator\.domain is also listed in domains/);
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  });
});
