'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const markdown = require('../public/markdownPage');
const {
  buildEditablePresentationPlan,
  validateEditablePresentationPlan
} = require('../public/js/markdownEditableSyntaxAdapters');
const {
  descendants,
  loadMarkdownPageViewInternals,
  renderSemanticSegments
} = require('./helpers/markdownFakeDom');

const view = loadMarkdownPageViewInternals([
  'semanticSyntaxSegments',
  'renderSemanticBlockContents'
]);

const VALID_FIXTURES = Object.freeze([
  {
    name: 'relative destination',
    source: '![alt](image.png)',
    expression: '![alt](image.png)',
    alt: 'alt',
    opening: '![',
    destination: '](image.png)'
  },
  {
    name: 'angle destination containing a space',
    source: '![Cell structure](<assets/cell image.png>)',
    expression: '![Cell structure](<assets/cell image.png>)',
    alt: 'Cell structure',
    opening: '![',
    destination: '](<assets/cell image.png>)'
  },
  {
    name: 'remote URL destination',
    source: '![x](https://example.com/a.png)',
    expression: '![x](https://example.com/a.png)',
    alt: 'x',
    opening: '![',
    destination: '](https://example.com/a.png)'
  },
  {
    name: 'missing local destination',
    source: '![missing](does-not-exist.png)',
    expression: '![missing](does-not-exist.png)',
    alt: 'missing',
    opening: '![',
    destination: '](does-not-exist.png)'
  },
  {
    name: 'destination with a title',
    source: '![alt](image.png "Image title")',
    expression: '![alt](image.png "Image title")',
    alt: 'alt',
    opening: '![',
    destination: '](image.png "Image title")'
  },
  {
    name: 'reference image',
    source: '![alt][ref]\n\n[ref]: image.png "Image title"',
    expression: '![alt][ref]',
    alt: 'alt',
    opening: '![',
    destination: '][ref]'
  }
]);

function imageOwner(snapshot) {
  const owners = snapshot.semanticIndex.ownersOfType('image', 'imageReference');
  assert.equal(owners.length, 1, 'fixture must contain exactly one parser-owned image node');
  return owners[0];
}

function presentationPlan(snapshot, mode, options = {}) {
  const plan = buildEditablePresentationPlan(snapshot, {
    model: markdown,
    mode,
    ...options
  });
  const validation = validateEditablePresentationPlan(plan, snapshot);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  return plan;
}

function plannedSource(snapshot, plan) {
  return plan.lines.map((line) => (
    line.leaves.map((leaf) => leaf.text).join('') + line.lineEnding
  )).join('').slice(0, snapshot.markdownBody.length);
}

function allLeaves(plan) {
  return plan.lines.flatMap((line) => line.leaves);
}

function exactLeaf(plan, start, end) {
  return allLeaves(plan).find((leaf) => (
    leaf.sourceStart === start && leaf.sourceEnd === end
  )) || null;
}

function roleKeys(leaf) {
  return (leaf?.semanticRoles || []).map((role) => `${role.family}:${role.role}`);
}

function readingRender(source) {
  const sourceSnapshot = markdown.createSourceSnapshot(source);
  const rendered = renderSemanticSegments(view, source, {
    mode: 'reading',
    sourceSnapshot,
    sourceVersion: sourceSnapshot.version
  });
  return {
    ...rendered,
    sourceSnapshot,
    nodes: rendered.blocks.flatMap((block) => descendants(block.element))
  };
}

function elementsWithClass(nodes, className) {
  return nodes.filter((node) => (
    node?.nodeType === 1 && node.classList.contains(className)
  ));
}

test('imageSourceRanges keeps exact source-backed marker, alt, and destination ranges', () => {
  for (const fixture of [
    ...VALID_FIXTURES,
    {
      name: 'escaped and nested alt brackets at a non-zero document offset',
      source: 'prefix ![a\\] [b]](x.png) suffix',
      expression: '![a\\] [b]](x.png)',
      alt: 'a\\] [b]',
      opening: '![',
      destination: '](x.png)'
    }
  ]) {
    const snapshot = markdown.createSourceSnapshot(fixture.source);
    const owner = imageOwner(snapshot);
    const ranges = markdown.imageSourceRanges(fixture.source, owner.node);

    assert.equal(ranges.recognized, true, `${fixture.name}: image range was not recognized`);
    assert.equal(ranges.start, owner.start, `${fixture.name}: start differs from parser ownership`);
    assert.equal(ranges.end, owner.end, `${fixture.name}: end differs from parser ownership`);
    assert.equal(ranges.raw, fixture.expression, `${fixture.name}: raw source is not exact`);
    assert.equal(
      fixture.source.slice(ranges.markerStart, ranges.markerEnd),
      fixture.opening,
      `${fixture.name}: opening source marker differs`
    );
    assert.equal(
      fixture.source.slice(ranges.altStart, ranges.altEnd),
      fixture.alt,
      `${fixture.name}: alt range differs`
    );
    assert.equal(
      fixture.source.slice(ranges.destinationStart, ranges.destinationEnd),
      fixture.destination,
      `${fixture.name}: destination range differs`
    );
    assert.equal(ranges.markerEnd, ranges.altStart);
    assert.equal(ranges.altEnd, ranges.destinationStart);
  }
});

test('Source and Live keep image syntax literal with Group 2 marker roles in every active state', () => {
  for (const fixture of VALID_FIXTURES) {
    const snapshot = markdown.createSourceSnapshot(fixture.source);
    const owner = imageOwner(snapshot);
    const ranges = markdown.imageSourceRanges(fixture.source, owner.node);
    const plans = [
      ['source', presentationPlan(snapshot, 'source'), false],
      ['live inactive', presentationPlan(snapshot, 'live-preview'), false],
      ['live active', presentationPlan(snapshot, 'live-preview', {
        activeOwnerIds: [owner.id]
      }), true]
    ];

    for (const [mode, plan, active] of plans) {
      assert.equal(plannedSource(snapshot, plan), fixture.source,
        `${fixture.name} / ${mode}: presentation changed canonical source`);
      assert.equal(plan.constructs.images.length, 1,
        `${fixture.name} / ${mode}: image presentation metadata is missing`);
      assert.equal(plan.constructs.links.length, 0,
        `${fixture.name} / ${mode}: image was reinterpreted as a link`);
      assert.equal(plan.controls.some((control) => control.kind === 'open-link'), false,
        `${fixture.name} / ${mode}: image gained link navigation control`);

      const image = plan.constructs.images[0];
      assert.equal(image.raw, fixture.expression);
      assert.equal(image.active, active);
      assert.deepEqual({ ...image.presentation }, {
        sourceVisible: true,
        renderedMounted: false,
        layout: 'source-only'
      });

      const opening = exactLeaf(plan, ranges.markerStart, ranges.markerEnd);
      const alt = exactLeaf(plan, ranges.altStart, ranges.altEnd);
      const destination = exactLeaf(plan, ranges.destinationStart, ranges.destinationEnd);
      assert.ok(opening, `${fixture.name} / ${mode}: no exact opening leaf`);
      assert.ok(alt, `${fixture.name} / ${mode}: no exact alt leaf`);
      assert.ok(destination, `${fixture.name} / ${mode}: no exact destination leaf`);
      assert.equal(opening.text, fixture.opening);
      assert.equal(alt.text, fixture.alt);
      assert.equal(destination.text, fixture.destination);
      assert.ok(roleKeys(opening).includes('image-source:marker'));
      assert.ok(roleKeys(opening).includes('source-symbol:marker'));
      assert.ok(roleKeys(alt).includes('image-source:content'));
      assert.equal(roleKeys(alt).includes('source-symbol:marker'), false);
      assert.equal(roleKeys(alt).some((role) => role.startsWith('link:')), false);
      assert.ok(roleKeys(destination).includes('image-source:destination'));
      assert.ok(roleKeys(destination).includes('source-symbol:marker'));
      assert.equal(allLeaves(plan).some((leaf) => (
        roleKeys(leaf).some((role) => role.startsWith('link:'))
      )), false, `${fixture.name} / ${mode}: projected source gained a link role`);
    }
  }
});

test('Reading renders the exact literal image expression and never mounts IMG or link UI', () => {
  for (const fixture of VALID_FIXTURES) {
    const rendered = readingRender(fixture.source);
    const imageSources = elementsWithClass(rendered.nodes, 'markdown-page-image-source-only');
    const openings = elementsWithClass(rendered.nodes, 'markdown-page-image-source-marker');
    const destinations = elementsWithClass(
      rendered.nodes,
      'markdown-page-image-source-destination'
    );
    const alts = elementsWithClass(rendered.nodes, 'markdown-page-image-source-alt');

    assert.equal(rendered.nodes.some((node) => node?.tagName === 'IMG'), false,
      `${fixture.name}: Reading mounted an IMG`);
    assert.equal(imageSources.length, 1, `${fixture.name}: source-only wrapper is missing`);
    assert.equal(imageSources[0].textContent, fixture.expression,
      `${fixture.name}: Reading literal differs from canonical source`);
    assert.deepEqual(openings.map((element) => element.textContent), [fixture.opening]);
    assert.deepEqual(destinations.map((element) => element.textContent), [fixture.destination]);
    assert.deepEqual(alts.map((element) => element.textContent), [fixture.alt]);
    assert.ok([...openings, ...destinations].every((element) => (
      element.classList.contains('is-symbol-group-2')
    )), `${fixture.name}: syntax/destination is not assigned to Symbol Group 2`);
    assert.equal(alts[0].classList.contains('is-symbol-group-2'), false,
      `${fixture.name}: alt text was colored as syntax`);
    assert.equal(elementsWithClass(rendered.nodes, 'markdown-page-link').length, 0);
    assert.equal(elementsWithClass(rendered.nodes, 'markdown-page-link-navigation').length, 0);

    const html = markdown.renderMarkdown(fixture.source);
    assert.doesNotMatch(html, /<img(?:\s|>)/i,
      `${fixture.name}: non-interactive Markdown renderer still emits IMG`);
    assert.match(html, /data-markdown-image-presentation="source-only"/);
    assert.doesNotMatch(html, /\ssrc=/i,
      `${fixture.name}: source-only presentation retained a loadable src`);
  }
});

test('an unescaped-space destination stays ordinary parser text without image or link roles', () => {
  const source = '![Cell structure](assets/cell image.png)';
  const snapshot = markdown.createSourceSnapshot(source);
  assert.equal(snapshot.semanticIndex.ownersOfType('image', 'imageReference').length, 0,
    'CommonMark must continue treating the invalid unescaped-space destination as text');

  for (const mode of ['source', 'live-preview']) {
    const plan = presentationPlan(snapshot, mode);
    assert.equal(plannedSource(snapshot, plan), source);
    assert.equal(plan.constructs.images.length, 0);
    assert.equal(plan.constructs.links.length, 0);
    assert.equal(allLeaves(plan).some((leaf) => (
      roleKeys(leaf).some((role) => (
        role.startsWith('image-source:')
          || role.startsWith('source-symbol:')
          || role.startsWith('link:')
      ))
    )), false, `${mode}: invalid image-like text gained semantic presentation roles`);
  }

  const rendered = readingRender(source);
  assert.equal(rendered.blocks[0].element.textContent, source);
  assert.equal(rendered.nodes.some((node) => node?.tagName === 'IMG'), false);
  assert.equal(elementsWithClass(rendered.nodes, 'markdown-page-image-source-only').length, 0);
  assert.equal(elementsWithClass(rendered.nodes, 'markdown-page-link').length, 0);
  assert.equal(markdown.renderMarkdown(source), `<p>${source}</p>`);
});
