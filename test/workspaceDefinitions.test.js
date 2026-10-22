const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  normalizeWorkspaceDefinitions,
  readWorkspaceDefinitions
} = require('../desktop/workspaceDefinitions');

test('portable workspace definitions keep stable IDs and labels only', () => {
  assert.deepEqual(normalizeWorkspaceDefinitions({
    version: 1,
    workspaces: {
      workspace_lab: { id: 'workspace_lab', label: 'Lab files', root: '/machine/path' },
      '../bad': { id: '../bad', label: 'Bad' }
    }
  }), {
    version: 1,
    workspaces: {
      workspace_lab: { id: 'workspace_lab', label: 'Lab files' }
    }
  });
});

test('an old vault without workspace definitions reads as an empty portable config', async () => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-workspaces-old-'));
  assert.deepEqual(await readWorkspaceDefinitions(vaultRoot), { version: 1, workspaces: {} });
});
