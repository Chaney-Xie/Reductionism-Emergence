(function exposeStructuredTextCount(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.structuredTextCountModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const EMPTY_STATISTICS = Object.freeze({
    words: 0,
    paragraphs: 0,
    characters: 0
  });

  function nonnegativeInteger(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  function normalizeStatistics(value) {
    return {
      words: nonnegativeInteger(value?.words),
      paragraphs: nonnegativeInteger(value?.paragraphs),
      characters: nonnegativeInteger(value?.characters)
    };
  }

  function statisticsFromTextBlocks(blocks) {
    const visibleBlocks = (Array.isArray(blocks) ? blocks : [])
      .map((block) => String(block ?? '').trim())
      .filter(Boolean);
    const text = visibleBlocks.join('\n');
    const characters = Array.from(text)
      .filter((character) => !/\s/u.test(character)).length;
    const hanUnits = text.match(/\p{Script=Han}/gu) || [];
    const withoutHan = text.replace(/\p{Script=Han}/gu, ' ');
    const words = withoutHan.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || [];
    return {
      words: words.length + hanUnits.length,
      paragraphs: visibleBlocks.length,
      characters
    };
  }

  function countField(element, name) {
    const field = element?.querySelector?.(`[data-count-field="${name}"]`);
    if (!field) throw new Error(`Shared Count presentation is missing its ${name} field.`);
    return field;
  }

  function createCountPresentation(element) {
    if (!element?.querySelector || typeof element.setAttribute !== 'function') {
      throw new TypeError('Shared Count presentation requires its canonical DOM element.');
    }
    const fields = Object.freeze({
      words: countField(element, 'words'),
      characters: countField(element, 'characters'),
      paragraphs: countField(element, 'paragraphs')
    });

    function mount(container, before = null) {
      if (!container || typeof container.insertBefore !== 'function') {
        throw new TypeError('Shared Count presentation requires a mount container.');
      }
      const reference = before?.parentElement === container ? before : null;
      container.insertBefore(element, reference);
      return element;
    }

    function update(value) {
      const statistics = normalizeStatistics(value);
      fields.words.textContent = String(statistics.words);
      fields.characters.textContent = String(statistics.characters);
      fields.paragraphs.textContent = String(statistics.paragraphs);
      element.setAttribute('aria-label', [
        `${statistics.words} words or character units`,
        `${statistics.characters} visible characters`,
        `${statistics.paragraphs} paragraphs`
      ].join(', '));
      return statistics;
    }

    return Object.freeze({ element, mount, update });
  }

  return Object.freeze({
    EMPTY_STATISTICS,
    normalizeStatistics,
    statisticsFromTextBlocks,
    createCountPresentation
  });
}));
