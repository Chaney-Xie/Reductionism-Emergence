const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createNavigationModel } = require('../server/navigationModel');

test('new page identities are not recycled after an indexed page is deleted', async () => {
  const pagesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-page-identity-'));
  const model = createNavigationModel({
    pagesDir,
    pageDateStamp: () => '20260810'
  });

  try {
    const deletedPageId = await model.uniqueDatedPageId([]);
    const replacementPageId = await model.uniqueDatedPageId([]);
    assert.notEqual(replacementPageId, deletedPageId);
    assert.match(deletedPageId, /^page_20260810_[a-f0-9]{12}$/);
    assert.match(replacementPageId, /^page_20260810_[a-f0-9]{12}$/);
  } finally {
    await fs.rm(pagesDir, { recursive: true, force: true });
  }
});
