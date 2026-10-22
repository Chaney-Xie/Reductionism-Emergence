# W-RENAME042 — R&E / HN Naming and v0.4.2 Identity Migration

## Result

PASS. The current product identity is **Reductionism & Emergence** (`R&E`), the current version is **0.4.2**, and the structured-text system is **Hierarchy Network** (`HN`) with Page display name **HN Text**.

This was a vocabulary, module-identity, and package-identity migration only. The accepted Page/Vault schema, canonical source, grammar, editor behavior, history, serialization, APIs, conversion semantics, and interaction behavior were not redesigned.

## Initial classification

The pre-edit inventory was classified before mutation:

- **CURRENT PRODUCT IDENTITY → rename:** package/build product name, executable/bundle name, window/document title, menu/startup strings, current documentation and tests.
- **CURRENT HN IMPLEMENTATION → rename:** live `cneText`, `cneStructure`, and `cneList` module filenames, HN-private globals/classes/functions/constants, current DOM/CSS presentation names, current tests, imports, script tags, and freshness paths.
- **PERSISTED/API COMPATIBILITY → preserve:** `cne-text`, `page.cneText`, `cneTextMode`, `schemaVersion`, legacy schema versions, desktop bridge/IPC names, generated persisted block IDs, request/response fields, and the existing Application Support directory.
- **HISTORICAL EVIDENCE → remove before Git baseline:** old reports, manifests, hashes, screenshots, and one-off capture harnesses are not current product dependencies.
- **UNRELATED CNE STRING → inspect:** every remaining occurrence was reviewed; only explicit compatibility or historical references remain in live production files.

## Renamed current files

Production modules were cleanly renamed; no duplicate compatibility modules remain:

| Retired current path | Current path |
| --- | --- |
| `public/cneListCommands.js` | `public/hnListCommands.js` |
| `public/cneListIndex.js` | `public/hnListIndex.js` |
| `public/cneListNumbering.js` | `public/hnListNumbering.js` |
| `public/cneStructureIndex.js` | `public/hnStructureIndex.js` |
| `public/cneText.js` | `public/hnText.js` |
| `public/js/cnePageDocumentSession.js` | `public/js/hnPageDocumentSession.js` |
| `public/js/cneTextPageView.js` | `public/js/hnTextPageView.js` |
| `server/cneTextPage.js` | `server/hnTextPage.js` |

The 23 directly HN-owned top-level tests were likewise renamed from `test/cne*` to `test/hn*`:

`hnBasicMarkdownPresentationDom`, `hnBasicMarkdownSyntaxAdapter`, `hnListModel`, `hnListNumbering`, `hnListPersistence`, `hnMarkdownEmptyConversion`, `hnMarkdownEmptyConversionUi`, `hnMarkdownShellParity`, `hnPageDocumentSession`, `hnSequenceListCommands`, `hnSequenceListIndex`, `hnSequenceListPresentation`, `hnSequenceListPresentationCss`, `hnSequenceListRevisionReconcile`, `hnSequenceListSessionIntegration`, `hnSessionReferenceLifecycle`, `hnSourceCanonicalSelectionBoundaries`, `hnSourceCanonicalSyntaxEditor`, `hnStructureIndex`, `hnText`, `hnTextBackend`, `hnTextPageView`, and `hnTextUi`.

## Renamed current symbols

Current HN-private names now consistently use HN vocabulary. Principal owner changes include:

- `cneTextModel` → `hnTextModel`
- `cneStructureIndexModel` → `hnStructureIndexModel`
- `createCneStructureIndex` → `createHnStructureIndex`
- `cneListNumbering` → `hnListNumbering`
- `cneListIndexModel` / `createCneListIndex` → `hnListIndexModel` / `createHnListIndex`
- `cneListCommands` and its command entry points → `hnListCommands` and HN-named entry points
- `cnePageDocumentSessionModel`, `CnePageDocumentSession`, and registry/factories → their `hn` / `Hn` counterparts
- `cneTextPageView` and HN-private Page/View/controller functions → `hnTextPageView` and HN-named functions
- current private `CNE_PAGE_TYPE`, `CNE_SCHEMA_VERSION`, and `CNE_TEXT_MODES` symbols → `HN_PAGE_TYPE`, `HN_SCHEMA_VERSION`, and `HN_TEXT_MODES`
- current `PAGE_TYPES.CNE_TEXT` enum spelling → `PAGE_TYPES.HN_TEXT`, while retaining the exact value `cne-text`
- current HN-only DOM classes, datasets, element IDs, mount IDs, and CSS custom properties use `hn-*` / `--hn-*` naming.

The genuinely shared `public/js/sourceCanonicalEditor.js` was deliberately not renamed.

## Renamed UI and product strings

- `CogNeuro Viewer` → `Reductionism & Emergence` in current package, bundle, executable, desktop application/menu/window, server startup, and HTML document identities.
- compact default UI product placeholders use `R&E`.
- current `CNE Text`, `CNE Edit`, `CNE Browser`, `CNE Structure`, `CNE List`, and `CNE Syntax` terminology is now `HN Text`, `HN Edit`, `HN Browser`, `HN Structure`, `HN List`, and `HN Syntax`.
- the Page Type registry label is `HN Text` and its navigation badge is `HN`.

No current README existed at repository root or the audited current-documentation depth, so there was no live README identity to change.

## Preserved compatibility identifiers

The following are intentionally unchanged compatibility contracts:

- stable Page Type value: `cne-text`
- persisted Page body: `page.cneText`
- Vault preference/API field: `cneTextMode`
- persisted `schemaVersion`, revision, source, anchors, and legacy schema migration semantics
- API request/response fields named `cneText`
- desktop bridge `window.cneDesktop` and `cne-desktop:*` IPC channel names
- existing macOS Application Support directory name `CogNeuro Viewer`, so existing Vault registry and machine settings remain discoverable
- legacy schema constants and diagnostics that explicitly describe historical CNE documents
- persisted/generated `cne_block_*` IDs
- renderer ID `cne-text` wherever it is part of the stable Page Type contract.

Identity tests create and validate an HN Page through the stable `cne-text` registry value and verify the unchanged `cneText` envelope shape. Existing legacy/current HN tests and the full repository suite validate read, edit, save, restart, migration, history, and conversion behavior on this boundary.

## Repository baseline boundary

- Historical `certification/v0.3/**`, ticket reports, manifests, screenshots,
  hashes, and one-off packaged capture harnesses were removed from the source
  tree by W-REPOCLEAN01 before the first Git baseline.
- Current reusable tests and machine fixtures remain under `test/`.
- Current architecture contracts are maintained under `docs/architecture/`.
- The current identity check remains at
  `certification/v0.4.2/re-hn-identity/verify-identity.mjs`.
- Generated package output under `out/` is ignored and is not repository
  history.

## Authoritative version and identity locations

- `package.json`: package `reductionism-emergence`, version `0.4.2`
- `package-lock.json`: root package and lock version `0.4.2`
- `forge.config.js`: packager `name` and `executableName` are `Reductionism & Emergence`
- `forge.config.js`: packager icon is the project-owned `assets/reductionism-emergence.icns`
- `assets/reductionism-emergence-icon-source.png`: supplied 1254×1254 kraft-paper R&E monogram source (`ee2b203dc496f63e7b4d2f8c2818adbe687fda51ba081d7bdf2cc09b927317c1`)
- `assets/reductionism-emergence.icns`: complete macOS icon family (`fd2ea04608203e7fc65f3682846066eca0399ae08c833037a247f724a5dc73c5`)
- `desktop/main.js`: current `APP_NAME` and `app.setName(APP_NAME)`
- `public/index.html`: current document title
- generated `Contents/Info.plist`: `CFBundleDisplayName`, `CFBundleExecutable`, and `CFBundleName` are `Reductionism & Emergence`; both bundle version fields are `0.4.2`
- `server/appServer.js`: current metadata fallback `0.4.2` and current startup label.

## Exact package evidence

- output: `out/Reductionism & Emergence-darwin-arm64/Reductionism & Emergence.app`
- executable: `out/Reductionism & Emergence-darwin-arm64/Reductionism & Emergence.app/Contents/MacOS/Reductionism & Emergence`
- archive: `out/Reductionism & Emergence-darwin-arm64/Reductionism & Emergence.app/Contents/Resources/app.asar`
- archive SHA-256: `19031eab1fd4d4e05241c69979b3fc05a0b1e6f0448b4ab31a8c886df81a5412`
- archive size: `260,982,020` bytes
- archive mtime: `2026-10-22 10:03:39 +0100`
- packaged icon: `Contents/Resources/electron.icns`
- packaged icon SHA-256: `fd2ea04608203e7fc65f3682846066eca0399ae08c833037a247f724a5dc73c5` (exactly matches the project `.icns`)
- source↔ASAR freshness: **30/30 exact**, including all three renamed HN list modules.

This package was produced by a fresh Electron Forge package operation under the new product metadata. It is not a manually renamed old application.

## Validation

- identity migration tests: **4/4 pass**
- focused HN/identity/adjacent source matrix: **281/281 pass**
- definitive full source suite: **1,786 total / 1,761 pass / 0 fail / 25 skip**
- Markdown functional/freshness suite after package: **473/473 pass**
- source↔ASAR freshness: **30/30 pass**
- packaged icon source↔bundle equality: PASS (`fd2ea04608203e7fc65f3682846066eca0399ae08c833037a247f724a5dc73c5`)
- `verify-identity.mjs --package`: PASS
- production/test/certification syntax checks: PASS
- final process audit: no owned Viewer/helper, Forge, capture, appServer, or `server.js` process.

The single updated frozen-function hash in `sidebarDragFreezeContract.test.js` reflects only the private enum spelling `PAGE_TYPES.CNE_TEXT` → `PAGE_TYPES.HN_TEXT`; the function behavior and stable value are unchanged. One stale static table-selection assertion was updated to the already-current `editableTableCellEffectiveRange` owner; no corresponding product behavior changed in this ticket.

## Final invariant

Same Page/Vault data, same canonical text, same editor/runtime behavior, same persistence and interaction semantics; new current R&E/HN vocabulary and v0.4.2 package identity.
