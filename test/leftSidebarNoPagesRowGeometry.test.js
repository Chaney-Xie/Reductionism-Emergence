const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const styles = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');
const navigation = fs.readFileSync(path.join(root, 'public/js/navigation.js'), 'utf8');
const motion = fs.readFileSync(
  path.join(root, 'public/sidebarMembershipMoveAnimation.js'),
  'utf8'
);

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] || '';
}

test('nested No pages hints use exact Page row vertical geometry and filename alignment', () => {
  const page = rule('.page-link');
  const empty = rule('.nav-folder-empty');
  const nestedEmpty = rule('.nav-folder-pages > .nav-folder-empty');

  assert.match(page, /padding: var\(--font-file-row-padding-block\) 0\.7rem;/);
  assert.match(page, /line-height: var\(--font-file-row-line-height\);/);
  assert.match(empty, /margin: 0;/);
  assert.match(empty, /color: var\(--system-text-level-3\);/);
  assert.match(nestedEmpty, /padding-block: var\(--font-file-row-padding-block\);/);
  assert.match(nestedEmpty, /line-height: var\(--font-file-row-line-height\);/);
  assert.match(nestedEmpty, /padding-left: var\(--nav-page-text-start\);/);
});

test('No pages remains informational and reuses the existing row-motion owner', () => {
  const emptyCreation = navigation.match(
    /if \(!entries\.length\) \{([\s\S]*?)\} else \{/
  )?.[1] || '';

  assert.match(emptyCreation, /document\.createElement\('p'\)/);
  assert.match(emptyCreation, /empty\.className = 'nav-folder-empty';/);
  assert.match(emptyCreation, /empty\.textContent = 'No pages';/);
  assert.doesNotMatch(emptyCreation, /addEventListener|draggable|tabIndex|role/);
  assert.doesNotMatch(
    styles,
    /\.nav-folder-empty(?::hover|\.active|\.nav-selected)|(?:hover|active|nav-selected)[^,{]*\.nav-folder-empty/
  );
  assert.match(motion, /hasClass\(element, 'nav-folder-empty'\)/);
});
