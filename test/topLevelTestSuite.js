'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { markdownV02RetirementManifest } = require('./markdownV02RetirementManifest');

const TEST_DIRECTORY = __dirname;
const TOP_LEVEL_TEST_PATTERN = /\.(?:test|integration)\.js$/;

function discoverTopLevelTests() {
  return fs.readdirSync(TEST_DIRECTORY, { withFileTypes: true })
    .filter((entry) => entry.isFile() && TOP_LEVEL_TEST_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function retiredMarkdownV02Tests() {
  return markdownV02RetirementManifest.map((entry) => entry.file).sort();
}

function activeTopLevelTests() {
  const retired = new Set(retiredMarkdownV02Tests());
  return discoverTopLevelTests().filter((file) => !retired.has(file));
}

function absoluteTestPaths(files) {
  return files.map((file) => path.join(TEST_DIRECTORY, file));
}

function runTopLevelTests(files) {
  const child = spawn(process.execPath, ['--test', ...absoluteTestPaths(files)], {
    cwd: path.resolve(TEST_DIRECTORY, '..'),
    env: process.env,
    stdio: 'inherit'
  });
  child.on('error', (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}

if (require.main === module) {
  const legacy = process.argv.includes('--markdown-v02-legacy');
  runTopLevelTests(legacy ? retiredMarkdownV02Tests() : activeTopLevelTests());
}

module.exports = Object.freeze({
  TEST_DIRECTORY,
  discoverTopLevelTests,
  retiredMarkdownV02Tests,
  activeTopLevelTests
});
