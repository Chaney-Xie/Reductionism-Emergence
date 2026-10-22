'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const {
  createColourfulCanvasHarness
} = require('./helpers/colourfulCanvasHarness');

const read = (relativePath) => fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');

function blocksFixture() {
  return [
    { id: 'block_zero', objectId: 'object_colour_canvas', x: 20, y: 20, width: 60, height: 50 },
    { id: 'block_one', objectId: 'object_colour_canvas', x: 110, y: 20, width: 60, height: 50 },
    { id: 'block_many', objectId: 'object_colour_canvas', x: 200, y: 20, width: 60, height: 50 },
    { id: 'block_inactive', objectId: 'object_colour_canvas', x: 290, y: 20, width: 60, height: 50 }
  ];
}

function state(api, blockId) {
  return JSON.parse(api.semanticStateJson(blockId));
}

function derived(api, block, options) {
  return JSON.parse(api.deriveSemanticStateJson(block, options));
}

function overlaySnapshot(overlay) {
  return {
    state: overlay.dataset.state,
    disabled: overlay.disabled,
    tabIndex: overlay.tabIndex,
    ariaHidden: overlay.getAttribute('aria-hidden'),
    geometry: {
      left: overlay.style.left,
      top: overlay.style.top,
      width: overlay.style.width,
      height: overlay.style.height,
      transform: overlay.style.transform
    }
  };
}

test('pure Block derivation emits sibling presentation and interaction for every mode', async () => {
  const { api } = await createColourfulCanvasHarness();
  const [block] = blocksFixture();
  const original = JSON.stringify(block);
  const cases = [
    {
      name: 'Normal',
      options: { mode: 'normal' },
      expected: { presentationState: 1, interactive: true, interactionKind: 'activate-target' }
    },
    {
      name: 'Normal emphasis',
      options: { mode: 'normal', presentationStates: [3] },
      expected: { presentationState: 3, interactive: true, interactionKind: 'activate-target' }
    },
    {
      name: 'Block Edit unselected',
      options: { mode: 'block-edit' },
      expected: { presentationState: 2, interactive: true, interactionKind: 'select-block-edit' }
    },
    {
      name: 'Block Edit selected',
      options: { mode: 'block-edit', selectedId: block.id },
      expected: { presentationState: 3, interactive: true, interactionKind: 'select-block-edit' }
    },
    {
      name: 'Highlight Add unselected',
      options: { mode: 'highlight-edit' },
      expected: { presentationState: 2, interactive: true, interactionKind: 'edit-highlight-membership' }
    },
    {
      name: 'Highlight Adjust member',
      options: { mode: 'highlight-edit', highlightIds: [block.id] },
      expected: { presentationState: 3, interactive: true, interactionKind: 'edit-highlight-membership' }
    },
    {
      name: 'Highlight View member',
      options: { mode: 'highlight-view', activeIds: [block.id] },
      expected: { presentationState: 1, interactive: true, interactionKind: 'activate-target' }
    },
    {
      name: 'Highlight View member emphasis',
      options: { mode: 'highlight-view', activeIds: [block.id], presentationStates: [3] },
      expected: { presentationState: 3, interactive: true, interactionKind: 'activate-target' }
    },
    {
      name: 'Highlight View nonmember',
      options: { mode: 'highlight-view' },
      expected: { presentationState: 0, interactive: false, interactionKind: 'none' }
    },
    {
      name: 'Highlight View nonmember with every transient emphasis',
      options: { mode: 'highlight-view', presentationStates: [3, 3, 3, 3, 3] },
      expected: { presentationState: 0, interactive: false, interactionKind: 'none' }
    }
  ];

  for (const entry of cases) {
    assert.deepEqual(derived(api, block, entry.options), entry.expected, entry.name);
    assert.deepEqual(derived(api, block, entry.options), entry.expected, `${entry.name} repeat`);
  }
  assert.equal(JSON.stringify(block), original, 'pure derivation must not mutate the Block');
  assert.deepEqual(
    derived(api, block, { mode: 'normal', activeIds: [] }),
    { presentationState: 1, interactive: true, interactionKind: 'activate-target' },
    'Highlight definitions without a checked group do not activate Highlight View'
  );
});

test('DOM state and mask corruption cannot grant or revoke semantic Block interaction', async () => {
  const { api, canvasStage } = await createColourfulCanvasHarness();
  const blocks = blocksFixture();

  api.configureSemanticState({ mode: 'normal', blocks });
  let overlay = api.overlay('block_zero');
  overlay.dataset.state = '0';
  overlay.disabled = true;
  overlay.tabIndex = -1;
  overlay.setAttribute('aria-hidden', 'true');
  assert.equal(api.semanticInteractive('block_zero'), true);
  assert.equal(api.semanticResolveId(30, 30), 'block_zero');
  overlay.remove();
  assert.equal(api.semanticInteractive('block_zero'), true, 'interaction survives missing overlay DOM');
  assert.equal(api.semanticResolveId(30, 30), 'block_zero');
  api.render(blocks);
  assert.deepEqual(overlaySnapshot(api.overlay('block_zero')), {
    state: '1', disabled: false, tabIndex: 0, ariaHidden: 'false',
    geometry: { left: '20px', top: '20px', width: '60px', height: '50px', transform: 'rotate(0deg)' }
  });

  api.configureSemanticState({
    mode: 'highlight-view', blocks, activeIds: ['block_zero']
  });
  overlay = api.overlay('block_zero');
  overlay.dataset.state = '0';
  overlay.disabled = true;
  overlay.tabIndex = -1;
  assert.equal(api.semanticInteractive('block_zero'), true);
  assert.equal(api.semanticResolveId(30, 30), 'block_zero');

  overlay = api.overlay('block_inactive');
  overlay.dataset.state = '3';
  overlay.disabled = false;
  overlay.tabIndex = 0;
  overlay.setAttribute('aria-hidden', 'false');
  canvasStage.querySelector('.canvas-highlight-mask')?.remove();
  assert.equal(api.semanticInteractive('block_inactive'), false);
  assert.equal(api.semanticResolveId(300, 30), null);
  api.render(blocks);
  assert.deepEqual(state(api, 'block_inactive'), {
    presentationState: 0, interactive: false, interactionKind: 'none'
  });
  assert.deepEqual(overlaySnapshot(api.overlay('block_inactive')), {
    state: '0', disabled: true, tabIndex: -1, ariaHidden: 'true',
    geometry: { left: '290px', top: '20px', width: '60px', height: '50px', transform: 'rotate(0deg)' }
  });
});

test('overlay recreation preserves transient presentation without changing semantic interaction', async () => {
  const { api, canvasStage, undoManager } = await createColourfulCanvasHarness();
  const blocks = blocksFixture();
  const canonical = JSON.stringify(blocks);

  api.configureSemanticState({ mode: 'normal', blocks });
  for (const source of ['hover', 'active', 'relation-hover', 'external-link-hover']) {
    api.semanticRequest('block_zero', source, 3);
    const before = api.overlay('block_zero');
    const beforeSnapshot = overlaySnapshot(before);
    assert.equal(beforeSnapshot.state, '3', source);
    before.remove();
    api.render(blocks);
    const after = api.overlay('block_zero');
    assert.notEqual(after, before, `${source} uses a recreated physical node`);
    assert.equal(before.isConnected, false);
    assert.equal(canvasStage.querySelectorAll(
      '.canvas-block-overlay[data-block-id="block_zero"]'
    ).length, 1);
    assert.deepEqual(overlaySnapshot(after), beforeSnapshot, `${source} presentation survives`);
    assert.deepEqual(state(api, 'block_zero'), {
      presentationState: 3, interactive: true, interactionKind: 'activate-target'
    });
    assert.equal(api.semanticResolveId(30, 30), 'block_zero');
    api.semanticRequest('block_zero', source, null);
    assert.equal(api.overlay('block_zero').dataset.state, '1');
  }

  api.setSemanticAddLinkTarget('block_zero');
  const addLinkBefore = api.overlay('block_zero');
  assert.equal(addLinkBefore.dataset.state, '3');
  addLinkBefore.remove();
  api.render(blocks);
  assert.equal(api.overlay('block_zero').dataset.state, '3');
  api.setSemanticAddLinkTarget(null);
  assert.equal(api.overlay('block_zero').dataset.state, '1');

  api.configureSemanticState({ mode: 'highlight-view', blocks, activeIds: [] });
  for (const source of ['hover', 'active', 'relation-hover', 'external-link-hover', 'add-link']) {
    api.semanticRequest('block_inactive', source, 3);
  }
  const inactiveBefore = api.overlay('block_inactive');
  inactiveBefore.remove();
  api.render(blocks);
  assert.deepEqual(state(api, 'block_inactive'), {
    presentationState: 0, interactive: false, interactionKind: 'none'
  });
  assert.equal(api.overlay('block_inactive').dataset.state, '0');
  assert.equal(api.semanticResolveId(300, 30), null);

  assert.equal(JSON.stringify(blocks), canonical, 'presentation operations do not mutate Page Blocks');
  assert.equal(undoManager.undoStack.length, 0, 'presentation operations do not create Undo entries');
});

test('interaction authority is semantic while geometry, mask, and target routing remain delegated', async () => {
  const [canvas, app, pageObjects, css] = await Promise.all([
    read('public/js/canvasBlocks.js'),
    read('public/app.js'),
    read('public/pageObjects.js'),
    read('public/styles.css')
  ]);
  const deriveStart = canvas.indexOf('function deriveBlockPresentationInteraction(');
  const deriveEnd = canvas.indexOf('\nfunction currentBlockPresentationInteraction(', deriveStart);
  const interactiveStart = canvas.indexOf('function blockIsInteractive(');
  const interactiveEnd = canvas.indexOf('\nfunction blockInteractionKind(', interactiveStart);
  assert.ok(deriveStart >= 0 && deriveEnd > deriveStart);
  assert.ok(interactiveStart >= 0 && interactiveEnd > interactiveStart);
  assert.doesNotMatch(
    canvas.slice(deriveStart, deriveEnd) + canvas.slice(interactiveStart, interactiveEnd),
    /dataset|querySelector|classList|getComputedStyle|mask|opacity|pointer/i
  );
  assert.doesNotMatch(canvas, /function blockEffectiveState\(/);
  assert.match(canvas, /resolveOrdinaryBlockTarget\([^]*?\(object, localPoint\) => canvasObjectOpaqueAt\(runtime, object, localPoint\),\s*\(block\) => blockIsInteractive\(runtime, block\)\s*\)/);
  assert.match(canvas, /BLOCK_INTERACTION_KIND\.EDIT_HIGHLIGHT_MEMBERSHIP[^]*?toggleHighlightEditBlock/);
  assert.match(canvas, /BLOCK_INTERACTION_KIND\.SELECT_BLOCK_EDIT[^]*?setSelectedBlock\(runtime, target\.block\.id\)/);
  assert.match(app, /function handleBlockClick\(runtime, event, block\) \{\s*if \(!runtimeIsLive\(runtime\) \|\| !blockIsInteractive\(runtime, block\)/);
  assert.match(app, /if \(targets\.length === 0\)[^]*?openAddLinkPopover\(runtime,/);
  assert.match(app, /if \(targets\.length === 1\)[^]*?navigateCurrentTabToPage\(runtime,[^]*?openExternalLinkTarget\(runtime,/);
  assert.match(app, /openMultiLinkMenu\(runtime, block, event\.currentTarget\)/);
  assert.match(pageObjects, /function findBlockAtPoint\(object, blocks, point, acceptsBlock = \(\) => true\)/);
  assert.match(css, /\.canvas-highlight-mask \{[^}]*pointer-events: none;/);
});
