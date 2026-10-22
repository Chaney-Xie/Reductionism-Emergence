(function exposeFolderWarningTooltip(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.folderWarningTooltip = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  const FALLBACK_ERROR = 'Folder link lost. Relink this folder.';
  const ABSOLUTE_PATH_PATTERN = /(^|[\s("'`])(?:\/(?!\/)|[a-z]:[\\/])/i;

  function compactFolderError(value) {
    const message = typeof value === 'string' ? value.trim() : '';
    if (!message || ABSOLUTE_PATH_PATTERN.test(message)) return FALLBACK_ERROR;
    return message;
  }

  function createTooltip({ documentRef, windowRef, container, id = 'vault-folder-error-tooltip' }) {
    const bubble = documentRef.createElement('div');
    bubble.id = id;
    bubble.className = 'vault-folder-tooltip';
    bubble.setAttribute('role', 'tooltip');
    bubble.hidden = true;
    container.append(bubble);
    let currentAnchor = null;

    function position(anchor) {
      if (bubble.hidden || anchor !== currentAnchor) return;
      const anchorRect = anchor.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const bubbleWidth = bubble.offsetWidth;
      const bubbleHeight = bubble.offsetHeight;
      const edge = 8;
      const arrowGap = 8;
      const idealLeft = anchorRect.left + (anchorRect.width / 2) - (bubbleWidth / 2);
      const minLeft = containerRect.left + edge;
      const maxLeft = Math.max(minLeft, containerRect.right - edge - bubbleWidth);
      const viewportLeft = Math.min(Math.max(idealLeft, minLeft), maxLeft);
      const roomAbove = anchorRect.top - containerRect.top;
      const roomBelow = containerRect.bottom - anchorRect.bottom;
      const showBelow = roomAbove < bubbleHeight + arrowGap && roomBelow > roomAbove;
      const viewportTop = showBelow
        ? Math.min(anchorRect.bottom + arrowGap, containerRect.bottom - edge - bubbleHeight)
        : Math.max(containerRect.top + edge, anchorRect.top - arrowGap - bubbleHeight);
      const anchorCenter = anchorRect.left + (anchorRect.width / 2);
      const arrowLeft = Math.min(
        Math.max(anchorCenter - viewportLeft, 10),
        Math.max(10, bubbleWidth - 10)
      );

      bubble.classList.toggle('is-below', showBelow);
      bubble.style.left = `${viewportLeft - containerRect.left}px`;
      bubble.style.top = `${viewportTop - containerRect.top}px`;
      bubble.style.setProperty('--tooltip-arrow-left', `${arrowLeft}px`);
    }

    function show(anchor, message) {
      currentAnchor = anchor;
      bubble.textContent = compactFolderError(message);
      bubble.hidden = false;
      position(anchor);
      windowRef.requestAnimationFrame(() => position(anchor));
    }

    function hide(anchor = currentAnchor) {
      if (anchor !== currentAnchor) return;
      currentAnchor = null;
      bubble.hidden = true;
    }

    function attach(anchor, message) {
      anchor.tabIndex = 0;
      anchor.setAttribute('aria-describedby', id);
      anchor.addEventListener('pointerenter', () => show(anchor, message));
      anchor.addEventListener('pointerleave', () => hide(anchor));
      anchor.addEventListener('focus', () => show(anchor, message));
      anchor.addEventListener('blur', () => hide(anchor));
      return anchor;
    }

    return { attach, bubble, hide, position, show };
  }

  function createFolderNameCell(folder, { documentRef, tooltip }) {
    const nameCell = documentRef.createElement('span');
    nameCell.className = 'vault-folder-name';
    if (!folder) return nameCell;
    nameCell.textContent = folder.name;
    if (folder.available) return nameCell;

    nameCell.classList.add('is-unavailable');
    const warning = documentRef.createElement('span');
    warning.className = 'vault-folder-warning';
    warning.textContent = '⚠';
    warning.setAttribute('aria-label', 'Folder unavailable');
    tooltip.attach(warning, compactFolderError(folder.error));
    nameCell.append(warning);
    return nameCell;
  }

  return { FALLBACK_ERROR, compactFolderError, createFolderNameCell, createTooltip };
}));
