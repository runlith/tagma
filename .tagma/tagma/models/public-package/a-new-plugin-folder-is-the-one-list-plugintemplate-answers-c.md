---
id: 01a1adfd-2b02-77de-a2ec-67ace87c56d4
title: "A new plugin folder is the one list pluginTemplate answers: create_plugin and tagma-plugin init write exactly those files"
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/tagma/src/plugin/template.ts
---
Two doors make a plugin folder: the server's `create_plugin` inside a project, and the SDK's `tagma-plugin init` anywhere else. Neither has its own copy of the files. Both write `pluginTemplate({id, title})`, so a folder made by either builds, type-checks and tests the same way. A new starter file, or a changed one, therefore lands only here.

The template depends on the SDK at its own version (`^` + the package version), so a folder made today builds against the SDK that made it. Its dependencies are all `devDependencies`, because the build bundles everything into `dist/process.js` and `dist/providers.js` and an installed plugin runs no install.

`.gitattributes` marks `dist/**` and `tagma-plugin.json` as generated and merged as binary. Both are build output that is committed: a collaborator or an install from git runs nothing before Tagma reads them. Two edits of that output never merge line by line; whoever merges rebuilds. `.gitignore` re-includes `dist/` because many repositories ignore every `dist/`, and an ignored `dist/process.js` would leave the committed plugin without its process.

The template writes no `dist/` and no `tagma-plugin.json`. A folder becomes installable only after its dependencies are installed and `tagma-plugin build` has run.