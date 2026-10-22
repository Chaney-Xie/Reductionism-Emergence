'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { markdownV02RetirementManifest } = require('./markdownV02RetirementManifest');
const {
  TEST_DIRECTORY,
  discoverTopLevelTests,
  retiredMarkdownV02Tests,
  activeTopLevelTests
} = require('./topLevelTestSuite');

for (const entry of markdownV02RetirementManifest) {
  test.skip(
    `retired Markdown v0.2 contract: ${entry.file} -> ${entry.replacements.join(', ')}`,
    () => {}
  );
}

test('Markdown v0.2 retirement manifest is explicit, complete, and replacement-backed', () => {
  assert.equal(markdownV02RetirementManifest.length, 25);
  const files = markdownV02RetirementManifest.map((entry) => entry.file);
  assert.equal(new Set(files).size, files.length, 'retired filenames are unique');
  assert.deepEqual(files, [...files].sort(), 'retirement manifest remains alphabetically auditable');

  const topLevel = new Set(discoverTopLevelTests());
  const retired = new Set(retiredMarkdownV02Tests());
  const active = new Set(activeTopLevelTests());
  assert.deepEqual([...retired], [...files].sort());
  assert(active.has('markdownV02Retirement.test.js'), 'retirement audit runs in the active suite');

  for (const entry of markdownV02RetirementManifest) {
    assert.match(entry.file, /^markdown.*\.test\.js$/);
    assert(topLevel.has(entry.file), `retired test still exists: ${entry.file}`);
    assert(!active.has(entry.file), `retired test is excluded from the active suite: ${entry.file}`);
    assert(entry.replacements.length > 0, `${entry.file} names replacement coverage`);
    for (const replacement of entry.replacements) {
      const replacementPath = path.join(TEST_DIRECTORY, replacement);
      assert(topLevel.has(replacement), `replacement is a top-level test: ${replacement}`);
      assert(active.has(replacement), `replacement remains active: ${replacement}`);
      assert(!retired.has(replacement), `replacement is not itself retired: ${replacement}`);
      assert(fs.statSync(replacementPath).isFile(), `replacement exists: ${replacement}`);
      assert.match(
        fs.readFileSync(replacementPath, 'utf8'),
        /\btest(?:\.skip)?\s*\(|\brequire\(['"][^'"]+\.test\.(?:js|mjs)['"]\)/,
        `replacement contains executable coverage: ${replacement}`
      );
    }
  }
});

test('active launcher retains migrated and non-Markdown top-level coverage', () => {
  const active = new Set(activeTopLevelTests());
  const requiredActive = [
    'markdownCodeLanguageTransaction.test.js',
    'markdownLatexPresentation.test.js',
    'markdownLinkTableModes.test.js',
    'markdownPresentationCorrections.test.js',
    'markdownSharedSourcePresentation.test.js',
    'markdownTableStructuralUi.test.js',
    'markdownTaskList.test.js',
    'markdownEditableAffinity.test.js',
    'markdownEditableFoundation.test.js',
    'markdownEditableLiveController.test.js',
    'markdownEditablePositionCertification.test.js',
    'markdownEditableProjection.test.js',
    'markdownEditableRandomizedCertification.test.js',
    'markdownEditableSyntaxAdapters.test.js',
    'markdownEditableTransactionCertification.test.js',
    'markdownExplicitTransactionHistory.test.js'
  ];
  requiredActive.forEach((file) => assert(active.has(file), `${file} remains active`));

  discoverTopLevelTests()
    .filter((file) => !file.startsWith('markdown'))
    .forEach((file) => assert(active.has(file), `non-Markdown test remains active: ${file}`));
});
