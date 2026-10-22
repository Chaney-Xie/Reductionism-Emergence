# Runtime ownership

## Pane and Tab runtime

Each Pane owns one durable runtime object. `activePaneId` identifies the active
Pane; active state is derived rather than copied into a second global store.
Rendering, Page loading, editor mounts, camera/view state, async generation
tokens, and disposal operate on an explicit Pane runtime. A reused Pane DOM node
does not preserve the lifetime of a disposed runtime.

Tabs own their Page history and view state. Navigation and canonical Page
publication address the target Pane/runtime explicitly. Inactive Pane or Tab
updates must not impersonate the active runtime or refresh global chrome.

## Page and Vault authority

The server-side Page file is the persistence authority. Renderer caches are
projections and must converge through explicit revisioned operations. Derived
navigation and descriptor indexes do not become Page metadata writers.

Desktop Vault servers are owned per Vault context. Opening or closing a Vault
must not replace another Vault's server, workspace state, pending writes, or
cleanup lifecycle. Vault-scoped settings remain scoped to their owning Vault.

## Lifecycle boundary

Async work is accepted only while its originating Pane, runtime, Tab, Page,
revision/generation, and Vault context are still current. Disposal invalidates
that work before DOM or workspace removal. Page deletion first updates canonical
cache/persistence, then notifies Pane/Tab lifecycle owners to close or replace
affected views.

These rules are exercised by the current Pane, workspace, navigation, metadata,
server-context, editor, and persistence tests. Historical packaged screenshots,
capture harnesses, and ticket reports are not architecture authorities.
