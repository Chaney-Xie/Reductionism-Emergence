const fs = require('fs/promises');
const path = require('path');

const WORKSPACE_ID_PATTERN = /^[a-z0-9_-]+$/i;

function normalizeWorkspaceDefinitions(value) {
  const definitions = { version: 1, workspaces: {} };
  const source = value?.workspaces;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return definitions;

  for (const [key, raw] of Object.entries(source)) {
    if (!raw || typeof raw !== 'object') continue;
    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : key;
    if (!WORKSPACE_ID_PATTERN.test(id)) continue;
    const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : id;
    definitions.workspaces[id] = { id, label };
    if (typeof raw.createdAt === 'string') definitions.workspaces[id].createdAt = raw.createdAt;
    if (typeof raw.updatedAt === 'string') definitions.workspaces[id].updatedAt = raw.updatedAt;
  }
  return definitions;
}

async function readWorkspaceDefinitions(vaultRoot, { fsImpl = fs } = {}) {
  const definitionsPath = path.join(vaultRoot, 'workspaces.json');
  try {
    return normalizeWorkspaceDefinitions(JSON.parse(await fsImpl.readFile(definitionsPath, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return normalizeWorkspaceDefinitions(null);
    if (error instanceof SyntaxError) {
      throw new Error('workspaces.json contains invalid JSON.');
    }
    throw error;
  }
}

module.exports = {
  WORKSPACE_ID_PATTERN,
  normalizeWorkspaceDefinitions,
  readWorkspaceDefinitions
};
