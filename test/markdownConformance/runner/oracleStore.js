'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { stableStringify } = require('./utils');

function safeVersion(value) {
  const version = String(value || '').trim();
  if (!version) throw new Error('An Obsidian version is required.');
  const safe = version.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
  if (!safe) throw new Error('The Obsidian version does not contain a safe filename component.');
  return safe;
}

function oracleFilename(obsidianVersion) {
  return `obsidian-${safeVersion(obsidianVersion)}.json`;
}

function writeVersionedOracle(directory, document, options = {}) {
  const version = document?.metadata?.obsidianVersion || document?.obsidianVersion;
  const destination = path.join(path.resolve(directory), oracleFilename(version));
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  const flag = options.overwrite === true ? 'w' : 'wx';
  try {
    fs.writeFileSync(destination, `${stableStringify(document)}\n`, {flag});
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(`Oracle already exists and was not overwritten: ${destination}`);
    }
    throw error;
  }
  return destination;
}

module.exports = Object.freeze({oracleFilename, safeVersion, writeVersionedOracle});
