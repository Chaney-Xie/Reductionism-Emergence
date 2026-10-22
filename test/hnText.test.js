const test = require('node:test');
const assert = require('node:assert/strict');

const hnText = require('../public/hnText');
const numbering = require('../public/hnListNumbering');
const listIndexModel = require('../public/hnListIndex');
const markdown = require('../public/markdownPage');
const markdownRuntime = require('../public/vendor/markdownRuntime');

function normalizedRuns(runs) {
  const normalized = [];
  for (const run of runs) {
    const marks = [...run.marks].sort();
    const previous = normalized[normalized.length - 1];
    if (previous && previous.marks.join('\u0000') === marks.join('\u0000')) {
      previous.text += run.text;
    } else {
      normalized.push({ text: run.text, marks });
    }
  }
  return normalized;
}

function parsedInlineRuns(node, activeMarks = []) {
  if (node.type === 'text') return [{ text: node.value, marks: activeMarks }];
  const mark = node.type === 'strong' ? 'strong'
    : node.type === 'emphasis' ? 'emphasis'
      : node.type === 'delete' ? 'strikethrough' : null;
  assert.ok(node.type === 'paragraph' || mark, `unexpected inline AST node: ${node.type}`);
  const marks = mark ? [...activeMarks, mark] : activeMarks;
  return (node.children || []).flatMap((child) => parsedInlineRuns(child, marks));
}

function parsedParagraphRuns(source) {
  const tree = markdownRuntime.parseMarkdown(source);
  return tree.children.map((node) => {
    assert.equal(node.type, 'paragraph');
    return normalizedRuns(parsedInlineRuns(node));
  });
}

function text(value, marks = []) {
  return {
    type: 'text',
    text: value,
    ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {})
  };
}

function paragraph(id, content = []) {
  return {
    type: 'paragraph',
    attrs: { id },
    ...(content.length ? { content } : {})
  };
}

function heading(id, level, content = []) {
  return {
    type: 'heading',
    attrs: { id, level },
    ...(content.length ? { content } : {})
  };
}

function legacyEnvelope(schemaVersion, content, revision = 0) {
  return {
    schemaVersion,
    revision,
    document: { type: 'doc', content }
  };
}

function listItem(id, paragraphs, childSequence = null) {
  return {
    type: 'list_item',
    attrs: { id },
    content: [...paragraphs, ...(childSequence ? [childSequence] : [])]
  };
}

function listSequence(id, scheme, startOrdinal, items, dottedPrefix = undefined) {
  return {
    type: 'list_sequence',
    attrs: {
      id,
      scheme,
      startOrdinal,
      ...(dottedPrefix ? { dottedPrefix } : {})
    },
    content: items
  };
}

test('schema 3 owns one exact source envelope and validateEnvelope means current schema', () => {
  assert.equal(hnText.HN_PAGE_TYPE, 'cne-text');
  assert.equal(hnText.LEGACY_CNE_SCHEMA_VERSION, 1);
  assert.equal(hnText.STRUCTURED_CNE_SCHEMA_VERSION, 2);
  assert.equal(hnText.HN_SCHEMA_VERSION, 3);
  assert.deepEqual(hnText.createEmptyEnvelope(), {
    schemaVersion: 3,
    revision: 0,
    source: '',
    anchors: {}
  });

  const envelope = {
    schemaVersion: 3,
    revision: 27,
    source: 'exact\r\nUnicode 你 👨‍👩‍👧‍👦',
    anchors: {}
  };
  const validation = hnText.validateCurrentEnvelope(envelope);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.value, envelope);
  assert.notEqual(validation.value, envelope);
  assert.equal(hnText.validateEnvelope(envelope).ok, true);

  const invalidMutations = [
    (value) => { value.document = { type: 'doc', content: [] }; },
    (value) => { value.selection = { anchor: 0, focus: 1 }; },
    (value) => { value.history = []; },
    (value) => { value.source = 12; },
    (value) => { value.anchors = []; },
    (value) => { value.anchors.future = { from: 0, to: 1 }; },
    (value) => { delete value.anchors; },
    (value) => { value.schemaVersion = 2; }
  ];
  for (const mutate of invalidMutations) {
    const candidate = structuredClone(envelope);
    mutate(candidate);
    assert.equal(hnText.validateCurrentEnvelope(candidate).ok, false);
  }
  for (const revision of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
    assert.equal(hnText.validateCurrentEnvelope({ ...envelope, revision }).ok, false);
  }
});

test('persisted validation admits basic legacy shape without treating it as current', () => {
  const unsupportedLegacy = legacyEnvelope(2, [{
    type: 'future_block',
    attrs: { payload: { mustSurvive: true } }
  }], 9);
  assert.equal(hnText.validatePersistedEnvelope(unsupportedLegacy).ok, true);
  assert.equal(hnText.validateCurrentEnvelope(unsupportedLegacy).ok, false);
  assert.equal(hnText.validateEnvelope(unsupportedLegacy).ok, false);

  assert.equal(hnText.validatePersistedEnvelope({
    schemaVersion: 1,
    revision: 0,
    document: { type: 'doc', content: [] }
  }).ok, true);
  assert.equal(hnText.validatePersistedEnvelope({
    schemaVersion: 2,
    revision: 0,
    document: { type: 'doc', content: [] }
  }).ok, true);
  assert.equal(hnText.validatePersistedEnvelope({
    schemaVersion: 4,
    revision: 0,
    source: '',
    anchors: {}
  }).ok, false, 'future source schemas remain invalid');
  assert.equal(hnText.validatePersistedEnvelope({
    schemaVersion: 2,
    revision: 0,
    document: { type: 'not-doc', content: [] }
  }).ok, false);
});

test('normalization only clones and never eagerly repairs or migrates content', () => {
  const future = {
    schemaVersion: 99,
    revision: 4,
    futureBody: { nested: ['keep'] }
  };
  const normalized = hnText.normalizeEnvelope(future);
  assert.deepEqual(normalized, future);
  assert.notEqual(normalized, future);
  assert.notEqual(normalized.futureBody, future.futureBody);
  normalized.futureBody.nested.push('changed');
  assert.deepEqual(future.futureBody.nested, ['keep']);
  assert.equal(hnText.normalizeEnvelope(null), null);
  assert.equal(hnText.normalizeEnvelope('malformed'), 'malformed');
});

test('legacy v1 migration deterministically serializes paragraphs, headings and marks', () => {
  const punctuation = 'Literal, ! * _ ~ [x](y) \\ #';
  assert.equal(
    hnText.escapeLegacyMarkdownText(punctuation),
    'Literal\\, \\! \\* \\_ \\~ \\[x\\]\\(y\\) \\\\ \\#'
  );
  const content = [
    paragraph('literal', [text(punctuation)]),
    ...Array.from({ length: 6 }, (_, index) => (
      heading(`heading-${index + 1}`, index + 1, [text(`Heading ${index + 1}`)])
    )),
    paragraph('marks', [text('Marked', ['strong', 'emphasis', 'strikethrough'])])
  ];
  const legacy = legacyEnvelope(1, content, 12);
  const before = structuredClone(legacy);
  const result = hnText.migrateLegacyEnvelope(legacy);

  assert.equal(result.ok, true);
  assert.equal(result.legacy, true);
  assert.equal(result.migrated, true);
  assert.equal(result.legacySchemaVersion, 1);
  assert.deepEqual(result.value, {
    schemaVersion: 3,
    revision: 12,
    source: [
      'Literal\\, \\! \\* \\_ \\~ \\[x\\]\\(y\\) \\\\ \\#',
      '# Heading 1',
      '## Heading 2',
      '### Heading 3',
      '#### Heading 4',
      '##### Heading 5',
      '###### Heading 6',
      '***~~Marked~~***'
    ].join('\n\n'),
    anchors: {}
  });
  assert.deepEqual(legacy, before, 'migration is pure');
  assert.equal(JSON.stringify(result.value).includes('heading-1'), false,
    'legacy structural IDs do not become anchors or source data');
});

test('legacy inline migration disambiguates adjacent and overlapping supported mark ranges', () => {
  const legacy = legacyEnvelope(1, [
    paragraph('adjacent', [
      text('A', ['strong', 'emphasis']),
      text('B', ['emphasis'])
    ]),
    paragraph('overlapping', [
      text('A', ['strong']),
      text('B', ['strong', 'emphasis']),
      text('C', ['emphasis'])
    ]),
    paragraph('strike-boundary', [
      text('A', ['strikethrough', 'strong']),
      text('B', ['strikethrough', 'emphasis']),
      text('C', ['strong'])
    ]),
    paragraph('entity-fallback', [
      text('__\u0001', ['emphasis', 'strikethrough']),
      text('word'),
      text(' ', ['emphasis']),
      text('a\n\nb', ['strikethrough'])
    ])
  ], 19);
  const result = hnText.migrateLegacyEnvelope(legacy);

  assert.equal(result.ok, true);
  assert.equal(result.value.revision, 19);
  assert.notEqual(result.value.source.split('\n\n')[0], '***A****B*',
    'the previously ambiguous delimiter run is not emitted');
  assert.deepEqual(parsedParagraphRuns(result.value.source), [
    [
      { text: 'A', marks: ['emphasis', 'strong'] },
      { text: 'B', marks: ['emphasis'] }
    ],
    [
      { text: 'A', marks: ['strong'] },
      { text: 'B', marks: ['emphasis', 'strong'] },
      { text: 'C', marks: ['emphasis'] }
    ],
    [
      { text: 'A', marks: ['strikethrough', 'strong'] },
      { text: 'B', marks: ['emphasis', 'strikethrough'] },
      { text: 'C', marks: ['strong'] }
    ],
    [
      { text: '__\u0001', marks: ['emphasis', 'strikethrough'] },
      { text: 'word', marks: [] },
      { text: ' ', marks: ['emphasis'] },
      { text: 'a\n\nb', marks: ['strikethrough'] }
    ]
  ]);
});

test('legacy inline migration encodes only whitespace needed to prevent block ambiguity', () => {
  const expected = [
    [{ text: ' ', marks: ['strong'] }],
    [{ text: ' x ', marks: ['emphasis'] }],
    [{ text: '    literal', marks: [] }],
    [{ text: 'a\n\nb', marks: [] }],
    [{ text: '---', marks: [] }],
    [{ text: '1. item', marks: [] }],
    [{ text: '```code', marks: [] }]
  ];
  const legacy = legacyEnvelope(1, expected.map((runs, index) => paragraph(
    `structural-${index}`,
    runs.map((run) => text(run.text, run.marks))
  )));
  const result = hnText.migrateLegacyEnvelope(legacy);

  assert.equal(result.ok, true);
  assert.deepEqual(parsedParagraphRuns(result.value.source), expected);
  assert.match(result.value.source, /\*\*&#32;\*\*/);
  assert.match(result.value.source, /&#32;&#32;&#32;&#32;literal/);
  assert.match(result.value.source, /a&#10;&#10;b/);
  assert.match(result.value.source, /\\-\\-\\-/);
  assert.match(result.value.source, /1\\\. item/);
  assert.match(result.value.source, /\\`\\`\\`code/);
});

test('legacy migration fails closed when no exact Markdown-compatible source round trip exists', () => {
  const legacy = legacyEnvelope(1, [paragraph('nul', [text('\u0000')])], 7);
  const before = structuredClone(legacy);
  const result = hnText.migrateLegacyEnvelope(legacy);

  assert.equal(result.ok, false);
  assert.equal(result.readOnly, true);
  assert.equal(result.legacy, true);
  assert.ok(result.errors.some(({ code }) => code === 'legacy-inline-roundtrip'));
  assert.deepEqual(result.legacyEnvelope, legacy);
  assert.deepEqual(legacy, before);
  assert.equal(Object.hasOwn(result, 'value'), false);
});

test('legacy v2 list migration preserves marker schemes, hierarchy, continuations and marks', () => {
  const child = listSequence(
    'child-sequence',
    numbering.SCHEMES.LOWER_ALPHA_LEFT,
    2,
    [listItem('child-item', [
      paragraph('child-paragraph', [text('Child * literal')]),
      paragraph('child-continuation', [text('Child continuation')])
    ])]
  );
  const decimal = listSequence(
    'decimal-sequence',
    numbering.SCHEMES.DECIMAL,
    3,
    [
      listItem('decimal-item-a', [
        paragraph('decimal-paragraph-a', [text('Root '), text('bold', ['strong'])]),
        paragraph('decimal-continuation', [text('Continuation')])
      ], child),
      listItem('decimal-item-b', [paragraph('decimal-paragraph-b', [text('Second')])])
    ]
  );
  const legacy = legacyEnvelope(2, [
    decimal,
    listSequence('dotted-sequence', numbering.SCHEMES.DOTTED_DECIMAL, 3, [
      listItem('dotted-item', [
        paragraph('dotted-paragraph', [text('Dotted')]),
        paragraph('dotted-continuation', [text('Dotted continuation', ['emphasis'])])
      ])
    ], [2, 7]),
    listSequence('upper-sequence', numbering.SCHEMES.UPPER_ROMAN_LEFT, 4, [
      listItem('upper-item', [paragraph('upper-paragraph', [text('Upper')])])
    ]),
    listSequence('lower-sequence', numbering.SCHEMES.LOWER_ROMAN_LEFT, 4, [
      listItem('lower-item', [paragraph('lower-paragraph', [text('Lower')])])
    ]),
    listSequence('alpha-sequence', numbering.SCHEMES.LOWER_ALPHA_LEFT, 27, [
      listItem('alpha-item', [paragraph('alpha-paragraph', [text('Alpha')])])
    ])
  ], 5);
  const result = hnText.migrateLegacyEnvelope(legacy);

  assert.equal(result.ok, true);
  assert.equal(result.legacySchemaVersion, 2);
  assert.equal(result.value.source, [
    '3. Root **bold**\n   Continuation\n\t(b Child \\* literal\n\t   Child continuation\n4. Second',
    '2.7.3. Dotted\n       *Dotted continuation*',
    '(IV Upper',
    '(iv Lower',
    '(aa Alpha'
  ].join('\n\n'));
  assert.deepEqual(result.value.anchors, {});
  for (const id of [
    'decimal-sequence', 'decimal-item-a', 'decimal-paragraph-a', 'child-sequence', 'child-item'
  ]) {
    assert.equal(JSON.stringify(result.value).includes(id), false);
  }

  const snapshot = markdown.createSourceSnapshot(result.value.source, { version: 5 });
  const index = listIndexModel.createHnListIndex(snapshot);
  assert.equal(index.items.length, 7,
    'every migrated legacy ListItem is recognized from canonical source only');
  const decimalSequence = index.sequences.find((sequence) => (
    sequence.depth === 0 && sequence.scheme === numbering.SCHEMES.DECIMAL
  ));
  const decimalItem = decimalSequence.items[0];
  const childSequence = index.childSequencesOf(decimalItem.id)[0];
  const migratedChild = childSequence.items[0];
  const dottedSequence = index.sequences.find((sequence) => (
    sequence.scheme === numbering.SCHEMES.DOTTED_DECIMAL
  ));

  assert.deepEqual(decimalSequence.authoredOrdinals, [3, 4]);
  assert.equal(result.value.source.slice(
    decimalItem.continuationParagraphs[0].paddingRange.start,
    decimalItem.continuationParagraphs[0].paddingRange.end
  ), '   ', 'root continuation padding equals `3.` plus its separator Space');
  assert.equal(result.value.source.slice(
    decimalItem.continuationParagraphs[0].contentRange.start,
    decimalItem.continuationParagraphs[0].contentRange.end
  ), 'Continuation');
  assert.equal(childSequence.depth, 1, 'the child sequence remains Tab-nested');
  assert.equal(childSequence.scheme, numbering.SCHEMES.LOWER_ALPHA_LEFT);
  assert.equal(migratedChild.parentItemId, decimalItem.id);
  assert.equal(result.value.source.slice(
    migratedChild.continuationParagraphs[0].tabsRange.start,
    migratedChild.continuationParagraphs[0].tabsRange.end
  ), '\t');
  assert.equal(result.value.source.slice(
    migratedChild.continuationParagraphs[0].paddingRange.start,
    migratedChild.continuationParagraphs[0].paddingRange.end
  ), '   ', 'continuation padding never becomes another structural Tab');
  assert.deepEqual(dottedSequence.dottedPrefix, [2, 7]);
  assert.equal(result.value.source.slice(
    dottedSequence.items[0].continuationParagraphs[0].paddingRange.start,
    dottedSequence.items[0].continuationParagraphs[0].paddingRange.end
  ), '       ', 'dotted continuation width follows the complete `2.7.3. ` prefix');
  assert.equal(result.value.source.slice(
    dottedSequence.items[0].continuationParagraphs[0].contentRange.start,
    dottedSequence.items[0].continuationParagraphs[0].contentRange.end
  ), '*Dotted continuation*', 'legacy inline marks remain exact canonical source');
});

test('unsupported legacy structures produce one read-only diagnostic without data loss', () => {
  const cases = [
    {
      name: 'node',
      value: legacyEnvelope(1, [{ type: 'table', attrs: { id: 'table-1' } }]),
      code: 'block-type'
    },
    {
      name: 'mark',
      value: legacyEnvelope(1, [paragraph('mark-block', [text('Link', ['link'])])]),
      code: 'mark-type'
    },
    {
      name: 'duplicate id',
      value: legacyEnvelope(1, [paragraph('duplicate'), heading('duplicate', 1)]),
      code: 'duplicate-structural-id'
    },
    {
      name: 'bad attributes',
      value: legacyEnvelope(1, [{
        type: 'paragraph',
        attrs: { id: 'valid-id', future: true }
      }]),
      code: 'block-attr-fields'
    }
  ];

  for (const fixture of cases) {
    const before = structuredClone(fixture.value);
    assert.equal(hnText.validatePersistedEnvelope(fixture.value).ok, true,
      `${fixture.name} reaches the migration owner`);
    const result = hnText.migrateLegacyEnvelope(fixture.value);
    assert.equal(result.ok, false, fixture.name);
    assert.equal(result.readOnly, true, fixture.name);
    assert.equal(result.legacy, true, fixture.name);
    assert.ok(result.errors.some(({ code }) => code === fixture.code), fixture.name);
    assert.deepEqual(result.legacyEnvelope, fixture.value, fixture.name);
    assert.notEqual(result.legacyEnvelope, fixture.value, fixture.name);
    assert.deepEqual(fixture.value, before, fixture.name);
    assert.equal(Object.hasOwn(result, 'value'), false, fixture.name);
  }
});

test('current migration is a pure clone and never adds a second body owner', () => {
  const current = {
    schemaVersion: 3,
    revision: 4,
    source: '***A****B*\n\n    literal',
    anchors: {}
  };
  const result = hnText.migratePersistedEnvelope(current);
  assert.equal(result.ok, true);
  assert.equal(result.legacy, false);
  assert.equal(result.migrated, false);
  assert.deepEqual(result.value, current);
  assert.notEqual(result.value, current);
  assert.deepEqual(Object.keys(result.value).sort(), [
    'anchors', 'revision', 'schemaVersion', 'source'
  ]);
});

test('HN mode settings are Vault-scoped values, not canonical Page fields', () => {
  assert.deepEqual(hnText.HN_TEXT_MODES, { EDIT: 'edit', BROWSER: 'browser' });
  assert.deepEqual(hnText.DEFAULT_SETTINGS, { cneTextMode: 'edit' });
  assert.equal(hnText.normalizeHnTextMode('browser'), 'browser');
  assert.equal(hnText.normalizeHnTextMode('unknown'), 'edit');
  assert.deepEqual(hnText.normalizeSettings(null), { cneTextMode: 'edit' });
  assert.deepEqual(hnText.normalizeSettings({ cneTextMode: 'browser', unrelated: true }), {
    cneTextMode: 'browser'
  });
  assert.equal(hnText.validateHnTextMode('edit').ok, true);
  assert.equal(hnText.validateHnTextMode('browser').ok, true);
  assert.equal(hnText.validateHnTextMode('reading').ok, false);
  assert.deepEqual(hnText.validateSettings({}), {
    ok: true,
    settings: { cneTextMode: 'edit' }
  });
  assert.equal(hnText.validateSettings({ cneTextMode: 'browser' }).ok, true);
  assert.equal(hnText.validateSettings({ cneTextMode: 'reading' }).ok, false);
  assert.equal(hnText.validateSettings(null).ok, false);
  assert.equal(Object.hasOwn(hnText.createEmptyEnvelope(), 'mode'), false);
});

test('empty and count helpers derive from canonical source without trimming authored bytes', () => {
  assert.equal(hnText.isCanonicalEmptyEnvelope(hnText.createEmptyEnvelope()), true);
  assert.equal(hnText.isCanonicalEmptyEnvelope({
    ...hnText.createEmptyEnvelope(),
    source: ' '
  }), false);
  assert.equal(hnText.isCanonicalEmptyEnvelope({
    ...hnText.createEmptyEnvelope(),
    anchors: { future: {} }
  }), false);
  assert.equal(hnText.textualContent({
    ...hnText.createEmptyEnvelope(),
    source: '你 A e\u0301 👨‍👩‍👧‍👦'
  }), '你 A e\u0301 👨‍👩‍👧‍👦');
  assert.equal(hnText.countTextGraphemes('你 A e\u0301 👨‍👩‍👧‍👦\n\t'), 4);
  assert.deepEqual(hnText.statistics('One two\n\nThree'), {
    words: 3,
    paragraphs: 2,
    characters: 11
  });
});
