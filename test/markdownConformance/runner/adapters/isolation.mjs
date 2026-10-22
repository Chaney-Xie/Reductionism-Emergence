import crypto from 'node:crypto';
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SENTINEL_NAME = '.cne-markdown-conformance-root.json';
const ROOT_PREFIX = 'cne-md-conformance-';

export class IsolationSafetyError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'IsolationSafetyError';
    this.details = details;
  }
}

function pathIsInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

async function existingRealpath(candidate) {
  try {
    return await realpath(candidate);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function canonicalTempBases() {
  const values = [...new Set([os.tmpdir(), '/private/tmp', '/tmp'])];
  const canonical = [];
  for (const value of values) {
    const resolved = await existingRealpath(value);
    if (resolved && !canonical.includes(resolved)) canonical.push(resolved);
  }
  return canonical;
}

export async function assertTemporaryRoot(candidate, { requireSentinel = false } = {}) {
  if (typeof candidate !== 'string' || !candidate.trim()) {
    throw new IsolationSafetyError('An isolated root path is required.');
  }
  const resolved = path.resolve(candidate);
  const canonical = await existingRealpath(resolved);
  if (!canonical) throw new IsolationSafetyError('The isolated root does not exist.', { candidate });
  if (canonical === path.parse(canonical).root || canonical === os.homedir()) {
    throw new IsolationSafetyError('Refusing to treat a broad system directory as an isolated root.', {
      candidate,
      canonical
    });
  }
  const bases = await canonicalTempBases();
  if (!bases.some((base) => pathIsInside(base, canonical) && base !== canonical)) {
    throw new IsolationSafetyError('Runtime root is outside an approved temporary directory.', {
      candidate,
      canonical,
      approvedBases: bases
    });
  }
  if (!path.basename(canonical).startsWith(ROOT_PREFIX)) {
    throw new IsolationSafetyError('Runtime root does not have the conformance safety prefix.', {
      canonical,
      requiredPrefix: ROOT_PREFIX
    });
  }
  if (requireSentinel) await readIsolationSentinel(canonical);
  return canonical;
}

export async function assertIsolatedChild(root, candidate, { mustExist = false } = {}) {
  const canonicalRoot = await assertTemporaryRoot(root, { requireSentinel: true });
  const resolved = path.resolve(candidate);
  if (resolved === canonicalRoot || !pathIsInside(canonicalRoot, resolved)) {
    throw new IsolationSafetyError('Path leaves the isolated runtime root.', {
      root: canonicalRoot,
      candidate: resolved
    });
  }

  let existing = resolved;
  while (!(await existingRealpath(existing))) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const canonicalAncestor = await existingRealpath(existing);
  if (!canonicalAncestor || !pathIsInside(canonicalRoot, canonicalAncestor)) {
    throw new IsolationSafetyError('An existing path ancestor escapes the isolated runtime root.', {
      root: canonicalRoot,
      candidate: resolved,
      existing,
      canonicalAncestor
    });
  }
  if (mustExist) {
    const canonicalCandidate = await existingRealpath(resolved);
    if (!canonicalCandidate || !pathIsInside(canonicalRoot, canonicalCandidate)) {
      throw new IsolationSafetyError('Existing isolated path could not be validated.', {
        root: canonicalRoot,
        candidate: resolved,
        canonicalCandidate
      });
    }
  }
  return resolved;
}

export async function readIsolationSentinel(root) {
  const canonical = await assertTemporaryRoot(root);
  const sentinelPath = path.join(canonical, SENTINEL_NAME);
  let sentinel;
  try {
    sentinel = JSON.parse(await readFile(sentinelPath, 'utf8'));
  } catch (error) {
    throw new IsolationSafetyError(`Isolated root sentinel is unavailable: ${error.message}`, {
      root: canonical,
      sentinelPath
    });
  }
  if (sentinel?.schemaVersion !== 1
    || sentinel?.root !== canonical
    || typeof sentinel?.token !== 'string'
    || sentinel.token.length < 16) {
    throw new IsolationSafetyError('Isolated root sentinel failed validation.', {
      root: canonical,
      sentinel
    });
  }
  return sentinel;
}

export async function createIsolatedRuntimeRoot(kind, {
  baseDirectory = os.tmpdir(),
  label = ''
} = {}) {
  const base = await existingRealpath(path.resolve(baseDirectory));
  const approvedBases = await canonicalTempBases();
  if (!base || !approvedBases.some((approved) => pathIsInside(approved, base))) {
    throw new IsolationSafetyError('Requested temporary base directory is not approved.', {
      baseDirectory,
      base,
      approvedBases
    });
  }
  const safeKind = String(kind || 'runtime').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const safeLabel = String(label || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 24);
  const prefix = `${ROOT_PREFIX}${safeKind}${safeLabel ? `-${safeLabel}` : ''}-`;
  const created = await mkdtemp(path.join(base, prefix));
  const root = await realpath(created);
  await chmod(root, 0o700);
  const sentinel = {
    schemaVersion: 1,
    purpose: 'markdown-behavioural-conformance',
    kind: safeKind,
    label: safeLabel || null,
    token: crypto.randomUUID(),
    pid: process.pid,
    createdAt: new Date().toISOString(),
    root
  };
  await writeFile(
    path.join(root, SENTINEL_NAME),
    `${JSON.stringify(sentinel, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600, flag: 'wx' }
  );
  const profile = path.join(root, 'profile');
  const vault = path.join(root, 'vault');
  await Promise.all([
    mkdir(profile, { recursive: false, mode: 0o700 }),
    mkdir(vault, { recursive: false, mode: 0o700 })
  ]);
  return { root, profile, vault, sentinel };
}

export async function validateIsolatedRuntimeRoot(session) {
  if (!session?.root || !session?.profile || !session?.vault) {
    throw new IsolationSafetyError('Incomplete isolated runtime session.', { session });
  }
  const root = await assertTemporaryRoot(session.root, { requireSentinel: true });
  const [profile, vault] = await Promise.all([
    assertIsolatedChild(root, session.profile, { mustExist: true }),
    assertIsolatedChild(root, session.vault, { mustExist: true })
  ]);
  const [profileStat, vaultStat] = await Promise.all([stat(profile), stat(vault)]);
  if (!profileStat.isDirectory() || !vaultStat.isDirectory()) {
    throw new IsolationSafetyError('Isolated profile and Vault paths must be directories.', {
      profile,
      vault
    });
  }
  return { ...session, root, profile, vault };
}

export async function writeIsolatedFile(root, destination, data, options = {}) {
  const target = await assertIsolatedChild(root, destination);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, data, options);
  return target;
}

export async function writeIsolatedJson(root, destination, value, { mode = 0o600 } = {}) {
  return writeIsolatedFile(root, destination, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode
  });
}

export async function copyReadOnlyIntoIsolation(root, source, destination) {
  const target = await assertIsolatedChild(root, destination);
  const sourceStat = await stat(source);
  if (!sourceStat.isFile()) {
    throw new IsolationSafetyError('Read-only runtime source is not a regular file.', { source });
  }
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await copyFile(source, target);
  await chmod(target, 0o444);
  const copiedStat = await stat(target);
  if ((copiedStat.mode & 0o222) !== 0) {
    throw new IsolationSafetyError('Copied runtime asset is unexpectedly writable.', { target });
  }
  return target;
}

export async function sha256File(filePath) {
  const bytes = await readFile(filePath);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export async function readExactFileObservation(root, filePath) {
  const target = await assertIsolatedChild(root, filePath, { mustExist: true });
  const bytes = await readFile(target);
  return {
    path: target,
    byteLength: bytes.byteLength,
    base64: bytes.toString('base64'),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    utf8: bytes.toString('utf8')
  };
}

export async function isolatedPathExists(root, candidate) {
  const target = await assertIsolatedChild(root, candidate);
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function removeIsolatedRuntimeRoot(root, { expectedToken } = {}) {
  const canonical = await assertTemporaryRoot(root, { requireSentinel: true });
  const sentinel = await readIsolationSentinel(canonical);
  if (expectedToken && sentinel.token !== expectedToken) {
    throw new IsolationSafetyError('Isolated root token mismatch; refusing teardown.', {
      root: canonical,
      expectedToken,
      actualToken: sentinel.token
    });
  }
  const rootStat = await lstat(canonical);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new IsolationSafetyError('Isolated root is not a plain directory; refusing teardown.', {
      root: canonical
    });
  }
  await rm(canonical, { recursive: true, force: false, maxRetries: 2 });
}

export const isolationConstants = Object.freeze({ SENTINEL_NAME, ROOT_PREFIX });
