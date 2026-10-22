const test = require('node:test');
const assert = require('node:assert/strict');
const { executeAddFiles } = require('../desktop/addFileController');

test('Add File rolls back newly copied files when the page mutation fails', async () => {
  let rollbackCount = 0;
  const result = await executeAddFiles({
    pageId: 'page_test',
    prepareFiles: async () => ({
      ok: true,
      copiedCount: 1,
      files: [{ type: 'folder', folderId: 'folder_001', relativePath: 'A.png' }],
      rollbackCopies: async () => { rollbackCount += 1; }
    }),
    requestMutation: async () => ({ ok: false, body: { error: 'duplicate' } })
  });
  assert.deepEqual(result, { ok: false, error: 'duplicate' });
  assert.equal(rollbackCount, 1);
});

test('Add File reports refresh failure separately after successful persistence', async () => {
  let rollbackCount = 0;
  const result = await executeAddFiles({
    pageId: 'page_test',
    prepareFiles: async () => ({
      ok: true,
      copiedCount: 0,
      files: [{ type: 'folder', folderId: 'folder_001', relativePath: 'A.png' }],
      rollbackCopies: async () => { rollbackCount += 1; }
    }),
    requestMutation: async () => ({ ok: true, body: { page: {} } })
  });
  assert.equal(result.mutationSucceeded, true);
  assert.match(result.error, /could not be refreshed/i);
  assert.equal(rollbackCount, 0);
});
