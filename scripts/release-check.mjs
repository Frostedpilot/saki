#!/usr/bin/env node
// Release hygiene: the workspace has one version, CHANGELOG.md has a section for
// it, and (on a tag build) the tag matches it. No dependencies, no file writes.
//
//   node scripts/release-check.mjs                 # check versions + changelog
//   node scripts/release-check.mjs --tag v1.0.0    # also require the tag
//   node scripts/release-check.mjs --notes         # print the changelog section
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PACKAGE_FILES = ['package.json', 'engine/package.json', 'server/package.json', 'web-client/package.json'];

const readJson = (root, rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));

export function packageVersions(root = ROOT) {
  return PACKAGE_FILES.map((file) => ({ file, version: readJson(root, file).version }));
}

export function checkVersions(root = ROOT) {
  const versions = packageVersions(root);
  const errors = [];
  const version = versions[0]?.version;
  for (const { file, version: v } of versions) {
    if (!v) errors.push(`${file} has no version`);
    else if (v !== version) errors.push(`${file} is ${v}, expected ${version}`);
  }
  return { version, versions, errors };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// `## [1.0.0] - 2026-10-25`, `## 1.0.0` and `## v1.0.0` all count. The body runs
// to the next level-2 heading.
export function changelogSection(changelog, version) {
  const heading = new RegExp(`^##\\s+\\[?v?${escapeRe(version)}\\]?(?:\\s|$).*$`, 'm');
  const match = heading.exec(changelog);
  if (!match) return null;
  const rest = changelog.slice(match.index + match[0].length);
  const next = rest.search(/^##\s+/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

export function checkRelease({ root = ROOT, tag } = {}) {
  const { version, errors } = checkVersions(root);
  let section = null;
  try {
    const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
    section = changelogSection(changelog, version);
  } catch {
    errors.push('CHANGELOG.md is missing');
  }
  if (section !== null && section.length === 0) {
    errors.push(`CHANGELOG.md has an empty section for ${version}`);
  } else if (section === null) {
    errors.push(`CHANGELOG.md has no section for ${version}`);
  }
  if (tag !== undefined) {
    const expected = `v${version}`;
    if (tag !== expected && tag !== version) {
      errors.push(`tag ${tag} does not match package version (expected ${expected})`);
    }
  }
  return { version, section, errors };
}

function main(argv) {
  const tagIndex = argv.indexOf('--tag');
  const tag = tagIndex !== -1 ? argv[tagIndex + 1] : undefined;
  const notes = argv.includes('--notes');
  const result = checkRelease({ tag });

  if (notes) {
    if (result.errors.length) {
      for (const e of result.errors) console.error(`release-check: ${e}`);
      process.exit(1);
    }
    console.log(result.section);
    return;
  }

  if (result.errors.length) {
    for (const e of result.errors) console.error(`release-check: ${e}`);
    process.exit(1);
  }
  console.log(`release-check: ${result.version} is consistent across the workspace and changelog`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
