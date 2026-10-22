const assert = require('node:assert/strict');
const test = require('node:test');

const { createImportService } = require('../server/importService');
const { createLinkModel } = require('../server/linkModel');

const linkTypes = {
  linkTypes: [
    { id: 'contains', opposite: 'contained_by' },
    { id: 'contained_by', opposite: 'contains' }
  ]
};

function model() {
  const importService = createImportService({
    imageAssetsDir: '/tmp/viewer-unused-images',
    resourceAssetsDir: '/tmp/viewer-unused-resources',
    localAssetFilePath: () => null
  });
  return createLinkModel({ defaultLinkTypes: linkTypes, idPageSuffix: importService.idPageSuffix });
}

test('link IDs retain the pre-extraction stable format', () => {
  const links = model();
  const page = { id: 'page_20260714_001' };
  const block = { id: 'block_20260714_001_001', links: [] };

  assert.equal(
    links.uniqueBlockPageLinkId(page, block, 'page_Fb1p5'),
    'link_20260714_001_block_20260714_001_001_to_Fb1p5'
  );
});

test('backlink generation preserves opposite link type and identity fields', () => {
  const links = model();
  const backlink = links.backlinkFromLink({
    sourcePageId: 'page_A',
    sourceBlockId: 'block_A_001',
    sourceLinkId: 'link_A_to_B',
    targetPageId: 'page_B',
    linkTypeId: 'contains',
    sourcePageTitle: 'A'
  }, '2026-01-01T00:00:00.000Z');

  assert.equal(backlink.id, 'backlink_page_A_block_A_001_link_A_to_B');
  assert.equal(backlink.linkTypeId, 'contained_by');
  assert.equal(backlink.sourceLinkTypeId, 'contains');
  assert.equal(backlink.label, 'A');
});
