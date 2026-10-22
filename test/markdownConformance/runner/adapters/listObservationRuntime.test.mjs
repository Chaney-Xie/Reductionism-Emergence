import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  AST_LIST_ITEMS_FUNCTION_SOURCE,
  CANONICAL_LIST_ITEMS_FUNCTION_SOURCE,
  LIST_LIFECYCLE_DOM_FUNCTION_SOURCE,
  LIST_LIFECYCLE_INTEGRITY_FUNCTION_SOURCE,
  SEMANTIC_LIST_ITEMS_FUNCTION_SOURCE,
  canonicalListItemsFromSource,
  evaluateListLifecycleIntegrity,
  listItemsFromMarkdownAst,
  listLifecycleDomInventory,
  semanticListItemsFromDom
} from './listObservationRuntime.mjs';

const require = createRequire(import.meta.url);

test('canonical source inventory preserves every marker token and exact physical range', () => {
  const lines = [
    '37. alpha',
    '004) beta',
    '- dash',
    '* star',
    '+ plus',
    '  continuation only',
    'not - a marker',
    '9007199254740993) huge',
    '-'
  ];
  const source = lines.join('\r\n');
  const items = canonicalListItemsFromSource(source);

  assert.deepEqual(items.map(({ rawMarker }) => rawMarker), [
    '37.', '004)', '-', '*', '+', '9007199254740993)', '-'
  ]);
  assert.deepEqual(items.map(({ kind }) => kind), [
    'ordered', 'ordered', 'unordered', 'unordered', 'unordered', 'ordered', 'unordered'
  ]);
  assert.deepEqual(items.slice(0, 2).map(({ rawOrdinal, delimiter, ordinal }) => ({
    rawOrdinal, delimiter, ordinal
  })), [
    { rawOrdinal: '37', delimiter: '.', ordinal: 37 },
    { rawOrdinal: '004', delimiter: ')', ordinal: 4 }
  ]);
  assert.equal(items[5].rawOrdinal, '9007199254740993');
  assert.equal(items[5].ordinal, null, 'unsafe ordinals retain exact raw text without precision loss');
  assert.deepEqual(items.filter(({ bullet }) => bullet).map(({ bullet }) => bullet), [
    '-', '*', '+', '-'
  ]);
  assert.deepEqual(items.map(({ sourceOrder }) => sourceOrder), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(items.some(({ line }) => line.index === 5 || line.index === 6), false);

  for (const item of items) {
    assert.equal(source.slice(item.line.start, item.line.end), lines[item.line.index]);
    assert.equal(source.slice(item.markerRange.start, item.markerRange.end), item.rawMarker);
    assert.equal(item.line.endWithEnding, item.line.end + item.line.ending.length);
    assert.ok(item.contentRange.start >= item.markerRange.end);
    assert.equal(item.contentRange.end, item.line.end);
  }
  assert.equal(source.slice(items[0].contentRange.start, items[0].contentRange.end), 'alpha');
  assert.equal(source.slice(items.at(-1).contentRange.start, items.at(-1).contentRange.end), '');
});

test('canonical source inventory derives mixed physical hierarchy, tabs, and quote prefixes', () => {
  const lines = [
    '- root',
    '  continued root',
    '  7) child',
    '    + grandchild',
    '  * sibling',
    '+ root two',
    '\t- tab child',
    '> - quote root',
    '>   2) quote child',
    '>     * quote grandchild',
    '>> + double quote root',
    '  > * spaced quote root'
  ];
  const items = canonicalListItemsFromSource(lines.join('\n'));

  assert.deepEqual(items.map(({ path, parentPath, physicalDepth }) => ({
    path, parentPath, physicalDepth
  })), [
    { path: '0', parentPath: null, physicalDepth: 1 },
    { path: '0.0', parentPath: '0', physicalDepth: 2 },
    { path: '0.0.0', parentPath: '0.0', physicalDepth: 3 },
    { path: '0.1', parentPath: '0', physicalDepth: 2 },
    { path: '1', parentPath: null, physicalDepth: 1 },
    { path: '1.0', parentPath: '1', physicalDepth: 2 },
    { path: '2', parentPath: null, physicalDepth: 1 },
    { path: '2.0', parentPath: '2', physicalDepth: 2 },
    { path: '2.0.0', parentPath: '2.0', physicalDepth: 3 },
    { path: '3', parentPath: null, physicalDepth: 1 },
    { path: '4', parentPath: null, physicalDepth: 1 }
  ]);
  assert.equal(items.some(({ line }) => line.index === 1), false, 'continuation is not an item');
  assert.equal(items.find(({ line }) => line.index === 6).indentationColumns, 4);
  assert.deepEqual(items.slice(6).map(({ quoteDepth, quotePrefix, indentationColumns }) => ({
    quoteDepth, quotePrefix, indentationColumns
  })), [
    { quoteDepth: 1, quotePrefix: '> ', indentationColumns: 0 },
    { quoteDepth: 1, quotePrefix: '> ', indentationColumns: 2 },
    { quoteDepth: 1, quotePrefix: '> ', indentationColumns: 4 },
    { quoteDepth: 2, quotePrefix: '>> ', indentationColumns: 0 },
    { quoteDepth: 1, quotePrefix: '  > ', indentationColumns: 0 }
  ]);
});

test('canonical source helper remains self-contained when serialized for browser injection', () => {
  const injected = Function(`return (${CANONICAL_LIST_ITEMS_FUNCTION_SOURCE});`)();
  const source = '8) parent\n   - child\ncontinuation';
  assert.deepEqual(injected(source), canonicalListItemsFromSource(source));
});

test('parser AST inventory preserves same-line nested list items that the physical scanner cannot see', () => {
  const markdownPageModel = require('../../../../public/markdownPage');
  const source = '1. A\n2. *\n3. C';
  const tree = markdownPageModel.parseMarkdownDocument(source);
  const items = listItemsFromMarkdownAst(tree, source);

  assert.equal(canonicalListItemsFromSource(source).length, 3);
  assert.equal(items.length, 4);
  assert.deepEqual(items.map(({ path, parentPath, sourceStart, rawMarker }) => ({
    path, parentPath, sourceStart, rawMarker
  })), [
    { path: '0', parentPath: null, sourceStart: 0, rawMarker: '1.' },
    { path: '1', parentPath: null, sourceStart: 5, rawMarker: '2.' },
    { path: '1.0', parentPath: '1', sourceStart: 8, rawMarker: '*' },
    { path: '2', parentPath: null, sourceStart: 10, rawMarker: '3.' }
  ]);
  assert.equal(items[1].ownContentEmpty, true);
  assert.equal(items[1].directChildListCount, 1);
  assert.equal(items[2].parentSourceStart, 5);

  const injected = Function(`return (${AST_LIST_ITEMS_FUNCTION_SOURCE});`)();
  assert.deepEqual(injected(tree, source), items);
});

test('regex-only indented code tokens do not require presentation-only marker candidates', () => {
  const markdownPageModel = require('../../../../public/markdownPage');
  for (const source of ['1.A\n    1. B', '-A\n    - B']) {
    const astItems = listItemsFromMarkdownAst(
      markdownPageModel.parseMarkdownDocument(source),
      source
    );
    const sourceItems = canonicalListItemsFromSource(source);
    assert.equal(astItems.length, 0);
    assert.equal(sourceItems.length, 1);
    assert.equal(sourceItems[0].line.index, 1);

    const integrity = evaluateListLifecycleIntegrity({
      astItems,
      sourceItems,
      semanticItems: [],
      markers: []
    });
    assert.equal(integrity.valid, true);
    assert.equal(integrity.counts.presentationOnlySourceItems, 1);
    assert.equal(integrity.counts.presentationOnlyMarkers, 0);
    assert.deepEqual(integrity.presentationOwnership, [{
      presentationSourceStart: sourceItems[0].markerRange.start,
      presentationItemPath: sourceItems[0].path,
      presentationParentPath: sourceItems[0].parentPath,
      markerMatches: 0,
      visibleMarkerMatches: 0
    }]);
  }
});

class FakeElement {
  constructor(tagName, options = {}) {
    this.tagName = String(tagName).toUpperCase();
    this.attributes = { ...(options.attributes || {}) };
    this.checked = Boolean(options.checked);
    this.type = this.attributes.type || '';
    this.textContent = String(options.textContent || '');
    this.innerText = options.innerText == null ? this.textContent : String(options.innerText);
    this.rect = options.rect || null;
    const classes = new Set(options.classes || []);
    this.classList = { contains: (className) => classes.has(className) };
    this.computedStyle = options.computedStyle || {};
    this.markerStyle = options.markerStyle || {};
    this.children = [...(options.children || [])];
    this.parentElement = null;
    for (const child of this.children) child.parentElement = this;
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name)
      ? String(this.attributes[name])
      : null;
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }

  getBoundingClientRect() {
    return this.rect || {
      x: 0, y: 0, left: 0, top: 0,
      right: 0, bottom: 0, width: 0, height: 0
    };
  }
}

function element(tagName, options) {
  return new FakeElement(tagName, options);
}

test('DOM inventory honors ordered starts, item values, nested paths, checkboxes, and native markers', () => {
  const directUnchecked = element('input', {
    attributes: { type: 'checkbox' },
    checked: false
  });
  const nestedChecked = element('input', {
    attributes: { type: 'checkbox' },
    checked: true
  });
  const nestedItem = element('li', {
    computedStyle: { display: 'list-item', listStyleType: 'none', visibility: 'visible' },
    markerStyle: { display: 'inline', visibility: 'visible', content: 'normal' },
    children: [nestedChecked]
  });
  const nestedList = element('ul', {
    computedStyle: { listStyleType: 'disc', listStylePosition: 'outside' },
    children: [nestedItem]
  });
  const first = element('li', {
    attributes: { 'data-markdown-source-start': '12', 'data-markdown-source-end': '27' },
    computedStyle: { display: 'list-item', listStyleType: 'decimal', visibility: 'visible' },
    markerStyle: {
      display: 'inline', visibility: 'visible', content: 'normal', color: 'rgb(1, 2, 3)'
    }
  });
  const valued = element('li', {
    attributes: { value: '7' },
    computedStyle: { display: 'list-item', listStyleType: 'decimal', visibility: 'visible' },
    markerStyle: { display: 'inline', visibility: 'visible', content: 'normal' },
    children: [nestedList]
  });
  const afterValue = element('li', {
    computedStyle: { display: 'list-item', listStyleType: 'decimal', visibility: 'visible' },
    markerStyle: { display: 'inline', visibility: 'visible', content: 'normal' },
    children: [directUnchecked]
  });
  const ordered = element('ol', {
    attributes: { start: '3' },
    computedStyle: { listStyleType: 'decimal', listStylePosition: 'outside' },
    children: [first, valued, afterValue]
  });
  const finalUnorderedItem = element('li', {
    computedStyle: { display: 'list-item', listStyleType: 'square', visibility: 'visible' },
    markerStyle: { display: 'inline', visibility: 'visible', content: 'normal' }
  });
  const finalUnordered = element('ul', { children: [finalUnorderedItem] });
  const root = element('div', {
    children: [ordered, element('section', { children: [finalUnordered] })]
  });
  const previousGetComputedStyle = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (target, pseudo) => (
    pseudo === '::marker' ? target.markerStyle : target.computedStyle
  );
  try {
    const items = semanticListItemsFromDom(root);
    assert.deepEqual(items.map(({ path, parentPath, domOrder, listDepth }) => ({
      path, parentPath, domOrder, listDepth
    })), [
      { path: '0', parentPath: null, domOrder: 0, listDepth: 1 },
      { path: '1', parentPath: null, domOrder: 1, listDepth: 1 },
      { path: '1.0', parentPath: '1', domOrder: 2, listDepth: 2 },
      { path: '2', parentPath: null, domOrder: 3, listDepth: 1 },
      { path: '3', parentPath: null, domOrder: 4, listDepth: 1 }
    ]);
    assert.deepEqual(items.map(({ ordered, ordinal }) => ({ ordered, ordinal })), [
      { ordered: true, ordinal: 3 },
      { ordered: true, ordinal: 7 },
      { ordered: false, ordinal: null },
      { ordered: true, ordinal: 8 },
      { ordered: false, ordinal: null }
    ]);
    assert.equal(items[1].explicitValue, 7);
    assert.equal(items[1].checked, null, 'nested checkbox does not belong to its parent item');
    assert.equal(items[2].checked, true);
    assert.equal(items[3].checked, false);
    assert.equal(items[0].nativeMarker.listStyleType, 'decimal');
    assert.equal(items[0].sourceStart, 12);
    assert.equal(items[0].sourceEnd, 27);
    assert.equal(items[1].sourceStart, null);
    assert.equal(items[0].nativeMarker.color, 'rgb(1, 2, 3)');
    assert.equal(items[0].nativeMarker.rendered, true);
    assert.equal(items[2].nativeMarker.rendered, false, 'list-style:none hides the native marker');

    const injected = Function(`return (${SEMANTIC_LIST_ITEMS_FUNCTION_SOURCE});`)();
    assert.deepEqual(injected(root), items);
  } finally {
    if (previousGetComputedStyle === undefined) delete globalThis.getComputedStyle;
    else globalThis.getComputedStyle = previousGetComputedStyle;
  }
});

test('DOM inventory remains dependency-free when computed styles are unavailable', () => {
  const previousGetComputedStyle = globalThis.getComputedStyle;
  delete globalThis.getComputedStyle;
  try {
    const root = element('ul', { children: [element('li')] });
    assert.deepEqual(semanticListItemsFromDom(root), [{
      path: '0',
      parentPath: null,
      domOrder: 0,
      sourceStart: null,
      sourceEnd: null,
      listDepth: 1,
      ordered: false,
      startNumber: null,
      explicitValue: null,
      ordinal: null,
      checked: null,
      nativeMarker: null
    }]);
  } finally {
    if (previousGetComputedStyle !== undefined) globalThis.getComputedStyle = previousGetComputedStyle;
  }
});

test('DOM inventory rejects transparent zero-width native markers', () => {
  const item = element('li', {
    computedStyle: {
      display: 'list-item',
      listStyleType: '"\u200b"',
      visibility: 'visible',
      opacity: '1'
    },
    markerStyle: {
      display: 'inline-block',
      visibility: 'visible',
      opacity: '1',
      color: 'rgba(0, 0, 0, 0)'
    }
  });
  const root = element('ul', { children: [item] });
  const previousGetComputedStyle = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (target, pseudo) => (
    pseudo === '::marker' ? target.markerStyle : target.computedStyle
  );
  try {
    const [observed] = semanticListItemsFromDom(root);
    assert.equal(observed.nativeMarker.listStyleType, '"\u200b"');
    assert.equal(observed.nativeMarker.rendered, false);
  } finally {
    if (previousGetComputedStyle === undefined) delete globalThis.getComputedStyle;
    else globalThis.getComputedStyle = previousGetComputedStyle;
  }
});

test('V1 lifecycle DOM inventory captures parser-addressable ownership and LI geometry', () => {
  const box = (left, top, width = 100, height = 18) => ({
    x: left, y: top, left, top, right: left + width, bottom: top + height, width, height
  });
  const nestedItem = element('li', {
    attributes: { 'data-markdown-source-start': '8', 'data-markdown-source-end': '9' },
    rect: box(30, 24),
    children: [element('span', { textContent: '' })]
  });
  const nested = element('ul', {
    attributes: { 'data-markdown-source-start': '8', 'data-markdown-source-end': '9' },
    rect: box(20, 24),
    children: [nestedItem]
  });
  const root = element('ol', {
    attributes: {
      start: '1',
      'data-markdown-source-start': '0',
      'data-markdown-source-end': '14'
    },
    rect: box(0, 0, 140, 66),
    children: [
      element('li', {
        attributes: { 'data-markdown-source-start': '0', 'data-markdown-source-end': '4' },
        rect: box(10, 0),
        children: [element('span', { textContent: 'A' })]
      }),
      element('li', {
        attributes: { 'data-markdown-source-start': '5', 'data-markdown-source-end': '9' },
        rect: box(10, 22, 120, 20),
        children: [nested]
      }),
      element('li', {
        attributes: { 'data-markdown-source-start': '10', 'data-markdown-source-end': '14' },
        rect: box(10, 46),
        children: [element('span', { textContent: 'C' })]
      })
    ]
  });
  const inventory = listLifecycleDomInventory(element('div', { children: [root] }));

  assert.deepEqual(inventory.items.map((item) => ({
    path: item.path,
    parentPath: item.parentPath,
    parentSourceStart: item.parentSourceStart,
    sourceStart: item.sourceStart,
    ownContentEmpty: item.ownContentEmpty,
    rect: item.rect
  })), [
    { path: '0', parentPath: null, parentSourceStart: null, sourceStart: 0,
      ownContentEmpty: false, rect: box(10, 0) },
    { path: '1', parentPath: null, parentSourceStart: null, sourceStart: 5,
      ownContentEmpty: true, rect: box(10, 22, 120, 20) },
    { path: '1.0', parentPath: '1', parentSourceStart: 5, sourceStart: 8,
      ownContentEmpty: true, rect: box(30, 24) },
    { path: '2', parentPath: null, parentSourceStart: null, sourceStart: 10,
      ownContentEmpty: false, rect: box(10, 46) }
  ]);
  assert.deepEqual(inventory.lists.map(({ parentSourceStart, directItemCount }) => ({
    parentSourceStart, directItemCount
  })), [
    { parentSourceStart: null, directItemCount: 3 },
    { parentSourceStart: 5, directItemCount: 1 }
  ]);

  const injected = Function(`return (${LIST_LIFECYCLE_DOM_FUNCTION_SOURCE});`)();
  assert.deepEqual(injected(element('div', { children: [root] })), inventory);
});

test('three genuine canonical empty ordered siblings own three distinct DOM rows', () => {
  const markdownPageModel = require('../../../../public/markdownPage');
  const source = '4. \n5. \n6. ';
  const sourceItems = canonicalListItemsFromSource(source);
  const astItems = listItemsFromMarkdownAst(
    markdownPageModel.parseMarkdownDocument(source),
    source
  );
  const box = (left, top, width = 100, height = 18) => ({
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height
  });
  const rowTops = [0, 24, 48];
  const rootList = element('ol', {
    attributes: {
      start: '4',
      'data-markdown-source-start': '0',
      'data-markdown-source-end': String(source.length)
    },
    rect: box(0, 0, 140, 66),
    children: sourceItems.map((sourceItem, index) => element('li', {
      attributes: {
        'data-markdown-source-start': String(sourceItem.line.start),
        'data-markdown-source-end': String(sourceItem.line.end)
      },
      rect: box(30, rowTops[index]),
      children: [element('span', { textContent: '' })]
    }))
  });
  const inventory = listLifecycleDomInventory(element('div', {
    children: [rootList]
  }));
  const markers = sourceItems.map((sourceItem, index) => ({
    markerId: `source-marker-${index}`,
    astSourceStart: astItems[index].sourceStart,
    ownerSourceStart: astItems[index].sourceStart,
    effective: true,
    kind: 'source-marker',
    rect: box(10, rowTops[index], 12, 18),
    displayedMarker: sourceItem.rawMarker
  }));
  const integrity = evaluateListLifecycleIntegrity({
    astItems,
    sourceItems,
    semanticItems: inventory.items,
    markers
  });

  assert.deepEqual(sourceItems.map(({ rawMarker }) => rawMarker), ['4.', '5.', '6.']);
  assert.deepEqual(astItems.map(({ sourceStart, listDepth }) => ({
    sourceStart,
    listDepth
  })), [
    { sourceStart: 0, listDepth: 1 },
    { sourceStart: 4, listDepth: 1 },
    { sourceStart: 8, listDepth: 1 }
  ]);
  assert.deepEqual(inventory.items.map(({ ordinal, ownContentEmpty, rect }) => ({
    ordinal,
    ownContentEmpty,
    top: rect.top
  })), [
    { ordinal: 4, ownContentEmpty: true, top: 0 },
    { ordinal: 5, ownContentEmpty: true, top: 24 },
    { ordinal: 6, ownContentEmpty: true, top: 48 }
  ]);
  assert.equal(new Set(inventory.items.map(({ rect }) => rect.top)).size, 3);
  assert.equal(new Set(markers.map(({ rect }) => rect.top)).size, 3);
  assert.equal(integrity.valid, true, JSON.stringify(integrity.violations));
  assert.deepEqual(integrity.geometry.itemCollisionGroups, []);
  assert.deepEqual(integrity.geometry.markerCollisionGroups, []);
  assert.equal(integrity.ownership.every(({ semanticMatches, effectiveMarkerMatches }) => (
    semanticMatches === 1 && effectiveMarkerMatches === 1
  )), true);
});

test('V1 list lifecycle integrity enforces AST/LI/marker ownership and sibling-local geometry', () => {
  const box = (left, top, width = 12, height = 18) => ({
    x: left, y: top, left, top, right: left + width, bottom: top + height, width, height
  });
  const astItems = [
    { sourceStart: 0, parentSourceStart: null, listDepth: 1, ordered: true },
    { sourceStart: 5, parentSourceStart: null, listDepth: 1, ordered: true },
    { sourceStart: 8, parentSourceStart: 5, listDepth: 2, ordered: false }
  ];
  const semanticItems = [
    { sourceStart: 0, parentSourceStart: null, listDepth: 1, ordered: true,
      rect: box(30, 0, 100) },
    { sourceStart: 5, parentSourceStart: null, listDepth: 1, ordered: true,
      rect: box(30, 24, 100) },
    // Its box overlaps its semantic parent by design; different ownership
    // groups mean this is not a sibling-row collision.
    { sourceStart: 8, parentSourceStart: 5, listDepth: 2, ordered: false,
      rect: box(50, 26, 80) }
  ];
  const markers = [
    { markerId: 'm0', astSourceStart: 0, ownerSourceStart: 0, effective: true,
      kind: 'source-marker', rect: box(10, 0) },
    { markerId: 'm1', astSourceStart: 5, ownerSourceStart: 5, effective: true,
      kind: 'source-marker', rect: box(10, 24) },
    { markerId: 'm2', astSourceStart: 8, ownerSourceStart: 8, effective: true,
      kind: 'source-marker', rect: box(32, 26) }
  ];
  const clean = evaluateListLifecycleIntegrity({ astItems, semanticItems, markers });
  assert.equal(clean.valid, true);
  assert.deepEqual(clean.counts, {
    astItems: 3,
    semanticItems: 3,
    effectiveMarkers: 3,
    presentationOnlySourceItems: 0,
    presentationOnlyMarkers: 0,
    visiblePresentationOnlyMarkers: 0
  });
  assert.deepEqual(clean.geometry.itemCollisionGroups, []);
  assert.deepEqual(clean.geometry.markerCollisionGroups, []);
  assert.equal(clean.ownership.every(({ semanticMatches, effectiveMarkerMatches }) => (
    semanticMatches === 1 && effectiveMarkerMatches === 1
  )), true);

  const brokenOwnership = evaluateListLifecycleIntegrity({
    astItems,
    semanticItems: semanticItems.map((item) => (
      item.sourceStart === 8 ? { ...item, parentSourceStart: null } : item
    )),
    markers: markers.concat({
      markerId: 'm1-duplicate', astSourceStart: 5, ownerSourceStart: 5,
      effective: true, kind: 'source-marker', rect: box(10, 24)
    })
  });
  assert.equal(brokenOwnership.valid, false);
  assert.equal(brokenOwnership.violations.some(({ code }) => (
    code === 'semantic-parent-owner-mismatch'
  )), true);
  assert.equal(brokenOwnership.violations.some(({ code }) => (
    code === 'duplicate-effective-list-marker'
  )), true);

  const colliding = evaluateListLifecycleIntegrity({
    astItems: astItems.slice(0, 2),
    semanticItems: [
      semanticItems[0],
      // A sibling row in the same vertical band must collide even when its
      // horizontal box is completely disjoint.
      { ...semanticItems[1], rect: box(300, 4, 100) }
    ],
    markers: [
      { ...markers[0], rect: box(10, 0) },
      { ...markers[1], rect: box(300, 4) }
    ]
  });
  assert.equal(colliding.valid, false);
  assert.deepEqual(
    colliding.geometry.itemCollisionGroups[0].map(({ sourceStart }) => sourceStart),
    [0, 5]
  );
  assert.deepEqual(
    colliding.geometry.markerCollisionGroups[0].map(({ astSourceStart }) => astSourceStart),
    [0, 5]
  );
  assert.equal(colliding.violations.some(({ code }) => (
    code === 'semantic-list-item-geometry-collision'
  )), true);
  assert.equal(colliding.violations.some(({ code }) => (
    code === 'effective-marker-geometry-collision'
  )), true);

  const injected = Function(`return (${LIST_LIFECYCLE_INTEGRITY_FUNCTION_SOURCE});`)();
  assert.deepEqual(injected({ astItems, semanticItems, markers }), clean);
});

test('V1 list lifecycle integrity rejects missing, non-finite, and nonpositive LI rows', () => {
  const astItem = {
    sourceStart: 0,
    parentSourceStart: null,
    listDepth: 1,
    ordered: true
  };
  const marker = {
    markerId: 'm0',
    astSourceStart: 0,
    ownerSourceStart: 0,
    effective: true,
    kind: 'source-marker',
    rect: { left: 10, top: 0, right: 22, bottom: 18, width: 12, height: 18 }
  };
  const semanticItem = {
    ...astItem,
    rect: { left: 30, top: 0, right: 130, bottom: 18, width: 100, height: 18 }
  };
  const evaluateRect = (rect) => evaluateListLifecycleIntegrity({
    astItems: [astItem],
    semanticItems: [{ ...semanticItem, rect }],
    markers: [marker]
  });

  const missing = evaluateRect(null);
  assert.equal(missing.valid, false);
  assert.deepEqual(missing.geometry.itemRows, [{
    sourceStart: 0,
    parentSourceStart: null,
    listDepth: 1,
    rect: null
  }]);
  assert.equal(missing.violations.some(({ code }) => (
    code === 'semantic-list-item-geometry-missing'
  )), true);

  const nonFinite = evaluateRect({
    ...semanticItem.rect,
    bottom: Number.POSITIVE_INFINITY
  });
  assert.equal(nonFinite.valid, false);
  assert.equal(nonFinite.violations.some(({ code }) => (
    code === 'semantic-list-item-geometry-missing'
  )), true);

  for (const rect of [
    { ...semanticItem.rect, bottom: 0, height: 0 },
    { ...semanticItem.rect, bottom: -1, height: -1 },
    { ...semanticItem.rect, bottom: 0, height: 18 }
  ]) {
    const nonpositive = evaluateRect(rect);
    assert.equal(nonpositive.valid, false);
    assert.equal(nonpositive.violations.some(({ code }) => (
      code === 'semantic-list-item-geometry-nonpositive-height'
    )), true);
    assert.equal(nonpositive.geometry.itemRows[0].rect, null);
  }

  const clean = evaluateRect(semanticItem.rect);
  assert.equal(clean.valid, true, JSON.stringify(clean.violations));

  const injected = Function(`return (${LIST_LIFECYCLE_INTEGRITY_FUNCTION_SOURCE});`)();
  assert.deepEqual(injected({
    astItems: [astItem],
    semanticItems: [{ ...semanticItem, rect: null }],
    markers: [marker]
  }), missing);
});

test('source-only list presentation tokens stay unique and collision-checked without becoming semantic LIs', () => {
  const box = (top) => ({
    x: 10, y: top, left: 10, top, right: 28, bottom: top + 18, width: 18, height: 18
  });
  const astItems = [{
    sourceStart: 0,
    sourceEnd: 32,
    markerStart: 0,
    markerEnd: 2,
    parentSourceStart: null,
    listDepth: 1,
    ordered: true
  }];
  const sourceItems = [
    { path: '0', parentPath: null, physicalDepth: 1,
      markerRange: { start: 0, end: 2 } },
    // The parser intentionally absorbs these canonical marker-only rows into
    // AST item 0, while Live Preview still presents each exact source token.
    { path: '0.0', parentPath: '0', physicalDepth: 2,
      markerRange: { start: 8, end: 10 } },
    { path: '0.1', parentPath: '0', physicalDepth: 2,
      markerRange: { start: 16, end: 18 } }
  ];
  const semanticItems = [{
    sourceStart: 0,
    sourceEnd: 32,
    parentSourceStart: null,
    listDepth: 1,
    ordered: true,
    rect: { ...box(0), right: 110, width: 100, bottom: 60, height: 60 }
  }];
  const semanticMarker = {
    markerId: 'semantic-0',
    astSourceStart: 0,
    ownerSourceStart: 0,
    effective: true,
    kind: 'source-marker',
    rect: box(0)
  };
  const presentationMarkers = [
    { markerId: 'source-only-8', presentationOnly: true,
      presentationEffective: true, presentationSourceStart: 8,
      presentationItemPath: '0.0', presentationParentPath: '0',
      presentationListDepth: 2, tokenEnd: 10, ownerSourceStart: 0,
      effective: false, kind: 'source-marker', rect: box(22) },
    { markerId: 'source-only-16', presentationOnly: true,
      presentationEffective: true, presentationSourceStart: 16,
      presentationItemPath: '0.1', presentationParentPath: '0',
      presentationListDepth: 2, tokenEnd: 18, ownerSourceStart: 0,
      effective: false, kind: 'source-marker', rect: box(44) }
  ];
  const clean = evaluateListLifecycleIntegrity({
    astItems,
    sourceItems,
    semanticItems,
    markers: [semanticMarker, ...presentationMarkers]
  });
  assert.equal(clean.valid, true);
  assert.equal(clean.counts.astItems, 1);
  assert.equal(clean.counts.semanticItems, 1);
  assert.equal(clean.counts.effectiveMarkers, 1);
  assert.equal(clean.counts.presentationOnlyMarkers, 2);
  assert.deepEqual(clean.presentationOwnership.map(({ markerMatches }) => markerMatches), [1, 1]);

  const duplicate = evaluateListLifecycleIntegrity({
    astItems,
    sourceItems,
    semanticItems,
    markers: [semanticMarker, ...presentationMarkers, {
      ...presentationMarkers[0], markerId: 'source-only-8-duplicate'
    }]
  });
  assert.equal(duplicate.violations.some(({ code }) => (
    code === 'duplicate-presentation-only-list-marker'
  )), true);

  const colliding = evaluateListLifecycleIntegrity({
    astItems,
    sourceItems,
    semanticItems,
    markers: [semanticMarker,
      presentationMarkers[0],
      { ...presentationMarkers[1], rect: box(26) }
    ]
  });
  assert.equal(colliding.violations.some(({ code }) => (
    code === 'presentation-only-marker-geometry-collision'
  )), true);
  assert.deepEqual(
    colliding.geometry.presentationMarkerCollisionGroups[0]
      .map(({ presentationSourceStart }) => presentationSourceStart),
    [8, 16]
  );

  const wrongOwner = evaluateListLifecycleIntegrity({
    astItems,
    sourceItems,
    semanticItems,
    markers: [semanticMarker, {
      ...presentationMarkers[0], ownerSourceStart: 99
    }, presentationMarkers[1]]
  });
  assert.equal(wrongOwner.violations.some(({ code }) => (
    code === 'presentation-only-marker-owner-mismatch'
  )), true);

  const wrongToken = evaluateListLifecycleIntegrity({
    astItems,
    sourceItems,
    semanticItems,
    markers: [semanticMarker, {
      ...presentationMarkers[0], tokenEnd: 11
    }, presentationMarkers[1]]
  });
  assert.equal(wrongToken.violations.some(({ code }) => (
    code === 'presentation-only-marker-source-token-mismatch'
  )), true);

  const orphan = evaluateListLifecycleIntegrity({
    astItems,
    sourceItems,
    semanticItems,
    markers: [semanticMarker, ...presentationMarkers, {
      ...presentationMarkers[0],
      markerId: 'source-only-orphan',
      presentationSourceStart: 24,
      presentationItemPath: '0.2'
    }]
  });
  assert.equal(orphan.violations.some(({ code }) => (
    code === 'orphan-presentation-only-list-marker'
  )), true);
});
