---
id: 01a19566-2502-7761-b045-f22690f17180
title: submit_work refuses walk-cut on a harness .svelte sample whose tsconfig extends a package config, and `whole` does not carry it
ord: 183
tags: ["reflection"]
fields:
  {
    "actual": "refused[walk-cut] twice, with and without `whole`: \"UnsupportedSource: harness/samples/kit/apps/basics/tsconfig.json: its extends chain names the package config `$app/tsconfig`, which resolves to no file the tree holds\"; landing fell back to a plain git commit.",
    "command": "submit_work {checkout: /Users/teunlao/runlith/dromon, paths: [harness/samples/kit/apps/basics/src/routes/routing/preloading/hash-route/+page.svelte, harness/manifest/kit/apps.json], whole: [harness/samples/kit/apps/basics/src/routes/routing/preloading/hash-route/+page.svelte]}",
    "expected": "The one-line edit (this session's only lines in the file) lands; at least `whole` carries the named file intact without a line walk."
  }
---
Filed from project `vigla`. Received by a server up since 2026-11-01T04:35:00.962Z, from b555dcaa0.

The sample is upstream SvelteKit test data copied verbatim; its tsconfig `extends: "$app/tsconfig"` resolves only inside a Kit app after sync, so it is not a configuration error the caller can correct. The file had no peer lines (git diff: one line changed, written by the edit tool in this session). The refusal's unblock offers "land without" the file or "wait for the foreign changes", neither of which applies; `whole` is documented to carry named files intact, yet the walk still ran and cut.