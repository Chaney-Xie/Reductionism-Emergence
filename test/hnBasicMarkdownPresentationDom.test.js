'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const foundation = require('../public/markdownEditableFoundation');
const { createEditableProjection } = require('../public/js/markdownEditableProjection');
const sourceEditor = require('../public/js/sourceCanonicalEditor');
const syntaxAdapters = require('../public/js/markdownEditableSyntaxAdapters');
const {
  FakeElement,
  descendants,
  loadMarkdownPageViewInternals
} = require('./helpers/markdownFakeDom');

class ProjectionText {
  constructor(value = '') {
    this.nodeType = 3;
    this.nodeValue = String(value);
    this.parentElement = null;
    this.parentNode = null;
  }

  get textContent() {
    return this.nodeValue;
  }

  set textContent(value) {
    this.nodeValue = String(value || '');
  }

  contains(node) {
    return node === this;
  }
}

function projectionDocument() {
  return {
    createElement(tagName) {
      return new FakeElement({ tagName });
    },
    createTextNode(value) {
      return new ProjectionText(value);
    },
    createDocumentFragment() {
      return new FakeElement({ tagName: '#document-fragment', nodeType: 11 });
    },
    addEventListener() {},
    removeEventListener() {}
  };
}

function createRuntime() {
  const latexCalls = [];
  const view = loadMarkdownPageViewInternals([], {
    globalThis: {
      markdownRuntime: {
        renderLatex(source, options = {}) {
          latexCalls.push({ source, displayMode: options.displayMode === true });
          return `<span class="katex-test">${String(source)}</span>`;
        }
      }
    }
  });
  return { view, latexCalls };
}

function ownerIds(plan) {
  return [
    ...plan.constructs.strong,
    ...plan.constructs.emphasis,
    ...plan.constructs.strikethrough,
    ...plan.constructs.underlines,
    ...plan.constructs.math,
    ...plan.constructs.listRows
  ].map((construct) => String(construct.activationOwnerId || construct.ownerId));
}

function renderHn(source, options = {}) {
  const runtime = options.runtime || createRuntime();
  const strategy = sourceEditor.createHnBasicPresentationStrategy({
    presentationRuntime: runtime.view
  });
  const sourceSnapshot = strategy.createSourceSnapshot(source);
  const inactive = strategy.createPresentationPlan(sourceSnapshot, {
    mode: options.mode || 'edit',
    activeOwnerIds: []
  });
  const presentationPlan = strategy.createPresentationPlan(sourceSnapshot, {
    mode: options.mode || 'edit',
    activeOwnerIds: options.activeOwnerIds === 'all'
      ? ownerIds(inactive)
      : options.activeOwnerIds || []
  });
  const document = projectionDocument();
  const host = document.createElement('div');
  host.classList.add('hn-text-editor-host');
  const root = document.createElement('div');
  root.classList.add('hn-source-editor');
  host.append(root);
  const projection = createEditableProjection({ root, document, foundation });
  projection.render(sourceSnapshot, {
    mode: strategy.projectionMode,
    presentationPlan
  });
  strategy.mountPresentation({
    root,
    document,
    projection,
    presentationPlan,
    sourceSnapshot
  });
  return {
    ...runtime,
    strategy,
    sourceSnapshot,
    presentationPlan,
    projection,
    host,
    root
  };
}

function projectedLeaves(result) {
  return result.projection.enumerateProjectedLeaves();
}

function leavesWithRole(result, family, role) {
  return projectedLeaves(result).filter((leaf) => (
    (leaf.planLeaf.semanticRoles || []).some((descriptor) => (
      descriptor.family === family && descriptor.role === role
    ))
  ));
}

function elementsWithClass(root, className) {
  return descendants(root).filter((element) => element?.classList?.contains(className));
}

function exactProjectedSource(result) {
  return result.presentationPlan.lines.map((line) => (
    line.leaves.map((leaf) => leaf.text).join('') + line.lineEnding
  )).join('');
}

function remountWithRowGeometry(result, { rowHeight = 24 } = {}) {
  const rows = result.projection.enumeratePhysicalRows();
  result.host.offsetTop = 0;
  result.host.offsetHeight = rows.length * rowHeight;
  result.root.offsetTop = 0;
  result.root.offsetHeight = rows.length * rowHeight;
  result.root.offsetParent = result.host;
  rows.forEach((entry, index) => {
    entry.element.offsetTop = index * rowHeight;
    entry.element.offsetHeight = rowHeight;
    entry.element.offsetParent = result.root;
  });
  result.strategy.mountPresentation({
    root: result.root,
    document: result.root.parentElement ? projectionDocument() : null,
    projection: result.projection,
    presentationPlan: result.presentationPlan,
    sourceSnapshot: result.sourceSnapshot
  });
  return rows;
}

function structureRails(result) {
  return elementsWithClass(result.host, 'hn-semantic-block-rail');
}

test('HN H1/H2/H3 typography and full-range semantic rails mount outside canonical rows', () => {
  const source = [
    '# Overall **Concept** $x$',
    '',
    '-## Primary Concept',
    '',
    'ordinary text',
    '',
    '?{',
    'description',
    'multiple lines',
    '/}',
    '',
    '>>',
    'example',
    '>>',
    '',
    '>',
    'reformulation',
    '>',
    '',
    '?### Lower Heading'
  ].join('\n');
  const result = renderHn(source, { mode: 'edit' });
  const textNodes = projectedLeaves(result).map((leaf) => leaf.textNode);
  const rows = remountWithRowGeometry(result);
  const headingRows = rows.filter((entry) => (
    entry.element.classList.contains('is-hn-heading-row')
  ));

  assert.equal(exactProjectedSource(result), source);
  assert.deepEqual(headingRows.map((entry) => entry.element.dataset.hnHeadingLevel), [
    '1', '2', '3'
  ]);
  assert.ok(headingRows[0].element.classList.contains('is-hn-heading-level-1'));
  assert.ok(headingRows[1].element.classList.contains('is-hn-heading-level-2'));
  assert.ok(headingRows[2].element.classList.contains('is-hn-heading-level-3'));
  const rootHeading = result.sourceSnapshot.hnStructureIndex.headings[0];
  const titleLeaves = projectedLeaves(result).filter((leaf) => (
    rootHeading.titleRange.start <= leaf.sourceStart
      && leaf.sourceEnd <= rootHeading.titleRange.end
  ));
  assert.ok(titleLeaves.some((leaf) => (
    leaf.planLeaf.semanticRoles || []
  ).some((role) => role.family === 'strong' && role.role === 'content')),
  'inline strong presentation remains owned by the existing title leaves');
  const titleMath = result.presentationPlan.constructs.math.find((math) => (
    rootHeading.titleRange.start <= math.start && math.end <= rootHeading.titleRange.end
  ));
  assert.ok(titleMath);
  assert.ok(titleLeaves.some((leaf) => leaf.planLeaf.semanticOwnerId === titleMath.ownerId),
    'inline math presentation remains owned by the existing title leaves');
  assert.deepEqual(projectedLeaves(result).map((leaf) => leaf.textNode), textNodes,
    'structure presentation never replaces canonical projected text nodes');

  const layer = result.host.querySelector('[data-hn-structure-rail-layer="true"]');
  const rails = structureRails(result);
  assert.ok(layer);
  assert.equal(result.root.contains(layer), false, 'the rail layer is outside contenteditable');
  assert.equal(layer.contentEditable, 'false');
  assert.equal(layer.attributes['aria-hidden'], 'true');
  assert.equal(layer.dataset.hnStructureRailCount, '3');
  assert.deepEqual(rails.map((rail) => rail.dataset.hnSemanticBlockKind), [
    'description', 'example', 'reformulation'
  ]);
  assert.deepEqual(rails.map((rail) => rail.style.getPropertyValue('--hn-semantic-rail-top')), [
    '144px', '264px', '360px'
  ]);
  assert.deepEqual(rails.map((rail) => rail.style.getPropertyValue('--hn-semantic-rail-height')), [
    '96px', '72px', '72px'
  ], 'each rail covers opener, every body row, and closer as one interval');
  assert.deepEqual(rails.map((rail) => rail.textContent), ['', '', '']);
  assert.ok(rails.every((rail) => rail.contentEditable === 'false'));

  const blocks = result.sourceSnapshot.hnStructureIndex.semanticBlocks;
  rails.forEach((rail, index) => {
    const block = blocks[index];
    assert.equal(rail.dataset.hnSemanticBlockStart, String(block.fullRange.start));
    assert.equal(rail.dataset.hnSemanticBlockEnd, String(block.fullRange.end));
    assert.equal(
      rail.dataset.hnSemanticBlockFirstLine,
      rows[block.physicalLineExtent.startLineIndex].physicalLineId
    );
    assert.equal(
      rail.dataset.hnSemanticBlockLastLine,
      rows[block.physicalLineExtent.endLineIndex].physicalLineId
    );
  });
});

test('structure remount replaces revision-local presentation once and isolates sibling roots', () => {
  const initialSource = '# Old root\n-## Concept\n?{\nold body\n/}';
  const result = renderHn(initialSource);
  remountWithRowGeometry(result);
  const layer = result.host.querySelector('[data-hn-structure-rail-layer="true"]');
  const staleRail = structureRails(result)[0];

  const nextSource = 'ordinary\n?### New lower\n-## Concept\n>\nnew body\n>';
  const nextSnapshot = result.strategy.createSourceSnapshot(nextSource, {
    previousSnapshot: result.sourceSnapshot,
    version: result.sourceSnapshot.version + 1
  });
  const nextPlan = result.strategy.createPresentationPlan(nextSnapshot, {
    mode: 'edit',
    activeOwnerIds: []
  });
  result.projection.render(nextSnapshot, {
    mode: result.strategy.projectionMode,
    presentationPlan: nextPlan
  });
  result.sourceSnapshot = nextSnapshot;
  result.presentationPlan = nextPlan;
  const nextRows = remountWithRowGeometry(result);

  assert.equal(result.host.querySelectorAll('[data-hn-structure-rail-layer="true"]').length, 1,
    'a revision remount reuses exactly one root-owned overlay layer');
  assert.equal(result.host.querySelector('[data-hn-structure-rail-layer="true"]'), layer);
  assert.equal(staleRail.parentNode, null, 'the previous revision rail is detached');
  assert.equal(nextRows[0].element.classList.contains('is-hn-heading-row'), false,
    'stale heading classes are absent from the ordinary replacement row');
  assert.deepEqual(nextRows.filter(({ element }) => (
    element.classList.contains('is-hn-heading-row')
  )).map(({ element }) => element.dataset.hnHeadingLevel), ['3', '2']);
  assert.deepEqual(structureRails(result).map((rail) => rail.dataset.hnSemanticBlockKind), [
    'reformulation'
  ]);
  assert.equal(exactProjectedSource(result), nextSource);

  const sibling = renderHn('-## Sibling\n>>\nsibling body\n>>');
  remountWithRowGeometry(sibling, { rowHeight: 30 });
  const siblingLayer = sibling.host.querySelector('[data-hn-structure-rail-layer="true"]');
  assert.ok(siblingLayer);
  assert.notEqual(siblingLayer, layer);
  assert.deepEqual(structureRails(sibling).map((rail) => rail.dataset.hnSemanticBlockKind), [
    'example'
  ]);

  assert.equal(result.strategy.destroyPresentation({
    root: result.root,
    projection: result.projection,
    sourceSnapshot: result.sourceSnapshot,
    presentationPlan: result.presentationPlan
  }), true);
  assert.equal(result.host.querySelector('[data-hn-structure-rail-layer="true"]'), null);
  assert.equal(sibling.host.querySelector('[data-hn-structure-rail-layer="true"]'), siblingLayer,
    'destroying one Pane/root leaves the sibling presentation owner intact');
  assert.equal(structureRails(sibling).length, 1);
});

test('structure geometry observer coalesces reflow and disconnects on destroy', {
  concurrency: false
}, () => {
  const previousResizeObserver = globalThis.ResizeObserver;
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const observers = [];
  const scheduled = new Map();
  const cancelled = [];
  let nextFrameId = 40;

  class TestResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.observed = [];
      this.disconnected = false;
      observers.push(this);
    }

    observe(element) {
      this.observed.push(element);
    }

    disconnect() {
      this.disconnected = true;
    }
  }

  globalThis.ResizeObserver = TestResizeObserver;
  globalThis.requestAnimationFrame = (callback) => {
    const id = ++nextFrameId;
    scheduled.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    cancelled.push(id);
    scheduled.delete(id);
  };

  try {
    const result = renderHn('-## Concept\n?{\nbody\n/}');
    const rows = remountWithRowGeometry(result, { rowHeight: 20 });
    const observer = observers.at(-1);
    assert.deepEqual(observer.observed, [result.root, ...rows.map(({ element }) => element)]);
    assert.equal(structureRails(result)[0].style.getPropertyValue(
      '--hn-semantic-rail-height'
    ), '60px');

    rows[3].element.offsetHeight = 35;
    observer.callback();
    observer.callback();
    assert.equal(scheduled.size, 1, 'multiple resize notifications share one animation frame');
    const [[frameId, callback]] = scheduled;
    scheduled.delete(frameId);
    callback();
    assert.equal(structureRails(result)[0].style.getPropertyValue(
      '--hn-semantic-rail-height'
    ), '75px', 'the frame reconciles the rail against current row geometry');

    observer.callback();
    const pendingFrameId = [...scheduled.keys()][0];
    result.strategy.destroyPresentation({
      root: result.root,
      projection: result.projection,
      sourceSnapshot: result.sourceSnapshot,
      presentationPlan: result.presentationPlan
    });
    assert.equal(observer.disconnected, true);
    assert.deepEqual(cancelled, [pendingFrameId]);
    assert.equal(scheduled.size, 0);
    assert.equal(result.host.querySelector('[data-hn-structure-rail-layer="true"]'), null);
  } finally {
    if (previousResizeObserver === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = previousResizeObserver;
    if (previousRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    if (previousCancelAnimationFrame === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
  }
});

test('Edit and Browser consume the same HN structure descriptors and presentation classes', () => {
  const source = '# Root\n-## Concept\n?{\nbody\n/}\n?### Lower';
  const edit = renderHn(source, { mode: 'edit' });
  const browser = renderHn(source, { mode: 'browser' });
  const editRows = remountWithRowGeometry(edit);
  const browserRows = remountWithRowGeometry(browser);

  assert.deepEqual(
    edit.sourceSnapshot.hnStructureIndex.headings,
    browser.sourceSnapshot.hnStructureIndex.headings
  );
  assert.deepEqual(
    edit.sourceSnapshot.hnStructureIndex.semanticBlocks,
    browser.sourceSnapshot.hnStructureIndex.semanticBlocks
  );
  assert.deepEqual(editRows.map((entry) => entry.element.dataset.hnHeadingLevel || null),
    browserRows.map((entry) => entry.element.dataset.hnHeadingLevel || null));
  assert.deepEqual(structureRails(edit).map((rail) => ({
    kind: rail.dataset.hnSemanticBlockKind,
    start: rail.dataset.hnSemanticBlockStart,
    end: rail.dataset.hnSemanticBlockEnd
  })), structureRails(browser).map((rail) => ({
    kind: rail.dataset.hnSemanticBlockKind,
    start: rail.dataset.hnSemanticBlockStart,
    end: rail.dataset.hnSemanticBlockEnd
  })));
  assert.equal(exactProjectedSource(edit), source);
  assert.equal(exactProjectedSource(browser), source);
});

test('malformed blocks stay literal and structure cleanup removes only presentation state', () => {
  const source = '# Root\n-## Concept\n?{\nunclosed\n?### Lower';
  const result = renderHn(source);
  const textNodes = projectedLeaves(result).map((leaf) => leaf.textNode);
  const rows = remountWithRowGeometry(result);

  assert.deepEqual(result.sourceSnapshot.hnStructureIndex.semanticBlocks, []);
  assert.deepEqual(structureRails(result), []);
  assert.deepEqual(rows.filter((entry) => (
    entry.element.classList.contains('is-hn-heading-row')
  )).map((entry) => entry.element.dataset.hnHeadingLevel), ['1', '2', '3']);

  assert.equal(result.strategy.destroyPresentation({
    root: result.root,
    document: projectionDocument(),
    projection: result.projection,
    sourceSnapshot: result.sourceSnapshot,
    presentationPlan: result.presentationPlan
  }), true);
  assert.equal(result.host.querySelector('[data-hn-structure-rail-layer="true"]'), null);
  assert.ok(rows.every((entry) => !entry.element.classList.contains('is-hn-heading-row')));
  assert.deepEqual(projectedLeaves(result).map((leaf) => leaf.textNode), textNodes);
  assert.equal(exactProjectedSource(result), source);
});

test('HN structure CSS shares Markdown heading sizes and keeps rails in a pointer-inert gutter', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  for (const [level, size] of [[1, '1.8em'], [2, '1.55em'], [3, '1.32em']]) {
    const rule = new RegExp(
      `\\.hn-source-editor\\s+\\.markdown-editable-physical-row\\.is-hn-heading-level-${level}`
        + `[\\s\\S]{0,90}font-size:\\s*${size.replace('.', '\\.')}\\s*;`
    );
    assert.match(styles, rule, `HN level ${level} shares the accepted Markdown size declaration`);
  }
  assert.match(styles,
    /\.hn-source-editor \.markdown-editable-physical-row\.is-hn-heading-row\s*\{[^}]*color:\s*inherit;/s,
    'HN headings add no heading colour');
  assert.match(styles,
    /\.hn-structure-rail-layer\s*\{[^}]*pointer-events:\s*none;/s);
  assert.match(styles,
    /\.hn-semantic-block-rail\s*\{[^}]*left:\s*calc\(-1 \* var\(--hn-semantic-rail-gutter\)\);/s,
    'rails occupy a separate negative-inline gutter without shifting text');
  assert.match(styles, /--hn-description-rail-colour:\s*#6d82cf;/);
  assert.match(styles, /--hn-example-rail-colour:\s*#e6b957;/);
  assert.match(styles, /--hn-reformulation-rail-colour:\s*#8a919a;/);
});

test('real HN projection hides inactive inline markers and decorates their exact mapped content', () => {
  const source = '**bold** *italic* ~~strike~~ <u>under</u>';
  const result = renderHn(source);
  const families = [
    ['strong', 'strong'],
    ['emphasis', 'emphasis'],
    ['strikethrough', 'strikethrough'],
    ['underline-tag', 'underline']
  ];

  assert.equal(exactProjectedSource(result), source);
  families.forEach(([markerFamily, contentFamily]) => {
    const markers = leavesWithRole(result, markerFamily, 'marker');
    const content = leavesWithRole(result, contentFamily, 'content');
    assert.ok(markers.length >= 2, `${markerFamily}: opening and closing markers remain mapped`);
    assert.ok(markers.every((leaf) => (
      leaf.visibility === 'activatable'
        && leaf.element.dataset.visibility === 'activatable'
        && leaf.element.classList.contains(`is-${markerFamily}-marker`)
        && leaf.element.classList.contains(`is-${markerFamily}-marker-source-hidden`)
    )), `${markerFamily}: exact inactive markers use the shared hidden-source contract`);
    assert.ok(content.length >= 1, `${contentFamily}: mapped source content exists`);
    assert.ok(content.every((leaf) => (
      leaf.visibility === 'visible'
        && leaf.element.dataset.visibility === 'visible'
        && leaf.element.classList.contains(`is-${contentFamily}-content`)
    )), `${contentFamily}: original source leaves, rather than duplicate text, own styling`);
  });

  assert.equal(elementsWithClass(result.root, 'markdown-editable-simple-presentation').length, 0,
    'mapped inline presentation does not mount a second text owner');

  const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  assert.match(styles,
    /\.hn-source-editor\s+\.markdown-editable-projected-leaf\[data-visibility="activatable"\]/,
    'the HN surface hides inactive mapped marker leaves');
  assert.match(styles,
    /\.markdown-editable-projected-leaf\.is-strong-content/,
    'the shared mapped-content strong presentation remains the styling owner');
  assert.match(styles,
    /\.markdown-editable-projected-leaf\.is-emphasis-content/,
    'the shared mapped-content emphasis presentation remains the styling owner');
  assert.match(styles,
    /\.markdown-editable-projected-leaf\.is-strikethrough-content/,
    'the shared mapped-content strike presentation remains the styling owner');
  assert.match(styles,
    /\.markdown-editable-projected-leaf\.is-underline-content/,
    'the shared mapped-content underline presentation remains the styling owner');
});

test('real shared list mount renders the Reading glyph hierarchy over exact hidden HN markers', () => {
  const source = '- Parent\n\t- Child\n\t\t- Grandchild';
  const result = renderHn(source);
  const expected = [
    { marker: '- ', depth: '0', glyph: '\u2022', style: 'disc' },
    { marker: '\t- ', depth: '1', glyph: '\u25e6', style: 'circle' },
    { marker: '\t\t- ', depth: '2', glyph: '\u25aa', style: 'square' }
  ];

  assert.equal(exactProjectedSource(result), source);
  assert.equal(result.presentationPlan.constructs.listRows.length, 3);
  result.presentationPlan.constructs.listRows.forEach((listRow, index) => {
    const row = result.projection.enumeratePhysicalRows().find((entry) => (
      entry.physicalLineId === listRow.physicalLineId
    )).element;
    const markerSlot = row.querySelector('.markdown-editable-list-marker-slot');
    const bullet = row.querySelector('.markdown-editable-list-bullet');
    const markerLeaves = projectedLeaves(result).filter((leaf) => (
      leaf.physicalLineId === listRow.physicalLineId
        && listRow.markerStart <= leaf.sourceStart
        && leaf.sourceEnd <= listRow.markerEnd
    ));

    assert.equal(row.style.getPropertyValue('--markdown-editable-list-depth'), expected[index].depth);
    assert.ok(row.classList.contains('has-editable-list-row-presentation'));
    assert.ok(row.classList.contains('is-editable-list-presentation-rendered'));
    assert.ok(markerSlot, `${index}: shared list mount owns the marker slot`);
    assert.equal(bullet.textContent, expected[index].glyph);
    assert.equal(bullet.dataset.markdownUnorderedMarkerStyle, expected[index].style);
    assert.equal(bullet.dataset.markdownSemanticOnly, 'true');
    assert.equal(bullet.contentEditable, 'false');
    assert.equal(markerLeaves.map((leaf) => leaf.text).join(''), expected[index].marker);
    assert.ok(markerLeaves.every((leaf) => (
      leaf.visibility === 'activatable'
        && markerSlot.contains(leaf.element)
        && leaf.element.classList.contains('is-unordered-list-marker')
    )), `${index}: canonical marker leaves stay mapped and hidden in their presentation slot`);
  });

  assert.equal(result.projection.enumerateRegisteredActivationAnchors().filter((anchor) => (
    anchor.kind === 'unordered-list-row-rendered-activation'
  )).length, 3, 'each shared bullet routes activation back to its canonical marker');
});

test('real shared math mount renders inline and display math without a second canonical text owner', () => {
  const source = 'Inline $x+1$ end\n$$\ny^2\n$$';
  const result = renderHn(source);
  const mathHosts = elementsWithClass(result.root, 'markdown-editable-math-presentation');
  const mathLeaves = projectedLeaves(result).filter((leaf) => (
    result.presentationPlan.constructs.math.some((math) => (
      math.start <= leaf.sourceStart && leaf.sourceEnd <= math.end
    ))
  ));

  assert.equal(exactProjectedSource(result), source);
  assert.deepEqual(result.latexCalls, [
    { source: 'x+1', displayMode: false },
    { source: 'y^2', displayMode: true }
  ], 'HN delegates both dialect forms to the existing Markdown renderer');
  assert.equal(mathHosts.length, 2);
  assert.deepEqual(mathHosts.map((host) => host.dataset.mathSource), ['x+1', 'y^2']);
  assert.deepEqual(mathHosts.map((host) => host.classList.contains('is-display')), [false, true]);
  assert.ok(mathHosts.every((host) => (
    host.dataset.markdownSemanticOnly === 'true'
      && host.contentEditable === 'false'
      && host.attributes.role === 'math'
  )), 'rendered math is presentation-only and cannot become an editable source leaf');
  assert.ok(mathLeaves.every((leaf) => leaf.visibility === 'activatable'),
    'the one exact canonical math range remains in mapped, inactive source leaves');
  assert.equal(projectedLeaves(result).filter((leaf) => (
    leaf.element.classList.contains('markdown-editable-math-presentation')
  )).length, 0, 'rendered math is never registered as a second projected source leaf');
  assert.equal(result.projection.enumerateRegisteredActivationAnchors().filter((anchor) => (
    anchor.kind === 'math-rendered-activation'
      || anchor.kind === 'math-rendered-presentation'
  )).length, 2, 'rendered math points back to the existing canonical projection');
});

test('active Edit restores exact syntax while Browser refuses the same activation owners', () => {
  const source = '**bold** *italic* ~~strike~~ <u>under</u> $x$\n- Item';
  const inactive = renderHn(source);
  const edit = renderHn(source, { activeOwnerIds: ownerIds(inactive.presentationPlan) });
  const browser = renderHn(source, { mode: 'browser', activeOwnerIds: 'all' });

  assert.equal(exactProjectedSource(edit), source);
  assert.ok(projectedLeaves(edit).filter((leaf) => (
    (leaf.planLeaf.semanticRoles || []).some((role) => role.role === 'marker')
  )).every((leaf) => leaf.visibility === 'visible'),
  'active Edit exposes the exact marker leaves rather than generated replacements');
  assert.equal(elementsWithClass(edit.root, 'markdown-editable-list-bullet').length, 0,
    'active list syntax replaces its bullet presentation');
  assert.equal(elementsWithClass(edit.root, 'markdown-editable-math-presentation').length, 0,
    'active math syntax replaces its rendered presentation');

  assert.deepEqual(browser.presentationPlan.activeOwnerIds, []);
  assert.ok(projectedLeaves(browser).filter((leaf) => (
    (leaf.planLeaf.semanticRoles || []).some((role) => role.role === 'marker')
  )).every((leaf) => leaf.visibility === 'activatable'),
  'Browser ignores requested active owners and keeps all supported markers inactive');
  assert.equal(elementsWithClass(browser.root, 'markdown-editable-list-bullet').length, 1);
  assert.equal(elementsWithClass(browser.root, 'markdown-editable-math-presentation').length, 1);
});

test('reused HN display rows reconcile inactive-active-inactive math layout like Markdown Live', () => {
  const source = ['text before', '$$', '\\frac{a+b}{c}', '$$', 'text after'].join('\n');
  const runtime = createRuntime();
  const strategy = sourceEditor.createHnBasicPresentationStrategy({
    presentationRuntime: runtime.view
  });
  const sourceSnapshot = strategy.createSourceSnapshot(source);
  const document = projectionDocument();
  const root = document.createElement('div');
  root.classList.add('hn-source-editor');
  const projection = createEditableProjection({ root, document, foundation });
  const render = (mode = 'edit', activeOwnerIds = []) => {
    const presentationPlan = strategy.createPresentationPlan(sourceSnapshot, {
      mode,
      activeOwnerIds
    });
    projection.render(sourceSnapshot, {
      mode: strategy.projectionMode,
      presentationPlan
    });
    strategy.mountPresentation({ projection, presentationPlan, sourceSnapshot });
    return presentationPlan;
  };
  const mathRows = (math) => projection.enumeratePhysicalRows().filter((row) => (
    row.start < math.end && row.sourceEnd > math.start
  ));
  const collapsedRows = (math) => mathRows(math).map((row) => (
    row.element.classList.contains('is-editable-presentation-collapsed')
  ));

  const inactive = render();
  const inactiveMath = inactive.constructs.math[0];
  assert.equal(inactiveMath.presentation.layout, 'rendered-only');
  assert.deepEqual(collapsedRows(inactiveMath), [false, true, true]);
  assert.equal(elementsWithClass(root, 'markdown-editable-math-presentation').length, 1);

  const active = render('edit', [inactiveMath.ownerId]);
  const activeMath = active.constructs.math[0];
  const activeRows = mathRows(activeMath);
  const activeLeaves = projectedLeaves({ projection }).filter((leaf) => (
    activeMath.start <= leaf.sourceStart && leaf.sourceEnd <= activeMath.end
  ));
  const activeHost = elementsWithClass(root, 'markdown-editable-math-presentation')[0];
  const lastRow = activeRows.at(-1).element;
  const lastLeaf = activeLeaves.at(-1).element;
  assert.deepEqual({ ...activeMath.presentation }, {
    sourceVisible: true,
    renderedMounted: true,
    layout: 'source-above-rendered'
  });
  assert.deepEqual(collapsedRows(activeMath), [false, false, false],
    'HN clears the inactive rendered-only collapse before mounting active source rows');
  assert.ok(activeLeaves.every((leaf) => leaf.visibility === 'visible'));
  assert.equal(elementsWithClass(root, 'markdown-editable-math-presentation').length, 1);
  assert.ok(lastRow.childNodes.indexOf(activeHost) > lastRow.childNodes.indexOf(lastLeaf),
    'the one shared rendered preview follows the complete active canonical source range');
  assert.equal(exactProjectedSource({ presentationPlan: active }), source);

  const deactivated = render();
  const deactivatedMath = deactivated.constructs.math[0];
  assert.equal(deactivatedMath.presentation.layout, 'rendered-only');
  assert.deepEqual(collapsedRows(deactivatedMath), [false, true, true]);
  assert.equal(elementsWithClass(root, 'markdown-editable-math-presentation').length, 1);

  const browser = render('browser', [inactiveMath.ownerId]);
  const browserMath = browser.constructs.math[0];
  assert.deepEqual(browser.activeOwnerIds, []);
  assert.equal(browserMath.presentation.layout, 'rendered-only');
  assert.deepEqual(collapsedRows(browserMath), [false, true, true]);
  assert.equal(elementsWithClass(root, 'markdown-editable-math-presentation').length, 1);
  assert.equal(exactProjectedSource({ presentationPlan: browser }), source);
});

test('one active inline math owner never reveals or removes an unrelated HN math owner', () => {
  const source = [
    '$a$ text $b$',
    '$a$$b$',
    '**text** $a+b$',
    '- list row containing $x$'
  ].join('\n');
  const runtime = createRuntime();
  const strategy = sourceEditor.createHnBasicPresentationStrategy({
    presentationRuntime: runtime.view
  });
  const sourceSnapshot = strategy.createSourceSnapshot(source);
  const document = projectionDocument();
  const root = document.createElement('div');
  root.classList.add('hn-source-editor');
  const projection = createEditableProjection({ root, document, foundation });
  const render = (activeOwnerIds = []) => {
    const presentationPlan = strategy.createPresentationPlan(sourceSnapshot, {
      mode: 'edit',
      activeOwnerIds
    });
    projection.render(sourceSnapshot, {
      mode: strategy.projectionMode,
      presentationPlan
    });
    strategy.mountPresentation({ projection, presentationPlan, sourceSnapshot });
    return presentationPlan;
  };
  const renderedOwners = () => elementsWithClass(root, 'markdown-editable-math-presentation')
    .map((host) => String(host.dataset.markdownEditablePresentationOwner));

  const inactive = render();
  assert.equal(inactive.constructs.math.length, 5);
  assert.deepEqual(inactive.constructs.math.map((math) => math.raw), [
    '$a$', '$b$', '$a$$b$', '$a+b$', '$x$'
  ], 'the current parser boundary stays unchanged, including one $a$$b$ owner');
  assert.equal(renderedOwners().length, 5);

  for (const requested of inactive.constructs.math) {
    const activeOwnerIds = syntaxAdapters.activePresentationOwnerIdsForSelection(inactive, {
      anchor: requested.contentStart,
      focus: requested.contentStart
    });
    const active = render(activeOwnerIds);
    const selected = active.constructs.math.find((math) => math.ownerId === requested.ownerId);
    assert.equal(selected.active, true, `${requested.raw}: requested math owner activates`);
    assert.equal(renderedOwners().filter((ownerId) => ownerId === requested.ownerId).length, 0,
      `${requested.raw}: active inline math has no rendered duplicate`);
    active.constructs.math.filter((math) => math.ownerId !== requested.ownerId).forEach((math) => {
      assert.equal(math.active, false, `${requested.raw}: unrelated math remains inactive`);
      assert.equal(renderedOwners().filter((ownerId) => ownerId === math.ownerId).length, 1,
        `${requested.raw}: unrelated math keeps one rendered owner`);
    });
    assert.equal(exactProjectedSource({ presentationPlan: active }), source);

    const restored = render();
    assert.ok(restored.constructs.math.every((math) => math.active === false));
    assert.equal(renderedOwners().length, 5, `${requested.raw}: deactivation restores all renderers`);
  }
});

test('HN heading and sequence presentation leave every unsupported Markdown role literal', () => {
  const source = [
    '# Heading',
    '> Quote',
    '1. Ordered',
    '- [ ] Task',
    '[Link](https://example.com)',
    '![Image](asset.png)',
    '`inline code`',
    '| A | B |',
    '| --- | --- |',
    '---',
    '<u class="unsafe">HTML</u>'
  ].join('\n');
  const result = renderHn(source);
  const forbiddenClasses = [
    'markdown-editable-heading-presentation',
    'markdown-editable-quote-rail',
    'markdown-editable-table-presentation',
    'markdown-editable-code-presentation',
    'markdown-editable-task-control',
    'markdown-editable-link-presentation',
    'markdown-editable-image-presentation'
  ];

  assert.equal(exactProjectedSource(result), source);
  const headingRow = result.projection.enumeratePhysicalRows()[0].element;
  assert.ok(headingRow.classList.contains('is-hn-heading-level-1'));
  assert.deepEqual(result.presentationPlan.constructs.headings, []);
  assert.deepEqual(result.presentationPlan.constructs.quotes, []);
  assert.deepEqual(result.presentationPlan.constructs.orderedListMarkers, []);
  assert.deepEqual(result.presentationPlan.constructs.listRows.map((row) => ({
    family: row.family,
    raw: row.raw,
    markerSource: row.markerSource,
    contentSource: row.contentSource,
    sourceVisible: row.presentation.sourceVisible,
    renderedMounted: row.presentation.renderedMounted
  })), [{
    family: 'hn-sequence-list',
    raw: '1. Ordered',
    markerSource: '1. ',
    contentSource: 'Ordered',
    sourceVisible: true,
    renderedMounted: false
  }]);
  assert.deepEqual(result.presentationPlan.constructs.links, []);
  assert.deepEqual(result.presentationPlan.constructs.images, []);
  assert.deepEqual(result.presentationPlan.constructs.inlineCode, []);
  assert.deepEqual(result.presentationPlan.constructs.tables, []);
  assert.deepEqual(result.presentationPlan.constructs.thematicBreaks, []);
  assert.deepEqual(result.presentationPlan.constructs.underlines, []);
  forbiddenClasses.forEach((className) => {
    assert.equal(elementsWithClass(result.root, className).length, 0, className);
  });
  const sequenceRow = result.presentationPlan.constructs.listRows[0];
  const sequenceElement = result.projection.enumeratePhysicalRows()[2].element;
  const markerSlot = sequenceElement.querySelector('.markdown-editable-list-marker-slot');
  assert.ok(sequenceElement.classList.contains('is-hn-sequence-list-row'));
  assert.equal(markerSlot.textContent, '1. ');
  assert.equal(sequenceElement.querySelector('.markdown-editable-list-bullet'), null,
    'canonical sequence marker bytes never gain a rendered duplicate');
  assert.ok(projectedLeaves(result).filter((leaf) => (
    sequenceRow.start <= leaf.sourceStart && leaf.sourceEnd <= sequenceRow.end
  )).every((leaf) => (
    leaf.visibility === 'visible'
      && leaf.element.dataset.visibility === 'visible'
      && (leaf.planLeaf.semanticRoles || []).length === 1
      && leaf.planLeaf.semanticRoles[0].family === 'hn-sequence-list'
  )), 'the sequence row uses its canonical projected marker/content leaves');
  assert.ok(projectedLeaves(result).filter((leaf) => (
    leaf.sourceEnd <= sequenceRow.start || sequenceRow.end <= leaf.sourceStart
  )).every((leaf) => (
    leaf.visibility === 'visible'
      && leaf.element.dataset.visibility === 'visible'
      && (leaf.planLeaf.semanticRoles || []).length === 0
  )), 'unsupported bytes remain one literal editable/selectable projection');
});
