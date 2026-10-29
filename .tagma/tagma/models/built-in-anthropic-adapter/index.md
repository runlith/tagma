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
      }
    ],
    "id": "@runlith/adapter-anthropic"
  }
edges:
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
  - kind: imports
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports
    to: 01a12c51-8120-7250-9703-61feea5c74f4
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
sources:
  - kind: dir
    ref: packages/adapter-anthropic
---
Anthropic provider declarations in the Tagma registry: the API key (`anthropic`) and Claude Code as an external harness (`claude-code`). It takes request registrations from `@runlith/llm` and adds to them the provider kind, icon, and Claude Code account environment entries: the `CLAUDE_CONFIG_DIR` directory and unsetting keys that would switch billing off the subscription.
