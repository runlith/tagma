---
id: 01a0caab-fdda-7650-bd03-9dcda7ad5cd8
title: "Derive, don't respell: four literals in the desktop scripts duplicate owned values"
ord: 32
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/desktop/scripts/build-host.ts
  - kind: file
    ref: apps/tagma/desktop/scripts/dev.ts
---
Four literals in the desktop scripts respell values a single owner already exports; drift breaks confusingly (a dev window ignoring its surface argument loads the default URL and may start an installation server beside the dev stack):

- `scripts/dev.ts:47` respells `--tagma-surface-url=` instead of importing `SURFACE_URL_ARGUMENT` from `src/config.ts` (`config.ts:3`);
- `scripts/dev.ts:47` respells the main bundle path as `join(distDir, 'app', 'main.mjs')` instead of deriving it from `HOST_MAIN` (`protocol/frozen.ts:3`, already used by `build-host.ts:32` for the bundle output);
- `scripts/build-host.ts:44` respells `main.mjs` in the generated `package.json` instead of deriving it from `HOST_MAIN`;
- `scripts/dev.ts:56` hardcodes `'Tagma Dev.app'` instead of `IDENTITIES.dev.bundle` (`IDENTITIES` lives at `build-host.ts:13-16`).

No claim pins these equalities because string equality across files is not source-measurable; the fix is one import and three derivations. (The generated `package.json`'s hardcoded `version: '0.1.0'` was noticed and deliberately left out: nothing was shown reading it.)

Found by the zone review of [[c04717c7]] for [[a014cd4c]]; it implements no decision of its own. Done when all four spellings derive from their owners.