const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

const RENAMED_FILES = Object.freeze([
  ['public/cneListCommands.js', 'public/hnListCommands.js'],
  ['public/cneListIndex.js', 'public/hnListIndex.js'],
  ['public/cneListNumbering.js', 'public/hnListNumbering.js'],
  ['public/cneStructureIndex.js', 'public/hnStructureIndex.js'],
  ['public/cneText.js', 'public/hnText.js'],
  ['public/js/cnePageDocumentSession.js', 'public/js/hnPageDocumentSession.js'],
  ['public/js/cneTextPageView.js', 'public/js/hnTextPageView.js'],
  ['server/cneTextPage.js', 'server/hnTextPage.js']
]);

test('R&E v0.4.2 is the one current package, bundle, and runtime identity', () => {
  const packageJson = JSON.parse(read('package.json'));
  const packageLock = JSON.parse(read('package-lock.json'));
  const forge = read('forge.config.js');
  const desktop = read('desktop/main.js');
  const index = read('public/index.html');
  const server = read('server/appServer.js');

  assert.equal(packageJson.name, 'reductionism-emergence');
  assert.equal(packageJson.version, '0.4.2');
  assert.equal(packageJson.description, 'Reductionism & Emergence desktop knowledge workspace.');
  assert.equal(packageLock.name, packageJson.name);
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[''].name, packageJson.name);
  assert.equal(packageLock.packages[''].version, packageJson.version);
  assert.match(forge, /name:\s*'Reductionism & Emergence'/);
  assert.match(forge, /executableName:\s*'Reductionism & Emergence'/);
  assert.match(forge, /icon:\s*path\.resolve\(__dirname, 'assets', 'reductionism-emergence\.icns'\)/);
  assert.equal(exists('assets/reductionism-emergence-icon-source.png'), true);
  assert.equal(exists('assets/reductionism-emergence.icns'), true);
  assert.match(desktop, /const APP_NAME = 'Reductionism & Emergence'/);
  assert.match(desktop, /app\.setName\(APP_NAME\)/);
  assert.match(index, /<title>Reductionism &amp; Emergence<\/title>/);
  assert.match(server, /version:\s*metadata\.sourceVersion \|\| '0\.4\.2'/);
  assert.match(server, /Reductionism & Emergence is running at/);
});

test('current HN-owned modules are clean renames with one live path', () => {
  for (const [oldPath, newPath] of RENAMED_FILES) {
    assert.equal(exists(oldPath), false, `${oldPath} must not remain as a duplicate`);
    assert.equal(exists(newPath), true, `${newPath} must be the current HN owner`);
  }

  const index = read('public/index.html');
  for (const currentPath of [
    'hnListNumbering.js',
    'hnText.js',
    'hnStructureIndex.js',
    'hnListIndex.js',
    'hnListCommands.js',
    'js/hnPageDocumentSession.js',
    'js/hnTextPageView.js'
  ]) {
    assert.match(index, new RegExp(`src="${currentPath.replaceAll('.', '\\.')}(?:\\?|\")`));
  }
  assert.doesNotMatch(index, /src="(?:js\/)?cne(?:Text|List|Structure|Page)/i);

  const model = require('../public/hnText');
  const pageTypes = require('../public/pageTypes');
  assert.equal(model.HN_PAGE_TYPE, 'cne-text');
  assert.equal(model.HN_SCHEMA_VERSION, 3);
  assert.deepEqual(model.HN_TEXT_MODES, { EDIT: 'edit', BROWSER: 'browser' });
  assert.equal(pageTypes.PAGE_TYPES.HN_TEXT, 'cne-text');
  assert.equal(pageTypes.pageTypeDefinition('cne-text').label, 'HN Text');
});

test('persisted and external CNE compatibility identifiers remain byte-level contracts', () => {
  const model = require('../public/hnText');
  const empty = model.createEmptyEnvelope();
  const pageTypes = require('../public/pageTypes');
  const preload = read('desktop/preload.js');
  const vaultContext = read('server/vaultContext.js');

  assert.deepEqual(Object.keys(empty).sort(), ['anchors', 'revision', 'schemaVersion', 'source']);
  assert.equal(empty.schemaVersion, 3);
  assert.equal(pageTypes.createPageRecord({ id: 'page_compat', title: 'Compatibility' },
    'cne-text').type, 'cne-text');
  assert.match(read('server/appServer.js'), /req\.body\.cneText/);
  assert.match(read('public/app.js'), /page\.cneText/);
  assert.match(read('public/app.js'), /vaultPreferences\.cneTextMode/);
  assert.match(preload, /exposeInMainWorld\('cneDesktop'/);
  assert.match(preload, /cne-desktop:get-vault-info/);
  assert.match(vaultContext, /APP_DATA_DIRECTORY_NAME = 'CogNeuro Viewer'/);
});

test('current identity and architecture contracts do not depend on historical certification evidence', () => {
  const identityContract = read('docs/architecture/identity-and-compatibility.md');
  const structuredTextContract = read('docs/architecture/structured-text.md');
  const runtimeContract = read('docs/architecture/runtime-ownership.md');
  assert.match(identityContract, /Reductionism & Emergence/);
  assert.match(identityContract, /Page Type value: `cne-text`/);
  assert.match(structuredTextContract, /Canonical text is source data, never rendered DOM/);
  assert.match(runtimeContract, /Each Pane owns one durable runtime object/);
});
