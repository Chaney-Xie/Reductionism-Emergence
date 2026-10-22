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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function mathMlFrom(rendered) {
  return rendered.match(/<math\b[^>]*>[\s\S]*?<\/math>/)?.[0] || '';
}

function semanticMathText(mathMl) {
  return mathMl
    .replace(/<annotation\b[^>]*>[\s\S]*?<\/annotation>/g, '')
    .replace(/<[^>]*>/g, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const latexCorpus = [
  ...[
    [String.raw`x^2`, 'msup', ['x', '2']],
    [String.raw`x^{12}`, 'msup', ['x', '12']],
    [String.raw`x_i`, 'msub', ['x', 'i']],
    [String.raw`x_{ij}`, 'msub', ['x', 'ij']],
    [String.raw`x_i^2`, 'msubsup', ['x', 'i', '2']],
    [String.raw`Ca^{2+}`, 'msup', ['Ca', '2', '+']],
    [String.raw`H_2O`, 'msub', ['H', '2', 'O']]
  ].map(([source, expectedTag, textIncludes]) => ({
    group: 'superscript and subscript', source, expectedTag, textIncludes
  })),
  ...[
    [String.raw`\frac{a}{b}`, 'mfrac', ['a', 'b']],
    [String.raw`\sqrt{x}`, 'msqrt', ['x']],
    [String.raw`\sqrt[3]{x}`, 'mroot', ['3', 'x']]
  ].map(([source, expectedTag, textIncludes]) => ({
    group: 'fractions and roots', source, expectedTag, textIncludes
  })),
  ...[
    [String.raw`\alpha`, 'α'], [String.raw`\beta`, 'β'],
    [String.raw`\gamma`, 'γ'], [String.raw`\delta`, 'δ'],
    [String.raw`\Delta`, 'Δ'], [String.raw`\epsilon`, 'ϵ'],
    [String.raw`\theta`, 'θ'], [String.raw`\lambda`, 'λ'],
    [String.raw`\mu`, 'μ'], [String.raw`\pi`, 'π'],
    [String.raw`\rho`, 'ρ'], [String.raw`\sigma`, 'σ'],
    [String.raw`\phi`, 'ϕ'], [String.raw`\omega`, 'ω'],
    [String.raw`\Omega`, 'Ω']
  ].map(([source, expected]) => ({
    group: 'Greek letters', source, expectedTag: 'mi', textIncludes: [expected]
  })),
  ...[
    [String.raw`\times`, '×'], [String.raw`\cdot`, '⋅'],
    [String.raw`\pm`, '±'], [String.raw`\mp`, '∓'],
    [String.raw`\neq`, '≠'], [String.raw`\approx`, '≈'],
    [String.raw`\equiv`, '≡'], [String.raw`\leq`, '≤'],
    [String.raw`\geq`, '≥'], [String.raw`\propto`, '∝'],
    [String.raw`\infty`, '∞']
  ].map(([source, expected]) => ({
    group: 'relations and operators', source,
    expectedTag: source === String.raw`\infty` ? 'mi' : 'mo',
    textIncludes: [expected]
  })),
  ...[
    [String.raw`\rightarrow`, '→'], [String.raw`\leftarrow`, '←'],
    [String.raw`\leftrightarrow`, '↔'], [String.raw`\rightleftharpoons`, '⇌'],
    [String.raw`\Longrightarrow`, '⟹'],
    [String.raw`\xrightarrow{\text{enzyme}}`, '→', 'enzyme'],
    [String.raw`\xleftrightarrow{}`, '↔']
  ].map(([source, ...expected]) => ({
    group: 'arrows', source, expectedTag: 'mo', textIncludes: expected
  })),
  ...[
    [String.raw`\text{rate limiting step}`, 'rate limiting step'],
    [String.raw`\mathrm{ATP}`, 'ATP'],
    [String.raw`\mathrm{NADH}`, 'NADH'],
    [String.raw`\operatorname{pH}`, 'pH']
  ].map(([source, expected]) => ({
    group: 'text and upright symbols', source,
    expectedTag: source.startsWith(String.raw`\text`) ? 'mtext' : 'mi',
    textIncludes: [expected]
  })),
  ...[
    [String.raw`\sum_{i=1}^{n}`, '∑', 'i', 'n'],
    [String.raw`\prod_{i=1}^{n}`, '∏', 'i', 'n'],
    [String.raw`\int_a^b`, '∫', 'a', 'b'],
    [String.raw`\oint`, '∮'],
    [String.raw`\lim_{x\to0}`, 'lim', 'x', '0']
  ].map(([source, ...expected]) => ({
    group: 'large operators', source, expectedTag: 'mo', textIncludes: expected
  })),
  ...[
    [String.raw`\left( \frac{a}{b} \right)`, '(', 'a', 'b', ')'],
    [String.raw`\left[ x \right]`, '[', 'x', ']'],
    [String.raw`\left\{ x \right\}`, '{', 'x', '}']
  ].map(([source, ...expected]) => ({
    group: 'delimiters', source, expectedTag: 'mo', textIncludes: expected
  })),
  ...[
    [String.raw`\begin{pmatrix}a & b \\ c & d\end{pmatrix}`, 'a', 'b', 'c', 'd'],
    [String.raw`\begin{bmatrix}1 & 0 \\ 0 & 1\end{bmatrix}`, '1', '0'],
    [String.raw`\begin{aligned}A + B &\rightarrow C \\ C + D &\rightarrow E\end{aligned}`, 'A', 'B', 'C', 'D', 'E'],
    [String.raw`\begin{cases}x, & x > 0 \\ 0, & x \leq 0\end{cases}`, 'x', '0', '≤']
  ].map(([source, ...expected]) => ({
    group: 'matrices and multiline structures', source, expectedTag: 'mtable', textIncludes: expected
  })),
  ...[
    [String.raw`\vec{v}`, 'v'], [String.raw`\mathbf{v}`, 'v'],
    [String.raw`\hat{x}`, 'x'], [String.raw`\bar{x}`, 'x'],
    [String.raw`\overline{AB}`, 'AB'],
    [String.raw`\underbrace{a+b}_{\text{text}}`, 'a', 'b', 'text'],
    [String.raw`\overbrace{a+b}^{\text{text}}`, 'a', 'b', 'text']
  ].map(([source, ...expected]) => ({
    group: 'accents, vectors, and braces', source, expectedTag: 'mrow', textIncludes: expected
  })),
  ...[
    [String.raw`\in`, '∈'], [String.raw`\notin`, '∉'],
    [String.raw`\subset`, '⊂'], [String.raw`\subseteq`, '⊆'],
    [String.raw`\cup`, '∪'], [String.raw`\cap`, '∩'],
    [String.raw`\forall`, '∀'], [String.raw`\exists`, '∃'],
    [String.raw`\land`, '∧'], [String.raw`\lor`, '∨']
  ].map(([source, expected]) => ({
    group: 'sets and logic', source,
    expectedTag: source === String.raw`\forall` || source === String.raw`\exists` ? 'mi' : 'mo',
    textIncludes: [expected]
  })),
  ...[
    [String.raw`\ce{H2O}`, 'H', 'O'],
    [String.raw`\ce{CO2}`, 'C', 'O'],
    [String.raw`\ce{Ca^2+}`, 'Ca', '2', '+'],
    [String.raw`\ce{ATP + H2O -> ADP + P_i}`, 'ATP', 'H', 'O', 'ADP', '→'],
    [String.raw`\ce{A <=> B}`, 'A', 'B'],
    [String.raw`\ce{C6H12O6 + 6O2 -> 6CO2 + 6H2O}`, 'C', 'H', 'O', '→'],
    [String.raw`\pu{37 ^\circ C}`, '37', 'C']
  ].map(([source, ...expected]) => ({
    group: 'mhchem and physical units', source, expectedTag: 'mrow', textIncludes: expected
  }))
];

test('bundled KaTeX runtime renders the approved LaTeX and chemistry corpus semantically', async (t) => {
  for (const testCase of latexCorpus) {
    await t.test(`${testCase.group}: ${testCase.source}`, () => {
      for (const displayMode of [false, true]) {
        const rendered = runtime.renderLatex(testCase.source, { displayMode });
        const mathMl = mathMlFrom(rendered);
        const text = semanticMathText(mathMl);

        assert.match(rendered, /class="katex(?:-display)?"/);
        assert.doesNotMatch(rendered, /katex-error/);
        assert.match(mathMl, new RegExp(`<${testCase.expectedTag}\\b`));
        assert.ok(
          mathMl.includes(
            `<annotation encoding="application/x-tex">${escapeHtml(testCase.source)}</annotation>`
          ),
          'MathML annotation did not preserve the exact canonical LaTeX source'
        );
        testCase.textIncludes.forEach((expected) => {
          assert.ok(
            text.includes(expected),
            `${displayMode ? 'display' : 'inline'} MathML text did not include ${JSON.stringify(expected)}; got ${JSON.stringify(text)}`
          );
        });
      }
    });
  }
});

test('bundled KaTeX runtime recovers safely from invalid and unknown formula source', async (t) => {
  const invalidCases = [
    { source: String.raw`\frac{`, errorPattern: /katex-error/ },
    { source: String.raw`\notARealCommand{x}`, errorPattern: /mathcolor="#cc0000"/ }
  ];
  for (const testCase of invalidCases) {
    await t.test(testCase.source, () => {
      const rendered = runtime.renderLatex(testCase.source, { displayMode: false });
      assert.match(rendered, testCase.errorPattern);
      assert.ok(rendered.includes(escapeHtml(testCase.source)));
      assert.doesNotMatch(rendered, /<script\b|onerror\s*=|javascript:/i);
    });
  }
});

test('Markdown runtime never parses math delimiters inside inline or fenced code', async (t) => {
  const codeCases = [
    {
      name: 'inline code',
      source: '`$x^2$ and \\ce{H2O}`',
      expectedType: 'inlineCode'
    },
    {
      name: 'backtick fence',
      source: '```javascript\nconst formula = "$x^2$"; // \\ce{H2O}\n```',
      expectedType: 'code'
    },
    {
      name: 'tilde fence',
      source: '~~~latex\n$x^2$ and \\ce{H2O}\n~~~',
      expectedType: 'code'
    },
    {
      name: 'longer fence containing a shorter fence',
      source: '````markdown\n```\n$x^2$ and \\ce{H2O}\n```\n````',
      expectedType: 'code'
    }
  ];

  for (const testCase of codeCases) {
    await t.test(testCase.name, () => {
      const nodes = descendants(runtime.parseMarkdown(testCase.source));
      const codeNodes = nodes.filter((node) => node.type === testCase.expectedType);
      assert.equal(codeNodes.length, 1);
      assert.match(codeNodes[0].value, /\$x\^2\$/);
      assert.equal(nodes.some((node) => node.type === 'inlineMath' || node.type === 'math'), false);
    });
  }
});
