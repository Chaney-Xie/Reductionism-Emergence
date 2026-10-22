const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const {
  APP_DATA_SCHEMA_VERSION,
  createEmptyVault,
  isPathInside,
  pathExists,
  readJson,
  readRegistry,
  validateVault,
  vaultMetadata,
  writeJsonFileAtomic
} = require('./vaultContext');

class VaultRegistryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VaultRegistryError';
    this.code = code;
  }
}

function normalizeVaultName(value) {
  if (typeof value !== 'string') {
    throw new VaultRegistryError('INVALID_NAME', 'Enter a Vault name.');
  }
  const name = value.trim().normalize('NFC');
  if (!name || name === '.' || name === '..' || /[\/:\0-\x1f\x7f]/.test(name)) {
    throw new VaultRegistryError(
      'INVALID_NAME',
      'Vault names cannot be empty or contain “/”, “:”, or control characters.'
    );
  }
  return name;
}

function comparableVaultName(value) {
  return normalizeVaultName(value).toLocaleLowerCase('en-US');
}

function stableNewVaultId(idFactory = () => crypto.randomUUID()) {
  const token = String(idFactory()).replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (!token) throw new VaultRegistryError('INVALID_ID', 'A stable Vault ID could not be created.');
  return `vault_${token}`;
}

function canonicalVaultsRoot(appDataRoot) {
  return path.join(path.resolve(appDataRoot), 'vaults');
}

function assertManagedVaultRoot(appDataRoot, vaultRoot) {
  const vaultsRoot = canonicalVaultsRoot(appDataRoot);
  const resolved = path.resolve(vaultRoot || '');
  if (!isPathInside(vaultsRoot, resolved) || path.dirname(resolved) !== vaultsRoot) {
    throw new VaultRegistryError('UNMANAGED_ROOT', 'The Vault root is not application-managed.');
  }
  return resolved;
}

async function loadRegistry(appDataRoot, { fsImpl = fs } = {}) {
  const registry = await readRegistry(path.resolve(appDataRoot), { fsImpl });
  if (!registry || !Array.isArray(registry.vaults) || !registry.vaults.length) {
    throw new VaultRegistryError('INVALID_REGISTRY', 'The Vault registry is unavailable.');
  }
  return registry;
}

function publicVaultEntry(entry, currentVaultId) {
  return {
    vaultId: entry.vaultId,
    displayName: entry.displayName,
    current: entry.vaultId === currentVaultId
  };
}

async function listRegisteredVaults(appDataRoot, options = {}) {
  const registry = await loadRegistry(appDataRoot, options);
  return {
    currentVaultId: registry.currentVaultId,
    vaults: registry.vaults.map((entry) => publicVaultEntry(entry, registry.currentVaultId))
  };
}

function findEntry(registry, vaultId) {
  const entry = registry.vaults.find((candidate) => candidate.vaultId === vaultId);
  if (!entry) throw new VaultRegistryError('VAULT_NOT_FOUND', 'The selected Vault is not registered.');
  return entry;
}

function assertUniqueName(registry, displayName, excludedVaultId = null) {
  const comparable = comparableVaultName(displayName);
  if (registry.vaults.some((entry) => (
    entry.vaultId !== excludedVaultId
      && comparableVaultName(entry.displayName) === comparable
  ))) {
    throw new VaultRegistryError('DUPLICATE_NAME', 'A Vault with this name already exists.');
  }
}

async function validateRegisteredVault(appDataRoot, vaultId, options = {}) {
  const registry = await loadRegistry(appDataRoot, options);
  const entry = findEntry(registry, vaultId);
  const vaultRoot = assertManagedVaultRoot(appDataRoot, entry.vaultRoot);
  const validation = await validateVault(vaultRoot, options);
  if (!validation.valid || validation.vaultId !== vaultId) {
    throw new VaultRegistryError(
      'INVALID_VAULT',
      `The selected Vault could not be loaded: ${validation.errors.join(' ') || 'Vault ID mismatch.'}`
    );
  }
  return { registry, entry: { ...entry, vaultRoot }, validation };
}

async function createRegisteredVault(appDataRoot, name, {
  fsImpl = fs,
  idFactory,
  now = new Date().toISOString()
} = {}) {
  const root = path.resolve(appDataRoot);
  const registry = await loadRegistry(root, { fsImpl });
  const displayName = normalizeVaultName(name);
  assertUniqueName(registry, displayName);
  const vaultId = stableNewVaultId(idFactory);
  if (registry.vaults.some((entry) => entry.vaultId === vaultId)) {
    throw new VaultRegistryError('DUPLICATE_ID', 'A stable Vault ID collision occurred.');
  }
  const vaultsRoot = canonicalVaultsRoot(root);
  const finalRoot = path.join(vaultsRoot, displayName);
  const temporaryRoot = path.join(vaultsRoot, `.${vaultId}.create`);
  if (await pathExists(finalRoot, { fsImpl })) {
    throw new VaultRegistryError('FOLDER_EXISTS', 'A Vault folder with this name already exists.');
  }
  const metadata = vaultMetadata({ vaultId, displayName, now });
  let published = false;
  try {
    await fsImpl.rm(temporaryRoot, { recursive: true, force: true });
    await createEmptyVault(temporaryRoot, metadata, { fsImpl });
    const validation = await validateVault(temporaryRoot, { fsImpl, expectedPageCount: 0 });
    if (!validation.valid) {
      throw new VaultRegistryError('CREATE_FAILED', validation.errors.join(' '));
    }
    await fsImpl.rename(temporaryRoot, finalRoot);
    published = true;
    const entry = {
      vaultId,
      displayName,
      vaultRoot: finalRoot,
      folderName: displayName,
      createdAt: now,
      lastOpenedAt: now
    };
    const nextRegistry = {
      ...registry,
      schemaVersion: APP_DATA_SCHEMA_VERSION,
      vaults: [...registry.vaults, entry]
    };
    await writeJsonFileAtomic(path.join(root, 'vault-registry.json'), nextRegistry, { fsImpl });
    return { entry, registry: nextRegistry };
  } catch (error) {
    await fsImpl.rm(temporaryRoot, { recursive: true, force: true }).catch(() => {});
    if (published && await pathExists(finalRoot, { fsImpl })) {
      await fsImpl.rm(finalRoot, { recursive: true, force: true }).catch(() => {});
    }
    throw error;
  }
}

async function selectRegisteredVault(appDataRoot, vaultId, {
  fsImpl = fs,
  now = new Date().toISOString()
} = {}) {
  const root = path.resolve(appDataRoot);
  const { registry, entry, validation } = await validateRegisteredVault(root, vaultId, { fsImpl });
  const nextRegistry = {
    ...registry,
    schemaVersion: APP_DATA_SCHEMA_VERSION,
    currentVaultId: vaultId,
    vaults: registry.vaults.map((candidate) => candidate.vaultId === vaultId
      ? { ...candidate, lastOpenedAt: now }
      : candidate)
  };
  await writeJsonFileAtomic(path.join(root, 'vault-registry.json'), nextRegistry, { fsImpl });
  return { entry, validation, registry: nextRegistry };
}

async function renameRegisteredVault(appDataRoot, vaultId, name, {
  fsImpl = fs,
  idFactory = () => crypto.randomUUID(),
  now = new Date().toISOString(),
  beforeMutation = null,
  afterMutation = null
} = {}) {
  const root = path.resolve(appDataRoot);
  const registry = await loadRegistry(root, { fsImpl });
  const entry = findEntry(registry, vaultId);
  const displayName = normalizeVaultName(name);
  assertUniqueName(registry, displayName, vaultId);
  const oldRoot = assertManagedVaultRoot(root, entry.vaultRoot);
  const targetRoot = path.join(canonicalVaultsRoot(root), displayName);
  let originalMetadata = await readJson(path.join(oldRoot, 'vault.json'), { fsImpl });
  if (originalMetadata.vaultId !== vaultId) {
    throw new VaultRegistryError('INVALID_VAULT', 'The Vault metadata ID does not match the registry.');
  }
  const sameExactRoot = oldRoot === targetRoot;
  if (sameExactRoot && entry.displayName === displayName) {
    return { entry, registry, changed: false };
  }
  const caseOnly = oldRoot !== targetRoot
    && oldRoot.toLocaleLowerCase('en-US') === targetRoot.toLocaleLowerCase('en-US');
  if (!caseOnly && await pathExists(targetRoot, { fsImpl })) {
    throw new VaultRegistryError('FOLDER_EXISTS', 'A Vault folder with this name already exists.');
  }
  const intermediateRoot = path.join(
    canonicalVaultsRoot(root),
    `.${vaultId}.rename-${String(idFactory()).replace(/[^a-z0-9]/gi, '')}`
  );
  let currentRoot = oldRoot;
  let mutationStarted = false;
  try {
    if (typeof beforeMutation === 'function') {
      await beforeMutation({ entry, displayName, oldRoot, targetRoot });
    }
    const flushedMetadata = await readJson(path.join(oldRoot, 'vault.json'), { fsImpl });
    if (flushedMetadata.vaultId !== vaultId) {
      throw new VaultRegistryError('INVALID_VAULT', 'The Vault metadata ID does not match the registry.');
    }
    originalMetadata = flushedMetadata;
    mutationStarted = true;
    if (!sameExactRoot) {
      if (caseOnly) {
        await fsImpl.rename(oldRoot, intermediateRoot);
        currentRoot = intermediateRoot;
      }
      await fsImpl.rename(currentRoot, targetRoot);
      currentRoot = targetRoot;
    }
    const nextMetadata = { ...originalMetadata, displayName, updatedAt: now };
    await writeJsonFileAtomic(path.join(currentRoot, 'vault.json'), nextMetadata, { fsImpl });
    const nextEntry = {
      ...entry,
      displayName,
      vaultRoot: currentRoot,
      folderName: displayName
    };
    const nextRegistry = {
      ...registry,
      schemaVersion: APP_DATA_SCHEMA_VERSION,
      vaults: registry.vaults.map((candidate) => candidate.vaultId === vaultId
        ? nextEntry
        : candidate)
    };
    await writeJsonFileAtomic(path.join(root, 'vault-registry.json'), nextRegistry, { fsImpl });
    const result = { entry: nextEntry, registry: nextRegistry, changed: true };
    if (typeof afterMutation === 'function') await afterMutation(result);
    return result;
  } catch (error) {
    if (mutationStarted) {
      await writeJsonFileAtomic(path.join(currentRoot, 'vault.json'), originalMetadata, { fsImpl }).catch(() => {});
      if (currentRoot !== oldRoot && await pathExists(currentRoot, { fsImpl })) {
        await fsImpl.rename(currentRoot, oldRoot).catch(() => {});
      }
      await writeJsonFileAtomic(path.join(root, 'vault-registry.json'), registry, { fsImpl }).catch(() => {});
    }
    throw error;
  }
}

module.exports = {
  VaultRegistryError,
  createRegisteredVault,
  listRegisteredVaults,
  normalizeVaultName,
  renameRegisteredVault,
  selectRegisteredVault,
  validateRegisteredVault
};
