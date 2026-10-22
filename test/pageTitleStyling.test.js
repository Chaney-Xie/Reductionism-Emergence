const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function read(relativePath) {
  return fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');
}

function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] || '';
}

function rules(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{[^}]*\\}`, 'g'))]
    .map((match) => match[0]).join('\n');
}

test('page title hit area follows the text and has no hover highlight', async () => {
  const css = await read('public/styles.css');
  const display = rules(css, '.page-title-display');

  assert.match(display, /width: auto/);
  assert.match(display, /max-width: 100%/);
  assert.match(display, /padding: 0/);
  assert.match(display, /font-size: 14px/);
  assert.equal(rule(css, '.page-title-display:hover'), '');
});

test('page title editing shows only the text caret without an input box', async () => {
  const [css, app] = await Promise.all([
    read('public/styles.css'),
    read('public/app.js')
  ]);
  const editor = rule(css, '.title-editor');
  const input = rule(css, '.title-input');
  const focus = rule(css, '.title-input:focus');

  assert.match(editor, /width: fit-content/);
  assert.match(input, /field-sizing: content/);
  assert.match(input, /border: 0/);
  assert.match(input, /background: transparent/);
  assert.match(input, /box-shadow: none/);
  assert.match(input, /caret-color: currentColor/);
  assert.match(input, /font-family: var\(--font-system-family\)/);
  assert.match(input, /font-size: 14px/);
  assert.match(focus, /outline: 0/);
  assert.match(focus, /box-shadow: none/);
  assert.match(app, /beginTitleEditor\(runtime, \{ caretOffset: caretOffsetAtClick\(runtime, event\) \}\)/);
});

test('page toolbar is two-thirds height with centred rounded-square icon targets', async () => {
  const css = await read('public/styles.css');
  const toolbar = rules(css, '.pane-page-toolbar');
  const button = rules(css, '.toolbar-button');
  const titleArea = rule(css, '.toolbar-title-area');

  assert.match(toolbar, /min-height: 43px/);
  assert.match(toolbar, /align-items: center/);
  assert.match(button, /width: 30px/);
  assert.match(button, /height: 30px/);
  assert.match(button, /border-radius: 6px/);
  assert.match(titleArea, /align-items: center/);
  assert.match(titleArea, /justify-items: center/);
});
