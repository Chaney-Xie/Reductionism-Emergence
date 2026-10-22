import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  VIEWER_V1_DEFAULTS,
  verifyPackagedViewerFreshness
} from '../../../test/markdownConformance/runner/adapters/viewerV1.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), '../../..');
const packageRequested = process.argv.includes('--package');

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

async function isFile(relativePath) {
  try {
    return (await fs.stat(path.join(root, relativePath))).isFile();
  } catch {
    return false;
  }
}

const metadata = JSON.parse(await read('package.json'));
const lock = JSON.parse(await read('package-lock.json'));
const forge = await read('forge.config.js');
const desktop = await read('desktop/main.js');
const index = await read('public/index.html');

assert.equal(metadata.name, 'reductionism-emergence');
assert.equal(metadata.version, '0.4.2');
assert.equal(lock.version, metadata.version);
assert.equal(lock.packages[''].version, metadata.version);
assert.match(forge, /name:\s*'Reductionism & Emergence'/);
assert.match(forge, /executableName:\s*'Reductionism & Emergence'/);
assert.match(forge, /icon:\s*path\.resolve\(__dirname, 'assets', 'reductionism-emergence\.icns'\)/);
assert.equal(await isFile('assets/reductionism-emergence-icon-source.png'), true);
assert.equal(await isFile('assets/reductionism-emergence.icns'), true);
assert.match(desktop, /const APP_NAME = 'Reductionism & Emergence'/);
assert.match(index, /<title>Reductionism &amp; Emergence<\/title>/);
assert.match(index, /aria-label="Change HN Text mode"/);

const renamePairs = [
  ['public/cneListCommands.js', 'public/hnListCommands.js'],
  ['public/cneListIndex.js', 'public/hnListIndex.js'],
  ['public/cneListNumbering.js', 'public/hnListNumbering.js'],
  ['public/cneStructureIndex.js', 'public/hnStructureIndex.js'],
  ['public/cneText.js', 'public/hnText.js'],
  ['public/js/cnePageDocumentSession.js', 'public/js/hnPageDocumentSession.js'],
  ['public/js/cneTextPageView.js', 'public/js/hnTextPageView.js'],
  ['server/cneTextPage.js', 'server/hnTextPage.js']
];
for (const [oldPath, newPath] of renamePairs) {
  assert.equal(await isFile(oldPath), false, `${oldPath} must be retired`);
  assert.equal(await isFile(newPath), true, `${newPath} must exist`);
}

const pageTypes = await read('public/pageTypes.js');
const hnText = await read('public/hnText.js');
const preload = await read('desktop/preload.js');
const vaultContext = await read('server/vaultContext.js');
assert.match(pageTypes, /HN_TEXT:\s*'cne-text'/);
assert.match(pageTypes, /label:\s*'HN Text'/);
assert.match(hnText, /const HN_PAGE_TYPE = 'cne-text'/);
assert.match(hnText, /const HN_SCHEMA_VERSION = 3/);
assert.match(hnText, /cneTextMode:/);
assert.match(preload, /exposeInMainWorld\('cneDesktop'/);
assert.match(vaultContext, /APP_DATA_DIRECTORY_NAME = 'CogNeuro Viewer'/);
assert.equal(VIEWER_V1_DEFAULTS.freshnessFiles.includes('public/hnListCommands.js'), true);
assert.equal(VIEWER_V1_DEFAULTS.freshnessFiles.includes('public/hnListIndex.js'), true);
assert.equal(VIEWER_V1_DEFAULTS.freshnessFiles.includes('public/hnListNumbering.js'), true);

const result = {
  product: 'Reductionism & Emergence',
  shortProduct: 'R&E',
  version: metadata.version,
  structuredTextSystem: 'Hierarchy Network',
  pageTypeDisplayName: 'HN Text',
  renamedFiles: renamePairs.length,
  freshnessInventory: VIEWER_V1_DEFAULTS.freshnessFiles.length,
  package: null
};

if (packageRequested) {
  const freshness = await verifyPackagedViewerFreshness();
  assert.equal(freshness.packageMetadata.name, 'reductionism-emergence');
  assert.equal(freshness.packageMetadata.version, '0.4.2');
  assert.equal(freshness.checked.length, VIEWER_V1_DEFAULTS.freshnessFiles.length);
  assert.equal(freshness.checked.every((entry) => (
    entry.sourceSha256 === entry.packagedSha256
  )), true);
  result.package = {
    executablePath: VIEWER_V1_DEFAULTS.executablePath,
    asarSha256: freshness.asarSha256,
    checked: freshness.checked.length
  };
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
