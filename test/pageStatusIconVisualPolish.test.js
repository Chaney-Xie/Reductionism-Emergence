const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const stylesPath = path.resolve(__dirname, '../public/styles.css');
const pinPath = path.resolve(__dirname, '../public/navPagePin.svg');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rule(styles, selector) {
  const match = styles.match(new RegExp(`(?:^|\\n)${escapeRegExp(selector)} \\{([^}]*)\\}`));
  assert.ok(match, `Missing ${selector} rule.`);
  return match[1];
}

test('Page status icons polish only their paint inside the frozen gutter wrapper', async () => {
  const styles = await fs.readFile(stylesPath, 'utf8');
  const row = rule(styles, '.page-link');
  const slot = rule(styles, '.page-link::before');
  const gutter = rule(styles, '.nav-page-status-gutter');
  const group = rule(styles, '.nav-page-status-group');
  const pageIndicator = rule(styles, '.nav-page-status-group .nav-row-indicator');
  const badge = rule(styles, '.nav-page-type-badge');
  const disclosure = rule(styles, '.nav-folder-disclosure-button');
  const follower = rule(styles, '.nav-binding-follower-indicator');

  assert.match(row, /align-items: center;/);
  assert.match(row, /padding: var\(--font-file-row-padding-block\) 0\.7rem;/);
  assert.match(row, /line-height: var\(--font-file-row-line-height\);/);
  assert.match(slot, /flex: 0 0 1\.15rem;/);
  assert.match(slot, /height: var\(--font-file-row-line-height\);/);
  assert.match(gutter, /flex: 0 0 0;/);
  assert.match(gutter, /width: 0;/);
  assert.match(gutter, /height: 0;/);
  assert.match(gutter, /margin-right: -0\.4rem;/);
  assert.match(group, /top: 50%;/);
  assert.match(group, /right: 0\.465rem;/);
  assert.match(group, /gap: 0\.4rem;/);
  assert.match(group, /transform: translateY\(-50%\);/);
  assert.match(pageIndicator, /flex: 0 0 0\.72rem;/);
  assert.match(pageIndicator, /margin-left: 0;/);
  assert.match(pageIndicator, /color: #ADADAD;/);
  assert.match(badge, /flex: 0 0 auto;/);
  assert.match(badge, /color: #ADADAD;/);
  assert.match(disclosure, /flex: 0 0 1\.15rem;/);
  assert.match(disclosure, /height: 1\.45rem;/);
  assert.match(disclosure, /margin-left: -0\.575rem;/);
  assert.match(follower, /flex: 0 0 1\.15rem;/);
  assert.match(follower, /margin-right: -0\.4rem;/);
});

test('Default Open keeps its circle while reducing its apparent size and weight', async () => {
  const styles = await fs.readFile(stylesPath, 'utf8');
  const owner = rule(styles, '.nav-page-status-indicator.nav-default-indicator');
  const symbol = rule(styles, '.nav-page-status-indicator.nav-default-indicator::before');

  assert.match(owner, /border: 0;/);
  assert.match(owner, /transform: translateY\(0\.5px\);/);
  assert.match(symbol, /top: 50%;/);
  assert.match(symbol, /left: 50%;/);
  assert.match(symbol, /width: 0\.52rem;/);
  assert.match(symbol, /height: 0\.52rem;/);
  assert.match(symbol, /border: 1\.3px solid currentColor;/);
  assert.match(symbol, /border-radius: 50%;/);
  assert.match(symbol, /transform: translate\(-50%, -50%\);/);
});

test('Stick on Top enlarges only its scoped vector paint without changing its slot', async () => {
  const styles = await fs.readFile(stylesPath, 'utf8');
  const owner = rule(styles, '.nav-page-status-indicator.nav-pin-indicator');
  const vector = rule(styles, '.nav-page-status-indicator.nav-pin-indicator::before');
  const retiredStem = rule(styles, '.nav-page-status-indicator.nav-pin-indicator::after');
  const sharedHead = rule(styles, '.nav-pin-indicator::before');
  const sharedStem = rule(styles, '.nav-pin-indicator::after');

  assert.match(owner, /transform: translateY\(0\.25px\);/);
  assert.match(vector, /top: 50%;/);
  assert.match(vector, /left: 50%;/);
  assert.match(vector, /width: 0\.8rem;/);
  assert.match(vector, /height: 0\.8rem;/);
  assert.match(vector, /background: currentColor;/);
  assert.match(vector, /-webkit-mask: url\('\.\/navPagePin\.svg'\) center \/ 100% 100% no-repeat;/);
  assert.match(vector, /mask: url\('\.\/navPagePin\.svg'\) center \/ 100% 100% no-repeat;/);
  assert.match(vector, /transform: translate\(-50%, -50%\);/);
  assert.match(retiredStem, /content: none;/);

  assert.match(sharedHead, /transform: rotate\(45deg\);/);
  assert.match(sharedStem, /background: currentColor;/);
  assert.match(sharedStem, /transform: rotate\(45deg\);/);
  assert.match(sharedStem, /transform-origin: top center;/);
});

test('Page pin vector puts the stem tip level with the tilted head lower-right corner', async () => {
  const svg = await fs.readFile(pinPath, 'utf8');

  assert.match(svg, /viewBox="0 0 12 12"/);
  assert.match(svg, /fill="none"/);
  assert.match(svg, /transform="rotate\(30 6 8\)"/);
  assert.match(svg, /stroke-width="1\.22"/);
  assert.match(svg, /<rect x="2\.6" y="3\.5" width="6\.8" height="4\.5" rx="0\.45"\/>/);
  assert.match(svg, /<path d="M5\.2 8V10\.424871"\/>/);
  assert.doesNotMatch(svg, /<line\b|<polyline\b/);

  const angle = 30 * Math.PI / 180;
  const lowerRightY = 8 + (9.4 - 6) * Math.sin(angle);
  const stemTipY = 8 + (5.2 - 6) * Math.sin(angle) + (10.424871 - 8) * Math.cos(angle);
  assert.ok(Math.abs(lowerRightY - stemTipY) < 0.000001);
  assert.ok(5.2 < 6, 'Stem must attach left of the head centre.');
  assert.ok(10.424871 - 8 > 2.4, 'Stem must remain visibly longer than the superseded nub.');

  const apparentStroke = 1.22 * (0.8 * 16 / 12);
  assert.ok(Math.abs(apparentStroke - 1.3) < 0.01);
});
