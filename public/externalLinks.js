(function exposeExternalLinks(root, factory) {
  const api = factory(
    typeof module === 'object' && module.exports
      ? require('./resourceLocations')
      : root.resourceLocationsModel
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.externalLinksModel = api;
}(typeof globalThis === 'object' ? globalThis : this, (resourceLocationsModel) => {
  const TARGET_KINDS = Object.freeze({ URL: 'url', FILE: 'file' });
  const TARGET_MODES = new Set(Object.values(TARGET_KINDS));

  function normalizeDisplayName(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 512);
  }

  function normalizeWebUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const parsed = new URL(value.trim());
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      return parsed.href;
    } catch {
      return null;
    }
  }

  function decodeHtmlText(value) {
    if (typeof value !== 'string') return '';
    const named = {
      amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"'
    };
    return value.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi, (match, entity) => {
      if (entity[0] === '#') {
        const hexadecimal = entity[1]?.toLowerCase() === 'x';
        const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
        if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
        try { return String.fromCodePoint(codePoint); } catch { return match; }
      }
      return named[entity.toLowerCase()] ?? match;
    });
  }

  function htmlUrlCandidates(html) {
    if (typeof html !== 'string' || !html.trim()) return [];
    const result = [];
    const anchorPattern = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;
    let match;
    while ((match = anchorPattern.exec(html))) {
      const url = normalizeWebUrl(decodeHtmlText(match[1] || match[2] || match[3] || ''));
      if (!url) continue;
      const text = decodeHtmlText((match[4] || '').replace(/<[^>]*>/g, ' '));
      const displayName = normalizeDisplayName(text.replace(/\s+/g, ' '));
      result.push({
        url,
        displayName: displayName && !normalizeWebUrl(displayName) ? displayName : ''
      });
    }
    return result;
  }

  function firstUriListUrl(value) {
    if (typeof value !== 'string') return null;
    for (const line of value.split(/\r?\n/)) {
      const candidate = line.trim();
      if (!candidate || candidate.startsWith('#')) continue;
      const url = normalizeWebUrl(candidate);
      if (url) return url;
    }
    return null;
  }

  function externalLinkUrlFromDropData({ uriList = '', html = '', plainText = '' } = {}) {
    const htmlCandidates = htmlUrlCandidates(html);
    const uriUrl = firstUriListUrl(uriList);
    if (uriUrl) {
      const matchingHtml = htmlCandidates.find((candidate) => candidate.url === uriUrl);
      return { targetKind: TARGET_KINDS.URL, url: uriUrl, displayName: matchingHtml?.displayName || '' };
    }
    if (htmlCandidates.length) {
      return {
        targetKind: TARGET_KINDS.URL,
        url: htmlCandidates[0].url,
        displayName: htmlCandidates[0].displayName
      };
    }
    const plainUrl = typeof plainText === 'string'
      ? plainText.split(/\r?\n/).map((line) => normalizeWebUrl(line)).find(Boolean) || null
      : null;
    return plainUrl
      ? { targetKind: TARGET_KINDS.URL, url: plainUrl, displayName: '' }
      : null;
  }

  function normalizeTargetMode(value, fallback = TARGET_KINDS.URL) {
    return TARGET_MODES.has(value) ? value : fallback;
  }

  function displayNameAfterFileSelection(currentValue, fileName) {
    if (typeof currentValue === 'string' && currentValue.trim()) return currentValue;
    return normalizeDisplayName(fileName);
  }

  function normalizeFileRef(value) {
    if (value?.type === 'external'
      && typeof value.externalFileId === 'string'
      && /^external_file_[a-z0-9_-]+$/i.test(value.externalFileId)) {
      return { type: 'external', externalFileId: value.externalFileId };
    }
    try {
      return resourceLocationsModel.normalizeResourceLocation(value);
    } catch {
      return null;
    }
  }

  function normalizeExternalLink(value) {
    if (!value || typeof value !== 'object') return null;
    const id = typeof value.id === 'string' && /^external_[a-z0-9_-]+$/i.test(value.id)
      ? value.id
      : null;
    const displayName = normalizeDisplayName(value.displayName);
    const targetKind = normalizeTargetMode(value.targetKind, null);
    if (!id || !displayName || !targetKind) return null;
    const sourceBlockId = typeof value.sourceBlockId === 'string'
      && /^[a-z0-9_-]+$/i.test(value.sourceBlockId)
      ? value.sourceBlockId
      : null;
    const createdAt = typeof value.createdAt === 'string' ? value.createdAt : null;
    const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : createdAt;
    if (targetKind === TARGET_KINDS.URL) {
      const url = normalizeWebUrl(value.url);
      if (!url) return null;
      return {
        id, displayName, targetKind, url, fileRef: null, sourceBlockId, createdAt, updatedAt
      };
    }
    const fileRef = normalizeFileRef(value.fileRef);
    if (!fileRef) return null;
    return {
      id, displayName, targetKind, url: null, fileRef, sourceBlockId, createdAt, updatedAt
    };
  }

  function normalizeExternalLinks(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const result = [];
    for (const item of value) {
      const normalized = normalizeExternalLink(item);
      if (!normalized || seen.has(normalized.id)) continue;
      seen.add(normalized.id);
      result.push(normalized);
    }
    return result;
  }

  function validateDraft(value) {
    const displayName = normalizeDisplayName(value?.displayName);
    const targetKind = normalizeTargetMode(value?.targetKind);
    const errors = {};
    if (!displayName) errors.displayName = 'Display as is required.';
    if (targetKind === TARGET_KINDS.URL) {
      const url = normalizeWebUrl(value?.url);
      if (!url) errors.url = 'Enter a valid URL';
      if (Object.keys(errors).length) {
        return { valid: false, errors, error: errors.displayName || errors.url };
      }
      return { valid: true, value: { displayName, targetKind, url, fileRef: null } };
    }
    const fileRef = normalizeFileRef(value?.fileRef);
    if (!fileRef) errors.fileRef = 'Select a local file.';
    if (Object.keys(errors).length) {
      return { valid: false, errors, error: errors.displayName || errors.fileRef };
    }
    return { valid: true, value: { displayName, targetKind, url: null, fileRef } };
  }

  function targetLabel(link, displayPath = '') {
    if (link?.targetKind === TARGET_KINDS.URL) return link.url || '';
    return displayPath || link?.fileRef?.relativePath || '';
  }

  return {
    TARGET_KINDS,
    displayNameAfterFileSelection,
    externalLinkUrlFromDropData,
    firstUriListUrl,
    normalizeDisplayName,
    normalizeExternalLink,
    normalizeExternalLinks,
    normalizeTargetMode,
    normalizeWebUrl,
    targetLabel,
    validateDraft
  };
}));
