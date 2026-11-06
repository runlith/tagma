---
id: 01a0fd8b-beed-7934-884b-a443f92da92b
title: Model provider accounts
ord: 38
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      },
      {
        "at": "testing/",
        "role": "testing"
      }
    ],
    "id": "providers",
    "kind": "product",
    "order": [
      [
        "contract/wire/"
      ],
      [
        "."
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0c0d5-c713-75bd-b78b-0583adeeb4ba
  - kind: imports
    to: 01a0c6ed-5b45-77b0-a47b-9e0ab77b7a93
  - kind: imports
    to: 01a0c6f0-27d3-71ea-90c2-b3debbed8039
  - kind: imports
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
  - kind: imports
    to: 01a0c703-263a-7a49-8a3d-0bfdc70821a1
  - kind: imports
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports
    to: 01a0c83d-be5e-7beb-99fc-b3492a74de70
  - kind: imports
    to: 01a0c944-8aa1-7e16-b225-ddc5d1caad35
  - kind: imports
    to: 01a0ca5d-3b72-7529-8b88-94c413756ad0
  - kind: imports
    to: 01a0ca85-8b21-7009-8bcc-eddc5565be05
  - kind: imports
    to: 01a0d564-ec47-7645-8756-ec405e1647fa
  - kind: imports
    to: 01a0d584-d0b8-7967-9796-a8e3bbddbda9
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-beeb-7ef2-bff4-d6d3b824564e
  - kind: imports
    to: 01a0fd8b-bf10-7a02-a086-916b457e7a6c
  - kind: imports
    to: 01a0fd8b-bf12-7d39-abd6-b5ffc43d3272
  - kind: imports
    to: 01a11241-8e1a-7151-a20e-e97daa6db0fc
  - kind: imports
    to: 01a123cc-eedf-7059-b425-43b31ad089ea
  - kind: imports
    to: 01a12c51-8120-7250-9703-61feea5c74f4
  - kind: imports
    to: 01a18921-8504-7058-9d53-62c5e9aa47fc
  - kind: imports-tests
    to: 01a12c56-911b-7d6f-9ef3-3bc7b6853ec2
  - kind: imports-tests
    to: 01a12c56-911d-7f8b-ade2-75bbc432f43a
  - kind: imports-tests
    to: 01a12ce3-7d6d-71b9-8c1e-d661ac293dd5
  - kind: imports-tests
    to: 01a12d4a-4b11-7dd5-bbf3-f8fc040c97a8
  - kind: imports-tests
    to: 01a1645c-0111-70ad-b9c5-09ef1cb7b072
sources:
  - kind: dir
    ref: apps/tagma/server/src/providers
---
Models run on the operator’s subscriptions, keys and installed programs. The module owns provider declarations, accounts, credentials, quotas and fresh model asks: features name an answer kind and a selection, while the provider’s declared request, borrowing or program path decides how the answer is served. It also gives an outside caller, a plugin, the model menu and one ask on the operator’s accounts, recorded as the caller’s.