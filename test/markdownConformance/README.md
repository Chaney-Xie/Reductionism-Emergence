# Obsidian ↔ Reductionism & Emergence Markdown conformance

This tree is the reusable v0.3 Markdown behavioural audit and repair system. It inventories Viewer support, records intentional Viewer differences, generates deterministic scenarios, drives isolated real Obsidian (O1) and packaged Viewer (V1) runtimes, compares their evidence, and retains regression inputs.

Production Markdown repair is part of the workflow. A production change should follow authoritative evidence, address a grouped root cause rather than one scenario, and pass the relevant repair gate and regression suites. The Viewer parser, fake DOM tests, CommonMark, and prose documentation remain supporting evidence; none substitutes for an O1 ↔ V1 run.

## Corpus contract

`fixtures/canonicalFixtures.json` and `scenarios/actionCatalog.json` generate the deterministic boundary/action corpus. Generation sorts its inputs, omits clock data by default, and writes the current scenario count and SHA-256 into the generated JSON. Regenerate the corpus instead of copying a count or digest from this README.

The inventory preserves the independently audited v0.3 syntax rows and separately records additional forms already supported by the current parser/renderer, including Setext headings, backslash hard breaks, safe inline HTML, underscore emphasis, alternate list markers, indented and tilde-fenced code, reference/autolinks, and Markdown images. Obsidian-only wikilinks, embeds, callouts, footnotes, tags, highlights, and comments are not silently added to Viewer scope.

Checked-in generated corpora and the small oracle set under `fixtures/oracles/` are reproducible regression inputs. Runtime captures and comparisons belong in the generated, Git-ignored `evidence/` directory and are not timeless certification claims: app versions, package freshness, selected scenarios, automation coverage, and comparison output must all belong to the run being reported. Final counts belong in generated evidence, not here.

## Layout

- `inventory/supportedSyntax.json`: current Viewer support, evidence, frozen controls, and unsupported boundaries.
- `inventory/obsidianDocumentation.json`: official documentation annotations and URLs. Installed-runtime O1 evidence wins for interaction observations; disagreements remain visible.
- `overrides/viewerOverrides.json`: strict allowlists and Viewer expectations for hidden thematic breaks, quote rails, frozen LaTeX, and approved table interaction.
- `fixtures/canonicalFixtures.json`: exact source strings, target anchors, structural tags, and unit-level semantic assertions.
- `fixtures/oracles/`: versioned O1/V1 regression inputs directly consumed by current tests; these are fixtures, not historical run archives.
- `scenarios/actionCatalog.json` and `scenarios/generator.js`: exact selection resolution and deterministic boundary/action expansion.
- `scenarios/certificationRandomProfile.json`: the bounded `v0.3-valid` random grammar, seed, action bounds, and history/navigation policy.
- `scenarios/v0.3ListEditingExpanded.json`: the deterministic list-editing supplement covering ordered, unordered, mixed, nested, continuation-line, join, activation, and arbitrary-numbering cases.
- `scenarios/v0.3ListRandom500.json`: the separate persisted-seed corpus of exactly 500 bounded Source/Live Preview list-editing sequences.
- `scenarios/v0.3ListEditingMinimizedRegressions.json`: the aggregate permanent one-action gate produced from authoritative divergences in the expanded list corpus.
- `scenarios/obsidianSourceRepairGate.json`: source-and-selection expectations recorded from the versioned O1 oracle for targeted Viewer repair verification.
- `scenarios/v0.3FinalRepairGate.json`: focused multi-action scenarios intended for a fresh real O1 ↔ V1 repair-gate run.
- `scenarios/v0.3ListFocusedEvidence.json`: focused active/inactive ordered-numbering and trusted cross-item pointer-selection scenarios.
- `scenarios/v0.3ValidRandomTargetedRepairGate.json`: deterministic minimized representatives for the early valid-random root-cause clusters, including timing-sensitive history prefixes.
- `scenarios/v0.3ValidRandomFullTraceRepairGate.json`: generated first-authoritative-divergence gate for the complete per-action random trace; ordinary cases are rebased to one action and editor/history-dependent cases retain the shortest validated prefix policy.
- `scenarios/v0.3ValidRandomNoEarlyDivergence.json`: the valid-random originals that remain exact through action six, retained for late-divergence tracing.
- `runner/adapters/`: isolated real-application O1/V1 transports, kept separate from normalization and classification.
- `runner/observations.js`: exact source bytes/text, UTF-16 selection offsets, physical lines, semantic snapshots, presentation, and stable geometry normalization.
- `runner/listEditingScenarios.js` and `runner/listEditingScenariosCli.js`: deterministic generation and validation for the two isolated list-editing corpora.
- `runner/adapters/listObservationRuntime.mjs`: dependency-free source/DOM list extraction shared by the real O1 and V1 renderer captures.
- `runner/actionTraceComparison.js`: per-action O1/V1 trace alignment, normalized step comparison, and first/downstream divergence reporting.
- `runner/actionTraceRepairArtifacts.js`: deterministic conversion of first authoritative random divergences into replayable source/caret repair scenarios with embedded O1 and before-repair V1 results.
- `runner/finalTraceEvidence.js`: strict final-observation pairing and comparison for real O1/V1 traces.
- `runner/crossRuntimeContract.js`: auditable behavioural projection for cross-runtime semantic/presentation differences while source, selection, and physical structure remain exact.
- `runner/prefixProbeScenarios.js`: deterministic bounded prefix probes for authoritative random source/caret mismatches.
- `runner/repairGateEvidence.mjs`: Viewer-only bridge from a recorded O1 source oracle to fresh V1 evidence.
- `runner/repairGateOracleReplay.js`: validation of embedded repair-gate oracles against fresh O1 final state and action traces.
- `runner/comparator.js`: source-first comparison and the five conformance statuses.
- `runner/randomSequences.js`: diagnostic random generation plus the stricter `v0.3-valid` profile.
- `runner/minimizer.js`: bounded deterministic delta debugging and permanent regression record creation.
- `runner/executor.js`: adapter-neutral execution for one scenario, a corpus, or per-action unit traces.
- `runner/oracleStore.js`: versioned exclusive-write Obsidian oracle storage.
- `runner/report.js`: `MARKDOWN_CONFORMANCE_MATRIX.md` and `MARKDOWN_CONFORMANCE_SUMMARY.md` content.
- `runner/cli.js`: JSON `generate`, `compare`, and `report` commands.
- `evidence/`: generated, Git-ignored runtime captures and derived comparisons; inspect their metadata before reuse.
- `regressions/`: replayable minimized O1 ↔ V1 failures only.

## Safety and evidence

The real-runtime adapters create a private temporary root with a conformance-specific prefix and sentinel, then create a disposable profile and Vault beneath it. They validate real paths before use, verify the launched runtime is attached to the disposable Vault, and require the sentinel token before teardown. They never attach the user's normal Obsidian or Viewer Vault. `--keep-artifacts` deliberately retains the isolated temporary root for diagnosis; otherwise it is removed.

Evidence levels are non-interchangeable:

- `O1`: the configured installed Obsidian application running against the isolated Vault.
- `V1`: the rebuilt packaged Viewer in real Chromium/Electron against the isolated Vault.
- `U`: a unit/integration observation, including `public/markdownPage.js` semantic parsing.

Strict conformance requires O1 on the Obsidian side and V1 on the Viewer side. `observeViewerSource` always labels itself `U`. Missing or non-automatable Obsidian evidence becomes `OBSIDIAN_NOT_AUTOMATABLE`; missing, non-automatable, non-V1, or otherwise indeterminate Viewer evidence becomes `AMBIGUOUS`. Viewer persistence-surface disagreement is a `VIEWER_FAIL`. None of these cases becomes `MATCH` merely because automation was unavailable.

The packaged Viewer adapter checks a defined set of production files inside `app.asar` before launching and refuses stale packages. That freshness list is a guard for the Markdown runtime, not a proof that every repository file is represented. Rebuild after relevant production changes and record the package metadata/hash. The current Obsidian adapter also depends on its configured executable and effective cached ASAR; absence or an automation failure is evidence unavailability, not permission to alter the user's real configuration.

Real multi-action runs through `realRuntimeCli.mjs` capture the authoritative persisted final state by default. Add `--trace-actions` to capture after every dispatched action in both O1 and V1. Intermediate steps use one timing-preserving renderer observation so instrumentation stays well below Obsidian's 500 ms history-group boundary: O1 source authority is the native editor buffer and V1 source authority is the canonical rendered DOM. Each step retains source, selection, physical/semantic/presentation observations, byte hash metadata, and relevant runtime consistency without forcing a save or API round trip. After the final action, the adapter performs one separate full file/persistence capture; it is never replaced by the intermediate step. Evidence level still comes from the real adapter, not from the trace utility.

Semantic and presentation capture is limited to observable concepts exposed safely by each runtime. Stable geometry is rounded when supplied; unavailable geometry is not invented, and pixel-identical DOM/CSS is not a conformance requirement. Normalized comparison cannot repair missing evidence, source/caret/physical differences, or Viewer integrity failures.

## Scenario and observation meaning

For each fixture the deterministic generator resolves meaningful positions such as document start, marker boundaries, text start/middle/end, physical-line boundaries, blank and terminal rows, and document end. Editable Source and active Live Preview scenarios exercise relevant insertion, deletion, newline, indentation, navigation, selection, history, persistence, and mode actions. Reading and inactive Live Preview retain meaningful inspection, click, mode, and reopen cases instead of pretending raw editing is available.

Every scenario carries exact initial source, mode/active state, concrete anchor/focus, action payload, and required observation dimensions. Source is compared before every other dimension. Selection offsets are canonical JavaScript/DOM UTF-16 source offsets; adapters translate native editor positions into that contract.

Physical lines and semantic Markdown nodes are deliberately separate. Physical lines retain exact endings and a terminal row, while semantic nodes describe the parsed document. Thus `A\nB\nC` may expose three editable physical lines and one semantic paragraph without conflation.

A normalized adapter observation includes fields shaped like:

```json
{
  "scenarioId": "quotes.quote-depth-2.source.active.text-end.enter",
  "evidenceLevel": "O1",
  "automatable": true,
  "source": ">> A\n>> ",
  "sourceBytesBase64": "Pj4gQQo+PiA=",
  "selection": {"anchor": 9, "focus": 9},
  "physical": {"lineCount": 2, "lines": []},
  "semantic": {"rootTypes": ["blockquote"], "nodes": []},
  "presentation": {"markerVisibility": "visible", "renderedState": "raw"},
  "geometry": null,
  "metadata": {"applicationVersion": "recorded-by-adapter"},
  "raw": {"runtime": {}}
}
```

`semantic`, `presentation`, and `geometry` must be observations of that application, not values synthesized with the Viewer parser for Obsidian. Adapter-specific capture stays under `raw` and in the source evidence document.

## Raw-strict and normalized cross-runtime comparison

`finalTraceEvidenceCli.js` applies the strict common observation model. This deliberately exposes differences caused by application chrome, DOM architecture, capture taxonomy, or geometry as well as behavioural differences.

`crossRuntimeContractCli.js` additionally projects semantic and presentation observations onto a declared behavioural contract. It has family-aware projections for quotes, inline/display LaTeX, thematic breaks, and tables, and a generic structural projection elsewhere. Each result retains:

- the normalized status and reason;
- `rawStrictStatus`;
- raw O1/V1 digests and raw difference paths;
- the projected semantic/presentation evidence; and
- a per-runtime normalization audit.

Normalization can remove non-product differences such as Obsidian title chrome, internal DOM paths/counts, and irrelevant pixel structure. It does not relax exact source, selection, or physical-line comparison, does not change the strict override engine, and does not replace the raw source evidence documents.

For observations that contain aligned `actionTrace[]` entries, `actionTraceComparison.js` applies the same normalized contract at every action. It verifies index/action alignment, reports missing or unexpected steps, and identifies the first behavioural and first authoritative divergence plus downstream fallout. Source, selection, and physical structure also receive an independent `authoritativeStatus`, so an override or a semantic observation gap cannot conceal an editing failure. Generic intermediate O1 semantic/marker taxonomy that is not independently observable remains explicit as `semanticObservationGap*` and `nonComparableSemanticDifferenceCount`; it is not mislabeled as a Viewer failure or silently counted as semantic MATCH. `realRuntimeCli.mjs --trace-actions` produces this input directly, and `actionTraceComparisonCli.js` (or `npm run markdown-conformance:compare-actions`) writes the machine-readable comparison.

Example comparisons, using one real-runtime output document that contains both adapters:

```sh
node test/markdownConformance/runner/finalTraceEvidenceCli.js \
  --scenarios /tmp/markdown-v0.3-valid.json \
  --obsidian /tmp/markdown-runtime-evidence.json \
  --viewer /tmp/markdown-runtime-evidence.json \
  --output /tmp/markdown-raw-comparison.json \
  --require-clean

node test/markdownConformance/runner/crossRuntimeContractCli.js \
  --scenarios /tmp/markdown-v0.3-valid.json \
  --obsidian /tmp/markdown-runtime-evidence.json \
  --viewer /tmp/markdown-runtime-evidence.json \
  --output /tmp/markdown-normalized-comparison.json \
  --require-clean
```

## Classification and overrides

The comparator returns exactly:

- `MATCH`
- `INTENTIONAL_VIEWER_OVERRIDE`
- `VIEWER_FAIL`
- `OBSIDIAN_NOT_AUTOMATABLE`
- `AMBIGUOUS`

An override is accepted only when every mismatching leaf path is covered by matching allowlists and every applicable Viewer expectation passes. Multiple matching override allowlists may collectively cover a scenario. Source, caret, physical-line, or semantic differences cannot hide behind presentation overrides.

The approved quote rule is explicit through depth 3: inactive/Reading rails are `|`, `||`, `|||`; active/Source presentation is `|>`, `|>>`, `|>>>`. Transaction behaviour still follows the O1 observation. Thematic breaks never paint `<hr>` in Viewer. LaTeX and table presentation remain frozen/approved while source correctness is still compared.

## Generation and random profiles

Run from the repository root:

```sh
npm run markdown-conformance:generate -- \
  --output /tmp/markdown-scenarios.json

npm run markdown-conformance:generate -- \
  --families quotes,ordered-lists \
  --output /tmp/markdown-selected-families.json
```

Two random profiles deliberately coexist:

- `diagnostic` (or plain `--random-count`) is broad stress input and may produce awkward history or vertical navigation.
- `v0.3-valid` is the bounded source-comparable profile. It starts from valid fixtures, guarantees history before Undo, permits Redo only immediately after Undo, and excludes vertical caret movement by default.

Generate the checked-in profile defaults without embedding result totals in documentation:

```sh
npm run markdown-conformance:generate -- \
  --random-profile v0.3-valid \
  --random-only \
  --output /tmp/markdown-v0.3-valid.json
```

`--seed`, `--random-count`, `--random-min-actions`, and `--random-max-actions` may override profile defaults only within its checked-in bounds. `--include-non-comparable-vertical` appends one terminal ArrowUp/ArrowDown, marks selection non-comparable, and prevents a later edit from depending on editor-specific vertical geometry.

## Expanded v0.3 list-editing corpora

The list-editing expansion is intentionally separate from the generic deterministic and `v0.3-valid` corpora. [`scenarios/v0.3ListEditingExpanded.json`](scenarios/v0.3ListEditingExpanded.json) is a deterministic supplement tagged `list-editing-expanded`. Its generated summary records coverage across Source, active and inactive Live Preview, and Reading mode; ordered, unordered, and mixed markers; arbitrary ordered values; list depths one through three; physical continuation lines; structural joins; activation/blur; and Enter, Backspace, Delete, Tab, and Shift+Tab boundaries. The file's own `scenarioCount`, `corpusSha256`, and coverage summary are authoritative; do not copy those generated values into prose.

[`scenarios/v0.3ListRandom500.json`](scenarios/v0.3ListRandom500.json) is the separate seeded stress corpus. It contains exactly 500 sequences and stratifies 8–12 actions across Source and Live Preview, ordered, unordered, mixed, nested, arbitrary-numbering, and continuation categories. Each sequence starts with a target click and edit, and the corpus includes navigation, deletion, newline, indentation, Undo, and Redo under bounded history rules. The persisted seed, per-sequence seed, action quotas, total action count, and digest live in the JSON so a run can prove which corpus it used.

[`scenarios/v0.3ListLifecycleRandom500.json`](scenarios/v0.3ListLifecycleRandom500.json) is the independently seeded empty-item lifecycle corpus. Its 500 bounded eight-action traces cover ordered and unordered parent/nested boundaries, repeated Enter/Backspace/Delete, alternating Enter with Backspace or Delete, root and nested empty items, active/inactive transitions, and Undo/Redo. Every action requests source, caret, physical lines, semantic hierarchy, list presentation, focus, and Viewer lifecycle-integrity capture; the persisted JSON is authoritative for its seed, quotas, action count, motif catalog, and hashes.

Validate the checked-in corpora, or regenerate equivalent scratch copies, from the repository root:

```sh
node test/markdownConformance/runner/listEditingScenariosCli.js check

node test/markdownConformance/runner/listEditingScenariosCli.js generate \
  --expanded-output /tmp/markdown-list-editing-expanded.json \
  --random-output /tmp/markdown-list-random-500.json \
  --lifecycle-output /tmp/markdown-list-lifecycle-random-500.json \
  --seed cogneuro-v0.3-list-editing-random-500-001 \
  --lifecycle-seed cogneuro-v0.3-list-lifecycle-random-500-001
```

The list observation contract is source-addressed rather than DOM-addressed. For every tagged expanded-list observation, `presentation.list.sourceItems[]` derives canonical item identity from the exact source: tree paths such as `0` and `0.0`, parent paths, source order, physical line and absolute UTF-16 marker/content ranges, indentation columns, quote depth, raw marker/ordinal, and physical depth. `semanticItems[]` independently records the observable DOM hierarchy, effective ordered values, task state, and native marker facts. The merged `items[]` then aligns the two surfaces by canonical item path and exposes hierarchy, kind, recognition, displayed marker/ordinal, visibility, active state, and marker ownership. Ownership is normalized only to `source`, `semantic`, `none`, or `unknown`; source-owned `-`, `*`, and `+` stay exact, while the implementation glyph for a visible semantic unordered bullet is not treated as source text.

With `--trace-actions`, O1 and V1 capture that contract after every dispatched action. The normalized action comparison keeps source, selection, and physical lines exact, then compares per-item hierarchy and display plus focus (`editorActive`, active item paths, and active line indexes) and marker owner. Reading or inactive state does not invent an active item merely to align the runtimes.

## Expanded list action comparison and minimization

Capture either expanded list corpus with per-action evidence. The two examples write a single evidence document containing both O1 and V1 observations:

```sh
npm run markdown-conformance:real -- run \
  --adapter both \
  --scenarios test/markdownConformance/scenarios/v0.3ListEditingExpanded.json \
  --trace-actions \
  --require-automatable \
  --output /tmp/markdown-list-expanded-runtime.json

npm run markdown-conformance:real -- run \
  --adapter both \
  --scenarios test/markdownConformance/scenarios/v0.3ListRandom500.json \
  --set random \
  --trace-actions \
  --require-automatable \
  --output /tmp/markdown-list-random-500-runtime.json

npm run markdown-conformance:real -- run \
  --adapter both \
  --scenarios test/markdownConformance/scenarios/v0.3ListLifecycleRandom500.json \
  --set random \
  --trace-actions \
  --require-automatable \
  --output /tmp/markdown-list-lifecycle-random-500-runtime.json
```

Minimize each confirmed lifecycle mismatch separately so its exact scenario ID and action dependency remain explicit:

```sh
node test/markdownConformance/runner/adapters/realFailureMinimizer.mjs \
  --scenarios test/markdownConformance/scenarios/v0.3ListLifecycleRandom500.json \
  --id CONFIRMED_LIFECYCLE_SCENARIO_ID \
  --predicate list-contract \
  --difference-path-prefix presentation.list \
  --max-evaluations 100 \
  --output /tmp/markdown-minimized-list-lifecycle-failure.json
```

Compare every aligned deterministic action, retaining independent authoritative and list-behaviour statuses:

```sh
npm run markdown-conformance:compare-actions -- \
  --scenarios test/markdownConformance/scenarios/v0.3ListEditingExpanded.json \
  --obsidian /tmp/markdown-list-expanded-runtime.json \
  --viewer /tmp/markdown-list-expanded-runtime.json \
  --output /tmp/markdown-list-expanded-action-comparison.json
```

For a confirmed tagged list mismatch, replace `CONFIRMED_LIST_SCENARIO_ID` below with its exact ID. `--predicate list-contract` replays both real applications and preserves only candidates that still fail the expanded list contract; `--difference-path-prefix presentation` can narrow the predicate to the relevant projected surface. The command also writes a minimized regression record to `regressions/` unless `--regressions` selects another directory.

```sh
node test/markdownConformance/runner/adapters/realFailureMinimizer.mjs \
  --scenarios test/markdownConformance/scenarios/v0.3ListEditingExpanded.json \
  --id CONFIRMED_LIST_SCENARIO_ID \
  --predicate list-contract \
  --difference-path-prefix presentation \
  --max-evaluations 100 \
  --output /tmp/markdown-minimized-list-failure.json
```

To produce an aggregate replay gate from a complete action comparison, pass the same source corpus and the unmodified O1/V1 evidence used by that comparison:

```sh
npm run markdown-conformance:repair-artifacts -- \
  --scenarios test/markdownConformance/scenarios/v0.3ListEditingExpanded.json \
  --comparison /tmp/markdown-list-expanded-action-comparison.json \
  --obsidian /tmp/markdown-list-expanded-runtime.json \
  --viewer /tmp/markdown-list-expanded-runtime.json \
  --output /tmp/markdown-list-expanded-repair-gate.json
```

For tagged expanded-list cases, the repair-artifact builder retains every authoritative divergent action, rebases an ordinary action from its exact O1 predecessor when possible, and embeds the normalized O1 semantic/presentation list oracle as well as source and selection. Replay and validate that gate before promoting it to the permanent checked-in aggregate.

If that strict replay reports a fresh-load Live Preview caret setup adjacent to an incomplete `*` delimiter as `OBSIDIAN_NOT_AUTOMATABLE`, feed the replay record into a second build with `--o1-replay`. The builder then retains the shortest observed producing suffix that starts on the active line before the delimiter existed, including any required Undo/Redo suffix. It does not apply this expansion to adjacent-asterisk states that already replayed successfully, and it leaves `automaticMinimizationComplete` false until the regenerated gate receives a fresh strict O1 replay.

The replay record is also a monotonic minimization input. A later
`REPRODUCIBLE` result preserves the exact previously replayed action count
instead of collapsing a proven dependency suffix back to a fresh one-action
setup. If an automatable strict replay instead reaches
`oracle-final-mismatch` (or its captured action trace mismatches), the builder
retains the prior gate start and expands once across the nearest earlier
non-history edit boundary. This covers delimiter/history state and semantic
Tab state that source plus caret alone cannot reconstruct. The expanded case
remains `requiresO1ReplayValidation: true` until that new suffix receives a
clean strict replay; unrelated clean cases remain certified.

Repair metadata distinguishes the reason a prefix is needed (`prefixStateRequired`), a complete original prefix (`prefixStatePreserved`), and a middle origin suffix (`dependencySuffixPreserved`). `originReplayStartActionIndex` identifies the exact contiguous origin slice. `historyDependencyResolved` means an exact source-and-selection history anchor was found; `historyDependencyReduced` additionally means the emitted gate actually starts after origin action zero. Count fields use those same literal meanings: one-action rebases exclude an original action-zero case, and preserved-prefix counts exclude reduced history or caret-affinity suffixes.

A zero-failure comparison is scoped evidence, not universal list certification. Even zero confirmed mismatches across both checked-in list corpora applies only to those exact corpus hashes, seeds, modes, actions, runtime versions, settings, and Viewer package. It does not certify every Markdown list form, editor state, future app version, seed, or interaction sequence.

## Real-runtime capture and prefix probes

The following command launches applications. It uses disposable profiles/Vaults but still requires the configured Obsidian and freshly packaged Viewer to be available:

```sh
npm run markdown-conformance:real -- run \
  --adapter both \
  --scenarios /tmp/markdown-v0.3-valid.json \
  --set random \
  --batch-size 20 \
  --trace-actions \
  --require-automatable \
  --output /tmp/markdown-runtime-evidence.json
```

`--trace-actions` is opt-in because per-action DOM/semantic observation costs more than final-only capture. Output observations contain `actionTrace[]` entries shaped as `{index, action, observation}` plus completeness and timing-preserving-capture metadata; the adapter result also reports trace observation and automatable-trace totals. The persisted file and Viewer persistence surfaces are checked in the separate parent final observation. `--require-automatable` checks both the parent final observations and every captured step.

When authoritative final source or caret differs, generate bounded prefix scenarios from the same corpus and O1/V1 evidence:

```sh
node test/markdownConformance/runner/prefixProbeScenariosCli.js \
  --scenarios /tmp/markdown-v0.3-valid.json \
  --obsidian /tmp/markdown-runtime-evidence.json \
  --viewer /tmp/markdown-runtime-evidence.json \
  --max-prefix 6 \
  --output /tmp/markdown-prefix-probes.json
```

The prefix tool excludes non-automatable observations and Viewer integrity failures. For each remaining source or caret-only mismatch it emits the bounded early prefixes plus the complete original trace, preserving origin ID, mismatch kind, and prefix length. The resulting `sequences[]` document can be rerun through `markdown-conformance:real` with `--set random`. A prefix corpus localizes a divergence; it does not itself certify the repaired behaviour.

After a complete per-action comparison, generate the permanent repair gate directly from the first authoritative divergence in every affected sequence:

```sh
npm run markdown-conformance:repair-artifacts -- \
  --scenarios /tmp/markdown-v0.3-valid.json \
  --comparison /tmp/markdown-action-comparison.json \
  --obsidian /tmp/markdown-o1-action-trace.json \
  --viewer /tmp/markdown-v1-action-trace.json \
  --output /tmp/markdown-full-trace-repair-gate.json
```

For an ordinary transaction, the gate uses the preceding exact O1 source/selection and retains only the divergent action. Undo/Redo, paired Backspace, closer overtype, and known intermediate states that cannot be selected after a fresh Obsidian load preserve their producing prefix. Every case embeds the expected O1 source/selection, observed before-repair V1 result, origin, divergent action, and difference paths. Rerun the generated gate in O1 to prove that every embedded oracle remains reproducible before using it as a Viewer-only repair gate, then validate the capture:

```sh
npm run markdown-conformance:validate-o1-replay -- \
  --gate /tmp/markdown-full-trace-repair-gate.json \
  --obsidian /tmp/markdown-repair-gate-o1.json \
  --output /tmp/markdown-repair-gate-o1-replay.json \
  --require-reproducible
```

The validator requires automatable O1 evidence and exact final source, anchor, and focus. When a timing-preserving action trace is present, it also verifies action count/order/payload and the trace's final observation; available origin repair metadata is checked for preserved-prefix or one-action-rebase consistency. Each case is classified `REPRODUCIBLE`, `OBSIDIAN_NOT_AUTOMATABLE`, or `AMBIGUOUS_ORACLE_MISMATCH`. `--require-reproducible` exits with status 2 unless every gate case is reproducible.

## Production repair gates

Use `scenarios/obsidianSourceRepairGate.json` when the relevant O1 interaction has already been recorded as an exact source/selection oracle. Capture fresh packaged Viewer evidence, then compare without launching another application:

```sh
npm run markdown-conformance:repair-gate -- \
  --scenarios test/markdownConformance/scenarios/obsidianSourceRepairGate.json \
  --viewer /tmp/viewer-repair-gate-evidence.json \
  --output /tmp/viewer-repair-gate-comparison.json \
  --require-clean
```

The bridge requires V1, exact source and anchor/focus, readable consistent Viewer persistence, and explicit coverage for every selected scenario. `productDecisionRequired` remains allowed ambiguity; it is not silently repaired.

For `scenarios/v0.3FinalRepairGate.json` or any other two-runtime sequence set, capture fresh O1 and V1 and use the strict or normalized final-trace comparator. After a confirmed failure, group by root cause, repair production by syntax family, and rerun:

1. the focused failure/prefix or source-oracle gate;
2. the affected family;
3. frozen controls; and
4. the complete deterministic and valid-random corpus.

Only a successfully replayed minimized O1 ↔ V1 failure belongs in `regressions/`. Documentation/runtime disagreements and undecided product differences stay explicit instead of becoming guessed patches.

## Reports

Historical ticket reports and packaged screenshots are not retained. Reusable
fixtures, oracles, scenarios, and regressions required by current conformance
tests remain under this directory. Runtime evidence and comparison reports are
generated on demand in ignored output locations and are not permanent
architecture documentation.

The general JSON CLI can compare already captured evidence and render reports:

```sh
node test/markdownConformance/runner/cli.js compare \
  --scenarios /tmp/markdown-scenarios.json \
  --obsidian /tmp/obsidian-observations.json \
  --viewer /tmp/viewer-observations.json \
  --output /tmp/markdown-comparison.json

node test/markdownConformance/runner/cli.js report \
  --comparisons /tmp/markdown-comparison.json \
  --metadata /tmp/markdown-run-metadata.json \
  --format both \
  --matrix MARKDOWN_CONFORMANCE_MATRIX.md \
  --summary MARKDOWN_CONFORMANCE_SUMMARY.md
```

Inputs and machine outputs are JSON; the reports are Markdown. Comparison joins observations by `scenarioId`, so adapter execution order is irrelevant. `--allow-unit-evidence` exists only for harness testing and cannot certify conformance.

## Verification without launching applications

The top-level `test/markdownConformance.test.js` wrapper makes the nested core test visible to the non-recursive `npm test` glob. The dedicated package script includes the source-repair, physical-line, deletion-filler, history-policy, and newline suites plus nested runner/adapter globs, so action tracing, comparison, prefix probes, isolation, and repair gates stay in one reusable command.

```sh
npm test
npm run test:markdown-conformance

node --test \
  test/markdownConformance/runner/actionTraceComparison.test.js \
  test/markdownConformance/runner/finalTraceEvidence.test.js \
  test/markdownConformance/runner/crossRuntimeContract.test.js \
  test/markdownConformance/runner/prefixProbeScenarios.test.js

npm run markdown-conformance:generate -- \
  --families quotes \
  --output /tmp/markdown-quotes-smoke.json

npm run markdown-conformance:generate -- \
  --random-profile v0.3-valid \
  --random-only \
  --output /tmp/markdown-valid-random-smoke.json
```

These commands verify code paths and deterministic generation but remain U-level support. A clean unit suite, a checked-in comparison, or a normalized match is not a fresh O1 ↔ V1 certification by itself.
