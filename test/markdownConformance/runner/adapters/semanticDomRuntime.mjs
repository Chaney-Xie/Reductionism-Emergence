/*
 * This function is serialized into each real renderer. Keep it dependency-free.
 * It deliberately emits product-neutral Markdown concepts rather than DOM tags,
 * application class names, or implementation-specific nesting wrappers.
 */
export function semanticObservationFromDom(root) {
  const nodes = [];

  const directListItems = (list) => [...list.children].filter((child) => child.tagName === 'LI');
  const typeFor = (element) => {
    const tag = element.tagName?.toLowerCase?.() || '';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'p') return 'paragraph';
    if (tag === 'blockquote') return 'blockquote';
    if (tag === 'ol' || tag === 'ul') return 'list';
    if (tag === 'li') return 'listItem';
    if (tag === 'pre') return 'code';
    if (tag === 'code' && !element.closest('pre')) return 'inlineCode';
    if (tag === 'strong' || tag === 'b') return 'strong';
    if (tag === 'em' || tag === 'i') return 'emphasis';
    if (tag === 'del' || tag === 's') return 'delete';
    if (tag === 'a') return 'link';
    if (tag === 'img') return 'image';
    if (tag === 'hr') return 'thematicBreak';
    if (tag === 'br') return 'break';
    if (tag === 'table') return 'table';
    if (tag === 'tr') return 'tableRow';
    if (tag === 'th' || tag === 'td') return 'tableCell';
    if (tag === 'mjx-container'
      || element.classList?.contains('katex')
      || element.classList?.contains('math')) return 'math';
    return null;
  };

  const mappedChildren = (parent) => {
    const result = [];
    const visit = (element) => {
      for (const child of element?.children || []) {
        if (typeFor(child)) result.push(child);
        else visit(child);
      }
    };
    visit(parent);
    return result;
  };

  const visit = (element, context, nodePath) => {
    const type = typeFor(element);
    if (!type) return;
    const quoteDepth = context.quoteDepth + (type === 'blockquote' ? 1 : 0);
    const listDepth = context.listDepth + (type === 'list' ? 1 : 0);
    const entry = { path: nodePath, type, quoteDepth, listDepth };
    if (type === 'heading') entry.depth = Number(element.tagName.slice(1));
    if (type === 'list') {
      entry.ordered = element.tagName === 'OL';
      entry.startNumber = entry.ordered ? Number(element.getAttribute('start') || 1) : null;
    }
    if (type === 'listItem') {
      const list = element.parentElement;
      const siblings = list ? directListItems(list) : [];
      const index = Math.max(0, siblings.indexOf(element));
      const start = list?.tagName === 'OL' ? Number(list.getAttribute('start') || 1) : null;
      const explicitValue = element.hasAttribute?.('value')
        ? Number(element.getAttribute('value'))
        : null;
      entry.ordinal = start == null
        ? null
        : Number.isFinite(explicitValue) ? explicitValue : start + index;
      const checkbox = element.querySelector(':scope input[type="checkbox"]');
      entry.checked = checkbox ? Boolean(checkbox.checked) : null;
    }
    if (type === 'tableCell') entry.header = element.tagName === 'TH';
    nodes.push(entry);
    mappedChildren(element).forEach((child, index) => {
      visit(child, { quoteDepth, listDepth }, `${nodePath}.${index}`);
    });
  };

  const roots = mappedChildren(root);
  roots.forEach((element, index) => visit(
    element,
    { quoteDepth: 0, listDepth: 0 },
    String(index)
  ));
  const typeCounts = nodes.reduce((counts, node) => {
    counts[node.type] = (counts[node.type] || 0) + 1;
    return counts;
  }, {});
  return {
    rootTypes: roots.map((element) => typeFor(element)),
    nodes,
    typeCounts,
    maximumQuoteDepth: nodes.reduce((maximum, node) => Math.max(maximum, node.quoteDepth), 0),
    maximumListDepth: nodes.reduce((maximum, node) => Math.max(maximum, node.listDepth), 0)
  };
}

export const SEMANTIC_DOM_FUNCTION_SOURCE = semanticObservationFromDom.toString();
