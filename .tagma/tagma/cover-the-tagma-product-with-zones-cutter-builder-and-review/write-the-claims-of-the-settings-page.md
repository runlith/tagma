---
id: 01a0ca95-3109-78aa-b120-911c20b34f0c
title: Write the claims of the settings page
ord: 187
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
---
The area is [[a3ff58c6]], which already existed and was revised rather than recreated in this cut: it was retitled, its body rewritten in English, and its source on the server's protocol file released to the server's own zone.

Read `apps/tagma/app/src/lib/features/settings` whole — the rail, the sections, the twenty-one control components, and `SettingsCatalog.svelte.ts`, which is the process that builds the page from the keys the server declares. Read its six tests. Load the `svelte5` skill first.

Two claims already stand under this area and are verified: [[5c427eb6]] on the three-place declaration of a control kind, and — moved out to [[e79e37c6]] in this cut — the shared catalog list. Both bodies are in Russian, unlike the rest of this cover; do not silently rewrite a verified claim, and say in your report whether you think either should be re-stated in English and re-verified. [[5c427eb6]] is a genuine cross-module claim whose sources reach into the server's tree; the server's own cut has agreed not to duplicate it.

The module above is [[cc59eadf]]. The reference zone is [[cb732496]].

Done when: the claims are written from the code and verified, the doctor over `apps/tagma/app/src/lib/features/settings` is clean, and a review passes.