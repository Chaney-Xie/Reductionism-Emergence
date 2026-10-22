# Minimized regressions

Random O1↔V1 differences belong here only after `minimizeFailure` has reduced the action list and the reduced trace has been replayed successfully against both real applications.

Each JSON record should retain the random origin ID, seed, initial source, initial selection, minimized actions, Obsidian version, Viewer commit/package hash, OS, settings, and the final normalized observations. A unit-only (`U`) difference is not an O1↔V1 regression oracle.

The aggregate permanent one-action gate for the expanded v0.3 list-editing corpus is [`../scenarios/v0.3ListEditingMinimizedRegressions.json`](../scenarios/v0.3ListEditingMinimizedRegressions.json). Keep individually minimized real-runtime records in this directory; the aggregate gate remains under `scenarios/` so the standard corpus runner can replay it directly.
