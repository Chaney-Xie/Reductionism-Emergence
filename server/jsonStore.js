const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

const jsonWriteTransactions = new AsyncLocalStorage();

function temporaryPathFor(filePath, purpose = 'tmp') {
  return `${filePath}.${process.pid}.${crypto.randomUUID()}.${purpose}`;
}

async function readFileSnapshot(filePath) {
  try {
    const [contents, stat] = await Promise.all([
      fs.readFile(filePath),
      fs.stat(filePath)
    ]);
    return { exists: true, contents, mode: stat.mode & 0o777 };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false };
    throw error;
  }
}

async function rememberPreviousFile(filePath) {
  const transaction = jsonWriteTransactions.getStore();
  if (!transaction) return;
  const resolvedPath = path.resolve(filePath);
  if (!transaction.snapshots.has(resolvedPath)) {
    transaction.snapshots.set(resolvedPath, readFileSnapshot(resolvedPath));
  }
  await transaction.snapshots.get(resolvedPath);
}

async function writeFileAtomic(filePath, contents, mode = null) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = temporaryPathFor(filePath);
  try {
    await fs.writeFile(temporaryPath, contents);
    if (mode != null) await fs.chmod(temporaryPath, mode);
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function fileMatchesSnapshot(filePath, snapshot) {
  try {
    if (!snapshot.exists) {
      await fs.access(filePath);
      return false;
    }
    const [contents, stat] = await Promise.all([fs.readFile(filePath), fs.stat(filePath)]);
    return contents.equals(snapshot.contents) && (stat.mode & 0o777) === snapshot.mode;
  } catch (error) {
    if (error.code === 'ENOENT') return !snapshot.exists;
    return false;
  }
}

async function rollBackJsonWrites(transaction) {
  const failures = [];
  const snapshots = [...transaction.snapshots.entries()].reverse();
  for (const [filePath, snapshotPromise] of snapshots) {
    try {
      const snapshot = await snapshotPromise;
      if (await fileMatchesSnapshot(filePath, snapshot)) continue;
      if (!snapshot.exists) {
        await fs.rm(filePath, { force: true });
      } else {
        try {
          // Restoring an existing writable file in place does not require a
          // writable parent directory. This matters when the denied target
          // and an earlier successful write are sibling Page files.
          await fs.writeFile(filePath, snapshot.contents);
          await fs.chmod(filePath, snapshot.mode);
        } catch {
          await writeFileAtomic(filePath, snapshot.contents, snapshot.mode);
        }
      }
    } catch (error) {
      failures.push({ filePath, error });
    }
  }
  return failures;
}

async function withJsonWriteTransaction(callback) {
  if (jsonWriteTransactions.getStore()) return callback();
  const transaction = { snapshots: new Map() };
  return jsonWriteTransactions.run(transaction, async () => {
    try {
      return await callback();
    } catch (error) {
      const rollbackFailures = await rollBackJsonWrites(transaction);
      if (rollbackFailures.length) error.rollbackFailures = rollbackFailures;
      throw error;
    }
  });
}

async function writeJson(filePath, value) {
  await rememberPreviousFile(filePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeJsonAtomic(filePath, value) {
  await rememberPreviousFile(filePath);
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeFileTransactional(filePath, contents, options) {
  await rememberPreviousFile(filePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, options);
}

async function deleteJson(filePath) {
  await deleteFile(filePath);
}

async function deleteFile(filePath) {
  await rememberPreviousFile(filePath);
  await fs.rm(filePath, { force: true });
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  cloneJson,
  deleteFile,
  deleteJson,
  readJson,
  readJsonIfExists,
  withJsonWriteTransaction,
  writeFileTransactional,
  writeJson,
  writeJsonAtomic
};
