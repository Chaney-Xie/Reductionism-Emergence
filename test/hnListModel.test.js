const test = require('node:test');
const assert = require('node:assert/strict');

const model = require('../public/hnText');
const numbering = require('../public/hnListNumbering');

function idFactory(prefix = 'rekey') {
  let value = 0;
  return () => `${prefix}-${++value}`;
}

function paragraph(id, text = '', marks = []) {
  return {
    type: 'paragraph',
    attrs: { id },
    ...(text ? {
      content: [{
        type: 'text',
        text,
        ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {})
      }]
    } : {})
  };
}

function item(id, paragraphs, childSequence = null) {
  return {
    type: 'list_item',
    attrs: { id },
    content: [...paragraphs, ...(childSequence ? [childSequence] : [])]
  };
}

function sequence(id, scheme, startOrdinal, items, dottedPrefix) {
  return {
    type: 'list_sequence',
    attrs: {
      id,
      scheme,
      startOrdinal,
      ...(dottedPrefix === undefined ? {} : { dottedPrefix })
    },
    content: items
  };
}

function nestedDocument() {
  const dottedChild = sequence(
    'seq-dotted',
    numbering.SCHEMES.DOTTED_DECIMAL,
    1,
    [item('item-dotted-1', [paragraph('para-dotted-1', 'Dotted child', ['strong'])])],
    [3]
  );
  return {
    type: 'doc',
    content: [
      paragraph('root-paragraph', 'Root'),
      {
        type: 'heading',
        attrs: { id: 'root-heading', level: 2 },
        content: [{ type: 'text', text: 'Heading', marks: [{ type: 'emphasis' }] }]
      },
      sequence('seq-decimal', numbering.SCHEMES.DECIMAL, 3, [
        item('item-decimal-1', [paragraph('para-decimal-1', 'Decimal')], dottedChild),
        item('item-decimal-2', [paragraph('para-decimal-2a', 'Second'), paragraph('para-decimal-2b', 'Continuation')])
      ]),
      sequence('seq-upper-roman', numbering.SCHEMES.UPPER_ROMAN_LEFT, 3998, [
        item('item-upper-roman-1', [paragraph('para-upper-roman-1', 'Roman')]),
        item('item-upper-roman-2', [paragraph('para-upper-roman-2', 'Roman two')])
      ]),
      sequence('seq-lower-roman', numbering.SCHEMES.LOWER_ROMAN_LEFT, 4, [
        item('item-lower-roman', [paragraph('para-lower-roman', 'lower roman')])
      ]),
      sequence('seq-alpha', numbering.SCHEMES.LOWER_ALPHA_LEFT, 27, [
        item('item-alpha', [paragraph('para-alpha', 'alpha', ['strikethrough'])])
      ])
    ]
  };
}

function collectStructuralIds(node, result = []) {
  if (node?.attrs?.id && ['paragraph', 'heading', 'list_sequence', 'list_item'].includes(node.type)) {
    result.push(node.attrs.id);
  }
  if (Array.isArray(node?.content)) node.content.forEach((child) => collectStructuralIds(child, result));
  return result;
}

test('HN schema v3 publishes one source envelope while preserving legacy List factories', () => {
  assert.equal(model.LEGACY_CNE_SCHEMA_VERSION, 1);
  assert.equal(model.STRUCTURED_CNE_SCHEMA_VERSION, 2);
  assert.equal(model.HN_SCHEMA_VERSION, 3);
  assert.deepEqual(model.LIST_SCHEMES, numbering.SCHEME_VALUES);
  assert.deepEqual(model.createEmptyEnvelope(), {
    schemaVersion: 3,
    revision: 0,
    source: '',
    anchors: {}
  });

  const nextId = idFactory('factory');
  const decimal = model.createListSequence(null, { idFactory: nextId });
  assert.deepEqual(decimal.attrs, {
    id: 'factory-1',
    scheme: numbering.SCHEMES.DECIMAL,
    startOrdinal: 1
  });
  assert.equal(decimal.content[0].type, 'list_item');
  assert.equal(decimal.content[0].content[0].type, 'paragraph');
  assert.equal(model.validateDocument({ type: 'doc', content: [decimal] }).ok, true);

  const dotted = model.createListSequence([
    model.createListItem([paragraph('provided-paragraph', 'Nested')], {
      idFactory: nextId
    })
  ], {
    idFactory: nextId,
    scheme: numbering.SCHEMES.DOTTED_DECIMAL,
    startOrdinal: 7,
    dottedPrefix: [3, 4]
  });
  assert.deepEqual(dotted.attrs.dottedPrefix, [3, 4]);
  assert.equal(model.validateDocument({ type: 'doc', content: [dotted] }).ok, true);
  assert.throws(() => model.createListSequence(null, {
    scheme: numbering.SCHEMES.DOTTED_DECIMAL
  }), /dottedPrefix/);
  assert.throws(() => model.createListSequence(null, {
    scheme: numbering.SCHEMES.DECIMAL,
    dottedPrefix: [1]
  }), /Only dotted-decimal/);
});

test('normalization is clone-only and explicit v1 migration produces one v3 source envelope', () => {
  const legacy = {
    schemaVersion: 1,
    revision: 17,
    document: {
      type: 'doc',
      content: [
        paragraph('legacy-paragraph', 'Legacy', ['strong', 'emphasis', 'strikethrough']),
        {
          type: 'heading',
          attrs: { id: 'legacy-heading', level: 6 },
          content: [{ type: 'text', text: 'Heading' }]
        }
      ]
    }
  };
  const normalized = model.normalizeEnvelope(legacy);
  assert.deepEqual(normalized, legacy);
  assert.notEqual(normalized, legacy);
  assert.notEqual(normalized.document, legacy.document);
  assert.deepEqual(collectStructuralIds(normalized.document), collectStructuralIds(legacy.document));
  assert.equal(model.validatePersistedEnvelope(normalized).ok, true);
  assert.equal(model.validateEnvelope(normalized).ok, false);

  const migration = model.migrateLegacyEnvelope(normalized);
  assert.equal(migration.ok, true);
  assert.equal(migration.legacy, true);
  assert.equal(migration.legacySchemaVersion, 1);
  assert.deepEqual(migration.envelope, {
    schemaVersion: 3,
    revision: 17,
    source: '***~~Legacy~~***\n\n###### Heading',
    anchors: {}
  });
  assert.equal(model.validateEnvelope(migration.envelope).ok, true);

  const malformedValues = [
    { ...legacy, extra: true },
    {
      ...legacy,
      document: {
        ...legacy.document,
        content: [paragraph('same-id', 'One'), paragraph('same-id', 'Two')]
      }
    },
    {
      ...legacy,
      document: {
        type: 'doc',
        content: [sequence('legacy-list', numbering.SCHEMES.DECIMAL, 1, [
          item('legacy-item', [paragraph('legacy-list-paragraph', 'Not v1')])
        ])]
      }
    },
    {
      ...legacy,
      document: {
        type: 'doc',
        content: [paragraph('invalid-mark', 'No', ['link'])]
      }
    }
  ];
  malformedValues.forEach((value) => {
    const normalized = model.normalizeEnvelope(value);
    assert.deepEqual(normalized, value);
    assert.equal(normalized.schemaVersion, 1);
  });

  const future = {
    schemaVersion: 99,
    revision: 4,
    document: { type: 'future-doc', content: [{ type: 'future-list', preserve: true }] }
  };
  assert.deepEqual(model.normalizeEnvelope(future), future);
  assert.equal(model.validateEnvelope(future).ok, false);
});

test('strict legacy v2 validation accepts nested Lists and migrates to one v3 source envelope', () => {
  const document = nestedDocument();
  const validation = model.validateDocument(document);
  assert.equal(validation.ok, true, validation.error);
  assert.deepEqual(validation.value, document);
  const legacyV2 = {
    schemaVersion: 2,
    revision: Number.MAX_SAFE_INTEGER,
    document
  };
  assert.equal(model.validateLegacyV2Envelope(legacyV2).ok, true);
  assert.equal(model.validatePersistedEnvelope(legacyV2).ok, true);
  assert.equal(model.validateEnvelope(legacyV2).ok, false);
  const migration = model.migrateLegacyEnvelope(legacyV2);
  assert.equal(migration.ok, true);
  assert.equal(migration.legacySchemaVersion, 2);
  assert.equal(model.validateEnvelope(migration.envelope).ok, true);
  assert.equal(migration.envelope.schemaVersion, 3);
  assert.deepEqual(migration.envelope.anchors, {});
  assert.equal(typeof migration.envelope.source, 'string');

  const duplicate = structuredClone(document);
  duplicate.content[2].content[0].attrs.id = 'root-paragraph';
  const duplicateValidation = model.validateDocument(duplicate);
  assert.equal(duplicateValidation.ok, false);
  assert.ok(duplicateValidation.errors.some(({ code }) => code === 'duplicate-structural-id'));
});

test('strict list validation rejects noncanonical attrs, ranges and hierarchy', () => {
  const base = {
    type: 'doc',
    content: [sequence('sequence', numbering.SCHEMES.DECIMAL, 1, [
      item('item', [paragraph('paragraph', 'One')])
    ])]
  };
  const mutations = [
    (value) => { value.content[0].extra = true; },
    (value) => { value.content[0].attrs.extra = true; },
    (value) => { value.content[0].content[0].extra = true; },
    (value) => { value.content[0].content[0].attrs.extra = true; },
    (value) => { value.content[0].attrs.scheme = 'unordered'; },
    (value) => { value.content[0].attrs.startOrdinal = 0; },
    (value) => { value.content[0].attrs.startOrdinal = 1.5; },
    (value) => { value.content[0].attrs.startOrdinal = Number.MAX_SAFE_INTEGER + 1; },
    (value) => { value.content[0].attrs.dottedPrefix = [1]; },
    (value) => { value.content[0].content = []; },
    (value) => { value.content[0].content[0].content = []; },
    (value) => {
      value.content[0].content[0].content[0] = {
        type: 'heading', attrs: { id: 'heading-in-item', level: 1 }
      };
    },
    (value) => {
      const child = sequence('child', numbering.SCHEMES.DECIMAL, 1, [
        item('child-item', [paragraph('child-paragraph')])
      ]);
      value.content[0].content[0].content = [child, paragraph('after-child')];
    },
    (value) => { value.content = [value.content[0].content[0]]; }
  ];
  mutations.forEach((mutate, index) => {
    const value = structuredClone(base);
    mutate(value);
    assert.equal(model.validateDocument(value).ok, false, `mutation ${index} must reject`);
  });

  for (const dottedPrefix of [undefined, [], [0], [1.5], ['1']]) {
    const value = structuredClone(base);
    value.content[0].attrs.scheme = numbering.SCHEMES.DOTTED_DECIMAL;
    if (dottedPrefix === undefined) delete value.content[0].attrs.dottedPrefix;
    else value.content[0].attrs.dottedPrefix = dottedPrefix;
    assert.equal(model.validateDocument(value).ok, false);
  }

  const overflowingRoman = {
    type: 'doc',
    content: [sequence('roman-sequence', numbering.SCHEMES.UPPER_ROMAN_LEFT, 3999, [
      item('roman-item-1', [paragraph('roman-paragraph-1')]),
      item('roman-item-2', [paragraph('roman-paragraph-2')])
    ])]
  };
  assert.equal(model.validateDocument(overflowingRoman).ok, false);

  const overflowingDecimal = structuredClone(base);
  overflowingDecimal.content[0].attrs.startOrdinal = Number.MAX_SAFE_INTEGER;
  overflowingDecimal.content[0].content.push(
    item('second-item', [paragraph('second-paragraph')])
  );
  assert.equal(model.validateDocument(overflowingDecimal).ok, false);
});

test('structured List paste preserves hierarchy and schemes while re-keying every ID', () => {
  const source = {
    type: 'doc',
    content: [nestedDocument().content[2]]
  };
  source.content[0].ignoredPresentation = { marker: '3.' };
  source.content[0].content[0].attrs.untrusted = 'strip';
  const originalIds = new Set(collectStructuralIds(source));
  const pasted = model.sanitizePastedDocument(source, { idFactory: idFactory('paste') });
  assert.equal(model.validateDocument(pasted).ok, true);
  assert.equal(pasted.content[0].type, 'list_sequence');
  assert.equal(pasted.content[0].attrs.scheme, numbering.SCHEMES.DECIMAL);
  assert.equal(pasted.content[0].attrs.startOrdinal, 3);
  assert.equal(pasted.content[0].content[0].content.at(-1).attrs.scheme,
    numbering.SCHEMES.DOTTED_DECIMAL);
  assert.deepEqual(pasted.content[0].content[0].content.at(-1).attrs.dottedPrefix, [3]);
  assert.equal(Object.hasOwn(pasted.content[0], 'ignoredPresentation'), false);
  assert.equal(Object.hasOwn(pasted.content[0].content[0].attrs, 'untrusted'), false);
  const pastedIds = collectStructuralIds(pasted);
  assert.equal(new Set(pastedIds).size, pastedIds.length);
  assert.equal(pastedIds.some((id) => originalIds.has(id)), false);

  const malformedList = structuredClone(source);
  malformedList.content[0].content[0].content.unshift({
    type: 'table',
    content: [{ type: 'text', text: 'Flatten safely', marks: [{ type: 'link' }] }]
  });
  const flattened = model.sanitizePastedDocument(malformedList, {
    idFactory: idFactory('flat')
  });
  assert.equal(flattened.content[0].type, 'paragraph');
  assert.match(model.textualContent(flattened), /Flatten safely/);
  assert.equal(model.validateDocument(flattened).ok, true);
});

test('text extraction and 字 count include List text but never generated markers', () => {
  const document = {
    type: 'doc',
    content: [
      paragraph('root', 'Root'),
      sequence('sequence', numbering.SCHEMES.DECIMAL, 7, [
        item('item', [
          paragraph('first', 'One'),
          paragraph('second', 'Second paragraph')
        ], sequence('child-sequence', numbering.SCHEMES.LOWER_ALPHA_LEFT, 1, [
          item('child-item', [paragraph('child', 'Child')])
        ]))
      ])
    ]
  };
  assert.equal(model.textualContent(document), 'Root\nOne\nSecond paragraph\nChild');
  assert.doesNotMatch(model.textualContent(document), /7\.|\(a/);
  assert.equal(model.countTextGraphemes(document), 27);
});
