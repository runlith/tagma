---
id: 01a123cc-eedf-7059-b425-43b31ad089ea
title: Credentials file
ord: 23
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/CredentialFile.ts"
      },
      {
        "at": "src/failure.ts"
      },
      {
        "at": "src/RefreshFlight.ts"
      }
    ],
    "id": "@runlith/credential-file"
  }
edges:
  - kind: imports
    to: 01a0fd8b-bf12-7d39-abd6-b5ffc43d3272
  - kind: imports
    to: 01a0fd8b-bf14-78e1-9fb7-466fe707d6ca
sources:
  - kind: dir
    ref: packages/credential-file
---
Tokens, keys and secrets live as a JSON document in a 0600 file read by several processes, which must never be left half-written. The package reads the document by the file's stamp, replaces it atomically under an inter-process lock, and picks up an interrupted replacement on the next read; the document's format and the meaning of its fields stay with whoever holds the file. A keyed refresh flight serializes grant exchange and conditionally stores its result, with optional cross-process exclusion; the caller owns grant identity, refresh policy and exchange. What the document means and who receives it is the embedding product's business.
