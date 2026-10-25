import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PACKAGE_FILES, changelogSection, checkRelease, checkVersions } from './release-check.mjs';

function makeWorkspace({ version = '1.2.3', server = version, changelog } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'saki-release-'));
  for (const file of PACKAGE_FILES) {
    const target = join(root, file);
    mkdirSync(join(target, '..'), { recursive: true });
    const v = file === 'server/package.json' ? server : version;
    writeFileSync(target, JSON.stringify({ name: file, version: v }));
  }
  if (changelog !== undefined) writeFileSync(join(root, 'CHANGELOG.md'), changelog);
  return root;
}

test('changelogSection returns one release and stops at the next heading', () => {
  const text = [
    '# Changelog',
    '',
    '## [1.2.3] - 2026-01-01',
    '',
    '- added a thing',
    '',
    '## [1.2.2] - 2025-12-01',
    '',
    '- old',
  ].join('\n');
  assert.equal(changelogSection(text, '1.2.3'), '- added a thing');
  assert.equal(changelogSection(text, '9.9.9'), null);
});

test('checkVersions requires one version across the workspace', () => {
  const ok = makeWorkspace();
  assert.deepEqual(checkVersions(ok).errors, []);

  const bad = makeWorkspace({ server: '0.1.0' });
  const result = checkVersions(bad);
  assert.equal(result.version, '1.2.3');
  assert.match(result.errors.join('\n'), /server\/package\.json is 0\.1\.0/);
});

test('checkRelease requires a changelog section and a matching tag', () => {
  const changelog = '## [1.2.3] - 2026-01-01\n\n- shipped\n';
  const root = makeWorkspace({ changelog });
  assert.deepEqual(checkRelease({ root }).errors, []);
  assert.deepEqual(checkRelease({ root, tag: 'v1.2.3' }).errors, []);
  assert.match(checkRelease({ root, tag: 'v1.2.4' }).errors.join('\n'), /does not match/);

  const noNotes = makeWorkspace({ changelog: '## [1.2.2] - 2025-01-01\n\n- old\n' });
  assert.match(checkRelease({ root: noNotes }).errors.join('\n'), /no section for 1\.2\.3/);
});

test('this repository is release-consistent', () => {
  assert.deepEqual(checkRelease().errors, []);
});
