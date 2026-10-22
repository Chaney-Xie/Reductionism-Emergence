const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const appearance = require('../public/appearanceSettings');

async function read(relativePath) {
  return fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');
}

test('selected Dictionary group stays uniformly Accent soft except the hovered row', async () => {
  const css = await read('public/vocabulary.css');
  assert.match(css, /\.vocab-entry\.is-highlighted\s*\{[^}]*background: var\(--accent-soft\)/);
  assert.match(css, /\.vocab-entry\.is-highlighted > \.vocab-display-row,[\s\S]*?\.vocab-entry\.is-highlighted > \.vocab-alias-row\s*\{[^}]*background: transparent/);
  assert.doesNotMatch(css, /\.vocab-(?:display|alias)-row\.(?:selected|current)[^{]*\{[^}]*accent-strong/);
  assert.match(css, /\.vocab-entry\.is-highlighted > \.vocab-display-row:hover,[\s\S]*?background: var\(--accent-strong\)/);
});

test('Dictionary Move target selection uses Guide colour for the source row and complete target group', async () => {
  const [source, css] = await Promise.all([
    read('public/vocabulary.js'),
    read('public/vocabulary.css')
  ]);
  assert.match(source, /displayRow\.classList\.toggle\('is-move-source', sameVocabularySource\(moveSource, displaySource\)\)/);
  assert.match(source, /aliasRow\.classList\.toggle\('is-move-source', sameVocabularySource\(moveSource, aliasSource\)\)/);
  assert.match(source, /section\.addEventListener\('pointermove',[\s\S]*?section\.classList\.add\('is-move-hover'\)[\s\S]*?Move "\$\{sourceWord\(moveSource\)\}" to "\$\{entry\.display\}"/);
  assert.match(source, /section\.addEventListener\('pointerleave',[\s\S]*?section\.classList\.remove\('is-move-hover'\)[\s\S]*?clearFloatingHint\(section\)/);
  assert.match(css, /body\.move-target-pick-mode \.vocab-display-row:hover,[\s\S]*?background: transparent/);
  assert.match(css, /body\.move-target-pick-mode \.vocab-display-row\.is-move-source,[\s\S]*?body\.move-target-pick-mode \.vocab-entry\.is-move-hover \{[^}]*background: var\(--surface-guide\)/);
  assert.match(css, /body\.move-target-pick-mode \.vocab-entry\.is-move-hover > \.vocab-display-row,[\s\S]*?background: transparent/);
  assert.match(source, /`Move "\$\{sourceWord\(moveSource\)\}" to "\$\{entry\.display\}"`[\s\S]*?section,[\s\S]*?'move'/);
  assert.match(css, /\.vocab-floating-hint\.vocab-move-follow-hint \{[^}]*border-color: var\(--border-tool\);[^}]*background: var\(--surface-tool\);/);
});

test('Add-to-existing hint is trigger-owned and clears on leave, selection change, close, and rerender', async () => {
  const source = await read('public/vocabulary.js');
  assert.match(source, /let hintTrigger = null/);
  assert.match(source, /setFloatingHint\([\s\S]*?row\s*\n\s*\);/);
  assert.match(source, /row\.addEventListener\('pointerleave',[\s\S]*?clearFloatingHint\(row\)/);
  assert.match(source, /row\.addEventListener\('focusout',[\s\S]*?clearFloatingHint\(row\)/);
  assert.match(source, /function beginTemporaryHighlight[\s\S]*?clearFloatingHint\(\)/);
  assert.match(source, /function render\(\) \{\s*clearFloatingHint\(\)/);
  assert.match(source, /window\.addEventListener\('pagehide', clearFloatingHint\)/);
  assert.match(source, /listEl\.addEventListener\('scroll', clearFloatingHint/);
  assert.match(source, /if \(hintEl\) clearFloatingHint\(\)/);
  assert.match(await read('public/vocabulary.css'), /\.vocab-floating-hint[\s\S]*?pointer-events: none/);
});

test('Vocabulary Library opens at the narrow reference width through renderer and native owners', async () => {
  const [app, descriptor, main] = await Promise.all([
    read('public/app.js'),
    read('public/js/descriptorModal.js'),
    read('desktop/main.js')
  ]);
  assert.match(app, /const DICTIONARY_DEFAULT_WINDOW_WIDTH = 820;/);
  assert.match(app, /const DICTIONARY_WINDOW_FEATURES = `width=\$\{DICTIONARY_DEFAULT_WINDOW_WIDTH\},height=760,resizable=yes,scrollbars=yes`;/);
  assert.equal((descriptor.match(/DICTIONARY_WINDOW_FEATURES/g) || []).length, 2);
  assert.doesNotMatch(descriptor, /width=820|width=980/);
  assert.match(main, /const VOCABULARY_DEFAULT_WINDOW_WIDTH = 820;/);
  assert.match(main, /new URL\(url\)\.pathname === '\/vocabulary\.html'[\s\S]*?\? VOCABULARY_DEFAULT_WINDOW_WIDTH[\s\S]*?: DEFAULT_CHILD_WINDOW_WIDTH/);
  assert.match(main, /overrideBrowserWindowOptions: \{\s*width: childWindowWidth\(url\),\s*height: 760,\s*parent: window,\s*webPreferences: secureWebPreferences\(\)/);
});

test('Vocabulary narrow layout fixes rail and actions while only both input columns flex', async () => {
  const css = await read('public/vocabulary.css');
  assert.match(css, /\.vocab-topbar \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;[^}]*padding: 0\.8rem 1\.5rem;/);
  assert.match(css, /\.vocab-main \{[^}]*grid-template-columns: minmax\(0, 1fr\) 52px;/);
  assert.match(css, /\.vocab-inputbar \{[^}]*grid-template-columns: minmax\(180px, 1fr\) max-content max-content;[^}]*padding: 0\.75rem 1\.5rem;/);
  assert.match(css, /\.vocab-search,[\s\S]*?\.vocab-new-word \{[^}]*width: 100%;[^}]*min-width: 0;/);
  assert.match(css, /\.vocab-new-word-wrap \{[^}]*min-width: 0;/);
  assert.match(css, /\.vocab-status \{[^}]*grid-column: 1 \/ -1;/);
  assert.match(css, /\.vocab-status:empty \{\s*display: none;/);
  assert.doesNotMatch(css, /@media \(max-width: 720px\)[\s\S]*?\.vocab-action-button[^}]*width: 100%/);
});

test('every application Cancel uses the canonical outline family without changing commands', async () => {
  const [css, descriptor, vault, navigation, html] = await Promise.all([
    read('public/sharedControls.css'),
    read('public/js/descriptorModal.js'),
    read('public/js/vaultSettings.js'),
    read('public/js/navigation.js'),
    read('public/index.html')
  ]);
  assert.match(descriptor, /cancelButton\.className = 'ui-outline-action ui-cancel-action'/);
  assert.match(vault, /appearance-manage-action ui-outline-action ui-cancel-action/g);
  assert.match(vault, /variant === 'cancel' \? 'ui-outline-action ui-cancel-action'/);
  assert.doesNotMatch(navigation, /navigation-move-cancel|navigation-move-menu/);
  assert.match(html, /id="add-link-cancel-button" class="ui-outline-action ui-cancel-action"/);
  assert.doesNotMatch(
    `${descriptor}\n${vault}\n${navigation}\n${html}`,
    /class(?:Name)?\s*=\s*['"]cancel-action(?:\s|['"])/
  );

  assert.match(css, /:is\(\.ui-outline-action, \.ui-cancel-action\) \{[\s\S]*?border-color: var\(--control-border\);[\s\S]*?background: var\(--control-surface\)/);
  assert.match(css, /\.ui-outline-action, \.ui-cancel-action\):not\(:disabled\):hover,[\s\S]*?background: var\(--control-surface-hover\)/);
  assert.match(css, /\.ui-outline-action, \.ui-cancel-action\):not\(:disabled\):active,[\s\S]*?var\(--surface-guide-section\)/);
  assert.doesNotMatch(css, /\.cancel-action/);

  const first = appearance.cssVariablesForAppearance({
    accentColour: '#123456', accentSoftOpacity: 0.12, accentStrongOpacity: 0.3
  });
  const second = appearance.cssVariablesForAppearance({
    accentColour: '#654321', accentSoftOpacity: 0.2, accentStrongOpacity: 0.4
  });
  for (const key of ['--accent-colour', '--accent-soft', '--accent-strong', '--accent-colour-pressed']) {
    assert.notEqual(first[key], second[key]);
  }
});
