---
id: 01a10391-868b-7cb6-9ad3-cd6c59890ef8
title: "#explanation"
ord: 14
tags: ["tag"]
fields:
  {
    "body": {
      "shape": "content"
    },
    "contracts": {
      "core/explanation": {
        "slots": {},
        "words": {}
      }
    },
    "edges": [
      "validates",
      "relates"
    ],
    "fields": {},
    "gates": [],
    "id": "explanation",
    "identity": {
      "shipped": {
        "export": "explanation",
        "library": "software-development"
      }
    },
    "roles": {},
    "sections": [
      {
        "key": "explanation",
        "text": "An #explanation states a lasting part of the code a reader cannot recover from it: a contract several files or modules keep, an invariant and what breaks without it, a format, or a choice and the alternative it rejected. Its sources name the narrowest code that could contradict it, and it stands under the module owning that code, never under another leaf; each session receives it once, on first reading or writing that code. The title states the fact and reads alone. The body holds only the reason, boundary, failure prevented or trade — never the code read back: no walk through functions, no list of fields or parameters, no constant's value — say what the constant must outlast. Measurements and how it was built belong to the task that did the work. A word of totality — every, only, never — is written after reading each place it covers: a universal statement the code breaks is worse than silence. A change breaking an explanation corrects it in the same change. A plain note may also name code with sources; this tag adds delivery on code reads and writes."
      },
      {
        "edits": [
          "append"
        ],
        "key": "project",
        "text": ""
      }
    ],
    "sources": [
      "file",
      "dir",
      "symbol"
    ]
  }
---
An #explanation states a lasting part of the code a reader cannot recover from it: a contract several files or modules keep, an invariant and what breaks without it, a format, or a choice and the alternative it rejected. Its sources name the narrowest code that could contradict it, and it stands under the module owning that code, never under another leaf; each session receives it once, on first reading or writing that code. The title states the fact and reads alone. The body holds only the reason, boundary, failure prevented or trade — never the code read back: no walk through functions, no list of fields or parameters, no constant's value — say what the constant must outlast. Measurements and how it was built belong to the task that did the work. A word of totality — every, only, never — is written after reading each place it covers: a universal statement the code breaks is worse than silence. A change breaking an explanation corrects it in the same change. A plain note may also name code with sources; this tag adds delivery on code reads and writes.