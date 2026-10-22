const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const stylesPath = path.resolve(__dirname, '../public/styles.css');
const navigationPath = path.resolve(__dirname, '../public/js/navigation.js');
const TOLERANCE = 1e-9;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rule(styles, selector) {
  const match = styles.match(new RegExp(`(?:^|\\n)${escapeRegExp(selector)} \\{([^}]*)\\}`));
  assert.ok(match, `Missing ${selector} rule.`);
  return match[1];
}

function rem(block, property) {
  const match = block.match(new RegExp(`(?:^|\\n)\\s*${escapeRegExp(property)}:\\s*(-?\\d+(?:\\.\\d+)?)rem;`));
  assert.ok(match, `Missing rem-valued ${property}.`);
  return Number(match[1]);
}

function horizontalPaddingRem(block) {
  const match = block.match(/(?:^|\n)\s*padding:\s*[^;\n]+\s(-?\d+(?:\.\d+)?)rem;/);
  assert.ok(match, 'Missing horizontal rem padding.');
  return Number(match[1]);
}

function close(left, right) {
  assert.ok(Math.abs(left - right) <= TOLERANCE, `${left} != ${right}`);
}

test('Page and folder rows resolve to one top-level marker/name column model', async () => {
  const styles = await fs.readFile(stylesPath, 'utf8');
  const page = rule(styles, '.page-link');
  const pageSlot = rule(styles, '.page-link::before');
  const folder = rule(styles, '.nav-folder-button');
  const disclosure = rule(styles, '.nav-folder-disclosure-button');

  assert.match(pageSlot, /content: '';/);
  assert.match(pageSlot, /flex: 0 0 1\.15rem;/);
  assert.match(pageSlot, /height: var\(--font-file-row-line-height\);/);
  assert.match(pageSlot, /pointer-events: none;/);

  const pageNameStart = horizontalPaddingRem(page)
    + rem(pageSlot, 'margin-left')
    + rem(pageSlot, 'width')
    + rem(pageSlot, 'margin-right')
    + rem(page, 'gap');
  const folderNameStart = horizontalPaddingRem(folder)
    + rem(disclosure, 'margin-left')
    + rem(disclosure, 'width')
    + rem(folder, 'gap');

  close(pageNameStart, 1.525);
  close(folderNameStart, 1.525);
  close(pageNameStart, folderNameStart);
});

test('status and follower markers resolve against disclosure and leader-name columns', async () => {
  const styles = await fs.readFile(stylesPath, 'utf8');
  const page = rule(styles, '.page-link');
  const pageSlot = rule(styles, '.page-link::before');
  const folder = rule(styles, '.nav-folder-button');
  const disclosure = rule(styles, '.nav-folder-disclosure-button');
  const statusGutter = rule(styles, '.nav-page-status-gutter');
  const statusGroup = rule(styles, '.nav-page-status-group');
  const rowIndicator = rule(styles, '.nav-row-indicator');
  const follower = rule(styles, '.nav-binding-follower-indicator');

  assert.match(statusGutter, /position: relative;/);
  assert.match(statusGutter, /flex: 0 0 0;/);
  assert.match(statusGutter, /width: 0;/);
  assert.match(statusGutter, /margin-right: -0\.4rem;/);
  assert.match(statusGutter, /pointer-events: none;/);
  assert.match(statusGroup, /position: absolute;/);
  assert.match(statusGroup, /pointer-events: none;/);

  const pageNameStart = horizontalPaddingRem(page)
    + rem(pageSlot, 'margin-left')
    + rem(pageSlot, 'width')
    + rem(pageSlot, 'margin-right')
    + rem(page, 'gap');
  const disclosureCenter = horizontalPaddingRem(folder)
    + rem(disclosure, 'margin-left')
    + rem(disclosure, 'width') / 2;
  const statusCenter = pageNameStart
    - rem(statusGroup, 'right')
    - rem(rowIndicator, 'width') / 2;
  const followerNameAdvance = rem(follower, 'width')
    + rem(follower, 'margin-right')
    + rem(page, 'gap');

  close(disclosureCenter, statusCenter);
  close(followerNameAdvance, rem(pageSlot, 'width'));
  assert.match(follower, /flex: 0 0 1\.15rem;/);
  assert.match(follower, /text-align: left;/);
  assert.match(follower, /pointer-events: none;/);
  assert.doesNotMatch(styles, /\.page-link\.nav-binding-follower\s*\{[^}]*padding-left/);
});

test('reserved slots add no fake control and preserve row-owned badges, highlights, and ellipsis', async () => {
  const [styles, navigation] = await Promise.all([
    fs.readFile(stylesPath, 'utf8'),
    fs.readFile(navigationPath, 'utf8')
  ]);

  assert.match(navigation, /disclosureButton\.className = 'nav-folder-disclosure-button'/);
  assert.match(navigation, /followerIndicator\.className = 'nav-binding-follower-indicator'/);
  assert.doesNotMatch(navigation, /nav-page-marker-slot/);
  assert.match(styles, /\.nav-page-label-text,\n\.nav-folder-label-text \{[^}]*min-width: 0;[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
  assert.match(rule(styles, '.nav-page-type-badge'), /flex: 0 0 auto;/);
  assert.match(styles, /\.page-link\.nav-selected,\n\.nav-folder-button\.nav-selected \{[^}]*background: var\(--surface-guide-section\);/);
});
