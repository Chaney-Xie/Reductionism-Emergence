const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const read = (relativePath) => fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');

function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] || '';
}

test('Right Sidebar boundaries keep one mounted resizer in each accepted DOM seam', async () => {
  const html = await read('public/index.html');
  const relationsStart = html.indexOf('id="right-sidebar-relations-view"');
  const resourcesStart = html.indexOf('id="right-sidebar-resources-view"');
  const sidebarEnd = html.indexOf('</aside>', resourcesStart);
  const relationsView = html.slice(relationsStart, resourcesStart);
  const resourcesView = html.slice(resourcesStart, sidebarEnd);

  assert.match(
    relationsView,
    /data-right-section="category"[\s\S]*?data-section="category"[\s\S]*?data-right-section="descriptor"/
  );
  assert.match(
    relationsView,
    /data-right-section="descriptor"[\s\S]*?data-section="descriptor"[\s\S]*?data-right-section="relations"/
  );
  assert.match(
    resourcesView,
    /data-right-section="maintenance"[\s\S]*?data-section="maintenance"[\s\S]*?data-right-section="external-links"/
  );
  assert.equal((relationsView.match(/class="right-section-resizer"/g) || []).length, 2);
  assert.equal((resourcesView.match(/class="right-section-resizer"/g) || []).length, 1);
});

test('2px divider paint and the overlaid 6px hit target have independent geometry', async () => {
  const css = await read('public/styles.css');
  const resizer = rule(css, '.right-section-resizer');
  const hitTarget = rule(css, '.right-section-resizer::before');
  const hover = css.match(
    /\.right-section-resizer:hover,\s*\.right-sidebar-resizing \.right-section-resizer\s*\{[^}]*\}/
  )?.[0] || '';

  assert.match(resizer, /position: relative/);
  assert.match(resizer, /z-index: 2/);
  assert.match(resizer, /flex: 0 0 2px/);
  assert.match(resizer, /cursor: row-resize/);
  assert.match(resizer, /touch-action: none/);
  assert.match(resizer, /--right-section-divider-colour: var\(--border-guide\)/);
  assert.match(resizer, /background: var\(--right-section-divider-colour\)/);
  assert.doesNotMatch(resizer, /linear-gradient\(/);
  assert.match(hitTarget, /position: absolute/);
  assert.match(hitTarget, /inset-block: -2px/);
  assert.match(hitTarget, /inset-inline: 0/);
  assert.match(hitTarget, /background: transparent/);
  assert.match(hitTarget, /pointer-events: auto/);
  assert.match(hitTarget, /cursor: row-resize/);
  assert.match(hitTarget, /touch-action: none/);
  assert.doesNotMatch(css, /\.right-section-resizer::after\s*\{/);
  assert.doesNotMatch(
    resizer,
    /(?:^|[;{])\s*(?:border(?:-[a-z-]+)?|box-shadow)\s*:/m
  );
  assert.match(hover, /--right-section-divider-colour: #8e9bad/);
  assert.doesNotMatch(hover, /before-surface|after-surface/);
});

test('retired adjacent-surface paint and its presentation branch have no remaining owner', async () => {
  const [css, sidebar] = await Promise.all([
    read('public/styles.css'),
    read('public/js/rightSidebar.js')
  ]);
  const body = rule(css, '.right-section-body');
  const header = rule(css, '.right-section-header');

  assert.match(body, /background: var\(--surface-guide\)/);
  assert.match(header, /background: var\(--surface-guide-section\)/);
  assert.doesNotMatch(css, /--right-section-divider-(?:before|after)-surface/);
  assert.doesNotMatch(css, /\.right-sidebar-section\.is-collapsed \+ \.right-section-resizer\s*\{/);
  assert.doesNotMatch(css, /\.right-section-resizer\.is-presenting-collapsing-body\s*\{/);
  assert.doesNotMatch(css, /\.is-collapsed:has\([^}]*display: block/);
  assert.match(sidebar, /section\.classList\.toggle\('is-collapsed', !expanded\)/);
  assert.match(sidebar, /body\.style\.display = 'block'/);
  assert.doesNotMatch(
    sidebar,
    /is-presenting-collapsing-body|presentsCollapsingBody|bodyStartHeight/
  );
  assert.ok(sidebar.includes(
    'const targetHeight = Number(resizer.getBoundingClientRect?.().height);'
  ));
  assert.doesNotMatch(sidebar, /getBoundingClientRect\?\.\(\)\.height\) \|\| 6/);
});
