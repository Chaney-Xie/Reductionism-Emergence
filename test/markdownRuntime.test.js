const test = require('node:test');
const assert = require('node:assert/strict');

const runtime = require('../public/vendor/markdownRuntime');

function descendants(node) {
  const result = [];
  const visit = (current) => {
    if (!current || typeof current !== 'object') return;
    result.push(current);
    (current.children || []).forEach(visit);
  };
  visit(node);
  return result;
}

test('bundled Markdown runtime parses positioned CommonMark, GFM, and math nodes', () => {
  const source = [
    '# Heading',
    '',
    '~~strike~~ https://example.com',
    '',
    '| A | B |',
    '| :- | -: |',
    '| 1 | 2 |',
    '',
    '- [x] done',
    '',
    '$C_6H_{12}O_6$'
  ].join('\n');
  const tree = runtime.parseMarkdown(source);
  const nodes = descendants(tree);

  assert.equal(tree.position.start.offset, 0);
  assert.equal(tree.position.end.offset, source.length);
  assert.ok(nodes.some((node) => node.type === 'heading' && node.depth === 1));
  assert.ok(nodes.some((node) => node.type === 'delete' && node.value === undefined));
  assert.ok(nodes.some((node) => node.type === 'link' && node.url === 'https://example.com'));
  assert.ok(nodes.some((node) => node.type === 'table'));
  assert.ok(nodes.some((node) => node.type === 'listItem' && node.checked === true));
  assert.ok(nodes.some((node) => node.type === 'inlineMath' && node.value === 'C_6H_{12}O_6'));

  nodes.filter((node) => node.position).forEach((node) => {
    const { start, end } = node.position;
    assert.equal(typeof start.offset, 'number');
    assert.equal(typeof end.offset, 'number');
    assert.ok(start.offset <= end.offset);
    assert.equal(source.slice(start.offset, end.offset).length, end.offset - start.offset);
  });
});

test('bundled highlighter uses only declared local languages and safely falls back', () => {
  const javascript = runtime.highlightCode('const value = 1;', 'js');
  assert.equal(javascript.language, 'javascript');
  assert.equal(javascript.displayName, 'JavaScript');
  assert.equal(javascript.known, true);
  assert.match(javascript.html, /hljs-keyword[^>]*>const</);

  const unknown = runtime.highlightCode('<script>alert(1)</script>', 'future-lang');
  assert.equal(unknown.language, '');
  assert.equal(unknown.displayName, 'future-lang');
  assert.equal(unknown.known, false);
  assert.equal(unknown.html, '&lt;script&gt;alert(1)&lt;/script&gt;');

  assert.deepEqual(
    runtime.languageMetadata.map((language) => language.label),
    [
      'Plain Text', 'JavaScript', 'TypeScript', 'JSON', 'HTML/XML', 'CSS',
      'Python', 'R', 'Bash/Shell', 'SQL', 'Java', 'C', 'C++', 'C#', 'Rust',
      'Go', 'MATLAB', 'Markdown', 'YAML', 'LaTeX'
    ]
  );
});

test('bundled KaTeX renders matrices and mhchem without a runtime network dependency', () => {
  const matrix = runtime.renderLatex(String.raw`\begin{pmatrix}a & b \\ c & d\end{pmatrix}`, {
    displayMode: true
  });
  assert.match(matrix, /class="katex-display"/);
  assert.match(matrix, /mtable/);
  assert.doesNotMatch(matrix, /katex-error/);

  const chemistry = runtime.renderLatex(String.raw`\ce{ATP + H2O -> ADP + P_i}`);
  assert.match(chemistry, /class="katex"/);
  assert.doesNotMatch(chemistry, /katex-error/);

  const invalid = runtime.renderLatex(String.raw`\frac{`);
  assert.match(invalid, /katex-error/);
  assert.match(invalid, /\\frac/);
});

test('fenced-code corpus preserves CommonMark fence semantics and exact positioned source', () => {
  const cases = [
    {
      name: 'tilde fence',
      source: '~~~python\nprint(1)\n~~~',
      language: 'python',
      meta: null,
      value: 'print(1)'
    },
    {
      name: 'four-backtick fence containing a shorter run',
      source: '````javascript\nconst ticks = ```;\n````',
      language: 'javascript',
      meta: null,
      value: 'const ticks = ```;'
    },
    {
      name: 'five-backtick fence containing four backticks',
      source: '`````markdown\n```` is content\n`````',
      language: 'markdown',
      meta: null,
      value: '```` is content'
    },
    {
      name: 'closing fence longer than opening fence',
      source: '```js\nconst value = 1;\n`````',
      language: 'js',
      meta: null,
      value: 'const value = 1;'
    },
    {
      name: 'empty plain-text fence',
      source: '```\n```',
      language: null,
      meta: null,
      value: ''
    },
    {
      name: 'unknown language and preserved metadata',
      source: '````unknown-language meta stays\n$x^2$ and `tick`\n````',
      language: 'unknown-language',
      meta: 'meta stays',
      value: '$x^2$ and `tick`'
    },
    {
      name: 'known language and exact metadata',
      source: '```javascript title="demo" extra\nconst value = 1;\n```',
      language: 'javascript',
      meta: 'title="demo" extra',
      value: 'const value = 1;'
    }
  ];

  for (const fixture of cases) {
    const prefix = 'Before\n\n';
    const suffix = '\n\nAfter';
    const canonical = `${prefix}${fixture.source}${suffix}`;
    const tree = runtime.parseMarkdown(canonical);
    const code = descendants(tree).find((node) => node.type === 'code');

    assert.ok(code, `${fixture.name}: expected one code node`);
    assert.equal(code.lang ?? null, fixture.language, `${fixture.name}: language`);
    assert.equal(code.meta ?? null, fixture.meta, `${fixture.name}: metadata`);
    assert.equal(code.value, fixture.value, `${fixture.name}: code body`);
    assert.equal(code.position.start.offset, prefix.length, `${fixture.name}: start offset`);
    assert.equal(
      code.position.end.offset,
      prefix.length + fixture.source.length,
      `${fixture.name}: end offset`
    );
    assert.equal(
      canonical.slice(code.position.start.offset, code.position.end.offset),
      fixture.source,
      `${fixture.name}: positioned slice must be exact canonical source`
    );

    if (fixture.value.includes('$x^2$')) {
      const codeDescendants = descendants(code);
      assert.equal(
        codeDescendants.some((node) => node.type === 'inlineMath' || node.type === 'math'),
        false,
        `${fixture.name}: dollar syntax inside code must not become math`
      );
    }
  }
});

test('every configured fenced-code language produces declared local highlighting', () => {
  const snippets = {
    plaintext: 'plain text',
    javascript: 'const value = 1;',
    typescript: 'interface User { name: string }',
    json: '{"value": true}',
    xml: '<section class="value">Hello</section>',
    css: '.value { color: red; }',
    python: 'def value():\n    return 1',
    r: 'value <- function(x) x + 1',
    bash: 'echo "$HOME"',
    sql: 'SELECT value FROM table_name;',
    java: 'public class Main { int value = 1; }',
    c: 'int main(void) { return 0; }',
    cpp: 'class Value { public: int x; };',
    csharp: 'public class Value { public int X { get; set; } }',
    rust: 'fn main() { let value = 1; }',
    go: 'package main\nfunc main() { value := 1 }',
    matlab: 'function y = square(x)\n  y = x.^2;\nend',
    markdown: '# Heading\n\n**bold**',
    yaml: 'value: true\nitems:\n  - one',
    latex: String.raw`\frac{a}{b} + \alpha`
  };

  assert.equal(runtime.languageMetadata.length, 20);
  for (const language of runtime.languageMetadata) {
    const snippet = snippets[language.id];
    assert.equal(typeof snippet, 'string', `${language.label}: representative snippet`);
    const highlighted = runtime.highlightCode(snippet, language.id);

    assert.equal(highlighted.known, true, `${language.label}: configured language is known`);
    assert.equal(highlighted.language, language.id, `${language.label}: resolved grammar`);
    assert.equal(highlighted.displayName, language.label, `${language.label}: display label`);
    if (language.id === 'plaintext') {
      assert.equal(highlighted.html, snippet);
      assert.doesNotMatch(highlighted.html, /class="hljs-/);
    } else {
      assert.match(
        highlighted.html,
        /<span class="hljs-[^"]+">/,
        `${language.label}: expected a real highlight.js token span`
      );
    }
  }

  const unknownSource = '<script>alert("$x^2$")</script>';
  const unknown = runtime.highlightCode(unknownSource, 'future-language');
  assert.equal(unknown.known, false);
  assert.equal(unknown.language, '');
  assert.equal(unknown.displayName, 'future-language');
  assert.equal(unknown.html, '&lt;script&gt;alert(&quot;$x^2$&quot;)&lt;/script&gt;');
  assert.doesNotMatch(unknown.html, /<script|class="hljs-/);
});
