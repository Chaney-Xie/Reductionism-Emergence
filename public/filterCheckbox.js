(function exposeFilterCheckboxControl(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.filterCheckboxControl = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createFilterCheckboxApi(root) {
  'use strict';

  function create(options = {}) {
    const ownerDocument = options.document || root?.document;
    if (!ownerDocument?.createElement) {
      throw new TypeError('A document is required to create a Filter checkbox.');
    }

    const label = ownerDocument.createElement('label');
    label.className = 'filter-checkbox';

    const input = ownerDocument.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(options.checked);
    if (options.value !== undefined) input.value = String(options.value);
    if (options.ariaLabel !== undefined) {
      input.setAttribute('aria-label', String(options.ariaLabel));
    }
    if (typeof options.onChange === 'function') {
      input.addEventListener('change', options.onChange);
    }

    const box = ownerDocument.createElement('span');
    box.className = 'filter-checkbox-box';
    box.setAttribute('aria-hidden', 'true');

    let text = null;
    if (options.text !== undefined && options.text !== null) {
      text = ownerDocument.createElement('span');
      text.className = 'filter-checkbox-text';
      text.textContent = String(options.text);
    }

    label.append(input, box);
    if (text) label.append(text);
    return { element: label, label, input, box, text };
  }

  return Object.freeze({ create });
}));
