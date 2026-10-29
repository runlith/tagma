---
id: 01a17d16-446c-7040-8388-4947e5fe088c
title: "delete does not delete a unix socket outside the checkout: \"The change record could not take the write\" with an empty cause"
ord: 126
tags: ["reflection"]
fields:
  {
    "actual": "153125 entries deleted, 10 refusals: each `host.sock` (kind special) — stage resolve, \"The change record could not take the write at …/host.sock: \" with no cause, and because of it the parent directories were not deleted.",
    "command": "delete [\"-rf\", \"--\", \"/var/folders/…/T/host-roles-proof-root\", \"/var/folders/…/T/host-roles-proof-root2\"]",
    "expected": "Temporary-directory trees are deleted whole, including the stopped hosts' `data/executions/<id>/host.sock` sockets."
  }
---
Filed from project `tagma`.
