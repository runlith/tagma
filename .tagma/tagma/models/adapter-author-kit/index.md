---
id: 01a12f83-9c8e-769f-8f0a-1f18e0801f50
title: Adapter author kit
ord: 34
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "conformance.ts"
      },
      {
        "at": "create.ts"
      },
      {
        "at": "rules.ts",
        "for": [
          "7abcb9a1"
        ]
      }
    ],
    "id": "@runlith/tagma-kit"
  }
edges:
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
  - kind: imports
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports
    to: 01a0d584-d0b8-7967-9796-a8e3bbddbda9
  - kind: imports
    to: 01a0fd8b-bf12-7d39-abd6-b5ffc43d3272
  - kind: imports
    to: 01a12c51-8120-7250-9703-61feea5c74f4
  - kind: imports
    to: 01a12c56-911b-7d6f-9ef3-3bc7b6853ec2
  - kind: imports
    to: 01a12c56-911d-7f8b-ade2-75bbc432f43a
  - kind: imports
    to: 01a12c56-911f-76ad-b665-0ff9a95d3d64
  - kind: imports
    to: 01a12c56-9122-7c94-91a6-f1c2cc11b67b
  - kind: imports
    to: 01a12c56-9124-7319-834e-660cd644f1c5
  - kind: imports
    to: 01a12c56-9126-7a2a-902e-aaa4ada7eee0
  - kind: imports
    to: 01a12c56-9127-7a6c-ac2f-3e1937fe1c9a
  - kind: imports
    to: 01a12c56-9129-7fb3-aa86-19579bcbb761
  - kind: imports
    to: 01a18e1d-2841-72f0-b3c5-26c3d4a5b244
sources:
  - kind: dir
    ref: packages/tagma/kit
---
An external adapter's author tests their package the way Tagma will accept it, before installation: the kit parses the declaration through the registry's validation, drives login and model calls against a stub, and demands `LLMError` errors; the template scaffolds a new adapter that passes this kit. The kit lives apart from the contract because it substitutes host modules, including the built-in adapters, which are themselves written against the contract; assembling the whole package's distribution — with `/rules` types expanded from the builtins' schemas — lives here too.
