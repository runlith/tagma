---
id: 01a0ca5d-3b72-7529-8b88-94c413756ad0
title: MCP client
ord: 25
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/McpCapabilities.ts",
        "for": [
          "f3b6b585",
          "13182a9f",
          "5565be05"
        ]
      },
      {
        "at": "src/mcpDeclarationFingerprint.ts",
        "for": [
          "f3b6b585",
          "13182a9f",
          "5565be05"
        ]
      },
      {
        "at": "src/McpFailure.ts",
        "for": [
          "f3b6b585",
          "13182a9f",
          "5565be05",
          "2243eda2",
          "9e81e75e"
        ]
      },
      {
        "at": "src/McpPool.ts",
        "for": [
          "f3b6b585",
          "13182a9f",
          "5565be05"
        ]
      },
      {
        "at": "src/mcpRedactor.ts",
        "for": [
          "f3b6b585",
          "13182a9f",
          "5565be05",
          "2243eda2",
          "e9aa47fc"
        ]
      },
      {
        "at": "src/McpServerDeclaration.ts"
      },
      {
        "at": "src/McpSession.ts",
        "for": [
          "f3b6b585",
          "13182a9f",
          "5565be05",
          "2243eda2"
        ]
      },
      {
        "at": "src/mcpToolCatalog.ts",
        "for": [
          "f3b6b585",
          "ab05dfec",
          "13182a9f",
          "5565be05",
          "2243eda2"
        ]
      },
      {
        "at": "src/McpToolIdentity.ts"
      },
      {
        "at": "src/sdk.ts",
        "for": [
          "f3b6b585",
          "13182a9f",
          "5565be05"
        ]
      },
      {
        "at": "src/sdkServer.ts",
        "for": [
          "f3b6b585",
          "9e81e75e",
          "13182a9f",
          "5565be05",
          "287a4906",
          "2243eda2",
          "af373f07",
          "b6853ec2",
          "3c2426a1"
        ]
      },
      {
        "at": "src/mcpCallerMeta.ts"
      },
      {
        "at": "src/mcpResources.ts"
      },
      {
        "at": "src/mcpApps.ts"
      },
      {
        "at": "src/McpAuth.ts",
        "for": [
          "f3b6b585"
        ]
      },
      {
        "at": "src/mcpOAuth.ts",
        "for": [
          "f3b6b585"
        ]
      },
      {
        "at": "src/mcpGrant.ts",
        "for": [
          "f3b6b585"
        ]
      },
      {
        "at": "src/testing/oauthServer.ts",
        "role": "testing"
      },
      {
        "at": "src/testing/keyedServer.ts",
        "role": "testing"
      }
    ],
    "id": "@runlith/mcp",
    "kind": "kit"
  }
edges:
  - kind: imports
    to: 01a0c944-8aa1-7e16-b225-ddc5d1caad35
  - kind: imports
    to: 01a0fd8b-bf12-7d39-abd6-b5ffc43d3272
sources:
  - kind: dir
    ref: packages/mcp
---
Tools living in other processes reach agents through this package: one MCP server pool per process, whose tools become kernel-contract tools. It owns the form a server declaration is stored in, pool sessions, the naming dictionary, the failure language every crash answers in, and the serving side offering the embedder's own tools over stdio. Tool classification, values resolved into a declaration, grants and secrets are handed by the embedding product at the boundary, and are not stored here; a server's bearer arrives the same way, through a two-call contract, and the kit runs the OAuth steps over the SDK without keeping a token.
