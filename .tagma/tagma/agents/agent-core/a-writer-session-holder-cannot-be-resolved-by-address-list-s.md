---
id: 01a1653e-7764-789c-8418-5d8e01944f89
title: "A writer-session holder cannot be resolved by address: list_sessions yields an unbounded list with no total and no cursor"
ord: 166
tags: ["reflection"]
fields:
  {
    "actual": "read_block returned only the numeric holder 2742; list_sessions takes neither selector nor limit and emitted hundreds of session rows (from id 2744 down to 2312), then the answer broke off offering the whole json. No total and no page continuation given.",
    "command": "read_block({blockIds:[\"84526f99\"],depth:0,json:true}); list_sessions({})",
    "expected": "Resolve holder=2742 to a thread address with one addressed read or a bounded page of writer sessions with limit, total, and cursor — without the project's whole writer history."
  }
---
Filed from project `runlith`.

One task holder was needed, to hand over facts for the current graph cleanup; its address turned up in the history's second row, yet the outcome still filled the whole reply envelope. This is a holder reading/projection defect, not a reason to request the full JSON and not a reconciliation error in Cursor.
