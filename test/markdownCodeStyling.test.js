const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const appearance = require('../public/appearanceSettings');
const markdown = require('../public/markdownPage');
const runtime = require('../public/vendor/markdownRuntime');

const DEFAULT_CODE_PALETTE = Object.freeze({
  '--code-fg': '#696969',
  '--code-muted': '#7A7A7A',
  '--code-comment': '#4F7240',
  '--code-keyword': '#9B4B95',
  '--code-control': '#9B4B95',
  '--code-string': '#9D5639',
  '--code-number': '#517240',
  '--code-function': '#6C6C2D',
  '--code-variable': '#026EA8',
  '--code-type': '#247565',
  '--code-class': '#247565',
  '--code-property': '#026EA8',
  '--code-constant': '#006EAA',
  '--code-tag': '#286DA6',
  '--code-attribute': '#026EA8',
  '--code-regexp': '#BD3A3A',
  '--code-operator': '#696969',
  '--code-punctuation': '#696969',
  '--code-invalid': '#D30D0D'
});

async function styles() {
  return fs.readFile(path.join(__dirname, '../public/styles.css'), 'utf8');
}

function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
    .map((match) => match[1])
    .join('\n');
}

test('code palette retains approved Dark+ roles and adjusts only for Group 2 contrast', () => {
  assert.deepEqual(appearance.CODE_PALETTE, {
    '--code-fg': '#D4D4D4',
    '--code-muted': '#808080',
    '--code-comment': '#6A9955',
    '--code-keyword': '#C586C0',
    '--code-control': '#C586C0',
    '--code-string': '#CE9178',
    '--code-number': '#B5CEA8',
    '--code-function': '#DCDCAA',
    '--code-variable': '#9CDCFE',
    '--code-type': '#4EC9B0',
    '--code-class': '#4EC9B0',
    '--code-property': '#9CDCFE',
    '--code-constant': '#4FC1FF',
    '--code-tag': '#569CD6',
    '--code-attribute': '#9CDCFE',
    '--code-regexp': '#D16969',
    '--code-operator': '#D4D4D4',
    '--code-punctuation': '#D4D4D4',
    '--code-invalid': '#F44747'
  });

  const surface = appearance.DEFAULT_APPEARANCE.guideSurfaceColour;
  const palette = appearance.codePaletteVariables(surface);
  assert.deepEqual(palette, DEFAULT_CODE_PALETTE);
  for (const [name, colour] of Object.entries(palette)) {
    const minimum = name === '--code-muted' ? 3.5 : 4.5;
    assert.ok(
      appearance.colourContrastRatio(colour, surface) >= minimum,
      `${name} must remain readable on the active Group 2 surface`
    );
    assert.notEqual(colour, '#000000');
  }

  const darkPalette = appearance.codePaletteVariables('#1E1E1E');
  assert.equal(darkPalette['--code-fg'], appearance.CODE_PALETTE['--code-fg']);
  assert.equal(darkPalette['--code-variable'], appearance.CODE_PALETTE['--code-variable']);
  for (const [name, colour] of Object.entries(darkPalette)) {
    const minimum = name === '--code-muted' ? 3.5 : 4.5;
    assert.ok(appearance.colourContrastRatio(colour, '#1E1E1E') >= minimum);
  }
});

test('inline and fenced code keep semantic text in the Page colour', async () => {
  const css = await styles();
  const inline = ruleBody(css, '.markdown-page-inline-code');
  const block = ruleBody(css, '.markdown-page-code-block');
  const highlighter = ruleBody(css, '.markdown-page-code-block .hljs');
  const inlineContent = ruleBody(
    css,
    '.markdown-page-inline-code > .markdown-inline-code-source-content,\n.markdown-page-inline-code > .markdown-inline-code-rendered'
  );
  const languageControl = ruleBody(css, '.markdown-code-language-control');
  const languageTargets = ruleBody(css, '.markdown-code-language-selector,\n.markdown-code-language-copy');
  const languageSelector = ruleBody(css, '.markdown-code-language-selector');
  const languageCopy = ruleBody(css, '.markdown-code-language-copy');
  const languageIcon = ruleBody(css, '.markdown-code-language-icon');

  assert.match(inline, /background:\s*var\(--md-code-background, var\(--surface-guide\)\)/);
  assert.match(inline, /color:\s*inherit/);
  assert.match(inline, /font-family:\s*var\(--font-page-family\)/);
  assert.match(inline, /font-size:\s*0\.9em/);
  assert.match(inline, /vertical-align:\s*baseline/);
  assert.match(inlineContent, /color:\s*inherit/);
  assert.match(block, /background:\s*var\(--md-code-background, var\(--surface-guide\)\)/);
  assert.match(block, /border:\s*1px solid var\(--md-code-border, var\(--border-guide\)\)/);
  assert.match(block, /color:\s*inherit/);
  assert.match(block, /font-family:\s*ui-monospace/);
  assert.match(highlighter, /background:\s*transparent/);
  assert.match(languageControl, /color:\s*var\(--code-variable\)/);
  assert.match(languageControl, /background:\s*transparent/);
  assert.match(languageControl, /border:\s*0/);
  assert.match(languageControl, /box-shadow:\s*none/);
  assert.match(languageControl, /padding:\s*0/);
  assert.match(languageControl, /font:\s*600 0\.72rem\/1\.2 var\(--font-page-family\)/);
  assert.match(languageTargets, /appearance:\s*none/);
  assert.match(languageTargets, /background:\s*transparent/);
  assert.match(languageTargets, /border:\s*0/);
  assert.match(languageTargets, /box-shadow:\s*none/);
  assert.match(languageTargets, /font:\s*inherit/);
  assert.match(languageSelector, /color:\s*var\(--code-muted\)/);
  assert.match(languageCopy, /color:\s*var\(--code-variable\)/);
  assert.match(languageIcon, /color:\s*inherit/);
  assert.match(css, /\.markdown-code-language-selector:not\(\.is-display-only\):hover[^}]*text-decoration:\s*underline/);
  assert.match(css, /\.markdown-code-language-copy:hover[^}]*text-decoration:\s*underline/);

  assert.match(css, /\.markdown-page-inline-code > \.markdown-source-marker\s*\{[^}]*var\(--md-symbol-group-2, var\(--code-muted\)\)/);
  assert.match(css, /\.markdown-page-code-shell\.is-fenced[\s\S]*?\.markdown-page-code-block > \.markdown-source-marker\s*\{[^}]*var\(--md-symbol-group-2, var\(--code-muted\)\)/);
  for (const selector of [
    '.markdown-page-code-block .hljs-regexp',
    '.markdown-page-code-block .hljs-property',
    '.markdown-page-code-block .hljs-selector-class',
    '.markdown-page-code-block .hljs-selector-pseudo',
    '.markdown-page-code-block .hljs-operator'
  ]) {
    assert.match(ruleBody(css, selector), /color:\s*inherit/);
  }
  const colourRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match) => ({ selector: match[1], body: match[2] }))
    .filter(({ selector, body }) => (
      /color\s*:/.test(body)
      && (
        (selector.includes('.markdown-page-code-block') && selector.includes('.hljs-'))
        || selector.includes('.markdown-code-token.is-')
      )
    ));
  assert.ok(colourRules.length >= 20, 'all highlighted and fallback token families are covered');
  colourRules.forEach(({ selector, body }) => {
    assert.match(body, /color:\s*inherit/, `${selector.trim()} keeps Page text colour`);
    assert.doesNotMatch(body, /color:\s*var\(--code-/);
  });
  assert.doesNotMatch(css, /--markdown-code-/);
});

test('representative bundled languages emit classes covered by semantic code styling', () => {
  const fixtures = [
    {
      language: 'javascript',
      source: '// note\nfunction greet(name) { const count = 2; return "hello"; }\nconst re = /ab+/g;',
      classes: ['comment', 'keyword', 'title function_', 'params', 'number', 'string', 'regexp']
    },
    {
      language: 'python',
      source: '# note\ndef greet(name):\n    return "hello" + str(2)',
      classes: ['comment', 'keyword', 'title function_', 'params', 'string', 'built_in', 'number']
    },
    {
      language: 'json',
      source: '{"name":"demo","count":2,"enabled":true}',
      classes: ['punctuation', 'attr', 'string', 'number', 'literal']
    },
    {
      language: 'xml',
      source: '<section class="demo">Hello</section>',
      classes: ['tag', 'name', 'attr', 'string']
    },
    {
      language: 'css',
      source: '.demo:hover { color: rgb(1, 2, 3); }',
      classes: ['selector-class', 'selector-pseudo', 'attribute', 'built_in', 'number']
    }
  ];

  for (const fixture of fixtures) {
    const highlighted = runtime.highlightCode(fixture.source, fixture.language);
    for (const className of fixture.classes) {
      assert.match(
        highlighted.html,
        new RegExp(`class="hljs-${className.replace(' ', ' ')}"`),
        `${fixture.language} should expose ${className}`
      );
    }
  }

  const plain = runtime.highlightCode('const plain = "$x^2$";', 'plaintext');
  assert.equal(plain.html, 'const plain = &quot;$x^2$&quot;;');
  assert.doesNotMatch(plain.html, /class="hljs-/);
});

test('static Markdown previews share the inline and fenced code presentation classes', () => {
  const source = [
    'Use `value` here.',
    '',
    '```javascript',
    'const value = 2;',
    '```'
  ].join('\n');
  const html = markdown.renderMarkdown(source);
  assert.match(html, /<code class="markdown-page-inline-code">value<\/code>/);
  assert.match(html, /<pre class="markdown-page-code-block"><code class="hljs language-javascript">/);
  assert.match(html, /markdown-code-language-control is-display-only/);
  assert.match(html, /markdown-code-language-icon/);
  assert.match(html, /markdown-code-language-name[^>]*>JavaScript</);
  assert.match(html, /data-markdown-semantic-only="true"/);
});
