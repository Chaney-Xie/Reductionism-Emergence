const fs = require('fs/promises');
const path = require('path');

const DISPLAYABLE_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
const MIME_BY_EXTENSION = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.csv': 'text/csv'
});

class SelectedFileError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SelectedFileError';
    this.code = code;
  }
}

function mimeTypeForFilename(filename) {
  return MIME_BY_EXTENSION[path.extname(filename).toLowerCase()] || 'application/octet-stream';
}

async function validateSelectedFiles(selectedPaths, { fsImpl = fs } = {}) {
  if (!Array.isArray(selectedPaths) || !selectedPaths.length) return [];
  const validated = [];
  for (const selectedPath of selectedPaths) {
    if (typeof selectedPath !== 'string' || !path.isAbsolute(selectedPath)) {
      throw new SelectedFileError('INVALID_FILE', 'The selected file path is invalid.');
    }
    let realPath;
    let stat;
    try {
      realPath = await fsImpl.realpath(selectedPath);
      stat = await fsImpl.stat(realPath);
    } catch {
      throw new SelectedFileError('FILE_NOT_FOUND', `File not found: ${path.basename(selectedPath)}`);
    }
    if (!stat.isFile()) {
      throw new SelectedFileError('NOT_A_FILE', `${path.basename(selectedPath)} is not a file.`);
    }
    validated.push({ realPath, stat });
  }
  return validated;
}

module.exports = {
  DISPLAYABLE_IMAGE_EXTENSIONS,
  SelectedFileError,
  mimeTypeForFilename,
  validateSelectedFiles
};
