const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const externalLinks = require('../public/externalLinks');
const { createExternalLinkActions } = require('../desktop/externalLinkActions');
const { setExternalFileTarget, setFolderRoot } = require('../desktop/desktopSettings');

test('External Link model keeps URL and opaque local-file targets separate and safe', () => {
  assert.equal(externalLinks.normalizeWebUrl('javascript:alert(1)'), null);
  assert.equal(externalLinks.normalizeWebUrl('file:///tmp/test'), null);
  assert.equal(externalLinks.normalizeWebUrl('https://example.test/a').startsWith('https://'), true);

  const url = externalLinks.normalizeExternalLink({
    id: 'external_url', displayName: ' Example ', targetKind: 'url',
    url: 'https://example.test/a', fileRef: { type: 'folder', folderId: 'folder_a', relativePath: 'x' },
    sourceBlockId: 'block_1', createdAt: 'now', updatedAt: 'now'
  });
  assert.equal(url.displayName, 'Example');
  assert.equal(url.fileRef, null);
  assert.equal(url.sourceBlockId, 'block_1');

  const file = externalLinks.normalizeExternalLink({
    id: 'external_file', displayName: 'Paper', targetKind: 'file', url: 'https://ignored.test',
    fileRef: { type: 'folder', folderId: 'folder_a', relativePath: 'papers/a.pdf' }
  });
  assert.equal(file.url, null);
  assert.deepEqual(file.fileRef, {
    type: 'folder', folderId: 'folder_a', relativePath: 'papers/a.pdf'
  });
  assert.deepEqual(externalLinks.normalizeExternalLink({
    id: 'external_anywhere', displayName: 'Application', targetKind: 'file',
    fileRef: { type: 'external', externalFileId: 'external_file_app1' }
  }).fileRef, { type: 'external', externalFileId: 'external_file_app1' });
  assert.equal(externalLinks.validateDraft({
    displayName: '', targetKind: 'url', url: 'https://example.test'
  }).valid, false);
  const invalidUrl = externalLinks.validateDraft({
    displayName: 'Unsafe', targetKind: 'url', url: 'javascript:alert(1)'
  });
  assert.deepEqual(invalidUrl.errors, { url: 'Enter a valid URL' });
  const missingDisplay = externalLinks.validateDraft({
    displayName: '', targetKind: 'url', url: 'https://example.test'
  });
  assert.deepEqual(missingDisplay.errors, { displayName: 'Display as is required.' });
  assert.equal(externalLinks.displayNameAfterFileSelection('', 'Paper.pdf'), 'Paper.pdf');
  assert.equal(externalLinks.displayNameAfterFileSelection('My paper', 'Paper.pdf'), 'My paper');
});

test('External Link drop URL extraction follows URI, HTML, then plain-text priority', () => {
  assert.deepEqual(externalLinks.externalLinkUrlFromDropData({
    uriList: '# browser metadata\n\nhttps://example.test/from-uri\nhttps://example.test/second',
    html: '<a href="https://example.test/from-uri">Example &amp; label</a>',
    plainText: 'https://example.test/from-plain'
  }), {
    targetKind: 'url',
    url: 'https://example.test/from-uri',
    displayName: 'Example & label'
  });

  assert.deepEqual(externalLinks.externalLinkUrlFromDropData({
    uriList: 'javascript:alert(1)',
    html: '<p><a href="https://example.test/from-html">A <strong>real</strong> link</a></p>',
    plainText: 'https://example.test/from-plain'
  }), {
    targetKind: 'url',
    url: 'https://example.test/from-html',
    displayName: 'A real link'
  });

  assert.deepEqual(externalLinks.externalLinkUrlFromDropData({
    plainText: 'not a URL\nhttps://example.test/from-plain\nhttps://example.test/ignored'
  }), {
    targetKind: 'url',
    url: 'https://example.test/from-plain',
    displayName: ''
  });
  assert.equal(externalLinks.externalLinkUrlFromDropData({ plainText: 'not a URL' }), null);
  assert.equal(externalLinks.externalLinkUrlFromDropData({ plainText: 'javascript:alert(1)' }), null);
  assert.equal(externalLinks.externalLinkUrlFromDropData({
    html: '<a href="https://example.test/path">https://example.test/path</a>'
  }).displayName, '');
});

test('desktop External Link actions accept arbitrary files and applications without copying', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-external-link-'));
  const selected = path.join(root, 'Paper.pdf');
  const application = path.join(root, 'Viewer.app');
  const ordinaryDirectory = path.join(root, 'ordinary-folder');
  await fs.writeFile(selected, 'original');
  await fs.mkdir(application);
  await fs.mkdir(ordinaryDirectory);
  const openedPaths = [];
  const openedUrls = [];
  let settings = null;
  const selections = [selected, application];
  const actions = createExternalLinkActions({
    vaultId: 'vault_a',
    loadSettings: async () => settings,
    storeExternalTarget: async (externalFileId, absolutePath) => {
      settings = setExternalFileTarget(settings, 'vault_a', externalFileId, absolutePath);
    },
    selectFile: async () => selections.shift(),
    resolveFileRef: async (fileRef) => ({ absolutePath: path.join(root, fileRef.relativePath) }),
    openPath: async (absolutePath) => { openedPaths.push(absolutePath); return ''; },
    openExternal: async (url) => { openedUrls.push(url); },
    logger: { error() {} }
  });

  const picked = await actions.selectExternalFile();
  assert.equal(picked.ok, true);
  assert.equal(picked.fileRef.type, 'external');
  assert.match(picked.fileRef.externalFileId, /^external_file_/);
  const pickedApplication = await actions.selectExternalFile();
  assert.equal(pickedApplication.ok, true);
  assert.equal(pickedApplication.fileName, 'Viewer.app');
  const dropped = await actions.registerDroppedExternalFile([ordinaryDirectory, selected]);
  assert.equal(dropped.ok, true);
  assert.equal(dropped.fileName, 'Paper.pdf');
  assert.equal((await actions.registerDroppedExternalFile([ordinaryDirectory])).ok, false);
  assert.equal(await fs.readFile(selected, 'utf8'), 'original');
  assert.equal((await actions.openExternalTarget({ targetKind: 'url', url: 'javascript:x' })).ok, false);
  assert.equal((await actions.openExternalTarget({ targetKind: 'url', url: 'https://example.test' })).ok, true);
  assert.equal((await actions.openExternalTarget({ targetKind: 'file', fileRef: picked.fileRef })).ok, true);
  assert.equal((await actions.openExternalTarget({
    targetKind: 'file', fileRef: pickedApplication.fileRef
  })).ok, true);
  assert.equal(openedUrls.length, 1);
  assert.deepEqual(openedPaths, [selected, application]);
  await fs.rm(selected);
  assert.equal((await actions.openExternalTarget({ targetKind: 'file', fileRef: picked.fileRef })).ok, false);
  assert.ok(settings.externalFileTargetsByVaultId.vault_a[picked.fileRef.externalFileId]);
});

test('an opaque External Link relocates only by one exact filename inside its original registered root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-external-relocate-'));
  const oldPath = path.join(root, 'old', 'Paper.pdf');
  const movedPath = path.join(root, 'new', 'Paper.pdf');
  await fs.mkdir(path.dirname(movedPath), { recursive: true });
  await fs.writeFile(movedPath, 'moved');
  let settings = setFolderRoot(null, 'vault_a', 'folder_002', root);
  settings = setExternalFileTarget(settings, 'vault_a', 'external_file_paper', oldPath);
  const opened = [];
  const actions = createExternalLinkActions({
    vaultId: 'vault_a',
    loadSettings: async () => settings,
    storeExternalTarget: async () => {},
    selectFile: async () => null,
    resolveFileRef: async () => null,
    openPath: async (absolutePath) => { opened.push(absolutePath); return ''; },
    openExternal: async () => {},
    logger: { info() {}, warn() {}, error() {} }
  });

  const described = await actions.describeExternalFile({
    type: 'external', externalFileId: 'external_file_paper'
  });
  assert.equal(described.ok, true);
  assert.equal(described.displayPath, movedPath);
  assert.equal((await actions.openExternalTarget({
    targetKind: 'file',
    fileRef: { type: 'external', externalFileId: 'external_file_paper' }
  })).ok, true);
  assert.deepEqual(opened, [movedPath]);

  settings = setExternalFileTarget(
    settings,
    'vault_a',
    'external_file_gone',
    path.join(root, 'old', 'Gone.pdf')
  );
  assert.equal((await actions.describeExternalFile({
    type: 'external', externalFileId: 'external_file_gone'
  })).ok, false);

  const duplicate = path.join(root, 'other', 'Paper.pdf');
  await fs.mkdir(path.dirname(duplicate), { recursive: true });
  await fs.writeFile(duplicate, 'ambiguous');
  assert.equal((await actions.describeExternalFile({
    type: 'external', externalFileId: 'external_file_paper'
  })).ok, false);

  await fs.rm(root, { recursive: true, force: true });
});
