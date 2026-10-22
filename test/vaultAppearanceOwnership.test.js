const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

function projectPath(relativePath) {
  return path.join(projectRoot, relativePath);
}

function read(relativePath) {
  return fs.readFile(projectPath(relativePath), 'utf8');
}

async function publicRendererScripts() {
  const rootScripts = (await fs.readdir(projectPath('public'), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => `public/${entry.name}`);
  const splitScripts = (await fs.readdir(projectPath('public/js'), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => `public/js/${entry.name}`);
  return [...rootScripts, ...splitScripts].sort();
}

function scriptSources(html) {
  return [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g)]
    .map((match) => match[1].split('?')[0]);
}

function directOrdinaryAppearancePuts(source) {
  const calls = [];
  const patterns = [
    /(?:request|fetch)\s*\(\s*(["'`])\/api\/appearance\1\s*,\s*\{[\s\S]{0,700}?\bmethod\s*:\s*(["'`])PUT\2/g,
    /\bmethod\s*:\s*(["'`])PUT\1[\s\S]{0,700}?(?:request|fetch)\s*\(\s*(["'`])\/api\/appearance\2/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) calls.push(match[0]);
  }
  return calls;
}

function functionSlice(source, startPattern, endPattern) {
  const start = source.search(startPattern);
  if (start < 0) return '';
  const remaining = source.slice(start);
  const relativeEnd = remaining.slice(1).search(endPattern);
  return relativeEnd < 0 ? remaining : remaining.slice(0, relativeEnd + 1);
}

test('main renderer loads the Appearance model, then the store, before app ownership begins', async () => {
  const sources = scriptSources(await read('public/index.html'));
  const modelIndex = sources.indexOf('appearanceSettings.js');
  const storeIndex = sources.indexOf('vaultAppearanceStore.js');
  const appIndex = sources.indexOf('app.js');

  assert.notEqual(modelIndex, -1, 'appearanceSettings.js must remain the model authority');
  assert.notEqual(storeIndex, -1, 'vaultAppearanceStore.js must be loaded by the main renderer');
  assert.notEqual(appIndex, -1, 'app.js must remain part of the main renderer');
  assert.ok(
    modelIndex < storeIndex && storeIndex < appIndex,
    'load order must be appearanceSettings.js -> vaultAppearanceStore.js -> app.js'
  );
});

test('only VaultAppearanceStore owns ordinary renderer PUT /api/appearance persistence', async () => {
  const files = await publicRendererScripts();
  const competingPutOwners = [];
  for (const relativePath of files.filter((file) => file !== 'public/vaultAppearanceStore.js')) {
    const source = await read(relativePath);
    if (directOrdinaryAppearancePuts(source).length > 0) competingPutOwners.push(relativePath);
  }

  assert.deepEqual(
    competingPutOwners,
    [],
    'no renderer module outside VaultAppearanceStore may PUT whole Appearance documents'
  );

  const store = await read('public/vaultAppearanceStore.js');
  assert.match(store, /(["'`])\/api\/appearance\1/, 'the store must target the canonical endpoint');
  assert.match(store, /\bmethod\s*:\s*(["'`])PUT\1/, 'the store must own ordinary PUT persistence');
});

test('Vault Settings has no legacy per-domain Appearance queues or version owners', async () => {
  const settings = await read('public/js/vaultSettings.js');
  for (const legacyOwner of [
    'appearanceBrightnessSaveQueue',
    'appearanceBlockSaveQueue',
    'appearanceMarkdownSaveQueue',
    'quickColourSaveQueue',
    'quickColourPendingIntent',
    'quickColourIntentVersion',
    'appearanceMarkdownSaveVersion',
    'queueMarkdownAppearanceSave',
    'queueBlockAppearanceSave'
  ]) {
    assert.doesNotMatch(
      settings,
      new RegExp(`\\b${legacyOwner}\\b`),
      `${legacyOwner} must not remain as a competing state/persistence owner`
    );
  }
  assert.match(settings, /\bvaultAppearanceStore\.(?:update|replace)\s*\(/);
  assert.match(settings, /\bvaultAppearanceStore\.flush\s*\(/);
});

test('bootstrap hydrates Appearance through VaultAppearanceStore only', async () => {
  const bootstrap = await read('public/js/appBootstrap.js');
  assert.match(bootstrap, /\bvaultAppearanceStore\.load\s*\(/);
  assert.doesNotMatch(bootstrap, /request\s*\(\s*(["'`])\/api\/appearance\1/);
  assert.doesNotMatch(bootstrap, /appearanceSettingsModel\.applyAppearanceSettings\s*\(/);
});

test('preset Global Apply remains a specialized PATCH adopted through the store transaction', async () => {
  const settings = await read('public/js/vaultSettings.js');
  const editPreset = functionSlice(
    settings,
    /async\s+function\s+editBlockColourPreset\s*\(/,
    /\n(?:async\s+)?function\s+[A-Za-z_$]/
  );

  assert.notEqual(editPreset, '', 'editBlockColourPreset must remain the specialized intent owner');
  assert.match(editPreset, /\/api\/appearance\/block-colour-presets\//);
  assert.match(editPreset, /\bmethod\s*:\s*(["'`])PATCH\1/);
  assert.match(editPreset, /\bvaultAppearanceStore\.transaction\s*\(/);
  assert.match(editPreset, /\bglobalApply\b/);
  assert.doesNotMatch(editPreset, /appearanceSettingsModel\.applyAppearanceSettings\s*\(/);
});

test('Canvas owns draft/Undo interaction but no Appearance persistence or store transaction', async () => {
  const canvas = await read('public/js/canvasBlocks.js');
  assert.doesNotMatch(canvas, /(["'`])\/api\/appearance(?:\/|\1)/);
  assert.doesNotMatch(
    canvas,
    /\bvaultAppearanceStore\.(?:load|update|replace|transaction|flush)\s*\(/
  );
});

test('the main renderer has one store subscription as its sole Appearance adoption seam', async () => {
  const files = [
    'public/app.js',
    ...(await publicRendererScripts()).filter((relativePath) => relativePath.startsWith('public/js/'))
  ];
  const adoptionSites = [];

  for (const relativePath of files) {
    const source = await read(relativePath);
    const assignments = source.match(/\bappearanceSettings\s*=\s*snapshot\s*;/g) || [];
    for (let index = 0; index < assignments.length; index += 1) {
      adoptionSites.push(relativePath);
    }
  }

  assert.equal(adoptionSites.length, 1, 'one derived renderer adoption seam must update CSS state');
  const adoptionOwner = adoptionSites[0];
  const adoptionSource = await read(adoptionOwner);
  assert.match(
    adoptionSource,
    /\bvaultAppearanceStore\.subscribe\s*\(\(snapshot\)[\s\S]*?appearanceSettings\s*=\s*snapshot\s*;[\s\S]*?appearanceSettingsModel\.applyAppearanceSettings\s*\(document\.documentElement, snapshot\)/,
    `${adoptionOwner} must adopt snapshots only as a VaultAppearanceStore subscriber`
  );

  const bootstrap = await read('public/js/appBootstrap.js');
  const settings = await read('public/js/vaultSettings.js');
  assert.doesNotMatch(bootstrap, /\bappearanceSettings\s*=/);
  assert.doesNotMatch(settings, /\bappearanceSettings\s*=\s*(?:saved|result|response)\b/);
});

test('desktop close delegates Appearance draining to the one store queue', async () => {
  const [settings, workspaceState] = await Promise.all([
    read('public/js/vaultSettings.js'),
    read('public/js/workspaceState.js')
  ]);

  assert.match(
    settings,
    /globalThis\.flushVaultAppearanceSavesNow\s*=\s*\(\)\s*=>\s*vaultAppearanceStore\.flush\(\)/,
    'the lifecycle hook must delegate directly to the existing store tail'
  );
  assert.match(
    workspaceState,
    /await globalThis\.flushVaultAppearanceSavesNow\(\)/,
    'desktop workspace flush must await pending Appearance persistence'
  );
});
