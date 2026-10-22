const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const read = (relativePath) => fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');

function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] || '';
}

test('exactly five top-level Right Sidebar toggles own the dedicated disclosure class', async () => {
  const html = await read('public/index.html');
  const rightSidebar = html.slice(
    html.indexOf('<aside id="right-sidebar"'),
    html.indexOf('</aside>', html.indexOf('<aside id="right-sidebar"'))
  );

  assert.equal(
    (rightSidebar.match(/class="right-section-disclosure disclosure-chevron"/g) || []).length,
    5
  );
  for (const [sectionId, sectionName] of [
    ['right-category-filter-section', 'Category'],
    ['right-descriptor-filter-section', 'Descriptor'],
    ['relations-section', 'Relations'],
    ['maintenance-section', 'Maintenance'],
    ['external-links-section', 'External Links']
  ]) {
    const sectionStart = rightSidebar.indexOf(`id="${sectionId}"`);
    const bodyStart = rightSidebar.indexOf('<div class="right-section-body">', sectionStart);
    const header = rightSidebar.slice(sectionStart, bodyStart);
    assert.ok(sectionStart >= 0 && bodyStart > sectionStart);
    assert.equal((header.match(/class="right-section-toggle"/g) || []).length, 1);
    assert.equal(
      (header.match(/class="right-section-disclosure disclosure-chevron"/g) || []).length,
      1
    );
    assert.match(header, new RegExp(`<span>${sectionName}<\\/span>`));
  }
});

test('top-level disclosure colours use System levels 3 and 2 without geometry declarations', async () => {
  const css = await read('public/styles.css');
  const root = rule(css, ':root');
  const defaultState = rule(css, '.right-section-toggle > .right-section-disclosure');
  const interactiveState = css.match(
    /\.right-section-header:is\(:hover, :focus-within\)\s*\.right-section-toggle > \.right-section-disclosure,\s*\.right-section-toggle:active > \.right-section-disclosure\s*\{[^}]*\}/
  )?.[0] || '';

  assert.match(root, /--system-text-level-3: #979797/);
  assert.match(root, /--system-text-level-2: #7D7D7D/);
  assert.match(defaultState, /color: var\(--system-text-level-3\)/);
  assert.match(interactiveState, /color: var\(--system-text-level-2\)/);
  assert.doesNotMatch(
    `${defaultState}\n${interactiveState}`,
    /(?:font-size|position|display|flex|width|height|margin|padding|transform|background|border|content)\s*:/
  );
});

test('nested and internal Right Sidebar disclosures retain Group 2.2 ownership', async () => {
  const [css, sidebar] = await Promise.all([
    read('public/styles.css'),
    read('public/js/rightSidebar.js')
  ]);

  assert.match(rule(css, '.right-sidebar .disclosure-chevron'), /color: var\(--border-guide\)/);
  assert.match(rule(css, '.right-descriptor-disclosure'), /color: var\(--border-guide\)/);
  assert.match(
    rule(css, '.relation-group-heading > .disclosure-chevron'),
    /color: var\(--border-guide\)/
  );
  assert.match(sidebar, /heading\.className = 'right-filter-group-heading'[\s\S]*?disclosure\.className = 'disclosure-chevron'/);
  assert.match(sidebar, /disclosure\.className = 'right-descriptor-disclosure'[\s\S]*?chevron\.className = 'disclosure-chevron'/);
  assert.match(sidebar, /heading\.className = 'relation-group-heading'[\s\S]*?disclosure\.className = 'disclosure-chevron'/);
  assert.doesNotMatch(sidebar, /right-section-disclosure/);
});
