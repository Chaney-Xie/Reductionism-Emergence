'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const markdown = require('../public/markdownPage');
const {
  SEMANTIC_PRESENTATION_KEYS,
  buildEditablePresentationPlan,
  validateEditablePresentationPlan
} = require('../public/js/markdownEditableSyntaxAdapters');
const {
  createCertificationProjection,
  positionKey,
  samePosition
} = require('./helpers/markdownEditableCertificationHarness');

function planned(source, mode = 'live-preview', options = {}) {
  const snapshot = markdown.createSourceSnapshot(source);
  const plan = buildEditablePresentationPlan(snapshot, {
    model: markdown,
    mode,
    ...options
  });
  return { snapshot, plan };
}

function assertExactPlan(snapshot, plan) {
  const validation = validateEditablePresentationPlan(plan, snapshot);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.equal(plan.markdownBody, snapshot.markdownBody);
  plan.lines.forEach((line) => {
    assert.equal(
      line.leaves.map((leaf) => leaf.text).join(''),
      snapshot.markdownBody.slice(line.start, line.contentEnd),
      `physical row ${line.index} must contain exact canonical slices`
    );
    line.leaves.forEach((leaf) => {
      assert.equal(leaf.text, snapshot.markdownBody.slice(leaf.sourceStart, leaf.sourceEnd));
    });
  });
}

function leavesForRange(plan, start, end) {
  return plan.lines.flatMap((line) => line.leaves).filter((leaf) => (
    leaf.sourceStart < end && start < leaf.sourceEnd
  ));
}

function installSingleLeafPointer(document, root) {
  document.caretPositionFromPoint = (clientX, clientY) => {
    const rowIndex = Math.max(
      0,
      Math.min(root.childNodes.length - 1, Math.floor(clientY / 22))
    );
    const row = root.childNodes[rowIndex] || null;
    if (!row) return null;
    const emptyHost = row.childNodes.find((child) => (
      child.dataset?.markdownEmptyCaretHost === 'true'
    ));
    if (emptyHost) return { offsetNode: emptyHost.firstChild, offset: 0 };
    const leaf = row.childNodes.find((child) => (
      child.dataset?.markdownProjectedLeaf === 'true'
    ));
    const text = leaf?.firstChild || null;
    if (!text) return null;
    return {
      offsetNode: text,
      offset: Math.max(0, Math.min(
        String(text.nodeValue || '').length,
        Math.round(clientX / 8)
      ))
    };
  };
}

function certifySingleConstruct(snapshot, activePlan) {
  const { document, root, projection } = createCertificationProjection(
    snapshot,
    'live-preview',
    { presentationPlan: activePlan }
  );
  const certification = projection.certifyPositions();
  assert.equal(certification.equal, true, certification.failures.map((failure) => (
    failure.key
  )).join('\n'));
  assert.deepEqual(certification.P, certification.K);
  assert.deepEqual(certification.K, certification.V);
  return { document, root, projection, certification };
}

test('escaped punctuation stays ordinary AST text with exact independent escape plans', () => {
  const source = 'Escaped symbols: \\*not italic\\*,  \\# not a heading.';
  const { snapshot, plan } = planned(source);
  const paragraph = snapshot.parserAst.children[0];
  const escapes = plan.constructs.escapes;

  assert.equal(paragraph.type, 'paragraph');
  assert.deepEqual(paragraph.children.map((node) => node.type), ['text']);
  assert.equal(snapshot.semanticIndex.ownersOfType('heading', 'emphasis').length, 0);
  assert.equal(plan.constructs.headings.length, 0);
  assert.equal(plan.constructs.emphasis.length, 0);
  assertExactPlan(snapshot, plan);
  assert.deepEqual(escapes.map((escape) => [
    escape.raw,
    escape.start,
    escape.end,
    escape.value,
    escape.anchorOffset
  ]), [
    ['\\*', 17, 19, '*', 18],
    ['\\*', 29, 31, '*', 30],
    ['\\#', 34, 36, '#', 35]
  ]);
  escapes.forEach((escape) => {
    assert.equal(snapshot.semanticIndex.ownerByNode(escape.node).id, escape.ownerId);
    assert.equal(escape.presentationOwned, true);
    assert.equal(escape.presentation.layout, 'rendered-only');
    assert.equal(escape.activationAnchor.offset, escape.anchorOffset);
    assert.equal(escape.activationAnchor.semanticOwnerId, escape.ownerId);
    assert.ok(leavesForRange(plan, escape.start, escape.end).every((leaf) => (
      leaf.kind === 'escape-hidden-source'
        && leaf.visibility === 'activatable'
        && leaf.interactionPolicy === 'activate-owner'
    )));
  });

  const activePlan = buildEditablePresentationPlan(snapshot, {
    model: markdown,
    mode: 'live-preview',
    activeOwnerIds: [escapes[0].ownerId]
  });
  assertExactPlan(snapshot, activePlan);
  assert.ok(activePlan.constructs.escapes.every((escape) => (
    escape.active
      && escape.activationAnchor === null
      && escape.presentation.layout === 'source-only'
  )), 'one text owner reveals all of its exact escape bytes together');
  const { projection } = createCertificationProjection(snapshot, 'live-preview', {
    presentationPlan: activePlan
  });
  projection.enumerateDeclaredPositions().forEach((position) => {
    const dom = projection.sourceToDom(position);
    const restored = dom && projection.domToSource(dom.node, dom.offset, {
      allowRowFallback: false
    });
    assert.ok(samePosition(position, restored), positionKey(position));
  });

  const sourcePlan = buildEditablePresentationPlan(snapshot, {
    model: markdown,
    mode: 'source'
  });
  assertExactPlan(snapshot, sourcePlan);
  assert.ok(sourcePlan.constructs.escapes.every((escape) => (
    escape.activationAnchor === null && escape.presentation.layout === 'source-only'
  )));
  assert.ok(sourcePlan.lines.flatMap((line) => line.leaves)
    .every((leaf) => leaf.visibility === 'visible'));
  assert.equal(markdown.renderMarkdown(source),
    '<p>Escaped symbols: *not italic*,  # not a heading.</p>');
});

test('heading, emphasis, strong, strike, and escape presentations activate through one exact anchor', async (t) => {
  const cases = [
    {
      name: 'heading',
      key: 'headings',
      source: '# Heading',
      kind: 'heading',
      tagName: 'h1',
      html: '<h1>Heading</h1>'
    },
    {
      name: 'emphasis',
      key: 'emphasis',
      source: '*emphasis*',
      kind: 'emphasis',
      tagName: 'em',
      html: '<p><em>emphasis</em></p>'
    },
    {
      name: 'strong',
      key: 'strong',
      source: '**strong**',
      kind: 'strong',
      tagName: 'strong',
      html: '<p><strong>strong</strong></p>'
    },
    {
      name: 'strike',
      key: 'strikethrough',
      source: '~~strike~~',
      kind: 'strikethrough',
      tagName: 'del',
      html: '<p><del>strike</del></p>'
    },
    {
      name: 'escape',
      key: 'escapes',
      source: '\\*',
      kind: 'escape',
      tagName: 'span',
      html: '<p>*</p>'
    }
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const { snapshot, plan } = planned(fixture.source);
      const construct = plan.constructs[fixture.key][0];
      assertExactPlan(snapshot, plan);
      assert.equal(construct.raw, fixture.source);
      assert.equal(construct.kind, fixture.kind);
      assert.equal(construct.presentation.role, fixture.kind);
      assert.equal(construct.presentation.tagName, fixture.tagName);
      assert.equal(construct.presentation.layout, 'rendered-only');
      assert.equal(construct.presentationOwned, true);
      assert.equal(construct.activationAnchor.offset, construct.anchorOffset);
      assert.equal(construct.activationAnchor.interactionPolicy, 'activate-owner');
      assert.equal(snapshot.semanticIndex.ownerByNode(construct.node).id, construct.ownerId);
      assert.equal(Object.isFrozen(construct), true);
      assert.equal(Object.isFrozen(construct.presentation), true);

      const inactiveProjection = createCertificationProjection(
        snapshot,
        'live-preview',
        { presentationPlan: plan }
      );
      const anchors = inactiveProjection.projection.enumeratePlanActivationAnchors()
        .filter((anchor) => anchor.ownerId === construct.ownerId);
      assert.equal(anchors.length, 1);
      assert.equal(anchors[0].position.offset, construct.anchorOffset);
      const semantic = inactiveProjection.document.createElement(fixture.tagName);
      semantic.append(inactiveProjection.document.createTextNode(
        'semantic presentation with unrelated geometry'
      ));
      inactiveProjection.root.append(semantic);
      const registered = inactiveProjection.projection.registerPlanActivationAnchor(
        semantic,
        anchors[0]
      );
      assert.ok(registered);
      assert.equal(semantic.attributes.contenteditable, 'false');
      for (const localOffset of [0, semantic.firstChild.nodeValue.length]) {
        const mapped = inactiveProjection.projection.domToSource(
          semantic.firstChild,
          localOffset,
          { allowRowFallback: false }
        );
        assert.ok(samePosition(mapped, anchors[0].position));
      }
      assert.ok(samePosition(
        inactiveProjection.projection.pointerToPosition({
          target: semantic,
          clientX: 9_999,
          clientY: 9_999
        }),
        anchors[0].position
      ), 'presentation pointer ownership is exact rather than proportional');

      const activePlan = buildEditablePresentationPlan(snapshot, {
        model: markdown,
        mode: 'live-preview',
        activeOwnerIds: [construct.ownerId]
      });
      const active = activePlan.constructs[fixture.key][0];
      assert.equal(active.presentation.layout, 'source-only');
      assert.equal(active.activationAnchor, null);
      const activeLeaves = leavesForRange(activePlan, active.start, active.end);
      assert.ok(activeLeaves.every((leaf) => leaf.visibility === 'visible'));
      assert.ok(activeLeaves.some((leaf) => leaf.kind === `${fixture.kind}-marker`));
      assert.ok(activeLeaves.some((leaf) => leaf.kind === `${fixture.kind}-content`));
      assert.ok(activeLeaves.flatMap((leaf) => leaf.semanticRoles)
        .some((role) => role.family === fixture.kind && role.role === 'marker'));
      assert.ok(activeLeaves.flatMap((leaf) => leaf.semanticRoles)
        .some((role) => role.family === fixture.kind && role.role === 'content'));
      const certification = certifySingleConstruct(snapshot, activePlan).certification;
      assert.equal(certification.P.length, fixture.source.length + 1);
      assert.equal(markdown.renderMarkdown(fixture.source), fixture.html);
    });
  }
});

test('nested inline formatting has one top-level presentation owner and exact raw activation', () => {
  const source = '# Heading **strong *emphasis* and ~~strike~~**';
  const { snapshot, plan } = planned(source);
  const heading = plan.constructs.headings[0];
  const nested = [
    ...plan.constructs.strong,
    ...plan.constructs.emphasis,
    ...plan.constructs.strikethrough
  ];

  assertExactPlan(snapshot, plan);
  assert.equal(heading.presentationOwned, true);
  assert.equal(heading.raw, source);
  assert.equal(heading.presentation.layout, 'rendered-only');
  nested.forEach((construct) => {
    assert.equal(construct.presentationOwned, false);
    assert.equal(construct.suppressedByOwnerId, heading.ownerId);
    assert.equal(construct.suppressionReason, 'nested-presentation-owner');
    assert.equal(construct.activationAnchor, null);
    assert.equal(construct.presentation.layout, 'source-only');
  });
  const owned = SEMANTIC_PRESENTATION_KEYS.flatMap((key) => plan.constructs[key])
    .filter((construct) => construct.presentationOwned);
  assert.deepEqual(owned.map((construct) => construct.presentationId), [heading.presentationId]);

  const activePlan = buildEditablePresentationPlan(snapshot, {
    model: markdown,
    mode: 'live-preview',
    activeOwnerIds: [heading.ownerId]
  });
  assert.equal(activePlan.constructs.headings[0].presentation.layout, 'source-only');
  assert.equal(activePlan.constructs.headings[0].activationAnchor, null);
  assert.ok(activePlan.lines.flatMap((line) => line.leaves)
    .every((leaf) => leaf.visibility === 'visible'));
  certifySingleConstruct(snapshot, activePlan);
  assert.equal(markdown.renderMarkdown(source),
    '<h1>Heading <strong>strong <em>emphasis</em> and <del>strike</del></strong></h1>');
});

test('Source mode preserves every approved marker byte while Live presentation remains downstream', () => {
  const source = [
    '## Heading',
    '',
    '*emphasis*',
    '',
    '**strong**',
    '',
    '~~strike~~',
    '',
    '\\*literal\\*'
  ].join('\r\n');
  const { snapshot } = planned(source);
  const sourcePlan = buildEditablePresentationPlan(snapshot, {
    model: markdown,
    mode: 'source'
  });
  assertExactPlan(snapshot, sourcePlan);
  assert.equal(sourcePlan.lines.map((line) => line.text).join('\r\n'), source);
  assert.equal(sourcePlan.lines.flatMap((line) => line.anchors).length, 0);
  assert.ok(sourcePlan.lines.flatMap((line) => line.leaves)
    .every((leaf) => leaf.visibility === 'visible'));
  assert.ok(sourcePlan.lines.flatMap((line) => line.leaves)
    .filter((leaf) => leaf.sourceEnd > leaf.sourceStart)
    .every((leaf) => leaf.interactionPolicy === 'editable-text'));
  assert.deepEqual({
    heading: sourcePlan.constructs.headings[0].raw,
    emphasis: sourcePlan.constructs.emphasis[0].raw,
    strong: sourcePlan.constructs.strong[0].raw,
    strike: sourcePlan.constructs.strikethrough[0].raw,
    escapes: sourcePlan.constructs.escapes.map((escape) => escape.raw)
  }, {
    heading: '## Heading',
    emphasis: '*emphasis*',
    strong: '**strong**',
    strike: '~~strike~~',
    escapes: ['\\*', '\\*']
  });

  const projection = createCertificationProjection(snapshot, 'source', {
    presentationPlan: sourcePlan
  }).projection;
  projection.enumerateDeclaredPositions().forEach((position) => {
    const dom = projection.sourceToDom(position);
    const roundTrip = dom && projection.domToSource(dom.node, dom.offset, {
      allowRowFallback: false
    });
    assert.ok(samePosition(position, roundTrip), positionKey(position));
  });
});

test('thematic breaks explicitly preserve the Viewer Source/Live policy without a Reading rule element', () => {
  const source = ['Before', '', '---', '', 'After'].join('\n');
  const sourceResult = planned(source, 'source');
  assertExactPlan(sourceResult.snapshot, sourceResult.plan);
  assert.equal(sourceResult.snapshot.semanticIndex.ownersOfType('thematicBreak').length, 1);
  const sourceBreak = sourceResult.plan.constructs.thematicBreaks[0];
  assert.equal(sourceBreak.presentation.layout, 'source-only');
  assert.deepEqual(sourceResult.plan.lines.find((line) => line.text === '---')
    .leaves.map((leaf) => [leaf.kind, leaf.text, leaf.visibility]), [
      ['thematic-break-marker', '---', 'visible']
    ]);

  const inactive = planned(source, 'live-preview');
  assertExactPlan(inactive.snapshot, inactive.plan);
  const inactiveBreak = inactive.plan.constructs.thematicBreaks[0];
  assert.deepEqual({
    sourceVisible: inactiveBreak.presentation.sourceVisible,
    renderedMounted: inactiveBreak.presentation.renderedMounted,
    layout: inactiveBreak.presentation.layout
  }, { sourceVisible: false, renderedMounted: false, layout: 'hidden' });
  assert.deepEqual(inactive.plan.lines.find((line) => line.text === '---')
    .leaves.map((leaf) => [leaf.kind, leaf.text, leaf.visibility]), [
      ['thematic-break-hidden-source', '---', 'activatable']
    ]);

  const active = planned(source, 'live-preview', {
    activeOwnerIds: [inactiveBreak.ownerId]
  }).plan;
  assert.deepEqual(active.lines.find((line) => line.text === '---')
    .leaves.map((leaf) => [leaf.kind, leaf.text, leaf.visibility]), [
      ['thematic-break-marker', '---', 'visible']
    ]);
  assert.equal(markdown.renderMarkdown('---'), '');
  assert.doesNotMatch(markdown.renderMarkdown(source), /<hr\b/i);
  assert.doesNotMatch(markdown.renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |'), /<hr\b/i);
});

test('Reading keeps approved semantics and safe embedded interaction markup', () => {
  const source = [
    '# Heading',
    '',
    '*emphasis* **strong** ~~strike~~ \\*literal\\*',
    '',
    '[Link](https://example.com/)',
    '',
    '```javascript',
    'const value = 1;',
    '```',
    '',
    '| A | B |',
    '|---|---|',
    '| 1 | 2 |'
  ].join('\n');
  const html = markdown.renderMarkdown(source);

  assert.match(html, /<h1>Heading<\/h1>/);
  assert.match(html, /<em>emphasis<\/em>/);
  assert.match(html, /<strong>strong<\/strong>/);
  assert.match(html, /<del>strike<\/del> \*literal\*/);
  assert.match(html, /<a href="https:\/\/example\.com\/" rel="noreferrer">Link<\/a>/);
  assert.match(html, /markdown-page-code-shell is-fenced/);
  assert.match(html, /<svg class="markdown-interaction-icon markdown-code-language-icon"/);
  assert.match(html, /<table>/);
  assert.doesNotMatch(html, /&lt;\/?svg/);
  assert.doesNotMatch(html, /<hr\b/i);
});
