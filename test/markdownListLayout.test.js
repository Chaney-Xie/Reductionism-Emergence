const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  FakeElement,
  descendants,
  loadMarkdownPageViewInternals,
  renderSemanticSegments
} = require('./helpers/markdownFakeDom');

const styles = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'styles.css'),
  'utf8'
);
const round2ListGate = JSON.parse(fs.readFileSync(
  path.join(
    __dirname,
    'markdownConformance',
    'scenarios',
    'v0.3ListRandom500MinimizedRegressionsRound2.json'
  ),
  'utf8'
));

function renderList(source, mode = 'live-preview') {
  const view = loadMarkdownPageViewInternals([
    'semanticSyntaxSegments',
    'renderSemanticBlockContents',
    'semanticSourceFromNode',
    'activeMarkdownSourceLineStarts',
    'structuralSourceMarkerIsOnActiveLine',
    'canonicalRawListSourceMarker',
    'updateLiveMarkerVisibility',
    'sourceDifference',
    'mapPendingSemanticMutationSelection'
  ]);
  const rendered = renderSemanticSegments(view, source, { mode });
  const nodes = rendered.blocks.flatMap((block) => descendants(block.element));
  return { view, rendered, nodes };
}

function elements(nodes, predicate) {
  return nodes.filter((node) => node?.nodeType === 1 && predicate(node));
}

function ordinaryItems(nodes) {
  return elements(nodes, (node) => (
    node.classList.contains('markdown-page-list-item')
      && !node.classList.contains('task-list-item')
  ));
}

function assertStableItemRow(item, expectedPrefix) {
  const directChildren = item.children;
  const prefix = directChildren[0];
  const body = directChildren[1];
  const marker = prefix?.children?.find((child) => (
    child.classList.contains('markdown-source-marker')
  ));
  assert.equal(prefix?.classList.contains('markdown-page-list-prefix'), true);
  assert.ok(marker, 'the prefix column owns the canonical source marker');
  assert.equal(prefix.textContent, expectedPrefix);
  assert.equal(body?.classList.contains('markdown-page-list-item-body'), true);
  assert.equal(directChildren.length, 2, 'prefix and body are the only list-row columns');
  assert.equal(
    body.children.some((child) => child.classList.contains('markdown-page-paragraph')),
    true,
    'the semantic paragraph stays inside the body column'
  );
  return { prefix, marker, body };
}

function canonicalSource(view, rendered) {
  return rendered.blocks
    .map((block) => view.semanticSourceFromNode(block.element))
    .join('');
}

test('unordered and ordered prefixes share one stable row with their item body', () => {
  for (const { source, listTag, prefix, bodyStart } of [
    { source: '- item', listTag: 'UL', prefix: '- ', bodyStart: 2 },
    { source: '1. item', listTag: 'OL', prefix: '1. ', bodyStart: 3 }
  ]) {
    const { view, rendered, nodes } = renderList(source, 'source');
    const list = elements(nodes, (node) => (
      node.classList.contains('markdown-page-list') && node.tagName === listTag
    ))[0];
    const item = ordinaryItems(nodes)[0];
    const row = assertStableItemRow(item, prefix);

    assert.ok(list);
    assert.equal(row.marker.dataset.markdownSourceStart, '0');
    assert.equal(row.marker.dataset.markdownSourceEnd, String(bodyStart));
    assert.equal(row.body.children[0].dataset.markdownSourceStart, String(bodyStart));
    assert.equal(canonicalSource(view, rendered), source);
  }
});

test('Reading preserves an explicit zero ordered-list start', () => {
  const { nodes } = renderList('0. zero\n3. source-only', 'reading');
  const list = elements(nodes, (node) => (
    node.classList.contains('markdown-page-list') && node.tagName === 'OL'
  ))[0];
  assert.ok(list);
  assert.equal(list.start, 0);
});

test('Live Preview persistently exposes canonical non-task list markers by source range', () => {
  const source = [
    '1. one',
    '7. seven',
    '3. three',
    '- dash',
    '* star',
    '+ plus',
    '- [ ] task'
  ].join('\n');
  const { view, rendered, nodes } = renderList(source, 'live-preview');
  const bodyRoot = new FakeElement({ tagName: 'div' });
  rendered.blocks.forEach((block) => bodyRoot.append(block.element));
  rendered.state.bodyRoot = bodyRoot;

  // FakeElement does not detach moved prefix children before replaceChildren,
  // so restore the parent link that the real DOM owns.
  ordinaryItems(nodes).concat(elements(nodes, (node) => (
    node.classList.contains('markdown-page-list-item')
      && node.classList.contains('task-list-item')
  ))).forEach((item) => {
    const prefix = item.children.find((child) => (
      child.classList.contains('markdown-page-list-prefix')
    ));
    prefix?.children.forEach((child) => { child.parentElement = prefix; });
  });

  view.updateLiveMarkerVisibility(rendered.state);
  const markers = elements(nodes, (node) => node.classList.contains('markdown-source-marker'))
    .filter((marker) => marker.closest('.markdown-page-list-prefix'));
  const ordinary = markers.filter((marker) => (
    !marker.closest('.markdown-page-list-item')?.classList.contains('task-list-item')
  ));
  const task = markers.find((marker) => (
    marker.closest('.markdown-page-list-item')?.classList.contains('task-list-item')
  ));

  assert.deepEqual(ordinary.map((marker) => marker.textContent), [
    '1. ', '7. ', '3. ', '- ', '* ', '+ '
  ]);
  assert.equal(ordinary.every((marker) => marker.classList.contains('is-visible')), true);
  assert.equal(task?.classList.contains('is-visible'), false, 'task checkbox ownership is unchanged');
  assert.equal(view.canonicalRawListSourceMarker(ordinary[1], source), true);
  ordinary[1].dataset.markdownSourceEnd = String(Number(ordinary[1].dataset.markdownSourceEnd) + 1);
  assert.equal(view.canonicalRawListSourceMarker(ordinary[1], source), false);
});

test('editable list-prefix decorators use exact source ranges without adopting Tab-overindents', () => {
  for (const fixture of [
    {
      source: '1. A\n       1. B\n      2. C\n   2. D\n2. E',
      expected: [[0, 1], [23, 2], [31, 2], [36, 1]],
      rejected: 12
    },
    {
      source: '1. A\n       - B\n     1. C\n   - D\n2. E',
      expected: [[0, 1], [21, 2], [29, 2], [33, 1]],
      rejected: 12
    },
    {
      source: '1. Alpha\n   2. Child2. Parent',
      expected: [[0, 1], [12, 2]],
      rejected: null
    },
    {
      source: '1. A\n   1. B\n          1. C\n   2. D\n3. E',
      expected: [[0, 1], [8, 2], [31, 2], [36, 1]],
      rejected: 23
    },
    {
      source: '    1. A\n   1. B\n      1. C\n   2. D\n2. E',
      expected: [[12, 1], [23, 2], [31, 1], [36, 1]],
      rejected: 4
    },
    {
      source: '1. Alpha\n   - A\n    Beta\n     1. Gamma\n2. Delta',
      expected: [[0, 1], [12, 2], [30, 2], [39, 1]],
      rejected: null
    }
  ]) {
    const { view, rendered, nodes } = renderList(fixture.source, 'source');
    const decorators = elements(nodes, (node) => (
      node.classList.contains('markdown-list-editing-prefix')
    ));
    assert.deepEqual(decorators.map((marker) => [
      Number(marker.dataset.markdownSourceStart),
      Number(marker.dataset.markdownListDepth)
    ]), fixture.expected);
    if (fixture.rejected != null) {
      assert.equal(decorators.some((marker) => (
        Number(marker.dataset.markdownSourceStart) === fixture.rejected
      )), false);
    }
    assert.equal(canonicalSource(view, rendered), fixture.source);
  }
});

test('editable prefix decorator recognizes marker-only nested ordered rows', () => {
  const source = '1. A\n   2. B\n   3. \n      1. C\n   4. D\n5. E';
  const { view, rendered, nodes } = renderList(source, 'live-preview');
  const markerOnly = elements(nodes, (node) => (
    node.classList.contains('markdown-list-editing-prefix')
      && Number(node.dataset.markdownSourceStart) === 16
  ))[0];
  assert.ok(markerOnly);
  assert.equal(markerOnly.textContent, '3.');
  assert.equal(markerOnly.dataset.markdownListDepth, '2');
  assert.equal(canonicalSource(view, rendered), source);
});

test('editable prefix decorator promotes valid prefixes embedded in mapped text', () => {
  for (const fixture of [
    {
      source: '1) Alpha\n    1)  \n    2) Beta\n2) Gamma',
      expected: [22, 25, 2, '2) ']
    },
    {
      source: '- Alpha\n  continued alpha\n  1.  \n  2. eta\n- Gamma',
      expected: [35, 38, 2, '2. ']
    },
    {
      source: '1. A\n    1.  \n    2. B\n2. C',
      expected: [18, 21, 2, '2. ']
    },
    {
      source: '1) Alpha\n2) *\n1)ta\n3) Gamma',
      expected: [19, 22, 1, '3) ']
    },
    {
      source: '1. Alpha\n   - \n       - *Beta\n1. Gamma',
      expected: [22, 24, 3, '- ']
    }
  ]) {
    const { view, rendered, nodes } = renderList(fixture.source, 'live-preview');
    const promoted = elements(nodes, (node) => (
      node.classList.contains('markdown-list-editing-prefix')
        && Number(node.dataset.markdownSourceStart) === fixture.expected[0]
    ))[0];
    assert.deepEqual([
      Number(promoted?.dataset.markdownSourceStart),
      Number(promoted?.dataset.markdownSourceEnd),
      Number(promoted?.dataset.markdownListDepth),
      promoted?.textContent
    ], fixture.expected);
    assert.equal(canonicalSource(view, rendered), fixture.source);
  }
});

test('editable list ownership reconciles a deeper child misparsed as indented code', () => {
  const source = '1. Alpha\n   - \n       - *Beta\n1. Gamma';
  const live = renderList(source, 'live-preview');
  const reconciled = elements(live.nodes, (node) => (
    node.classList.contains('markdown-page-reconciled-list-source')
  ));
  const childPrefix = elements(live.nodes, (node) => (
    node.classList.contains('markdown-list-editing-prefix')
      && Number(node.dataset.markdownSourceStart) === 22
  ))[0];

  assert.equal(reconciled.length, 1);
  assert.equal(
    elements(live.nodes, (node) => node.classList.contains('markdown-page-code-shell')).length,
    0
  );
  assert.equal(childPrefix?.dataset.markdownListDepth, '3');
  assert.equal(childPrefix?.textContent, '- ');
  assert.equal(canonicalSource(live.view, live.rendered), source);

  const reading = renderList(source, 'reading');
  assert.equal(
    elements(reading.nodes, (node) => (
      node.classList.contains('markdown-page-reconciled-list-source')
    )).length,
    0
  );
  assert.equal(
    elements(reading.nodes, (node) => node.classList.contains('markdown-page-code-shell')).length,
    1
  );

  const ordinaryCode = renderList('    2. indented code', 'live-preview');
  assert.equal(
    elements(ordinaryCode.nodes, (node) => (
      node.classList.contains('markdown-page-reconciled-list-source')
    )).length,
    0
  );
  assert.equal(
    elements(ordinaryCode.nodes, (node) => (
      node.classList.contains('markdown-page-code-shell')
        && node.classList.contains('is-indented')
    )).length,
    1
  );
});

test('a nonterminal bare root marker stays visible but exits list ownership', () => {
  for (const fixture of [
    { source: '- Alpha\n- \n-\nBeta\n- Gamma', markerStart: 11, exact: true },
    { source: '1. A\n2. *B\n3.\n3. C', markerStart: 11, exact: true },
    { source: '- Alpha\n- \n-\n    Beta\n- Gamma', markerStart: 11, exact: false }
  ]) {
    const { view, rendered, nodes } = renderList(fixture.source, 'live-preview');
    const exited = elements(nodes, (node) => (
      Number(node.dataset.markdownSourceStart) === fixture.markerStart
        && node.classList.contains('markdown-source-marker')
    ))[0];
    assert.ok(exited);
    assert.equal(exited.classList.contains('markdown-list-editing-prefix'), false);
    assert.equal(exited.classList.contains('markdown-list-editing-token'), false);
    assert.equal(exited.dataset.markdownListDepth, undefined);
    if (fixture.exact) {
      assert.equal(exited.classList.contains('markdown-exited-list-marker'), true);
      assert.equal(view.canonicalRawListSourceMarker(exited, fixture.source), true);
    }
    assert.equal(canonicalSource(view, rendered), fixture.source);
  }

  const trailing = renderList('- Alpha\n-', 'live-preview');
  const trailingMarker = elements(trailing.nodes, (node) => (
    Number(node.dataset.markdownSourceStart) === 8
      && node.classList.contains('markdown-source-marker')
  ))[0];
  assert.equal(trailingMarker.classList.contains('markdown-list-editing-prefix'), false);
  assert.equal(trailingMarker.classList.contains('markdown-exited-list-marker'), true);
  assert.equal(trailingMarker.dataset.markdownListDepth, undefined);
  assert.equal(trailing.view.canonicalRawListSourceMarker(
    trailingMarker,
    '- Alpha\n-'
  ), true);
});

test('overindented list-like tokens preserve lexical ownership without inventing depth', () => {
  for (const fixture of [
    {
      source: '* Alpha\n        * *Bta\n* Gamma',
      markerStart: 16,
      depth: 0,
      text: '* ',
      recognitionOnly: false
    },
    {
      source: '1. A\n    1. *\n            1.\n2. C',
      markerStart: 26,
      depth: 2,
      text: '1.',
      recognitionOnly: true
    },
    {
      source: '1. A\n    1.\n    *B\n2. C',
      markerStart: 9,
      depth: 1,
      text: '1.',
      recognitionOnly: true
    }
  ]) {
    const { view, rendered, nodes } = renderList(fixture.source, 'live-preview');
    const token = elements(nodes, (node) => (
      Number(node.dataset.markdownSourceStart) === fixture.markerStart
        && node.classList.contains('markdown-list-editing-token')
    ))[0];
    assert.ok(token);
    assert.equal(token.classList.contains('markdown-list-editing-prefix'), false);
    assert.equal(Number(token.dataset.markdownListDepth), fixture.depth);
    assert.equal(token.textContent, fixture.text);
    assert.equal(
      token.classList.contains('markdown-list-recognition-only-token'),
      fixture.recognitionOnly
    );
    assert.equal(canonicalSource(view, rendered), fixture.source);
  }
});

test('ordinary invalid overindents remain source text without list recognition', () => {
  for (const fixture of [
    {
      source: '1. Alpha\n-Beta\n     1. Gamma\n2. Delta',
      markerStart: 20
    },
    {
      source: '1. Alpha\n        1. *eta\n2. Gamma',
      markerStart: 17
    },
    {
      source: '1. A\n    1. *\n            1. \n2. C',
      markerStart: 26
    },
    {
      source: '- Alpha\n        * * eta\n+ Gamma',
      markerStart: 16
    }
  ]) {
    const { view, rendered, nodes } = renderList(fixture.source, 'source');
    const sourceToken = elements(nodes, (node) => (
      Number(node.dataset.markdownSourceStart) === fixture.markerStart
        && node.classList.contains('markdown-source-marker')
    ))[0];
    assert.ok(sourceToken);
    assert.equal(sourceToken.classList.contains('markdown-list-editing-prefix'), false);
    assert.equal(sourceToken.classList.contains('markdown-list-editing-token'), false);
    assert.equal(sourceToken.dataset.markdownListDepth, undefined);
    assert.equal(canonicalSource(view, rendered), fixture.source);
  }
});

test('Round 2 normalized list presentation oracles map to editable marker ownership', () => {
  const cases = round2ListGate.sequences.filter((scenario) => (
    !scenario.repairMetadata.authoritativeDifferencePaths.some((differencePath) => (
      differencePath === 'source' || differencePath.startsWith('source.')
    ))
  ));
  assert.equal(cases.length, 393);
  const view = loadMarkdownPageViewInternals([
    'semanticSyntaxSegments',
    'renderSemanticBlockContents'
  ]);
  let projectedPresentationCaseCount = 0;

  cases.forEach((scenario) => {
    const source = scenario.oracleExpected.source;
    const rendered = renderSemanticSegments(view, source, { mode: scenario.mode });
    const nodes = rendered.blocks
      .flatMap((block) => descendants(block.element))
      .filter((node) => node?.nodeType === 1);
    const records = [];
    let lineStart = 0;
    for (const rawLine of source.match(/[^\n]*(?:\n|$)/g) || ['']) {
      if (!rawLine && lineStart === source.length) continue;
      records.push({
        start: lineStart,
        text: rawLine.replace(/\r?\n$/, '')
      });
      lineStart += rawLine.length;
    }
    const targetIndexes = new Set(
      scenario.repairMetadata.authoritativeDifferencePaths
        .map((differencePath) => (
          /^(?:semantic\.items|presentation\.list\.markers)\.(\d+)/
            .exec(differencePath)?.[1]
        ))
        .filter((value) => value != null)
        .map(Number)
    );
    if (targetIndexes.size) projectedPresentationCaseCount += 1;

    targetIndexes.forEach((index) => {
      const expectedItem = scenario.oracleExpected.semantic.items[index];
      const expectedMarker = scenario.oracleExpected.presentation.list.markers[index];
      const line = records[expectedItem.lineIndex];
      const sourceMatch = /^([ \t]*)((\d+)([.)])|([-+*]))([ \t]+|$)/.exec(line.text);
      assert.ok(sourceMatch, `${scenario.id}: source item ${index}`);
      const markerStart = line.start + sourceMatch[1].length;
      const marker = nodes.filter((node) => (
        Number(node.dataset?.markdownSourceStart) === markerStart
          && (
            node.classList.contains('markdown-list-editing-prefix')
              || node.classList.contains('markdown-list-editing-token')
          )
      )).sort((left, right) => (
        Number(left.dataset.markdownSourceEnd) - Number(left.dataset.markdownSourceStart)
          - (Number(right.dataset.markdownSourceEnd) - Number(right.dataset.markdownSourceStart))
      ))[0];
      const visible = Boolean(marker)
        && !marker.classList.contains('markdown-list-recognition-only-token');
      const actual = {
        recognized: Boolean(marker),
        listDepth: marker ? Number(marker.dataset.markdownListDepth) || 0 : 0,
        markerVisible: visible,
        markerOwner: visible ? 'source' : 'none',
        displayedMarker: visible ? sourceMatch[2] : null,
        displayedOrdinal: visible && sourceMatch[3] ? Number(sourceMatch[3]) : null
      };
      const expected = {
        recognized: expectedItem.recognized,
        listDepth: expectedItem.listDepth,
        markerVisible: expectedMarker.markerVisible,
        markerOwner: expectedMarker.markerOwner,
        displayedMarker: expectedMarker.displayedMarker,
        displayedOrdinal: expectedMarker.displayedOrdinal
      };
      assert.deepEqual(actual, expected, `${scenario.id}: source item ${index}`);
    });
  });
  assert.equal(projectedPresentationCaseCount, 381);
});

test('native mutation selection falls back through the pending source difference', () => {
  const { view } = renderList('1. Alpha', 'live-preview');
  const insertion = view.sourceDifference('1. Alpha', '1. Axlpha');
  assert.deepEqual(
    JSON.parse(JSON.stringify(view.mapPendingSemanticMutationSelection(
      { anchor: 4, focus: 4 }, insertion, 9
    ))),
    { anchor: 5, focus: 5 }
  );
  const deletion = view.sourceDifference('1. Alpha', '1.Alpha');
  assert.deepEqual(
    JSON.parse(JSON.stringify(view.mapPendingSemanticMutationSelection(
      { anchor: 3, focus: 3 }, deletion, 7
    ))),
    { anchor: 2, focus: 2 }
  );
});

test('adjacent list items keep independent prefix/body rows and exact separators', () => {
  for (const source of ['- first\n- second', '1. first\n2. second']) {
    const { view, rendered, nodes } = renderList(source, 'source');
    const items = ordinaryItems(nodes);
    assert.equal(items.length, 2);
    items.forEach((item, index) => {
      assertStableItemRow(item, source.startsWith('-') ? '- ' : `${index + 1}. `);
    });
    assert.equal(canonicalSource(view, rendered), source);
  }
});

test('nested and multiline list content remains subordinate to the body column', () => {
  const source = [
    '1. parent',
    '   - child',
    '     continuation',
    '',
    '   continued paragraph',
    '2. next'
  ].join('\n');
  const { view, rendered, nodes } = renderList(source, 'source');
  const items = ordinaryItems(nodes);
  assert.equal(items.length, 3);

  const outer = assertStableItemRow(items[0], '1. ');
  const nested = assertStableItemRow(items[1], '- ');
  assertStableItemRow(items[2], '2. ');
  assert.equal(
    descendants(outer.body).some((node) => (
      node?.classList?.contains('markdown-page-list') && node.tagName === 'UL'
    )),
    true,
    'the nested list stays inside the parent body column'
  );
  assert.match(nested.body.textContent, /child/);
  assert.match(nested.body.textContent, /continuation/);
  assert.match(outer.body.textContent, /continued paragraph/);
  assert.equal(canonicalSource(view, rendered), source);
});

test('semantic inline styling remains inside the list body in every Markdown mode', () => {
  const source = '- **bold** ~~strike~~ `code`';
  for (const mode of ['reading', 'live-preview', 'source']) {
    const { view, rendered, nodes } = renderList(source, mode);
    const item = ordinaryItems(nodes)[0];
    const { body } = assertStableItemRow(item, '- ');
    const bodyNodes = descendants(body);
    assert.equal(bodyNodes.some((node) => node?.tagName === 'STRONG'), true);
    assert.equal(bodyNodes.some((node) => node?.tagName === 'DEL'), true);
    assert.equal(bodyNodes.some((node) => node?.tagName === 'CODE'), true);
    assert.equal(canonicalSource(view, rendered), source);
  }
});

test('mixed tab and four-space indentation share one parser-owned nested list', () => {
  const source = [
    '1. Glycolysis',
    '2. Link reaction',
    '3. TCA cycle',
    '\t1. Citrate',
    '    2. Isocitrate'
  ].join('\n');
  const { view, rendered, nodes } = renderList(source, 'source');
  const items = ordinaryItems(nodes);
  const lists = elements(nodes, (node) => node.classList.contains('markdown-page-list'));
  const depth = (item) => lists.filter((list) => list.contains(item)).length;

  assert.deepEqual(items.map(depth), [1, 1, 1, 2, 2]);
  assert.equal(items[3].parentElement, items[4].parentElement);
  assert.equal(
    items[2].querySelectorAll?.('.markdown-page-list')?.length || 0,
    1,
    'the third outer item owns one nested ordered list'
  );
  assert.equal(canonicalSource(view, rendered), source);
});

test('active structural markers are restricted to the selected canonical source line', () => {
  const source = [
    '1. Glycolysis',
    '2. Link reaction',
    '3. TCA cycle',
    '\t1. Citrate',
    '    2. Isocitrate'
  ].join('\n');
  const { view, nodes } = renderList(source, 'live-preview');
  const items = ordinaryItems(nodes);
  const marker = (item) => {
    const prefix = item.children[0];
    const result = prefix.children.find((child) => (
      child.classList.contains('markdown-source-marker')
    ));
    // FakeElement does not detach a moved child from its former parent as the
    // browser does. Restore the real DOM ownership used by the gutter check.
    result.parentElement = prefix;
    return result;
  };
  const activeLines = view.activeMarkdownSourceLineStarts(source, {
    anchor: source.indexOf('Citrate') + 2,
    focus: source.indexOf('Citrate') + 2
  });

  assert.equal(view.structuralSourceMarkerIsOnActiveLine(
    marker(items[2]), source, activeLines
  ), false, 'the parent item marker is on a different source line');
  assert.equal(view.structuralSourceMarkerIsOnActiveLine(
    marker(items[3]), source, activeLines
  ), true, 'the current nested marker is active');
  assert.equal(view.structuralSourceMarkerIsOnActiveLine(
    marker(items[4]), source, activeLines
  ), false, 'the inactive nested sibling remains rendered');
});

test('Source and active Live place prefixes in the native marker gutter', () => {
  assert.match(
    styles,
    /\.markdown-page-layer\.is-source \.markdown-page-list-item:not\(\.task-list-item\),[\s\S]*?\.markdown-page-layer\.is-live-preview[\s\S]*?\.markdown-page-list-item:not\(\.task-list-item\):has\([\s\S]*?> \.markdown-page-list-prefix \.markdown-source-marker\.is-visible[\s\S]*?\) \{[\s\S]*?position: relative;[\s\S]*?display: list-item;/
  );
  assert.match(
    styles,
    /\.markdown-page-list-item:not\(\.task-list-item\) > \.markdown-page-list-prefix[\s\S]*?display: block;[\s\S]*?position: absolute;[\s\S]*?right: 100%;[\s\S]*?white-space: pre;/
  );
  assert.match(
    styles,
    /\.markdown-page-list-item:not\(\.task-list-item\) > \.markdown-page-list-item-body[\s\S]*?min-width: 0;/
  );
  assert.doesNotMatch(
    styles,
    /\.markdown-page-list-item:not\(\.task-list-item\)[^{]*\{[^}]*display:\s*grid;/,
    'source visibility must not add marker width to semantic list depth'
  );
  assert.match(
    styles,
    /\.markdown-page-layer\.is-source \.markdown-source-marker,[\s\S]*?\.markdown-page-layer\.is-live-preview \.markdown-source-marker\.is-visible \{\s*display: inline;/
  );
  assert.doesNotMatch(
    styles,
    /\.markdown-page-list-item\s*\{[^}]*display:\s*grid;/,
    'ordinary Reading/inactive Live items retain the browser list-item layout'
  );
});
