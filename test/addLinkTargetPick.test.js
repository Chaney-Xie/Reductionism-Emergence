const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

test('entering Add Link target-pick mode opens Search without owning Folder collapse state', async () => {
  const app = await fs.readFile(path.join(__dirname, '../public/app.js'), 'utf8');
  const enter = app.match(/function enterLinkPickMode\(runtime\) \{[\s\S]*?\n\}/)?.[0] || '';
  const exit = app.match(/function exitLinkPickMode\(runtime\) \{[\s\S]*?\n\}/)?.[0] || '';

  assert.match(enter, /setLeftSidebarOpen\(true\)/);
  assert.match(enter, /descriptorSearchOpen = true/);
  assert.match(enter, /renderDescriptorSearchPanel\(\{ focus: true, selectAll: true \}\)/);
  assert.match(enter, /runtime\.linkPickMode = \{/);
  assert.doesNotMatch(`${enter}\n${exit}`, /folder\.collapsed|collapsed\s*=|expandAll|openAllAncestors|setAllFoldersCollapsed/);
  assert.doesNotMatch(enter, /descriptorSearchText\s*=|selectedCategoryFilterIds\.(?:clear|add|delete)/);
});
