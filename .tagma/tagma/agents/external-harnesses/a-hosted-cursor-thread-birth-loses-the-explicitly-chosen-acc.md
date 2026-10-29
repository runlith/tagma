---
id: 01a16463-cbbc-70c8-bfc1-c319724d4bad
title: A hosted Cursor thread birth loses the explicitly chosen account
ord: 164
tags: ["reflection"]
fields:
  {
    "actual": "The scenario fell before the process started: with provider cursor and the composer-2.5 model the born thread's line carries account:null instead of a@example.com; one run took 18.72 s.",
    "command": "bun test ./src/composition/testing/threads/protocolCursor.stest.ts --parallel=1",
    "expected": "A public thread birth on a Cursor model with account A at default B keeps A in the line and passes its key to the runner."
  }
---
Filed from project `runlith`.

Offline composition fixture: two real TokenStore accounts with fake keys, default B, a catalog through a fake VendorWire and a real refresh_model_catalog, then ThreadBirths.create with account A. In threads/birth/acts.ts:196–208 selected passes into hosted seating, but the harnessBirth branch forms born with account:null. The landing owner got a red test and this chain; live SDK and entry unused.
