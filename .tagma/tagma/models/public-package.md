---
id: 01a12c51-8120-7250-9703-61feea5c74f4
title: Public package
ord: 24
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/adapter/provider.ts"
      },
      {
        "at": "src/adapter/settings.ts"
      },
      {
        "at": "src/adapter/loader.ts"
      },
      {
        "at": "src/adapter/declaration.ts"
      },
      {
        "at": "src/adapter/hostModules.ts"
      },
      {
        "at": "src/rules/rules.ts"
      },
      {
        "at": "src/rules/effect.ts"
      },
      {
        "at": "src/rules/sources.ts",
        "for": [
          "8fda30d8",
          "e0801f50"
        ]
      },
      {
        "at": "src/adapter/harness.ts"
      },
      {
        "at": "src/adapter/metadata.ts"
      }
    ],
    "id": "@runlith/tagma"
  }
edges:
  - kind: imports
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports
    to: 01a0c944-8aa1-7e16-b225-ddc5d1caad35
  - kind: imports
    to: 01a0d584-d0b8-7967-9796-a8e3bbddbda9
sources:
  - kind: dir
    ref: packages/tagma
---
`@runlith/tagma` is the only thing third-party code imports from Tagma, and it carries only contract and descriptions. The `/rules` and `/rules/effect` doors are what a repo writes `tagma.config.ts` with: description functions of built-in inspections, linters, and format commands, `defineInspection`/`defineProgram` for its own, and the types of this contract; it never declares builtins' parameter shapes itself, but takes them as types from `@tagma/inspection` schemas, and the build unwraps them into `dist` with no references to closed packages. The `/adapter/*` doors are the model-provider adapter contract: what a provider declares, the settings schema, and `defineAdapter`; the built-in adapters are written on it too, so the contract is one for first-party and third-party, and it takes the request profile, quota, and model descriptions from `@runlith/llm`. Running the config, judging, loading adapters, registry, and accounts stay on the server.
