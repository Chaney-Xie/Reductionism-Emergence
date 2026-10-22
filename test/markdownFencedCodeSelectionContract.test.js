'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const markdown = require('../public/markdownPage');
const {
  buildEditablePresentationPlan,
  validateEditablePresentationPlan
} = require('../public/js/markdownEditableSyntaxAdapters');
const {
  createCertificationProjection,
  positionKey,
  samePosition
} = require('./helpers/markdownEditableCertificationHarness');

const fixture = [
  '```javascript',
  'const formula = "$x^2$";',
  'function test(value) {',
  '  return value + 1;',
  '}',
  '```'
].join('\n');

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
      `physical row ${line.index} is not an exact canonical projection`
    );
    line.leaves.forEach((leaf) => {
      assert.equal(leaf.text, snapshot.markdownBody.slice(leaf.sourceStart, leaf.sourceEnd));
    });
  });
}

function codeAnchors(plan, ownerId = null) {
  return plan.lines.flatMap((line) => line.anchors).filter((anchor) => (
    anchor.kind === 'code-block-rendered-activation'
      && (ownerId == null || anchor.ownerId === ownerId)
  ));
}

function installPlanAwarePointer(document, root) {
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

function certifyActiveCodePlan(snapshot, activePlan) {
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

test('fenced code keeps one immutable canonical range and one exact activation anchor', () => {
  const { snapshot, plan } = planned(fixture);
  const astCode = snapshot.semanticIndex.ownersOfType('code')[0];
  const fence = markdown.codeFenceRanges(fixture, astCode.node);
  const code = plan.constructs.codeBlocks[0];

  assertExactPlan(snapshot, plan);
  assert.equal(snapshot.semanticIndex.ownerByNode(code.node).id, code.ownerId);
  assert.equal(code.ownerId, astCode.id);
  assert.equal(code.fenced, true);
  assert.equal(code.start, fence.start);
  assert.equal(code.end, fence.end);
  assert.equal(code.raw, fixture.slice(fence.start, fence.end));
  assert.equal(code.openingRange.source, fixture.slice(fence.start, fence.bodyStart));
  assert.equal(code.bodySource, fixture.slice(fence.bodyStart, fence.bodyEnd));
  assert.equal(code.closingRange.source, fixture.slice(fence.closingStart, fence.end));
  assert.equal(code.activationStrategy, 'non-proportional-exact-anchor');
  assert.equal(code.activationAnchor.offset, fence.bodyStart);
  assert.equal(code.activationAnchor.semanticOwnerId, code.ownerId);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(code), true);
  assert.equal(Object.isFrozen(code.openingRange), true);

  const anchors = codeAnchors(plan, code.ownerId);
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].position.offset, fence.bodyStart);
  assert.equal(anchors[0].activationStrategy, 'non-proportional-exact-anchor');
  assert.ok(plan.lines.flatMap((line) => line.leaves)
    .filter((leaf) => leaf.semanticOwnerId === code.ownerId)
    .every((leaf) => leaf.kind === 'code-block-hidden-source'
      && leaf.visibility === 'activatable'));

  const activePlan = buildEditablePresentationPlan(snapshot, {
    model: markdown,
    mode: 'live-preview',
    activeOwnerIds: [code.ownerId]
  });
  assert.equal(activePlan.constructs.codeBlocks[0].activationAnchor, null);
  assert.equal(activePlan.constructs.codeBlocks[0].presentation.layout, 'source-only');
  assert.ok(activePlan.lines.flatMap((line) => line.leaves)
    .filter((leaf) => leaf.semanticOwnerId === code.ownerId)
    .every((leaf) => [
      'code-block-marker',
      'code-block-info',
      'code-block-content',
      'empty-row'
    ].includes(leaf.kind) && leaf.visibility === 'visible'));
  certifyActiveCodePlan(snapshot, activePlan);
});

test('standalone fences and an indented-away opener own each canonical byte once', () => {
  for (const marker of ['~~~', '```']) {
    const { snapshot, plan } = planned(marker);
    const code = plan.constructs.codeBlocks[0];
    assertExactPlan(snapshot, plan);
    assert.equal(code.raw, marker);
    assert.equal(code.start, 0);
    assert.equal(code.end, marker.length);
    assert.equal(code.bodyStart, marker.length);
    assert.equal(code.bodyEnd, marker.length);
    assert.equal(code.closingStart, marker.length);
    assert.equal(code.closed, false);
    assert.equal(codeAnchors(plan, code.ownerId).length, 1);
    assert.equal(code.activationAnchor.offset, marker.length);
  }

  const source = '    ~~~js\nconst x = 1;\n~~~';
  const { snapshot, plan } = planned(source);
  const [indented, standalone] = plan.constructs.codeBlocks;
  assertExactPlan(snapshot, plan);
  assert.equal(indented.fenced, false);
  assert.equal(indented.raw, '    ~~~js');
  assert.equal(standalone.fenced, true);
  assert.equal(standalone.raw, '~~~');
  assert.equal(standalone.start, source.length - 3);
  assert.equal(standalone.end, source.length);
  assert.ok(indented.end <= standalone.start, 'code owners must not overlap');
  assert.equal(codeAnchors(plan).length, 2);

  const sourcePlan = buildEditablePresentationPlan(snapshot, {
    model: markdown,
    mode: 'source'
  });
  assertExactPlan(snapshot, sourcePlan);
  assert.equal(codeAnchors(sourcePlan).length, 0);
  assert.ok(sourcePlan.constructs.codeBlocks.every((code) => (
    code.activationAnchor === null
      && code.presentation.layout === 'source-only'
  )));
});

test('dollar-delimited code has no math owner while Reading keeps semantic code output', () => {
  const { snapshot, plan } = planned(fixture);
  assertExactPlan(snapshot, plan);
  assert.equal(snapshot.semanticIndex.ownersOfType('inlineMath', 'math').length, 0);
  assert.equal(plan.constructs.math.length, 0);

  const html = markdown.renderMarkdown(fixture);
  assert.match(html, /markdown-page-code-shell is-fenced/);
  assert.match(html, /markdown-page-code-block/);
  assert.match(html, /\$x\^2\$/);
  assert.doesNotMatch(html, /markdown-math-(?:inline|display|rendered|source)/);
  assert.doesNotMatch(html, /data-math-source/);
});

test('empty unclosed fenced code uses the canonical terminal row and an exact plan anchor', () => {
  const source = '```js\n';
  const { snapshot, plan } = planned(source);
  const code = plan.constructs.codeBlocks[0];
  const terminal = snapshot.physicalLineIndex.lines.at(-1);

  assertExactPlan(snapshot, plan);
  assert.equal(code.raw, source);
  assert.equal(code.bodyStart, source.length);
  assert.equal(code.bodyEnd, source.length);
  assert.equal(code.closingStart, source.length);
  assert.equal(code.closed, false);
  assert.equal(code.activationAnchor.offset, source.length);
  assert.equal(code.activationAnchor.physicalLineId, terminal.id);
  assert.equal(terminal.start, source.length);
  assert.equal(terminal.text, '');
  assert.equal(codeAnchors(plan, code.ownerId).length, 1);

  const { document, root, projection } = createCertificationProjection(
    snapshot,
    'live-preview',
    { presentationPlan: plan }
  );
  const projectedTerminal = projection.enumerateProjectedLeaves().find((leaf) => (
    leaf.physicalLineId === terminal.id
  ));
  assert.ok(projectedTerminal);
  assert.equal(projectedTerminal.sourceStart, source.length);
  assert.equal(projectedTerminal.sourceEnd, source.length);
  assert.equal(projectedTerminal.emptyCaretHost, true);
  assert.equal(projectedTerminal.domText, '\u200b');

  const planAnchor = projection.enumeratePlanActivationAnchors().find((anchor) => (
    anchor.ownerId === code.ownerId
  ));
  assert.ok(planAnchor);
  const semanticCode = document.createElement('code');
  semanticCode.append(document.createTextNode('rendered empty code'));
  root.append(semanticCode);
  const registered = projection.registerPlanActivationAnchor(semanticCode, planAnchor);
  assert.ok(registered);
  assert.equal(registered.offset, source.length);
  assert.equal(semanticCode.attributes.contenteditable, 'false');
  for (const localOffset of [0, semanticCode.firstChild.nodeValue.length]) {
    const mapped = projection.domToSource(semanticCode.firstChild, localOffset, {
      allowRowFallback: false
    });
    assert.ok(samePosition(mapped, planAnchor.position));
  }
  const pointed = projection.pointerToPosition({
    target: semanticCode,
    clientX: 10_000,
    clientY: 10_000
  });
  assert.ok(samePosition(pointed, planAnchor.position),
    'rendered code maps to its one exact anchor, never a proportional character guess');
});

test('fence, code-body, and closing points round-trip only through EditableProjection', () => {
  const { snapshot } = planned(fixture);
  const owner = snapshot.semanticIndex.ownersOfType('code')[0];
  const fence = markdown.codeFenceRanges(fixture, owner.node);
  const activePlan = buildEditablePresentationPlan(snapshot, {
    model: markdown,
    mode: 'live-preview',
    activeOwnerIds: [owner.id]
  });
  const { projection } = certifyActiveCodePlan(snapshot, activePlan);
  const bodyProbe = fence.bodyStart
    + fixture.slice(fence.bodyStart, fence.bodyEnd).indexOf('$x^2$') + 3;
  const offsets = [
    fence.start,
    fence.fenceEnd,
    fence.infoEnd,
    fence.bodyStart,
    bodyProbe,
    fence.bodyEnd,
    fence.closingStart,
    fence.end
  ];

  for (const offset of offsets) {
    const position = projection.enumerateDeclaredPositions().find((candidate) => (
      candidate.offset === offset
    ));
    assert.ok(position, `missing declared position at ${offset}`);
    const dom = projection.sourceToDom(position);
    assert.ok(dom, `missing DOM projection at ${offset}`);
    const roundTrip = projection.domToSource(dom.node, dom.offset, {
      allowRowFallback: false
    });
    assert.ok(samePosition(position, roundTrip), `round trip changed offset ${offset}`);
    assert.equal(positionKey(position), positionKey(roundTrip));
  }
});

test('CRLF fenced, indented, and unclosed code retain exact source and P/K/V after activation', async (t) => {
  const cases = [
    {
      name: 'closed fenced CRLF',
      source: '```javascript meta words\r\nconst x = `a`;\r\n```\r\n',
      fenced: true,
      closed: true,
      language: 'javascript',
      meta: 'meta words',
      bodySource: 'const x = `a`;\r\n'
    },
    {
      name: 'indented CRLF',
      source: '    first\r\n    second\r\n',
      fenced: false,
      closed: false,
      language: '',
      meta: '',
      bodySource: '    first\r\n    second'
    },
    {
      name: 'unclosed fenced CRLF',
      source: '~~~js\r\nunclosed\r\n',
      fenced: true,
      closed: false,
      language: 'js',
      meta: '',
      bodySource: 'unclosed\r\n'
    }
  ];

  for (const fixtureCase of cases) {
    await t.test(fixtureCase.name, () => {
      const { snapshot, plan } = planned(fixtureCase.source);
      const code = plan.constructs.codeBlocks[0];
      assertExactPlan(snapshot, plan);
      assert.equal(code.fenced, fixtureCase.fenced);
      assert.equal(code.closed, fixtureCase.closed);
      assert.equal(code.language, fixtureCase.language);
      assert.equal(code.meta, fixtureCase.meta);
      assert.equal(code.bodySource, fixtureCase.bodySource);
      assert.equal(code.raw, fixtureCase.source.slice(code.start, code.end));
      assert.equal(codeAnchors(plan, code.ownerId).length, 1);
      assert.equal(code.activationAnchor.offset, code.anchorOffset);

      const sourcePlan = buildEditablePresentationPlan(snapshot, {
        model: markdown,
        mode: 'source'
      });
      assertExactPlan(snapshot, sourcePlan);
      assert.equal(sourcePlan.constructs.codeBlocks[0].activationAnchor, null);
      assert.ok(sourcePlan.lines.flatMap((line) => line.leaves)
        .every((leaf) => leaf.visibility === 'visible'));

      const activePlan = buildEditablePresentationPlan(snapshot, {
        model: markdown,
        mode: 'live-preview',
        activeOwnerIds: [code.ownerId]
      });
      const certification = certifyActiveCodePlan(snapshot, activePlan).certification;
      assert.equal(certification.equal, true);
      assert.equal(certification.P.length,
        snapshot.physicalLineIndex.lines.reduce((total, line) => total + line.text.length + 1, 0));
    });
  }
});
