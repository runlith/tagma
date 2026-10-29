---
id: 01a0ea9b-790b-786c-9051-1143144dfedc
title: A type shared by modules lives in the lowest module that uses it, and every other module imports it from there — never a copy, alias, or second declaration
ord: 7
tags: ["rule"]
fields:
  {
    "delivery": "code"
  }
sources:
  - kind: dir
    ref: .
---
If the lowest consumer cannot hold the type without importing upward, the type goes lower still, into the wire of the module it describes. Where no module fits, it goes to platform. A contract's `wire/` may take its own floor below `protocol/`, provided every file of it imports only downward.
