'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const markdown = require('../public/markdownPage');
const foundation = require('../public/markdownEditableFoundation');
const projectionRuntime = require('../public/js/markdownEditableProjection');
const syntaxAdapters = require('../public/js/markdownEditableSyntaxAdapters');
const {
  buildEditablePresentationPlan,
  validateEditablePresentationPlan
} = syntaxAdapters;
const {
  FakeElement,
  descendants,
  loadMarkdownPageViewInternals,
  renderSemanticSegments
} = require('./helpers/markdownFakeDom');
const {
  createCertificationProjection,
  samePosition
} = require('./helpers/markdownEditableCertificationHarness');

const viewSource = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'markdownPageView.js'),
  'utf8'
);
const styles = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'styles.css'),
  'utf8'
);

function functionSource(name) {
  const start = viewSource.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = viewSource.indexOf('{', viewSource.indexOf(') {', start));
  let depth = 0;
  for (let index = bodyStart; index < viewSource.length; index += 1) {
    if (viewSource[index] === '{') depth += 1;
    else if (viewSource[index] === '}') {
      depth -= 1;
      if (depth === 0) return viewSource.slice(start, index + 1);
    }
  }
  throw new Error(`Unable to isolate ${name}`);
}

function readingRender(source, stateOverrides = {}) {
  const view = loadMarkdownPageViewInternals([
    'semanticSyntaxSegments',
    'renderSemanticBlockContents'
  ], {
    globalThis: { markdownEditableSyntaxAdapters: syntaxAdapters }
  });
  const sourceSnapshot = markdown.createSourceSnapshot(source);
  const rendered = renderSemanticSegments(view, source, {
    mode: 'reading',
    sourceSnapshot,
    sourceVersion: sourceSnapshot.version,
    ...stateOverrides
  });
  const nodes = rendered.blocks.flatMap((block) => descendants(block.element));
  return { view, rendered, nodes, sourceSnapshot };
}

function editablePlan(source, mode = 'live-preview', options = {}) {
  const sourceSnapshot = markdown.createSourceSnapshot(source);
  const plan = buildEditablePresentationPlan(sourceSnapshot, {
    model: markdown,
    mode,
    ...options
  });
  const validation = validateEditablePresentationPlan(plan, sourceSnapshot);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  return { sourceSnapshot, plan };
}

function plannedSource({ sourceSnapshot, plan }) {
  return plan.lines.map((line) => (
    line.leaves.map((leaf) => leaf.text).join('') + line.lineEnding
  )).join('').slice(0, sourceSnapshot.markdownBody.length);
}

function projected(source, mode = 'live-preview', options = {}) {
  const planned = editablePlan(source, mode, options);
  const environment = createCertificationProjection(planned.sourceSnapshot, mode, {
    presentationPlan: planned.plan
  });
  return { ...planned, ...environment };
}

function elements(nodes, className) {
  return nodes.filter((node) => (
    node?.nodeType === 1 && node.classList.contains(className)
  ));
}

function navigationControls(root) {
  return descendants(root).filter((node) => (
    node?.nodeType === 1 && node.classList.contains('markdown-page-link-navigation')
  ));
}

function sourceRange(element) {
  const start = element?.dataset?.markdownSourceStart
    ?? element?.dataset?.sourceStart
    ?? element?.dataset?.markdownConstructStart;
  const end = element?.dataset?.markdownSourceEnd
    ?? element?.dataset?.sourceEnd
    ?? element?.dataset?.markdownConstructEnd;
  return { start: Number(start), end: Number(end) };
}

function descriptorRange(link) {
  return {
    start: Number(link.start),
    end: Number(link.end)
  };
}

function previousElementSibling(element) {
  const siblings = element?.parentElement?.childNodes || [];
  const index = siblings.indexOf(element);
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (siblings[cursor]?.nodeType === 1) return siblings[cursor];
  }
  return null;
}

function arrowAnchorIdentity(control) {
  const anchor = previousElementSibling(control);
  const range = sourceRange(anchor);
  return Number.isFinite(range.start) && Number.isFinite(range.end)
    ? JSON.stringify([range.start, range.end])
    : null;
}

function assertArrowForLink(root, link, label = 'logical link') {
  const expectedRange = descriptorRange(link);
  const presentationEnds = new Set([expectedRange.end, Number(link.labelEnd)]);
  const matches = navigationControls(root).filter((control) => {
    const anchorRange = sourceRange(previousElementSibling(control));
    return presentationEnds.has(anchorRange.end)
      && anchorRange.start >= expectedRange.start
      && anchorRange.start <= expectedRange.end;
  });
  assert.equal(matches.length, 1, `${label}: one physical arrow follows its canonical anchor`);
  const [control] = matches;
  const rightEdgeAnchor = previousElementSibling(control);
  assert.ok(rightEdgeAnchor, `${label}: the arrow follows the current presentation anchor`);
  assert.equal(control.parentElement, rightEdgeAnchor.parentElement);
  assert.equal(
    control.parentElement.childNodes.indexOf(control),
    control.parentElement.childNodes.indexOf(rightEdgeAnchor) + 1,
    `${label}: the arrow is directly after the current right-edge anchor`
  );
  assert.equal(control.dataset.markdownSemanticOnly, 'true');
  assert.equal(control.dataset.markdownSemanticControl, 'true');
  assert.equal(control.contentEditable, 'false');
  assert.equal(Object.hasOwn(control.dataset, 'markdownSourceStart'), false);
  assert.equal(Object.hasOwn(control.dataset, 'markdownSourceEnd'), false);
  return { control, rightEdgeAnchor };
}

function loadFullEditableView(names = []) {
  return loadMarkdownPageViewInternals(names, {
    globalThis: {
      markdownEditableFoundation: foundation,
      markdownEditableProjection: projectionRuntime,
      markdownEditableSyntaxAdapters: syntaxAdapters
    }
  });
}

function renderEditableDocument(source, mode = 'live-preview', stateOverrides = {}) {
  const view = loadFullEditableView([
    'renderEditableDocumentBlocks',
    'renderSemanticDocument',
    'refreshEditableProjection',
    'clearEditableLiveActiveState',
    'linkArrowIdentity',
    'createLinkArrowController',
    'collectEditableLinkArrowAnchors'
  ]);
  const sourceSnapshot = markdown.createSourceSnapshot(source);
  const bodyRoot = new FakeElement({ tagName: 'div' });
  bodyRoot.isConnected = true;
  const state = {
    body: source,
    sourceSnapshot,
    sourceVersion: sourceSnapshot.version,
    bodyRoot,
    mode,
    pageEditMode: false,
    bodyReadOnly: false,
    editableActiveOwnerIds: new Set(),
    editableActiveLineIds: new Set(),
    editableForcedRawOwnerIds: new Set(),
    linkArrowController: view.createLinkArrowController(),
    linkArrowAnchorSink: null,
    page: { id: `link-${mode}` },
    paneId: `pane-${mode}`,
    ...stateOverrides
  };
  view.renderEditableDocumentBlocks(state, bodyRoot);
  return { view, state, bodyRoot };
}

function eventRecord() {
  return {
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; }
  };
}

function dispatchOwn(element, type, event = eventRecord()) {
  (element?.listeners?.get(type) || []).forEach((listener) => listener(event));
  return event;
}

function mountedLiveLink(source, stateOverrides = {}) {
  const rendered = renderEditableDocument(source, 'live-preview', {
    paneId: 'pane-a',
    page: { id: 'page-a' },
    ...stateOverrides
  });
  const control = navigationControls(rendered.bodyRoot)[0];
  return {
    sourceSnapshot: rendered.state.sourceSnapshot,
    plan: rendered.state.editablePresentationPlan,
    view: rendered.view,
    state: rendered.state,
    bodyRoot: rendered.bodyRoot,
    row: control?.closest('.markdown-editable-physical-row') || rendered.bodyRoot,
    leaves: rendered.state.editableProjection.enumerateProjectedLeaves(),
    nodes: descendants(rendered.bodyRoot)
  };
}

function withArrowMutationAudit(root, maximum, operation) {
  const methods = ['append', 'before', 'after', 'remove', 'replaceChildren'];
  const originals = new Map();
  const counts = [];
  const sample = () => {
    const controls = navigationControls(root);
    const anchorIdentities = controls.map(arrowAnchorIdentity).filter(Boolean);
    counts.push(controls.length);
    assert.ok(controls.length <= maximum,
      `arrow cardinality exceeded ${maximum} during a DOM mutation`);
    assert.equal(new Set(anchorIdentities).size, anchorIdentities.length,
      'one current right-edge anchor cannot transiently own two controls');
  };
  methods.forEach((name) => {
    originals.set(name, FakeElement.prototype[name]);
    FakeElement.prototype[name] = function auditedMutation(...args) {
      const result = originals.get(name).apply(this, args);
      sample();
      return result;
    };
  });
  try {
    sample();
    operation(sample);
    sample();
  } finally {
    originals.forEach((method, name) => {
      FakeElement.prototype[name] = method;
    });
  }
  return counts;
}

function assertEditableArrowState(rendered, expected, label) {
  const controls = navigationControls(rendered.bodyRoot);
  assert.equal(controls.length, expected, label);
  assert.equal(new Set(controls.map(arrowAnchorIdentity)).size, controls.length,
    `${label}: every arrow has a distinct current right-edge anchor`);
  if (!expected) return [];
  const links = rendered.state.editablePresentationPlan?.constructs?.links || [];
  assert.equal(links.length, expected, `${label}: descriptor and arrow counts agree`);
  const leaves = rendered.state.editableProjection?.enumerateProjectedLeaves?.() || [];
  links.forEach((link, index) => {
    const { control, rightEdgeAnchor } = assertArrowForLink(
      rendered.bodyRoot,
      link,
      `${label} link ${index + 1}`
    );
    if (rendered.state.mode === 'source' || link.active) {
      const anchorLeaf = leaves.find((leaf) => leaf.element === rightEdgeAnchor);
      const anchorEnd = Number(anchorLeaf?.sourceEnd ?? sourceRange(rightEdgeAnchor).end);
      assert.equal(anchorEnd, descriptorRange(link).end,
        `${label}: raw presentation anchor ends at the complete canonical link range`);
    }
    assert.equal(leaves.some((leaf) => leaf.element === control), false,
      `${label}: arrow is not an EditableProjection leaf`);
  });
  assert.equal(plannedSource({
    sourceSnapshot: rendered.state.sourceSnapshot,
    plan: rendered.state.editablePresentationPlan
  }), rendered.state.body, `${label}: source remains byte exact`);
  return controls;
}

function runLinkArrowLifecycleTorture(source, fixtureName) {
  const rendered = renderEditableDocument(source, 'source');
  const controller = rendered.state.linkArrowController;
  let retained = assertEditableArrowState(rendered, 1, `${fixtureName} initial Source`)[0];
  const counts = withArrowMutationAudit(rendered.bodyRoot, 1, () => {
    for (let index = 0; index < 100; index += 1) {
      rendered.view.refreshEditableProjection(rendered.state);
      const [control] = assertEditableArrowState(
        rendered, 1, `${fixtureName} Source refresh ${index + 1}`
      );
      assert.equal(control, retained);
      assert.equal(rendered.state.linkArrowController, controller);
    }

    rendered.state.mode = 'live-preview';
    rendered.view.refreshEditableProjection(rendered.state);
    [retained] = assertEditableArrowState(rendered, 1, `${fixtureName} initial Live`);
    for (let index = 0; index < 100; index += 1) {
      rendered.view.refreshEditableProjection(rendered.state);
      const [control] = assertEditableArrowState(
        rendered, 1, `${fixtureName} Live refresh ${index + 1}`
      );
      assert.equal(control, retained);
      assert.equal(rendered.state.linkArrowController, controller);
    }

    for (let index = 0; index < 100; index += 1) {
      rendered.state.mode = 'source';
      rendered.view.refreshEditableProjection(rendered.state);
      assertEditableArrowState(rendered, 1, `${fixtureName} Live to Source ${index + 1}`);
      rendered.state.mode = 'live-preview';
      rendered.view.refreshEditableProjection(rendered.state);
      assertEditableArrowState(rendered, 1, `${fixtureName} Source to Live ${index + 1}`);
    }

    for (let index = 0; index < 100; index += 1) {
      const ownerId = rendered.state.editablePresentationPlan.constructs.links[0].ownerId;
      rendered.state.editableActiveOwnerIds = new Set([ownerId]);
      rendered.view.refreshEditableProjection(rendered.state);
      assertEditableArrowState(rendered, 1, `${fixtureName} Live active ${index + 1}`);
      rendered.state.editableActiveOwnerIds = new Set();
      rendered.view.refreshEditableProjection(rendered.state);
      assertEditableArrowState(rendered, 1, `${fixtureName} Live inactive ${index + 1}`);
    }

    for (let index = 0; index < 100; index += 1) {
      rendered.state.mode = 'reading';
      rendered.view.renderSemanticDocument(rendered.state, rendered.bodyRoot);
      assert.equal(navigationControls(rendered.bodyRoot).length, 0,
        `${fixtureName} Reading ${index + 1}`);
      rendered.state.mode = 'live-preview';
      rendered.view.renderSemanticDocument(rendered.state, rendered.bodyRoot);
      assertEditableArrowState(rendered, 1, `${fixtureName} Reading to Live ${index + 1}`);
      assert.equal(rendered.state.linkArrowController, controller);
    }
  });

  rendered.state.mode = 'reading';
  rendered.view.renderSemanticDocument(rendered.state, rendered.bodyRoot);
  assert.equal(navigationControls(rendered.bodyRoot).length, 0, `${fixtureName} final Reading`);
  rendered.state.mode = 'source';
  rendered.view.renderSemanticDocument(rendered.state, rendered.bodyRoot);
  assertEditableArrowState(rendered, 1, `${fixtureName} final Source`);
  rendered.state.mode = 'live-preview';
  rendered.view.renderSemanticDocument(rendered.state, rendered.bodyRoot);
  assertEditableArrowState(rendered, 1, `${fixtureName} final Live`);
  assert.equal(rendered.state.linkArrowController, controller);
  assert.ok(counts.every((count) => count <= 1));
  assert.equal(rendered.state.body, source);
  assert.equal(rendered.state.sourceSnapshot.markdownBody, source);
}

test('ordinary Markdown link has the exact Reading, Source, and Live arrow matrix', () => {
  const source = '[OpenAI](https://openai.com)';
  const readingActivations = [];
  const reading = readingRender(source, {
    onLinkActivate(detail) { readingActivations.push(detail); }
  });
  const readingLink = elements(reading.nodes, 'markdown-page-link')[0];
  assert.ok(readingLink);
  assert.equal(elements(reading.nodes, 'markdown-page-link-navigation').length, 0);
  assert.equal(dispatchOwn(readingLink, 'click').defaultPrevented, true);
  assert.equal(readingActivations[0].href, 'https://openai.com');
  assert.equal(reading.sourceSnapshot.markdownBody, source);

  const sourceActivations = [];
  const rendered = renderEditableDocument(source, 'source', {
    onLinkActivate(detail) { sourceActivations.push(detail); }
  });
  const controller = rendered.state.linkArrowController;
  const [sourceArrow] = assertEditableArrowState(rendered, 1, 'Source');
  const sourceAnchor = previousElementSibling(sourceArrow);
  dispatchOwn(sourceArrow, 'click');
  assert.equal(sourceActivations[0].href, 'https://openai.com');

  rendered.state.mode = 'live-preview';
  rendered.view.refreshEditableProjection(rendered.state);
  const [inactiveArrow] = assertEditableArrowState(rendered, 1, 'Live inactive');
  const inactiveAnchor = previousElementSibling(inactiveArrow);
  assert.equal(inactiveArrow, sourceArrow);
  assert.notEqual(inactiveAnchor, sourceAnchor);

  const ownerId = rendered.state.editablePresentationPlan.constructs.links[0].ownerId;
  rendered.state.editableActiveOwnerIds = new Set([ownerId]);
  rendered.view.refreshEditableProjection(rendered.state);
  const [activeArrow] = assertEditableArrowState(rendered, 1, 'Live active');
  assert.equal(activeArrow, sourceArrow);
  assert.notEqual(previousElementSibling(activeArrow), inactiveAnchor);

  rendered.state.editableActiveOwnerIds = new Set();
  rendered.view.refreshEditableProjection(rendered.state);
  assert.equal(assertEditableArrowState(rendered, 1, 'Live deactivated')[0], sourceArrow);
  assert.equal(rendered.state.linkArrowController, controller);

  rendered.state.mode = 'reading';
  rendered.view.renderSemanticDocument(rendered.state, rendered.bodyRoot);
  assert.equal(navigationControls(rendered.bodyRoot).length, 0);
  assert.equal(rendered.state.linkArrowController, controller);
});

test('ordinary link survives the complete x100 PageView arrow lifecycle', () => {
  runLinkArrowLifecycleTorture('[OpenAI](https://openai.com)', 'ordinary fixture');
});

test('exact escaped-label fixture stays one descriptor and one arrow through x100 lifecycle', () => {
  const source = '[\\[OpenAI\\](https://openai.com/)](https://openai.com/)';
  assert.equal(source.length, 54);
  assert.equal(editablePlan(source, 'source').plan.constructs.links.length, 1);
  assert.equal(editablePlan(source, 'live-preview').plan.constructs.links.length, 1);
  assert.equal(elements(readingRender(source).nodes, 'markdown-page-link-navigation').length, 0);
  runLinkArrowLifecycleTorture(source, 'escaped-label fixture');
});

test('malformed nested-link-looking source is one outer link in Reading, Source, and Live', () => {
  const source = '[[OpenAI](https://openai.com/)](https://openai.com)';
  const readingActivations = [];
  const reading = readingRender(source, {
    onLinkActivate(detail) { readingActivations.push(detail.href); }
  });
  const readingLinks = elements(reading.nodes, 'markdown-page-link');
  assert.equal(readingLinks.length, 1);
  assert.deepEqual(sourceRange(readingLinks[0]), { start: 0, end: 51 });
  assert.equal(
    readingLinks[0].dataset.markdownLinkSemanticRecovery,
    'obsidian-nested-link-shell'
  );
  const literalLabel = descendants(readingLinks[0]).find((node) => (
    node?.classList?.contains('markdown-source-mapped-text')
      && sourceRange(node).start === 1
      && sourceRange(node).end === 30
  ));
  assert.equal(literalLabel?.textContent, '[OpenAI](https://openai.com/)');
  assert.equal(navigationControls(reading.blocks?.[0]?.element || reading.rendered.blocks[0].element)
    .length, 0);
  dispatchOwn(readingLinks[0], 'click');
  assert.deepEqual(readingActivations, ['https://openai.com']);

  const activations = [];
  const rendered = renderEditableDocument(source, 'source', {
    onLinkActivate(detail) { activations.push(detail.href); }
  });
  const controller = rendered.state.linkArrowController;
  const [sourceArrow] = assertEditableArrowState(rendered, 1, 'recovered Source');
  const sourceLink = rendered.state.editablePresentationPlan.constructs.links[0];
  assert.deepEqual(descriptorRange(sourceLink), { start: 0, end: 51 });
  assert.equal(sourceLink.safeHref, 'https://openai.com');
  assert.equal(sourceLink.labelSource, '[OpenAI](https://openai.com/)');
  assert.equal(sourceLink.semanticRecovery.kind, 'obsidian-nested-link-shell');
  assert.equal(source[sourceLink.end - 1], ')');
  assert.equal(sourceRange(previousElementSibling(sourceArrow)).end, 51);
  dispatchOwn(sourceArrow, 'click');
  assert.deepEqual(activations, ['https://openai.com']);

  rendered.state.mode = 'live-preview';
  rendered.view.refreshEditableProjection(rendered.state);
  const [inactiveArrow] = assertEditableArrowState(rendered, 1, 'recovered Live inactive');
  assert.equal(inactiveArrow, sourceArrow);
  const inactiveAnchor = previousElementSibling(inactiveArrow);
  assert.equal(inactiveAnchor.textContent, '[OpenAI](https://openai.com/)');
  assert.deepEqual(sourceRange(inactiveAnchor), { start: 1, end: 30 });

  rendered.state.editableActiveOwnerIds = new Set([sourceLink.ownerId]);
  rendered.view.refreshEditableProjection(rendered.state);
  const [activeArrow] = assertEditableArrowState(rendered, 1, 'recovered Live active');
  assert.equal(activeArrow, sourceArrow);
  assert.equal(sourceRange(previousElementSibling(activeArrow)).end, 51);

  rendered.state.editableActiveOwnerIds = new Set();
  rendered.view.refreshEditableProjection(rendered.state);
  assert.equal(assertEditableArrowState(rendered, 1, 'recovered Live deactivated')[0], sourceArrow);
  assert.equal(rendered.state.linkArrowController, controller);
  assert.equal(rendered.state.body, source);
  assert.equal(rendered.state.sourceSnapshot.markdownBody, source);

  rendered.state.mode = 'reading';
  rendered.view.renderSemanticDocument(rendered.state, rendered.bodyRoot);
  assert.equal(navigationControls(rendered.bodyRoot).length, 0);
});

test('recovered shells preserve decoded prefix, suffix, and shared-gap text', () => {
  const shell = '[[A](https://inner.example/)](https://outer.example)';
  const surrounded = `${String.raw`\* `}${shell} &amp;`;
  const surroundedReading = readingRender(surrounded);
  assert.equal(elements(surroundedReading.nodes, 'markdown-page-link').length, 1);
  const visibleEscapedAsterisk = elements(
    surroundedReading.nodes,
    'markdown-source-mapped-text'
  ).find((node) => (
    node.textContent === '*'
      && sourceRange(node).start === 1
      && sourceRange(node).end === 2
  ));
  assert.ok(visibleEscapedAsterisk, 'escaped prefix punctuation remains decoded');
  const suffixStart = surrounded.indexOf(' &amp;', surrounded.indexOf(shell) + shell.length);
  const decodedSuffix = elements(
    surroundedReading.nodes,
    'markdown-decoded-rendered'
  ).find((node) => (
    sourceRange(node).start === suffixStart
      && sourceRange(node).end === surrounded.length
  ));
  assert.equal(decodedSuffix?.textContent, ' &');
  assert.equal(surroundedReading.sourceSnapshot.markdownBody, surrounded);

  const joined = `${shell} &amp; ${shell}`;
  const joinedReading = readingRender(joined);
  const joinedLinks = elements(joinedReading.nodes, 'markdown-page-link');
  assert.equal(joinedLinks.length, 2);
  const gapStart = shell.length;
  const gapEnd = joined.length - shell.length;
  const decodedGap = elements(joinedReading.nodes, 'markdown-decoded-rendered')
    .find((node) => (
      sourceRange(node).start === gapStart
        && sourceRange(node).end === gapEnd
    ));
  assert.equal(decodedGap?.textContent, ' & ');
  assert.equal(joinedReading.sourceSnapshot.markdownBody, joined);
});

test('recovered outer link survives the complete x100 PageView arrow lifecycle', () => {
  runLinkArrowLifecycleTorture(
    '[[OpenAI](https://openai.com/)](https://openai.com)',
    'recovered outer fixture'
  );
});

test('two separate links to the same URL keep two range-keyed arrows', () => {
  const source = ['[A](https://same.com/)', '[B](https://same.com/)'].join('\n');
  const rendered = renderEditableDocument(source, 'source');
  const controller = rendered.state.linkArrowController;
  const links = rendered.state.editablePresentationPlan.constructs.links;
  const controls = assertEditableArrowState(rendered, 2, 'same URL Source');
  assert.equal(new Set(links.map((link) => link.logicalLinkId)).size, 2);
  assert.equal(new Set(links.map((link) => link.safeHref)).size, 1);
  assert.equal(new Set(controls.map(arrowAnchorIdentity)).size, 2);
  const retained = new Set(controls);
  for (let index = 0; index < 100; index += 1) {
    rendered.view.refreshEditableProjection(rendered.state);
    assertEditableArrowState(rendered, 2, `same URL Source ${index + 1}`)
      .forEach((control) => assert.ok(retained.has(control)));
    rendered.state.mode = 'live-preview';
    rendered.view.refreshEditableProjection(rendered.state);
    assertEditableArrowState(rendered, 2, `same URL Live ${index + 1}`)
      .forEach((control) => assert.ok(retained.has(control)));
    rendered.state.mode = 'source';
    rendered.view.refreshEditableProjection(rendered.state);
  }
  assert.equal(rendered.state.linkArrowController, controller);
});

test('controller input moves one existing arrow between whole-link anchors', () => {
  const source = '[Link](https://example.com/)';
  const link = editablePlan(source, 'source').plan.constructs.links[0];
  const view = loadFullEditableView(['linkArrowIdentity', 'createLinkArrowController']);
  const controller = view.createLinkArrowController();
  const root = new FakeElement({ tagName: 'div' });
  const firstAnchor = new FakeElement({ tagName: 'span' });
  const secondAnchor = new FakeElement({ tagName: 'span' });
  [firstAnchor, secondAnchor].forEach((anchor) => {
    anchor.dataset.markdownSourceStart = '0';
    anchor.dataset.markdownSourceEnd = String(source.length);
  });
  root.append(firstAnchor, secondAnchor);
  const state = { mode: 'source', bodyRoot: root, page: { id: 'controller-page' } };
  const identity = view.linkArrowIdentity(link);
  const reconcileAt = (rightEdgeAnchor) => {
    controller.reconcile({
      state,
      mode: state.mode,
      links: [link],
      anchors: [{ ...identity, rightEdgeAnchor }]
    });
    return navigationControls(root)[0];
  };
  const created = reconcileAt(firstAnchor);
  assert.equal(previousElementSibling(created), firstAnchor);
  controller.detach();
  assert.equal(navigationControls(root).length, 0);
  const moved = reconcileAt(secondAnchor);
  assert.equal(moved, created);
  assert.equal(previousElementSibling(moved), secondAnchor);
  assertArrowForLink(root, link, 'direct controller');
  controller.destroy();
  assert.equal(navigationControls(root).length, 0);
});

test('equal-range destination edit reconfigures the existing arrow behavior', () => {
  const before = '[Link](https://example.com/a)';
  const after = '[Link](https://example.com/b)';
  const activations = [];
  const rendered = renderEditableDocument(before, 'source', {
    onLinkActivate(detail) { activations.push(detail.href); }
  });
  const original = navigationControls(rendered.bodyRoot)[0];
  const snapshot = markdown.createSourceSnapshot(after);
  rendered.state.body = after;
  rendered.state.sourceSnapshot = snapshot;
  rendered.state.sourceVersion = snapshot.version;
  rendered.view.refreshEditableProjection(rendered.state);
  const [reused] = navigationControls(rendered.bodyRoot);
  assert.equal(reused, original);
  assert.equal(reused.attributes['aria-label'], 'Open https://example.com/b');
  dispatchOwn(reused, 'click');
  assert.deepEqual(activations, ['https://example.com/b']);
});

test('PageView controller is the sole arrow creator and old compensation code is deleted', () => {
  const identitySource = functionSource('linkArrowIdentity');
  const controllerSource = functionSource('createLinkArrowController');
  const collectorSource = functionSource('collectEditableLinkArrowAnchors');
  const astLinkSource = functionSource('appendAstLink');
  const recoveredLinkSource = functionSource('appendRecoveredAstLink');
  const tableMountSource = functionSource('mountEditableTablePresentations');
  const destroySource = functionSource('destroyMarkdownPageLayer');
  const creationPattern = /createElement\(\s*['"]button['"]\s*,\s*['"]markdown-page-link-navigation['"]\s*\)/g;
  assert.equal((viewSource.match(creationPattern) || []).length, 1);
  assert.match(controllerSource, /const ensureArrow = \(identity\) =>/);
  assert.match(controllerSource, /const arrowsByIdentity = new Map\(\)/);
  assert.match(controllerSource, /currentAnchors\.get\(key\)\.after\(record\.control\)/);
  assert.doesNotMatch(identitySource, /(?:safeHref|href|url)/i);
  assert.doesNotMatch(astLinkSource, /markdown-page-link-navigation/);
  assert.match(astLinkSource, /linkArrowAnchorSink/);
  assert.match(astLinkSource, /rightEdgeAnchor:\s*link/);
  assert.match(recoveredLinkSource, /linkArrowAnchorSink/);
  assert.doesNotMatch(recoveredLinkSource, /markdown-page-link-navigation/);
  assert.doesNotMatch(collectorSource, /markdown-page-link-navigation/);
  assert.match(collectorSource, /rightEdgeAnchor/);
  assert.doesNotMatch(tableMountSource, /markdown-page-link-navigation/);
  assert.doesNotMatch(controllerSource, /querySelector(?:All)?\s*\(/);
  assert.doesNotMatch(controllerSource, /(?:malformed|nested-link|semanticRecovery)/i);
  assert.equal(
    (viewSource.match(/state\.linkArrowController\s*=\s*createLinkArrowController\(\)/g) || []).length,
    1
  );
  assert.match(destroySource, /state\.linkArrowController\?\.destroy\?\.\(\)/);
  [
    'createLinkAuxiliaryPresentationOwner',
    'linkAuxiliaryPresentationOwner',
    'registerEditableLinkAuxiliaryAnchors',
    'semantic-whole-range',
    'projected-whole-range',
    'markdownLinkAnchorProvider',
    'markdownLinkNavigationOwner',
    'markdown-link-auxiliary-anchor',
    'projected-right-edge',
    'markdown-editable-link-navigation-anchor',
    'controlClaim',
    'semanticEntries'
  ].forEach((retired) => assert.equal(viewSource.includes(retired), false, retired));
  assert.doesNotMatch(styles, /\.markdown-link-auxiliary-anchor/);
  const arrowRule = styles.match(/\.markdown-page-link-navigation\s*\{([^}]*)\}/s)?.[1] || '';
  const iconRule = styles.match(/\.markdown-page-link-navigation-icon\s*\{([^}]*)\}/s)?.[1] || '';
  const interactionRule = styles.match(
    /\.markdown-page-link-navigation:hover,\s*\.markdown-page-link-navigation:focus-visible\s*\{([^}]*)\}/s
  )?.[1] || '';
  assert.match(arrowRule, /position:\s*relative;/);
  assert.match(arrowRule, /top:\s*-0\.34em;/);
  assert.match(arrowRule, /display:\s*inline-flex;/);
  assert.match(arrowRule, /width:\s*0\.9em;/);
  assert.match(arrowRule, /height:\s*0\.9em;/);
  assert.match(arrowRule, /margin-inline-start:\s*0\.08em;/);
  assert.match(arrowRule, /line-height:\s*0;/);
  assert.match(arrowRule, /vertical-align:\s*baseline;/);
  assert.match(arrowRule, /color:\s*var\(--accent-colour\);/);
  assert.match(arrowRule, /background:\s*var\(--surface-tool\);/);
  assert.match(arrowRule, /box-shadow:\s*0 0 0 1px var\(--border-tool\);/);
  assert.match(arrowRule, /border-radius:\s*3px;/);
  assert.doesNotMatch(arrowRule, /transform\s*:/);
  assert.doesNotMatch(arrowRule, /vertical-align:\s*(?:super|top|text-top)/);
  assert.match(iconRule, /width:\s*0\.62em;/);
  assert.match(iconRule, /height:\s*0\.62em;/);
  assert.match(interactionRule, /color:\s*var\(--surface-canvas\);/);
  assert.match(interactionRule, /background:\s*var\(--accent-colour\);/);
  assert.match(interactionRule, /outline:\s*0;/);
  assert.doesNotMatch(styles,
    /\.markdown-page-layer\.is-(?:source|live-preview)[^{]*markdown-page-link-navigation/);
});

test('one PageView controller survives rerenders and destroy removes its arrows', () => {
  const rendered = renderEditableDocument('[Link](https://example.com/)', 'source');
  const controller = rendered.state.linkArrowController;
  const first = navigationControls(rendered.bodyRoot)[0];
  for (let index = 0; index < 100; index += 1) {
    rendered.view.refreshEditableProjection(rendered.state);
    assert.equal(rendered.state.linkArrowController, controller);
    assert.equal(navigationControls(rendered.bodyRoot)[0], first);
  }
  rendered.state.page = { id: 'replacement-page' };
  rendered.view.refreshEditableProjection(rendered.state);
  assert.equal(rendered.state.linkArrowController, controller);
  controller.destroy();
  assert.equal(navigationControls(rendered.bodyRoot).length, 0);
  assert.equal(rendered.bodyRoot.contains(first), false);
});

test('formatted Live link keeps one arrow at the current inactive and complete active edge', () => {
  const source = '[**Bold**](https://example.com/)';
  const mounted = mountedLiveLink(source);
  const link = mounted.plan.constructs.links[0];
  const inactive = assertArrowForLink(mounted.bodyRoot, link, 'formatted inactive Live');
  const ownerId = mounted.state.editablePresentationPlan.constructs.links[0].ownerId;
  mounted.state.editableActiveOwnerIds = new Set([ownerId]);
  mounted.view.refreshEditableProjection(mounted.state);
  const activeLink = mounted.state.editablePresentationPlan.constructs.links[0];
  const active = assertArrowForLink(mounted.bodyRoot, activeLink, 'formatted active Live');
  assert.equal(active.control, inactive.control);
  assert.notEqual(active.rightEdgeAnchor, inactive.rightEdgeAnchor);
  const activeLeaf = mounted.state.editableProjection.enumerateProjectedLeaves()
    .find((leaf) => leaf.element === active.rightEdgeAnchor);
  assert.equal(Number(activeLeaf?.sourceEnd ?? sourceRange(active.rightEdgeAnchor).end),
    source.length);
  assert.equal(plannedSource({
    sourceSnapshot: mounted.state.sourceSnapshot,
    plan: mounted.state.editablePresentationPlan
  }), source);
});

test('invalid Markdown link destinations remain exact and cannot navigate', () => {
  const source = '[Unsafe](javascript:alert(1))';
  const readingActivations = [];
  const reading = readingRender(source, {
    onLinkActivate(detail) { readingActivations.push(detail); }
  });
  const readingLink = elements(reading.nodes, 'markdown-page-link')[0];
  dispatchOwn(readingLink, 'click');
  assert.equal(readingActivations.length, 0);
  const liveActivations = [];
  const live = mountedLiveLink(source, {
    onLinkActivate(detail) { liveActivations.push(detail); }
  });
  const unsafe = live.plan.constructs.links[0];
  const navigation = elements(live.nodes, 'markdown-page-link-navigation')[0];
  assert.equal(unsafe.safeHref, '');
  assert.equal(navigation.attributes['aria-disabled'], 'true');
  assert.equal(navigation.tabIndex, -1);
  dispatchOwn(navigation, 'click');
  assert.equal(liveActivations.length, 0);
  assert.equal(plannedSource(live), source);
});

test('Table inactive and active presentations move the same arrow for x100 cycles', () => {
  const source = ['| Link |', '| --- |', '| [OpenAI](https://openai.com) |'].join('\n');
  const activations = [];
  const rendered = renderEditableDocument(source, 'live-preview', {
    onLinkActivate(detail) { activations.push(detail); }
  });
  const controller = rendered.state.linkArrowController;
  const retained = navigationControls(rendered.bodyRoot)[0];
  withArrowMutationAudit(rendered.bodyRoot, 1, () => {
    for (let index = 0; index < 100; index += 1) {
      const inactiveLink = rendered.state.editablePresentationPlan.constructs.links[0];
      const inactive = assertArrowForLink(rendered.bodyRoot, inactiveLink, `Table inactive ${index + 1}`);
      assert.equal(inactive.control, retained);
      assert.ok(inactive.rightEdgeAnchor.classList.contains('markdown-page-link'));
      assert.equal(retained.closest('td')?.dataset.markdownEditableTableCellActive, 'false');
      const table = rendered.state.editablePresentationPlan.constructs.tables[0];
      rendered.state.editableActiveTableCell = {
        tableStart: table.start,
        header: false,
        rowIndex: 0,
        columnIndex: 0
      };
      rendered.view.refreshEditableProjection(rendered.state);
      const activeLink = rendered.state.editablePresentationPlan.constructs.links[0];
      const active = assertArrowForLink(rendered.bodyRoot, activeLink, `Table active ${index + 1}`);
      assert.equal(active.control, retained);
      assert.notEqual(active.rightEdgeAnchor, inactive.rightEdgeAnchor);
      assert.equal(retained.closest('td')?.dataset.markdownEditableTableCellActive, 'true');
      assert.equal(rendered.state.linkArrowController, controller);
      assert.equal(rendered.view.clearEditableLiveActiveState(rendered.state), true);
      assert.deepEqual(navigationControls(rendered.bodyRoot), [retained]);
    }
  });
  dispatchOwn(retained, 'click');
  assert.equal(activations[0].href, 'https://openai.com');
  assert.equal(plannedSource({
    sourceSnapshot: rendered.state.sourceSnapshot,
    plan: rendered.state.editablePresentationPlan
  }), source);
});

test('Source owns exact raw table rows while Live and Reading own one approved semantic table', () => {
  const source = [
    '| Molecule | Role        |',
    '| -------- | ----------- |',
    '| ATP      | Energy      |',
    '| DNA      | Information |'
  ].join('\n');
  const reading = readingRender(source);
  const semanticTables = elements(reading.nodes, 'markdown-page-table');
  assert.equal(elements(reading.nodes, 'markdown-page-table-source').length, 0);
  assert.equal(semanticTables.length, 1);
  assert.equal(semanticTables[0].tagName, 'TABLE');
  assert.equal(reading.rendered.state.body, source);
  const sourceMode = projected(source, 'source');
  const sourceTable = sourceMode.plan.constructs.tables[0];
  assert.equal(sourceTable.activeRaw, true);
  assert.equal(sourceTable.controls.length, 0);
  assert.equal(plannedSource(sourceMode), source);
  assert.ok(sourceMode.projection.enumerateProjectedLeaves().every((leaf) => (
    leaf.kind === 'table-raw-source'
      && leaf.visibility === 'visible'
      && leaf.text === source.slice(leaf.sourceStart, leaf.sourceEnd)
  )));
  const live = projected(source);
  const liveTable = live.plan.constructs.tables[0];
  assert.equal(liveTable.activeRaw, false);
  assert.deepEqual(liveTable.controls.map((control) => control.kind), [
    'append-column',
    'append-row'
  ]);
  assert.ok(liveTable.controls.every((control) => (
    control.semanticOnly && control.contentEditable === false
  )));
  assert.equal(plannedSource(live), source);
  const tableMount = functionSource('mountEditableTablePresentations');
  assert.match(tableMount, /appendAstTable\(/);
  assert.match(tableMount, /if \(tablePlan\.activeRaw \|\| tablePlan\.invalid\) return;/);
});

test('Source table whitespace-only cells own each canonical byte exactly once', () => {
  const source = [
    '| A | B | C | Empty |',
    '| - | - | - | - |',
    '| 1 | 2 | 3 | |',
    '| 4 | 5 | 6 |    |'
  ].join('\n');
  const result = projected(source, 'source');
  const leaves = result.projection.enumerateProjectedLeaves();
  assert.equal(plannedSource(result), source);
  assert.equal(result.sourceSnapshot.markdownBody, source);
  result.plan.lines.forEach((line) => {
    const lineLeaves = leaves.filter((leaf) => (
      String(leaf.physicalLineId) === String(line.physicalLineId)
    ));
    assert.equal(lineLeaves[0].sourceStart, line.start);
    assert.equal(lineLeaves.at(-1).sourceEnd, line.contentEnd);
    for (let index = 1; index < lineLeaves.length; index += 1) {
      assert.equal(lineLeaves[index - 1].sourceEnd, lineLeaves[index].sourceStart);
    }
    assert.equal(lineLeaves.map((leaf) => leaf.text).join(''), line.text);
  });
  leaves.forEach((leaf) => {
    assert.equal(leaf.text, source.slice(leaf.sourceStart, leaf.sourceEnd));
  });
});

test('Live table exposes exact canonical cell leaves and anchors without raw delimiter ownership', () => {
  const source = ['| A | B |', '| - | - |', '| 1 | 2 |', '| | 4 |'].join('\n');
  const result = projected(source);
  const table = result.plan.constructs.tables[0];
  const leaves = result.projection.enumerateProjectedLeaves();
  const cellLeaves = leaves.filter((leaf) => leaf.kind === 'table-cell');
  const structuralLeaves = leaves.filter((leaf) => leaf.kind === 'table-structural-source');
  assert.equal(table.cells.length, 6);
  assert.ok(table.cells.every((cell) => cell.canonical));
  table.cells.forEach((cell) => {
    assert.equal(cell.source, source.slice(cell.start, cell.end));
    assert.ok(cell.outerStart <= cell.start && cell.end <= cell.outerEnd);
  });
  assert.deepEqual(cellLeaves.map((leaf) => leaf.text), ['A', 'B', '1', '2', '4']);
  cellLeaves.forEach((leaf) => {
    const start = result.projection.domToSource(leaf.textNode, 0, { allowRowFallback: false });
    const end = result.projection.domToSource(leaf.textNode, leaf.domText.length, {
      allowRowFallback: false
    });
    assert.equal(start.offset, leaf.sourceStart);
    assert.equal(end.offset, leaf.sourceEnd);
  });
  assert.ok(structuralLeaves.every((leaf) => (
    leaf.visibility === 'source-only'
      && leaf.interactionPolicy === 'activate-table-source'
  )));
  const emptyAnchor = result.projection.enumeratePlanActivationAnchors().find((anchor) => (
    anchor.kind === 'table-empty-cell'
  ));
  assert.ok(emptyAnchor);
  const declared = result.projection.enumerateDeclaredPositions().find((position) => (
    position.offset === emptyAnchor.position.offset
      && position.affinity === emptyAnchor.position.affinity
  ));
  assert.ok(samePosition(declared, emptyAnchor.position));
  assert.equal(plannedSource(result), source);
  assert.match(styles, /\.markdown-editable-table-presentation/);
});
