---
id: 01a17dc3-3538-7e64-8a8b-22409305e71b
title: delete does not delete a stopped host's Unix socket in a temporary directory
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "21798 removed, 6 failed: host.sock (kind special) — stage resolve, operation-failed, \"The change record could not take the write at …/host.sock: \" with an empty cause; five parents — directory-not-empty.",
    "command": "delete {\"args\":[\"-rf\",\"--\",\"/private/var/folders/87/cmcr9wbs5yqcbthnzgqp7lh80000gn/T/uh-repro\"],\"background\":true}",
    "expected": "The tree is deleted whole, including `inst/data/executions/<id>/host.sock`."
  }
---
Filed from project `tagma`.
