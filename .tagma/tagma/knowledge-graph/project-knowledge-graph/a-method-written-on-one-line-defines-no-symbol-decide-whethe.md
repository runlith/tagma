---
id: 01a0caa8-aeec-7ae3-8d76-647375d13994
title: A method written on one line defines no symbol — decide whether the paren arm means that
ord: 142
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/sources/readers/regions.ts
    symbol: isMember
---
A method written on one line — `run() { return this.held; }` — defines no symbol: the paren arm counts only when the line ends with `{` or leaves brackets open, so the scan reads a line that opens and closes its body the way it reads a call standing on its own line, and a symbol source on the name reads dead. Claim [[05de6035]] states the behavior; no test pins it either way.

Decide at the owner whether that is the contract or a gap. A fix widens the paren arm to the balanced-`}` line without admitting calls that take object or closure arguments on one line; `isMember` stands in the `REGION_READER` identity, so the fix re-dates every baseline once by design. Keeping the behavior pins it with a test instead.

Done when the behavior is either fixed with a test over the one-line form and the call forms that must still read as calls, or kept with a test pinning the gap — and [[05de6035]] and [[3e64be22]] state whichever was decided.