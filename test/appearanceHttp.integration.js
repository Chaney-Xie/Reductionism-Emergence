const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('Appearance reads defaults without mutation and saves only Vault appearance atomically', async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-appearance-http-'));
  const projectPath = path.join(vaultRoot, 'vault.json');
  const appearancePath = path.join(vaultRoot, 'appearance.json');
  const project = {
    projectId: 'project_appearance',
    projectName: 'Appearance Vault',
    version: '0.2.2',
    lastOpenedPageId: null
  };
  await writeJson(projectPath, project);
  const beforeGet = await fs.readFile(projectPath, 'utf8');

  process.env.VIEWER_ROOT = vaultRoot;
  process.env.VIEWER_APP_ROOT = path.resolve(__dirname, '..');
  const { startServer } = require('../server/appServer');
  const server = await startServer({ host: '127.0.0.1', port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const defaultsResponse = await fetch(`${origin}/api/appearance`);
  assert.equal(defaultsResponse.status, 200);
  const defaults = await defaultsResponse.json();
  assert.deepEqual(defaults.fileTypography.fontFamilies, ['system-ui']);
  assert.equal(defaults.fileTypography.fontSize, 14.4);
  assert.equal(defaults.accentColour, '#65778B');
  assert.equal(defaults.accentSoftOpacity, 0.18);
  assert.equal(defaults.accentStrongOpacity, 0.28);
  assert.equal(defaults.themeColour, '#597A5F');
  assert.equal(defaults.themeSoftOpacity, 0.1);
  assert.equal(defaults.toolSurfaceColour, '#F7F5F1');
  assert.equal(defaults.toolBorderColour, '#C4C0B8');
  assert.equal(defaults.guideSurfaceColour, '#EEE8E0');
  assert.equal(defaults.canvasSurfaceColour, '#F2F0EB');
  assert.equal(defaults.canvasBorderColour, '#AEB6C1');
  assert.equal(defaults.blockAppearance.colourful, false);
  assert.deepEqual(defaults.blockAppearance.colourfulBlock, {
    presets: [],
    lastUsedColour: '#6785A3'
  });
  assert.equal(defaults.blockAppearance.monochrome.colour, '#6785A3');
  assert.equal(defaults.blockAppearance.monochrome.opacity.status1, 0);
  assert.equal(defaults.blockAppearance.monochrome.borderWidth, 2);
  assert.equal(await fs.readFile(projectPath, 'utf8'), beforeGet);

  const savedAppearance = {
    toolSurfaceColour: '#F6F4F0',
    toolBorderColour: '#C0BCB4',
    guideSurfaceColour: '#ECE6DE',
    guideSectionBrightnessAdjustment: 0.04,
    guideBorderBrightnessAdjustment: 0.15,
    canvasSurfaceColour: '#F0EEE9',
    canvasBorderColour: '#A8B0BA',
    accentColour: '#224466',
    accentSoftOpacity: 0.12,
    accentStrongOpacity: 0.3,
    themeColour: '#DDEEFF',
    themeSoftOpacity: 0.08,
    blockAppearance: {
      colourful: false,
      colourfulBlock: {
        presets: [
          { id: 'preset_blue', colour: '#336699' },
          { id: 'preset_gold', colour: '#CC9900' }
        ],
        lastUsedColour: '#CC9900'
      },
      monochrome: {
        colour: '#336699',
        opacity: { status1: 0, status2: 0.42, status3: 0.78 },
        borderWidth: 3
      }
    },
    markdownColours: {
      headingMode: 'by-level',
      headings: {
        unified: null,
        h1: '#123456',
        h2: '#234567',
        h3: null,
        h4: null,
        h5: null,
        h6: null
      },
      text: {
        bold: '#345678',
        italic: null,
        boldItalic: '#456789',
        strikethroughText: null,
        strikethroughLine: '#56789A',
        underlineText: null,
        underlineLine: null,
        hyperlink: '#6789AB'
      },
      code: { background: '#DDEEFF', border: null },
      symbols: { group1: '#789ABC', group2: '#89ABCD' }
    },
    fileTypography: { fontFamilies: ['Times New Roman', 'Songti SC'], fontSize: 15 },
    systemTypography: { fontFamilies: ['Songti SC'] },
    pageTypography: { fontFamilies: ['Times New Roman', 'serif'], fontSize: 18 }
  };
  const saveResponse = await fetch(`${origin}/api/appearance`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(savedAppearance)
  });
  assert.equal(saveResponse.status, 200);
  assert.deepEqual(await saveResponse.json(), savedAppearance);
  assert.deepEqual(JSON.parse(await fs.readFile(appearancePath, 'utf8')), savedAppearance);
  assert.deepEqual(JSON.parse(await fs.readFile(projectPath, 'utf8')), project);
  assert.equal((await fs.readdir(path.dirname(projectPath))).some((name) => name.endsWith('.tmp')), false);

  const bytesBeforeInvalid = await fs.readFile(appearancePath, 'utf8');
  const invalidResponse = await fetch(`${origin}/api/appearance`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...savedAppearance, fileTypography: { fontFamilies: ['A', 'a'], fontSize: 15 } })
  });
  assert.equal(invalidResponse.status, 400);
  assert.equal(await fs.readFile(appearancePath, 'utf8'), bytesBeforeInvalid);
});
