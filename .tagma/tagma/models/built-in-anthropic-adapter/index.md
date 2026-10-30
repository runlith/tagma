---
id: 01a12c56-911b-7d6f-9ef3-3bc7b6853ec2
title: Built-in Anthropic adapter
ord: 25
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/adapter.ts"
      },
      {
        "at": "src/models/"
      },
      {
        "at": "src/profiles/"
      },
      {
        "at": "src/icon.ts"
      },
      {
        "at": "src/usage.ts",
        "for": [
          "287a4906"
        ]
      },
      {
        "at": "src/harness/claudeCode.ts"
      },
      {
        "at": "src/harness/session.ts"
      },
      {
        "at": "src/runner/run.ts"
      },
      {
        "at": "src/testing/",
        "role": "testing"
      }
    ],
    "id": "@runlith/adapter-anthropic"
  }
edges:
  - kind: imports
    to: 01a0c6ef-8083-763c-a499-dea0ffc6963b
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
  - kind: imports
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports
    to: 01a0c944-8aa1-7e16-b225-ddc5d1caad35
  - kind: imports
    to: 01a0ca5d-3b72-7529-8b88-94c413756ad0
  - kind: imports
    to: 01a108bd-5060-7141-819c-dd4dad88de8a
  - kind: imports
    to: 01a12c51-8120-7250-9703-61feea5c74f4
  - kind: imports
    to: 01a18e33-3513-785d-9824-df6d3c2426a1
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
  - kind: imports-tests
    to: 01a16b71-3a1f-7cfb-a633-2283feef9784
sources:
  - kind: dir
    ref: packages/adapter-anthropic
---
Anthropic provider declarations in the Tagma registry: the API key (`anthropic`) and Claude Code as an external harness (`claude-code`). It takes request registrations from `@runlith/llm` and adds to them the provider kind, icon, and Claude Code account environment entries: the `CLAUDE_CONFIG_DIR` directory and unsetting keys that would switch billing off the subscription.
