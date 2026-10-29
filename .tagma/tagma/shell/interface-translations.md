---
id: 01a1765d-03f8-7ddd-8912-c4ed8c2ee421
title: Interface translations
ord: 40
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/I18n.svelte.ts"
      },
      {
        "at": "src/locale.ts"
      },
      {
        "at": "src/testing.ts",
        "role": "testing"
      },
      {
        "at": "src/types.ts"
      }
    ],
    "id": "@runlith/i18n",
    "kind": "kit"
  }
edges:
  - kind: imports
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
sources:
  - kind: dir
    ref: packages/i18n
---
Translation as an app-graph key: message packages by locale, lazily loaded on language switch, plural forms and selection through Intl, typed message keys. Texts and language choice stay the app's.
