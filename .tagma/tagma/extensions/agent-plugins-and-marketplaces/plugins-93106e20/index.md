---
id: 01a1892f-19c3-73c9-ae5e-7d7993106e20
title: Plugins
ord: 6
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "app-plugins",
    "kind": "product"
  }
edges:
  - kind: imports
    to: 01a0c839-17d3-7d06-a00d-69691aee61f4
  - kind: imports
    to: 01a0ca5c-5906-74eb-a8b8-6650cb732496
  - kind: imports
    to: 01a1239f-2e01-7962-8ca3-25a8af373f07
  - kind: imports
    to: 01a174f2-3d3c-7aba-98fd-93f206137f5a
  - kind: imports
    to: 01a174f2-3d42-7971-98e6-d64d57643bc7
  - kind: imports
    to: 01a174f2-3d51-75fa-8183-c8b41c9696ea
  - kind: imports
    to: 01a174f2-3d53-77eb-b835-34ca4f0a6d9b
  - kind: imports
    to: 01a174f2-3d65-7e23-bb0f-9d871e061782
  - kind: imports
    to: 01a18921-8504-7058-9d53-62c5e9aa47fc
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/plugins
---
The operator installs an agent plugin from a folder or a git URL, switches it per project and uninstalls it in the Plugins settings section, and reads each plugin's card: what Tagma took from it under `<plugin>-<name>`, what it ignores with the reason, why a refused one gives nothing, and its options — plain ones written into `plugins.options`, secret ones into the key store through the secrets module. Consent for what a plugin runs is the operations' own review; the module reads and acts only through `read_plugins`, `install_plugin`, `enable_plugin` and `uninstall_plugin`.