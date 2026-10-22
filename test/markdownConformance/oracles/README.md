# Versioned Obsidian oracles

Only actual isolated-application observations (`evidenceLevel: "O1"`) belong here. Name each corpus `obsidian-<version>.json`; `runner/oracleStore.js` uses exclusive creation by default so an application update cannot silently replace an older oracle.

Every corpus records the exact Obsidian and installer versions, OS, isolated vault path or opaque run ID, editor view/mode settings, Strict line breaks, smart lists, tab-vs-spaces indentation, tab width, plugin state, fixture-corpus hash, and capture limitations. Never point an adapter at the user's real vault or change their normal Obsidian configuration.
