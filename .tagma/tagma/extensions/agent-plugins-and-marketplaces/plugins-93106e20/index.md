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
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: imports
    to: 01a0c839-17d3-7d06-a00d-69691aee61f4
  - kind: imports
    to: 01a0ca5c-5906-74eb-a8b8-6650cb732496
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bef1-758e-b119-40b1d962023e
  - kind: imports
    to: 01a0fd8b-befe-744b-876f-36f2f3b6b585
  - kind: imports
    to: 01a1239f-2e01-7962-8ca3-25a8af373f07
  - kind: imports
    to: 01a174f2-3d3c-7aba-98fd-93f206137f5a
  - kind: imports
    to: 01a174f2-3d42-7971-98e6-d64d57643bc7
  - kind: imports
    to: 01a174f2-3d51-75fa-8183-c8b41c9696ea
  - kind: imports
    to: 01a174f2-3d52-7cb0-8660-a40d39910e41
  - kind: imports
    to: 01a174f2-3d53-77eb-b835-34ca4f0a6d9b
  - kind: imports
    to: 01a174f2-3d55-75b3-a0ce-6ad72dc811be
  - kind: imports
    to: 01a174f2-3d65-7e23-bb0f-9d871e061782
  - kind: imports
    to: 01a174f2-3d67-75cf-b329-5f82212858cf
  - kind: imports
    to: 01a174f2-3d8d-7fa1-bc61-069b96400e93
  - kind: imports
    to: 01a18921-8504-7058-9d53-62c5e9aa47fc
  - kind: imports
    to: 01a189a0-4b54-758e-bef7-1061d6fd5286
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/plugins
---
The operator finds, adds and manages what agents can use in a project in the Plugins place on the rail: a list of what runs here — installed plugins and the MCP servers declared for the person or the project, ordered by what waits on the person — beside the catalog of every added marketplace, by category and by source; a plugin's page that previews an entry and adds it to this project or to all projects, then walks the sign-in each of its remote servers asks; an installed plugin's page with its state, services, options and acts; a server's page; and one field that adds a source, a plugin, a service or a program by its address. It reads marketplaces through the live `marketplaces.subscribe` feed, plugins through `read_plugins`, servers through `read_mcp_servers` kept live by the `mcp.servers` feed and an entry through `preview_plugin`, never a package itself; plain options go into `plugins.options`, secret ones into the key store, and consent for what a plugin runs is the operations' own review. Settings keep only a pointer to the place.