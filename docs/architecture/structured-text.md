# Structured-text ownership

## Shared rule

Canonical text is source data, never rendered DOM. Markdown and HN may share
projection, geometry, and presentation primitives, but they do not share a
second canonical document, selection, history, parser, or persistence owner.

## Markdown

- `page.markdownBody` is canonical.
- `public/markdownEditableFoundation.js` owns immutable source snapshots,
  physical-line identity, list and quote semantic indexes, transactions, and
  history boundaries.
- `public/markdownPage.js` owns Markdown parsing and canonical commands.
- `public/js/markdownEditableSyntaxAdapters.js` derives presentation ranges.
- `public/js/markdownEditableProjection.js` owns source↔DOM positions,
  selections, caret affinity, and exact revision reconciliation.
- `public/js/markdownPageView.js` mounts Reading, Source, and Live presentation
  without making presentation DOM canonical.

## Hierarchy Network

- The stable persisted envelope remains `page.cneText`; its canonical text is
  `page.cneText.source`.
- `public/hnText.js` owns the envelope schema, validation, and legacy migration.
- `public/js/hnPageDocumentSession.js` owns canonical HN session revisions,
  transactions, selection, and history.
- `public/js/sourceCanonicalEditor.js` is the shared source-canonical editor
  implementation consumed by HN; provisional IME state remains view-local
  until one canonical settlement.
- `public/hnStructureIndex.js`, `public/hnListIndex.js`, and related HN modules
  derive immutable structure/list descriptors from a source snapshot. They are
  not persisted metadata or alternate parsers.
- `public/js/hnTextPageView.js` owns HN Page presentation and consumes the shared
  structured-text shell without taking over canonical source ownership.

The stable `cne-text`, `cneText`, and `cneTextMode` spellings are compatibility
contracts described in `identity-and-compatibility.md`, not current UI names.
