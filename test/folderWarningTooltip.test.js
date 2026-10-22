const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const {
  createFolderNameCell,
  createTooltip
} = require('../public/folderWarningTooltip');

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  contains(value) { return this.values.has(value); }
  toggle(value, active) {
    if (active) this.values.add(value);
    else this.values.delete(value);
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.style = {
      setProperty: (name, value) => { this.style[name] = value; }
    };
    this.hidden = false;
    this.offsetWidth = 180;
    this.offsetHeight = 30;
    this.rect = { left: 0, top: 0, right: 180, bottom: 30, width: 180, height: 30 };
  }

  append(...children) { this.children.push(...children); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  dispatch(type) { for (const listener of this.listeners.get(type) || []) listener({ type }); }
  getBoundingClientRect() { return this.rect; }
}

function tooltipHarness() {
  const documentRef = { createElement: (tagName) => new FakeElement(tagName) };
  const windowRef = { requestAnimationFrame: (callback) => callback() };
  const container = new FakeElement('section');
  container.rect = { left: 100, top: 100, right: 700, bottom: 500, width: 600, height: 400 };
  const tooltip = createTooltip({ documentRef, windowRef, container });
  return { container, documentRef, tooltip };
}

test('folder warning uses an immediate accessible custom tooltip for pointer and focus', () => {
  const { documentRef, tooltip } = tooltipHarness();
  const cell = createFolderNameCell({
    name: 'External',
    available: false,
    error: 'External volume is unavailable.'
  }, { documentRef, tooltip });
  const warning = cell.children[0];
  warning.rect = { left: 390, top: 260, right: 402, bottom: 272, width: 12, height: 12 };

  assert.equal(warning.getAttribute('title'), null);
  assert.equal(warning.tabIndex, 0);
  assert.equal(warning.getAttribute('aria-describedby'), tooltip.bubble.id);

  warning.dispatch('pointerenter');
  assert.equal(tooltip.bubble.hidden, false);
  assert.equal(tooltip.bubble.textContent, 'External volume is unavailable.');
  warning.dispatch('pointerleave');
  assert.equal(tooltip.bubble.hidden, true);

  warning.dispatch('focus');
  assert.equal(tooltip.bubble.hidden, false);
  warning.dispatch('blur');
  assert.equal(tooltip.bubble.hidden, true);
});

test('folder warning tooltip is centred, flips at the modal edge, and does not expose paths', () => {
  const { documentRef, tooltip } = tooltipHarness();
  const cell = createFolderNameCell({
    name: 'Lost',
    available: false,
    error: 'Unavailable at /Volumes/Private/Research.'
  }, { documentRef, tooltip });
  const warning = cell.children[0];
  warning.rect = { left: 110, top: 106, right: 122, bottom: 118, width: 12, height: 12 };
  warning.dispatch('pointerenter');

  assert.equal(tooltip.bubble.textContent, 'Folder link lost. Relink this folder.');
  assert.equal(tooltip.bubble.textContent.includes('/Volumes/'), false);
  assert.equal(tooltip.bubble.classList.contains('is-below'), true);
  assert.equal(Number.parseFloat(tooltip.bubble.style.left) >= 8, true);
});

test('healthy folder rows render neither warning icon nor error tooltip trigger', () => {
  const { documentRef, tooltip } = tooltipHarness();
  const cell = createFolderNameCell({
    name: 'Healthy',
    available: true,
    error: null
  }, { documentRef, tooltip });
  assert.equal(cell.children.length, 0);
  assert.equal(tooltip.bubble.hidden, true);
});

test('current Add File, drag/drop, Relink, and Maintenance Reveal entry points remain wired', async () => {
  const root = path.join(__dirname, '..');
  const [html, appSource, bootstrapSource, mainSource, settingsSource, sidebarSource, css] = await Promise.all([
    fs.readFile(path.join(root, 'public/index.html'), 'utf8'),
    fs.readFile(path.join(root, 'public/app.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/js/appBootstrap.js'), 'utf8'),
    fs.readFile(path.join(root, 'desktop/main.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/js/vaultSettings.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/js/rightSidebar.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/styles.css'), 'utf8')
  ]);

  assert.match(html, /id="add-file-button"[^>]*>Add File<\/button>/);
  assert.match(bootstrapSource, /addFileButton\?\.addEventListener\('click'/);
  assert.match(mainSource, /properties: \['openFile', 'multiSelections'\]/);
  assert.match(bootstrapSource, /bindImportDropTarget\(resolveRuntime, area, 'canvas'\)/);
  assert.match(bootstrapSource, /bindImportDropTarget\(activePaneRuntime, maintenanceSection/);
  assert.match(settingsSource, /bridge\.relinkFolder\(defaultFolder\.id\)/);
  assert.match(sidebarSource, /resource-reveal-button/);
  assert.match(sidebarSource, /createRevealIconClickHandler/);
  assert.match(css, /\.vault-folder-tooltip[\s\S]*pointer-events: none/);
  assert.doesNotMatch(`${html}\n${appSource}\n${bootstrapSource}`, /Link Original File…|Copy into Vault…|resource-choice/);
});
