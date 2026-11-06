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
      },
      {
        "at": "src/adapter/hook.ts"
      },
      {
        "at": "src/adapter/payload.ts"
      },
      {
        "at": "src/adapter/claudeHooks.ts"
      },
      {
        "at": "src/plugin/template.ts"
      },
      {
        "at": "src/plugin/plugin.ts"
      },
      {
        "at": "src/plugin/process.ts"
      },
      {
        "at": "src/plugin/protocol.ts"
      },
      {
        "at": "src/plugin/testing.ts",
        "role": "testing"
      },
      {
        "at": "src/plugin/points.generated.ts"
      },
      {
        "at": "src/plugin/bundling.ts",
        "for": [
          "3d78b068"
        ]
      },
      {
        "at": "src/plugin/value.ts"
      },
      {
        "at": "src/plugin/svelteProgram.ts",
        "for": [
          "e0801f50"
        ]
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
    to: 01a0ca5d-3b72-7529-8b88-94c413756ad0
  - kind: imports
    to: 01a0d584-d0b8-7967-9796-a8e3bbddbda9
sources:
  - kind: dir
    ref: packages/tagma
---
`@runlith/tagma` is the only thing third-party code imports from Tagma. The `/rules` and `/rules/effect` doors are what a repo writes `tagma.config.ts` with: description functions of built-in inspections, linters, and format commands, `defineInspection`/`defineProgram` for its own, and the types of this contract; it never declares builtins' parameter shapes itself, but takes them as types from `@tagma/inspection` schemas, and the build unwraps them into `dist` with no references to closed packages. The `/adapter/*` doors are the provider and harness adapter contract: what a provider declares, terminal and ACP surfaces, hook codecs, metadata readers, the settings schema, and `defineAdapter`; the built-in adapters are written on it too, so the contract is one for first-party and third-party, and it takes the request profile, quota, and model descriptions from `@runlith/llm`. The `/plugin` door is a plugin's only way to Tagma: its definition, handler builders and typed client, with field types generated from the server owners' point schemas; `/plugin/process` serves a built plugin's process over stdio MCP, `/plugin/protocol` holds the names and payloads the host shares with that process, `/plugin/value` the pair that encodes and decodes the value an author's tool returns, `/plugin/points` the point types and the build step's verdict as the server owners declare them, `/plugin/template` the files of a new plugin folder, `/testing` runs a definition with no Tagma, and the `tagma-plugin` bin builds a folder into its manifest and bundled process. Running the config, judging, loading adapters, hosting plugin processes, registry, and accounts stay on the server.