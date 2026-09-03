import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseDenylist, scanText, scanTree } from '../scripts/leak-check.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'scripts', 'leak-check.mjs');

function tmpTree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leak-check-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
  return dir;
}

describe('parseDenylist', () => {
  test('skips blanks and comments', () => {
    const entries = parseDenylist('# a comment\n\nalpha\n  beta  \n');
    assert.deepEqual(entries.map((e) => e.term), ['alpha', 'beta']);
  });

  test('compiles a valid regex as a regex', () => {
    // Deliberately not a credential-shaped pattern: this repo's own leak-check runs over
    // its test files, and a realistic token fixture would trip it.
    const [entry] = parseDenylist('ACME-[0-9]{4,}');
    assert.equal(entry.kind, 'regex');
    assert.equal(scanText('ticket ACME-12345 filed', [entry]).length, 1);
    assert.equal(scanText('ticket ACME-12 filed', [entry]).length, 0);
  });

  test('falls back to a literal match for invalid regex syntax', () => {
    // A trailing backslash is not valid regex, but is a realistic path fragment.
    const [entry] = parseDenylist('some\\path\\');
    assert.equal(entry.kind, 'literal');
    assert.equal(scanText('C:\\Users\\x\\some\\path\\file.txt', [entry]).length, 1);
  });

  test('matching is case-insensitive', () => {
    const entries = parseDenylist('SecretProject');
    assert.equal(scanText('the secretproject codename', entries).length, 1);
  });
});

describe('scanTree', () => {
  test('reports a hit with file, line, and excerpt', () => {
    const dir = tmpTree({
      'README.md': 'clean line\nthis mentions AcmeCorp here\n',
      'ok.md': 'nothing to see\n',
    });
    const denylist = path.join(dir, '..', `denylist-${process.pid}.txt`);
    fs.writeFileSync(denylist, 'AcmeCorp\n');
    try {
      const res = scanTree({ dir, denylistPath: denylist });
      assert.equal(res.hits.length, 1);
      assert.equal(res.hits[0].file, 'README.md');
      assert.equal(res.hits[0].line, 2);
      assert.match(res.hits[0].excerpt, /AcmeCorp/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(denylist, { force: true });
    }
  });

  test('is clean when nothing matches', () => {
    const dir = tmpTree({ 'a.md': 'entirely innocent\n' });
    const denylist = path.join(dir, '..', `denylist2-${process.pid}.txt`);
    fs.writeFileSync(denylist, 'AcmeCorp\nOtherThing\n');
    try {
      const res = scanTree({ dir, denylistPath: denylist });
      assert.equal(res.hits.length, 0);
      assert.equal(res.terms, 2);
      assert.ok(res.scanned >= 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(denylist, { force: true });
    }
  });

  test('skips binary files rather than producing noise', () => {
    const dir = tmpTree({ 'a.md': 'clean\n' });
    fs.writeFileSync(path.join(dir, 'blob.bin'), Buffer.from([0x00, 0x41, 0x00, 0x42]));
    const denylist = path.join(dir, '..', `denylist3-${process.pid}.txt`);
    fs.writeFileSync(denylist, 'A\n');
    try {
      const res = scanTree({ dir, denylistPath: denylist });
      assert.ok(!res.hits.some((h) => h.file === 'blob.bin'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(denylist, { force: true });
    }
  });

  test('throws a typed error when the denylist is missing', () => {
    const dir = tmpTree({ 'a.md': 'x\n' });
    try {
      assert.throws(
        () => scanTree({ dir, denylistPath: path.join(dir, 'nope.txt') }),
        (e) => e.code === 'ENODENYLIST'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('cli', () => {
  test('exit 1 on a hit, exit 0 when clean', () => {
    const dir = tmpTree({ 'a.md': 'contains AcmeCorp\n' });
    const denylist = path.join(dir, '..', `denylist4-${process.pid}.txt`);
    fs.writeFileSync(denylist, 'AcmeCorp\n');
    try {
      const dirty = spawnSync(process.execPath, [CLI, '--dir', dir, '--denylist', denylist], { encoding: 'utf8' });
      assert.equal(dirty.status, 1);
      assert.match(dirty.stderr, /1 hit/);

      fs.writeFileSync(path.join(dir, 'a.md'), 'contains nothing\n');
      const clean = spawnSync(process.execPath, [CLI, '--dir', dir, '--denylist', denylist], { encoding: 'utf8' });
      assert.equal(clean.status, 0);
      assert.match(clean.stdout, /clean/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(denylist, { force: true });
    }
  });

  test('exit 2 when the denylist cannot be found', () => {
    const res = spawnSync(process.execPath, [CLI, '--denylist', path.join(os.tmpdir(), 'definitely-missing.txt')], { encoding: 'utf8' });
    assert.equal(res.status, 2);
    assert.match(res.stderr, /denylist not found/);
  });

  test('--json is machine-readable', () => {
    const dir = tmpTree({ 'a.md': 'AcmeCorp\n' });
    const denylist = path.join(dir, '..', `denylist5-${process.pid}.txt`);
    fs.writeFileSync(denylist, 'AcmeCorp\n');
    try {
      const res = spawnSync(process.execPath, [CLI, '--dir', dir, '--denylist', denylist, '--json'], { encoding: 'utf8' });
      const parsed = JSON.parse(res.stdout);
      assert.equal(parsed.hits.length, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(denylist, { force: true });
    }
  });
});
