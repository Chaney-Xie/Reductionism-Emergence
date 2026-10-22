const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function read(relativePath) {
  return fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');
}

test('Add Link affirmative and secondary controls use the shared solid and outline families', async () => {
  const [html, css, shared] = await Promise.all([
    read('public/index.html'),
    read('public/styles.css'),
    read('public/sharedControls.css')
  ]);
  assert.match(html, /id="add-link-new-page-button" class="ui-solid-action ui-primary-action"/);
  assert.match(html, /id="add-link-confirm-button" class="ui-solid-action ui-primary-action"/);
  assert.match(html, /id="add-link-cancel-button" class="ui-outline-action ui-cancel-action"/);
  assert.match(shared, /\.ui-solid-action, \.ui-primary-action\):not\(:disabled\):hover,[\s\S]*?background: var\(--theme-colour-hover\)/);
  assert.match(shared, /:is\(\.ui-outline-action, \.ui-cancel-action\) \{[\s\S]*?border-color: var\(--control-border\);[\s\S]*?background: var\(--control-surface\)/);
  assert.doesNotMatch(css, /\.add-link-(?:row|actions) button[^\{]*\{/);
});

test('Add Link Search uses shared outline interaction and selected target uses Tool input styling', async () => {
  const [css, shared, app] = await Promise.all([
    read('public/styles.css'),
    read('public/sharedControls.css'),
    read('public/app.js')
  ]);
  assert.match(await read('public/index.html'), /id="add-link-existing-page-button" class="ui-outline-action"/);
  assert.match(shared, /\.ui-outline-action, \.ui-cancel-action\):not\(:disabled\):hover,[\s\S]*?background: var\(--control-surface-hover\)/);
  assert.doesNotMatch(css, /\.add-link-(?:row|actions) button[^\{]*\{/);
  assert.match(css, /\.add-link-selected-target \{[\s\S]*?border: 1px solid var\(--border-tool\);[\s\S]*?background: var\(--surface-tool\)/);
  assert.doesNotMatch(css, /\.add-link-selected-target \{[^}]*border:[^;]*dashed/);
  assert.match(app, /addLinkExistingTarget\.textContent = targetPage[\s\S]*?\? \(targetPage\.title \|\| targetPage\.id\)[\s\S]*?: 'No page selected'/);
  assert.doesNotMatch(app, /`Selected: \$\{targetPage\.title/);
});

test('Add Link type label matches ordinary row typography and the popover is five-quarters wider', async () => {
  const [html, css] = await Promise.all([
    read('public/index.html'),
    read('public/styles.css')
  ]);
  assert.match(html, /<label class="add-link-label" for="add-link-type-select">Link type<\/label>/);
  assert.match(html, /<select id="add-link-type-select" class="add-link-type-select"><\/select>/);
  assert.match(html, /id="add-link-type-na" class="add-link-type-na" hidden>Not applicable<\/span>/);
  assert.match(css, /\.add-link-popover \{[\s\S]*?width: 300px;/);
  assert.match(css, /\.add-link-label \{[\s\S]*?color: inherit;[\s\S]*?font-size: inherit;/);
  assert.doesNotMatch(css, /\.add-link-label \{[^}]*font-size: 0\.75rem/);
  assert.match(css, /\.add-link-type-na \{[\s\S]*?width: 100%;[\s\S]*?border: 1px solid var\(--input-border-colour\);[\s\S]*?background: var\(--surface-tool\);[\s\S]*?pointer-events: none/);
});

test('link target-pick grey-out reuses the strong-modal overlay colour over the same regions', async () => {
  const css = await read('public/styles.css');
  assert.match(css, /--modal-overlay-colour: rgb\(35 42 52 \/ 45%\)/);
  assert.match(css, /body\.link-pick-mode \.page-area::after,[\s\S]*?body\.link-pick-mode \.right-sidebar::after \{[\s\S]*?background: var\(--modal-overlay-colour\)/);
  assert.match(css, /\.forced-modal-overlay \{[\s\S]*?background: var\(--modal-overlay-colour\)/);
  assert.doesNotMatch(css, /body\.link-pick-mode \.page-area,[\s\S]*?filter: grayscale/);
});
