const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const markdown = require('../public/markdownPage');

function loadMarkdownPageViewModel() {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'markdownPageView.js'),
    'utf8'
  );
  const context = { globalThis: { markdownPageModel: markdown } };
  vm.runInNewContext(source, context);
  return context.globalThis.markdownPageView;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('canonical formatting helper wraps exact forward and backward selections', () => {
  const view = loadMarkdownPageViewModel();

  assert.deepEqual(plain(view.toggleMarkdownFormatting(
    'alpha beta',
    { anchor: 0, focus: 5 },
    'bold'
  )), {
    source: '**alpha** beta',
    selection: { anchor: 2, focus: 7 }
  });

  assert.deepEqual(plain(view.toggleMarkdownFormatting(
    'alpha beta',
    { anchor: 5, focus: 0 },
    'italic'
  )), {
    source: '*alpha* beta',
    selection: { anchor: 6, focus: 1 }
  });

  assert.deepEqual(plain(view.toggleMarkdownFormatting(
    'alpha beta',
    { anchor: 0, focus: 5 },
    'underline'
  )), {
    source: '<u>alpha</u> beta',
    selection: { anchor: 3, focus: 8 }
  });
});

test('canonical formatting helper unwraps the matching construct without losing selection direction', () => {
  const view = loadMarkdownPageViewModel();

  assert.deepEqual(plain(view.toggleMarkdownFormatting(
    '**alpha**',
    { anchor: 2, focus: 7 },
    'bold'
  )), {
    source: 'alpha',
    selection: { anchor: 0, focus: 5 }
  });

  assert.deepEqual(plain(view.toggleMarkdownFormatting(
    '*alpha*',
    { anchor: 6, focus: 1 },
    'italic'
  )), {
    source: 'alpha',
    selection: { anchor: 5, focus: 0 }
  });

  assert.deepEqual(plain(view.toggleMarkdownFormatting(
    '<u>alpha</u>',
    { anchor: 3, focus: 8 },
    'underline'
  )), {
    source: 'alpha',
    selection: { anchor: 0, focus: 5 }
  });
});

test('canonical formatting helper composes and independently toggles nested bold and italic', () => {
  const view = loadMarkdownPageViewModel();

  assert.deepEqual(plain(view.toggleMarkdownFormatting(
    '*alpha*',
    { anchor: 1, focus: 6 },
    'bold'
  )), {
    source: '***alpha***',
    selection: { anchor: 3, focus: 8 }
  });

  assert.deepEqual(plain(view.toggleMarkdownFormatting(
    '**alpha**',
    { anchor: 2, focus: 7 },
    'italic'
  )), {
    source: '***alpha***',
    selection: { anchor: 3, focus: 8 }
  });

  assert.deepEqual(plain(view.toggleMarkdownFormatting(
    '***alpha***',
    { anchor: 3, focus: 8 },
    'bold'
  )), {
    source: '*alpha*',
    selection: { anchor: 1, focus: 6 }
  });

  assert.deepEqual(plain(view.toggleMarkdownFormatting(
    '***alpha***',
    { anchor: 3, focus: 8 },
    'italic'
  )), {
    source: '**alpha**',
    selection: { anchor: 2, focus: 7 }
  });
});

test('canonical formatting helper preserves punctuation and soft-line-break bytes', () => {
  const view = loadMarkdownPageViewModel();

  assert.deepEqual(plain(view.toggleMarkdownFormatting(
    'one, two!',
    { anchor: 0, focus: 9 },
    'bold'
  )), {
    source: '**one, two!**',
    selection: { anchor: 2, focus: 11 }
  });

  assert.deepEqual(plain(view.toggleMarkdownFormatting(
    'one\ntwo',
    { anchor: 0, focus: 7 },
    'underline'
  )), {
    source: '<u>one\ntwo</u>',
    selection: { anchor: 3, focus: 10 }
  });

  assert.match(
    markdown.renderMarkdown('**one\ntwo**'),
    /<strong>one\ntwo<\/strong>/
  );
  assert.match(
    markdown.renderMarkdown('<u>one\ntwo<\/u>'),
    /<u>one\ntwo<\/u>/
  );
});

test('safe underline is a semantic inline construct while arbitrary raw HTML stays escaped', () => {
  const construct = markdown.nextInlineConstruct('<u>under **bold**</u>', 0);
  assert.deepEqual(construct, {
    kind: 'underline',
    index: 0,
    end: 21,
    open: '<u>',
    close: '</u>',
    content: 'under **bold**',
    contentStart: 3
  });

  const html = markdown.renderMarkdown(
    '<u>under **bold**</u> and <u onclick="alert(1)">unsafe</u>'
  );
  assert.match(html, /<u>under <strong>bold<\/strong><\/u>/);
  assert.match(html, /&lt;u onclick=&quot;alert\(1\)&quot;&gt;unsafe&lt;\/u&gt;/);
  assert.doesNotMatch(html, /<u\s+onclick=/);
  assert.equal(markdown.readableText('<u>under **bold**</u>'), 'under bold');
});
