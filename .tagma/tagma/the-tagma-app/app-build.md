---
id: 01a174f2-3d4f-7199-8d1c-63f5d529143b
title: App build
ord: 66
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "app-build",
    "kind": "substrate"
  }
edges:
  - kind: imports
    to: 01a0c83c-e15d-738b-bdd7-5263883b9c98
  - kind: imports
    to: 01a0fd8b-bef5-738e-8ee9-97f36cc306ce
  - kind: imports
    to: 01a0fd8b-bf0d-7231-8383-459013182a9f
  - kind: imports
    to: 01a1165d-b047-7099-969a-602c520698f4
  - kind: imports
    to: 01a1237e-b7b0-70ab-98b0-c0c63d78b068
  - kind: imports
    to: 01a1428e-f259-70b0-ba48-835441c37464
sources:
  - kind: dir
    ref: apps/tagma/app/scripts
  - kind: file
    ref: apps/tagma/app/compilerOptions.js
  - kind: file
    ref: apps/tagma/app/surfaceOut.js
  - kind: file
    ref: apps/tagma/app/svelte.config.js
  - kind: file
    ref: apps/tagma/app/vite.config.ts
  - kind: file
    ref: apps/tagma/app/vitest.config.ts
---
The app is built by Vite and SvelteKit into static assets the server serves. The factory of its Vite config lives here (`scripts/surfaceConfig.ts`), used by both the app build and builds on top of it. Its Svelte compiler options (`compilerOptions.js`, exported as `@tagma/app/compilerOptions`) are the one place every root's Svelte config takes them from, so a root compiles the core's components exactly as the core does. Next to it lie the SvelteKit and Vitest configs, the build output directory and the dev-stand script.
