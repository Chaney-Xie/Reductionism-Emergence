const test = require('node:test');
const assert = require('node:assert/strict');

const structuredTextCountModel = require('../public/structuredTextCount');
const markdownPageModel = require('../public/markdownPage');
const hnTextModel = require('../public/hnText');

const EXPECTED_EQUIVALENT_STATISTICS = Object.freeze({
  words: 7,
  paragraphs: 3,
  characters: 32
});

function equivalentHnDocument() {
  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { id: 'heading-id-is-not-visible-text', level: 1 },
        content: [{ type: 'text', text: 'Alpha beta' }]
      },
      {
        type: 'paragraph',
        attrs: { id: 'paragraph-id-is-not-visible-text' },
        content: [
          { type: 'text', text: 'Gamma', marks: [{ type: 'strong' }] },
          {
            type: 'text',
            text: ' delta.',
            marks: [{ type: 'emphasis' }, { type: 'strikethrough' }]
          }
        ]
      },
      {
        type: 'list_sequence',
        attrs: {
          id: 'sequence-id-is-not-visible-text',
          scheme: 'decimal',
          startOrdinal: 99
        },
        content: [
          {
            type: 'list_item',
            attrs: { id: 'item-id-is-not-visible-text-1' },
            content: [{
              type: 'paragraph',
              attrs: { id: 'list-paragraph-id-1' },
              content: [{ type: 'text', text: 'Five one!' }]
            }]
          },
          {
            type: 'list_item',
            attrs: { id: 'item-id-is-not-visible-text-2' },
            content: [{
              type: 'paragraph',
              attrs: { id: 'list-paragraph-id-2' },
              content: [{ type: 'text', text: 'Six?' }]
            }]
          }
        ]
      },
      {
        type: 'paragraph',
        attrs: { id: 'empty-block-is-not-a-paragraph-unit' }
      },
      {
        type: 'future-root-node',
        attrs: { id: 'unsupported-future-node' },
        content: [{ type: 'text', text: 'Must never affect current Count semantics' }]
      }
    ]
  };
}

class FakeContainer {
  constructor(name) {
    this.name = name;
    this.children = [];
    this.parentElement = null;
  }

  append(node) {
    return this.insertBefore(node, null);
  }

  insertBefore(node, reference) {
    if (node.parentElement) {
      const previousIndex = node.parentElement.children.indexOf(node);
      if (previousIndex >= 0) node.parentElement.children.splice(previousIndex, 1);
    }
    const referenceIndex = reference === null ? -1 : this.children.indexOf(reference);
    if (reference !== null && referenceIndex < 0) {
      throw new Error(`${this.name} does not own the requested reference node.`);
    }
    const insertionIndex = referenceIndex < 0 ? this.children.length : referenceIndex;
    this.children.splice(insertionIndex, 0, node);
    node.parentElement = this;
    return node;
  }
}

class FakeCountRoot {
  constructor() {
    this.parentElement = null;
    this.attributes = new Map();
    this.fields = Object.fromEntries(['words', 'characters', 'paragraphs']
      .map((name) => [name, { name, textContent: '0', parentElement: this }]));
  }

  querySelector(selector) {
    const match = /^\[data-count-field="([a-z]+)"\]$/.exec(selector);
    return match ? this.fields[match[1]] ?? null : null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  cloneNode() {
    throw new Error('The canonical Count presentation must never be cloned.');
  }
}

test('Markdown and HN adapters produce the same canonical Count fields', () => {
  const markdown = [
    '# Alpha beta',
    '',
    '**Gamma** delta.',
    '',
    '- Five one!',
    '- Six?',
    '',
    ''
  ].join('\n');

  assert.deepEqual(
    markdownPageModel.statistics(markdown),
    EXPECTED_EQUIVALENT_STATISTICS
  );
  assert.deepEqual(
    hnTextModel.statistics(equivalentHnDocument()),
    EXPECTED_EQUIVALENT_STATISTICS
  );
});

test('HN Count excludes marks, stable IDs, generated list markers and unsupported roots', () => {
  const documentValue = equivalentHnDocument();
  const statistics = hnTextModel.statistics(documentValue);

  assert.deepEqual(statistics, EXPECTED_EQUIVALENT_STATISTICS);
  assert.equal(statistics.paragraphs, 3,
    'a visible root ListSequence is one bracketed Count block');

  documentValue.content[2].attrs.startOrdinal = 3_000;
  documentValue.content[2].attrs.id = 'different-generated-sequence-id';
  documentValue.content[0].content[0].marks = [{ type: 'strikethrough' }];
  documentValue.content.at(-1).content[0].text = 'Still unsupported and invisible';
  assert.deepEqual(hnTextModel.statistics(documentValue), statistics);
});

test('the shared character field preserves Markdown code-point semantics', () => {
  assert.deepEqual(
    structuredTextCountModel.statisticsFromTextBlocks(['e\u0301 👨‍👩‍👧‍👦']),
    { words: 1, paragraphs: 1, characters: 9 },
    'combining marks and ZWJ code points must not silently switch to HN grapheme semantics'
  );
  assert.deepEqual(
    structuredTextCountModel.statisticsFromTextBlocks(['', ' \n\t ', null, undefined]),
    { words: 0, paragraphs: 0, characters: 0 },
    'empty text blocks do not create bracketed paragraph units'
  );
});

test('one Count presentation root moves between Markdown and HN without cloning', () => {
  const countRoot = new FakeCountRoot();
  const markdownStrip = new FakeContainer('Markdown strip');
  const markdownZoom = { parentElement: null };
  markdownStrip.append(markdownZoom);
  const hnStrip = new FakeContainer('HN strip');
  const hnZoom = { parentElement: null };
  hnStrip.append(hnZoom);

  const presentation = structuredTextCountModel.createCountPresentation(countRoot);
  assert.equal(presentation.element, countRoot);
  assert.equal(presentation.mount(markdownStrip, markdownZoom), countRoot);
  assert.deepEqual(markdownStrip.children, [countRoot, markdownZoom]);

  assert.deepEqual(presentation.update(EXPECTED_EQUIVALENT_STATISTICS),
    EXPECTED_EQUIVALENT_STATISTICS);
  assert.equal(countRoot.fields.words.textContent, '7');
  assert.equal(countRoot.fields.characters.textContent, '32');
  assert.equal(countRoot.fields.paragraphs.textContent, '3');
  assert.equal(countRoot.getAttribute('aria-label'),
    '7 words or character units, 32 visible characters, 3 paragraphs');

  assert.equal(presentation.mount(hnStrip, hnZoom), countRoot);
  assert.deepEqual(markdownStrip.children, [markdownZoom]);
  assert.deepEqual(hnStrip.children, [countRoot, hnZoom]);
  assert.equal(countRoot.parentElement, hnStrip);
  assert.equal(
    [...markdownStrip.children, ...hnStrip.children]
      .filter((node) => node === countRoot).length,
    1,
    'the exact canonical Count root is reparented, not copied'
  );
});
