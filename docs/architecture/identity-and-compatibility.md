# Product identity and compatibility

## Current identity

- Product: **Reductionism & Emergence** (`R&E`)
- Version: **0.4.2**
- Structured-text system: **Hierarchy Network** (`HN`)
- Structured-text Page label: **HN Text**

The authoritative package version is `package.json`. `package-lock.json`,
`forge.config.js`, `desktop/main.js`, and the document title in
`public/index.html` must agree with that identity. The macOS application icon is
owned by `assets/reductionism-emergence.icns`; its editable source is
`assets/reductionism-emergence-icon-source.png`.

## Stable compatibility contracts

The HN rename is presentation and implementation vocabulary. It does not rename
persisted or externally observable compatibility identifiers:

- Page Type value: `cne-text`
- persisted Page body: `page.cneText`
- Vault preference and API field: `cneTextMode`
- persisted `schemaVersion`, `revision`, `source`, and `anchors`
- desktop bridge: `window.cneDesktop`
- desktop IPC prefix: `cne-desktop:`
- existing macOS Application Support directory: `CogNeuro Viewer`
- persisted/generated `cne_block_*` identifiers

Changing one of these identifiers requires an explicit data/API migration. A
current HN module, class, DOM name, or UI label must not introduce a second live
compatibility path merely to retain an old private spelling.

## Verification owners

`test/reHnIdentityMigration.test.js` verifies current product identity, clean HN
module ownership, and the compatibility boundary. Package source freshness is
owned by `test/markdownConformance/runner/adapters/viewerV1.mjs`.
