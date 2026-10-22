'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const markdown = require('../public/markdownPage');
const pageTypes = require('../public/pageTypes');
const hnText = require('../public/hnText');
const {
  descendants,
  loadMarkdownPageViewInternals,
  renderSemanticSegments
} = require('./helpers/markdownFakeDom');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function elements(rootNodes, className) {
  return rootNodes.filter((node) => (
    node?.nodeType === 1 && node.classList.contains(className)
  ));
}

function renderReading(source) {
  const view = loadMarkdownPageViewInternals([
    'semanticSyntaxSegments',
    'renderSemanticBlockContents'
  ]);
  const rendered = renderSemanticSegments(view, source, { mode: 'reading' });
  return rendered.blocks.flatMap((block) => descendants(block.element));
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  (node.children || []).forEach((child) => walk(child, visit));
}

test('the five inline families share one Paragraph softbreak representation', () => {
  const fixtures = [
    'text A\ntext B',
    '*italic A*\ntext B',
    '~~strike A~~\n<u>underline B</u>',
    '`code A`\ntext B',
    '[link A](https://example.test)\ntext B'
  ];

  fixtures.forEach((source) => {
    const tree = markdown.parseMarkdownDocument(source);
    assert.equal(tree.children.length, 1, source);
    assert.equal(tree.children[0].type, 'paragraph', source);
    assert.equal(
      elements(renderReading(source), 'markdown-source-line-break').length,
      1,
      source
    );
  });
});

test('the preference changes Reading whitespace only, not Paragraph, hardbreak, or List ASTs', () => {
  const paragraphSource = 'Alpha\nBeta';
  const blankLineSource = 'Alpha\n\nBeta';
  const hardbreakSource = 'Alpha  \nBeta';
  const listSource = '1. Parent\n\t1. Child\n\nFollowing Paragraph';

  assert.deepEqual(
    markdown.parseMarkdownDocument(paragraphSource),
    markdown.parseMarkdownDocument(paragraphSource),
    'the setting does not enter the parser API'
  );
  assert.deepEqual(
    markdown.parseMarkdownDocument(blankLineSource).children.map(({ type }) => type),
    ['paragraph', 'paragraph']
  );

  const hardbreakTypes = [];
  walk(markdown.parseMarkdownDocument(hardbreakSource), ({ type }) => hardbreakTypes.push(type));
  assert.equal(hardbreakTypes.filter((type) => type === 'break').length, 1);

  const listTree = markdown.parseMarkdownDocument(listSource);
  assert.deepEqual(listTree.children.map(({ type }) => type), ['list', 'paragraph']);
  const lists = [];
  walk(listTree, (node) => { if (node.type === 'list') lists.push(node); });
  assert.equal(lists.length, 2, 'strict-Tab child remains a semantic nested List');

  const underlineTree = markdown.parseMarkdownDocument('~~strike~~\n<u>underline</u>');
  const htmlTokens = [];
  walk(underlineTree, (node) => { if (node.type === 'html') htmlTokens.push(node.value); });
  assert.deepEqual(htmlTokens, ['<u>', '</u>']);
});

test('Reading has one root-scoped softbreak switch while Source, Live, and quote policy stay unchanged', () => {
  const styles = read('public/styles.css');
  assert.match(styles, /\.markdown-source-line-break\s*\{[^}]*white-space:\s*normal;/);
  assert.match(
    styles,
    /:root\[data-markdown-preserve-single-line-breaks=['"]true['"]\][^{]*\.markdown-page-layer\.is-reading[^{]*\.markdown-source-line-break\s*\{[^}]*white-space:\s*pre;/
  );
  assert.match(
    styles,
    /\.markdown-page-layer\.is-reading\s+\.markdown-page-quote \.markdown-source-line-break\s*\{[^}]*white-space:\s*pre;/
  );
  assert.doesNotMatch(
    styles,
    /data-markdown-preserve-single-line-breaks=['"]true['"][^{]*\.markdown-page-layer\.is-(?:source|live-preview)/
  );
});

test('preference application flips one document attribute without rerendering mounted panes', () => {
  const app = read('public/app.js');
  const source = app.slice(
    app.indexOf('function applyVaultMarkdownPreferences'),
    app.indexOf('function queueVaultMarkdownPreferenceIntent')
  );
  const attributes = new Map();
  const documentElement = {
    setAttribute(name, value) {
      attributes.set(name, String(value));
    }
  };
  const context = vm.createContext({
    document: { documentElement },
    pageTypesModel: pageTypes,
    markdownPageModel: markdown,
    hnTextModel: hnText,
    vaultPreferences: markdown.normalizeSettings({ defaultPageType: 'markdown' }),
    pageIndex: { pages: [] },
    renderPageList() {},
    refreshAllMarkdownPaneViews() {
      throw new Error('Reading preference must not rerender Pane views.');
    },
    refreshAllHnTextPaneViews() {
      throw new Error('Reading preference must not rerender Pane views.');
    },
    activePaneRuntime: () => ({ id: 'active-runtime' }),
    refreshMarkdownControlStrip() {},
    refreshHnTextControlStrip() {}
  });
  vm.runInContext(`${source}\nglobalThis.applyPreference = applyVaultMarkdownPreferences;`, context);

  context.applyPreference({
    defaultPageType: 'markdown',
    lastMarkdownMode: 'reading',
    preserveSingleLineBreaks: false
  }, { rerender: false });
  assert.equal(attributes.get('data-markdown-preserve-single-line-breaks'), 'false');

  context.applyPreference({
    defaultPageType: 'markdown',
    lastMarkdownMode: 'reading',
    preserveSingleLineBreaks: true
  }, { rerender: false });
  assert.equal(attributes.get('data-markdown-preserve-single-line-breaks'), 'true');

  context.applyPreference({
    ...context.vaultPreferences,
    preserveSingleLineBreaks: false
  }, { rerender: false });
  assert.equal(attributes.get('data-markdown-preserve-single-line-breaks'), 'false');
});

test('Vault Settings owns the only new toggle and saves it through the canonical Vault preference queue', () => {
  const [html, settings, app, bootstrap, server] = [
    'public/index.html',
    'public/js/vaultSettings.js',
    'public/app.js',
    'public/js/appBootstrap.js',
    'server/appServer.js'
  ].map(read);
  const preference = html.match(
    /<div id="vault-settings-control-panel"[\s\S]*?<div id="vault-settings-appearance-panel"/
  )?.[0] || '';
  const positions = [
    preference.indexOf('id="zoom-sensitivity-slider"'),
    preference.indexOf('id="vault-default-page-type"'),
    preference.indexOf('id="preserve-single-line-breaks-switch"')
  ];
  assert.equal(positions.every((position) => position >= 0), true);
  assert.equal(positions[0] < positions[1] && positions[1] < positions[2], true);
  assert.equal((html.match(/id="preserve-single-line-breaks-switch"/g) || []).length, 1);
  assert.match(settings, /queueVaultMarkdownPreferenceSave\(\{ preserveSingleLineBreaks \}\)/);
  assert.match(settings, /applyVaultMarkdownPreferences\([\s\S]*?\{ rerender: false \}\)/);
  assert.match(app, /data-markdown-preserve-single-line-breaks/);
  assert.match(bootstrap, /applyVaultMarkdownPreferences\(vaultPreferences, \{ rerender: false \}\)/);
  assert.match(server, /Object\.hasOwn\(changes, 'preserveSingleLineBreaks'\)/);
});
