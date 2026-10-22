// Pure outgoing-link/backlink identity, normalization, and cleanup helpers.
function createLinkModel({ defaultLinkTypes, idPageSuffix }) {
  function backlinkKey({ sourcePageId, sourceBlockId, sourceLinkId, targetPageId }) {
    return `${sourcePageId}|${sourceBlockId}|${sourceLinkId}|${targetPageId}`;
  }

  function backlinkId({ sourcePageId, sourceBlockId, sourceLinkId }) {
    return `backlink_${sourcePageId}_${sourceBlockId}_${sourceLinkId}`;
  }

  function linkTypeById(linkTypes) {
    return new Map((linkTypes.linkTypes || []).map((type) => [type.id, type]));
  }

  function oppositeLinkTypeId(linkTypeId, linkTypes) {
    const type = linkTypeById(linkTypes).get(linkTypeId);
    return type?.opposite || linkTypeId || '';
  }

  function backlinkFromLink(linkRef, createdAt, linkTypes = defaultLinkTypes) {
    const sourceLinkTypeId = linkRef.linkTypeId || linkRef.linkType || '';
    const backlink = {
      id: backlinkId(linkRef),
      sourcePageId: linkRef.sourcePageId,
      sourceBlockId: linkRef.sourceBlockId,
      sourceLinkId: linkRef.sourceLinkId,
      targetPageId: linkRef.targetPageId,
      targetType: 'page',
      sourceLinkTypeId,
      linkTypeId: oppositeLinkTypeId(sourceLinkTypeId, linkTypes),
      createdAt
    };

    if (linkRef.sourcePageTitle || linkRef.label) backlink.label = linkRef.sourcePageTitle || linkRef.label;
    return backlink;
  }

  function pageLinkRefs(page) {
    const refs = [];

    for (const block of page.blocks || []) {
      for (const link of block.links || []) {
        if (link.targetType !== 'page' || typeof link.targetPageId !== 'string') continue;

        refs.push({
          sourcePageId: page.id,
          sourceBlockId: block.id,
          sourceLinkId: link.id,
          targetPageId: link.targetPageId,
          targetType: 'page',
          linkTypeId: link.linkTypeId || link.type || '',
          linkType: link.type || '',
          label: link.label || '',
          sourcePageTitle: page.title || ''
        });
      }
    }

    return refs;
  }

  function validBacklink(backlink) {
    return backlink
      && backlink.targetType === 'page'
      && typeof backlink.sourcePageId === 'string'
      && typeof backlink.sourceBlockId === 'string'
      && typeof backlink.sourceLinkId === 'string'
      && typeof backlink.targetPageId === 'string';
  }

  function dedupeBacklinks(backlinks) {
    const byKey = new Map();

    for (const backlink of backlinks || []) {
      if (!validBacklink(backlink)) continue;
      const key = backlinkKey(backlink);
      if (!byKey.has(key)) byKey.set(key, backlink);
    }

    return [...byKey.values()];
  }

  function uniqueBlockPageLinkId(sourcePage, block, targetPageId) {
    const existingIds = new Set((block.links || []).map((link) => link.id));
    const base = `link_${idPageSuffix(sourcePage.id)}_${idPageSuffix(block.id)}_to_${idPageSuffix(targetPageId)}`;
    if (!existingIds.has(base)) return base;

    let number = 1;
    while (existingIds.has(`${base}_${number}`)) number += 1;
    return `${base}_${number}`;
  }

  function removeBacklinksBySource(page, sourcePageId) {
    const before = (page.backlinks || []).length;
    page.backlinks = (page.backlinks || []).filter((backlink) => (
      backlink.sourcePageId !== sourcePageId && backlink.targetPageId !== sourcePageId
    ));
    return before !== page.backlinks.length;
  }

  function removeIncomingLinkFromSource(page, backlink) {
    let removed = false;

    for (const block of page.blocks || []) {
      if (block.id !== backlink.sourceBlockId || !Array.isArray(block.links)) continue;

      const before = block.links.length;
      block.links = block.links.filter((link) => link.id !== backlink.sourceLinkId);
      removed = removed || before !== block.links.length;
    }

    return removed;
  }

  function removeLinksToTargetPage(page, targetPageId) {
    let removed = false;

    for (const block of page.blocks || []) {
      if (!Array.isArray(block.links)) continue;

      const before = block.links.length;
      block.links = block.links.filter((link) => (
        link.targetType !== 'page' || link.targetPageId !== targetPageId
      ));
      removed = removed || before !== block.links.length;
    }

    return removed;
  }

  return {
    backlinkFromLink,
    backlinkKey,
    dedupeBacklinks,
    linkTypeById,
    oppositeLinkTypeId,
    pageLinkRefs,
    removeBacklinksBySource,
    removeIncomingLinkFromSource,
    removeLinksToTargetPage,
    uniqueBlockPageLinkId,
    validBacklink
  };
}

module.exports = { createLinkModel };

