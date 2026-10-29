---
id: 01a0d44c-4c01-732a-a727-93844e5185d7
title: Standing claims and containers drop counts of lists and copied constant values
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d442-5076-7cdb-b903-69f8b450d2e0",
    "status": "done"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/catalogs/contract/wire/softwareDevelopment.ts
    symbol: softwareDevelopment
---
The #claim guidance now says a number is written only where the magnitude is itself the claim (commit 9ec2c99b88). Existing claims and containers still carry counts that are rewritten every time a list grows: 211 prose edits over 81 blocks in 21 days changed nothing but a number.

A candidate list was made by pattern — a number word of three or more, "two of the …", or a digit with a unit — over standing #claim, #area and #module blocks: 711 blocks, split into five scopes. Most will need a change; many will not.

For each candidate, decide one of:
- **Count of a list the text names** ("Six outcomes: agrees, refused, …") — drop the count ("Outcomes: agrees, refused, …").
- **Count standing in for a totality** ("Two of the package's four doors are browser-safe", "Sixty-four entries") — state the property instead: which members, and what they share.
- **A constant's value copied into prose** ("the term rung is twelve seconds") — replace it with what the value must satisfy, and make sure the constant's symbol is a source. Where the code gives no reason, keep the value bound to its symbol rather than invent one.
- **Keep** — the magnitude is the claim (a ceiling someone relies on, a ratio, an order of magnitude), or the number is structural and changes only with the meaning ("one of two carriers", "two tiers").

A title that changes renames the block, so rewrite titles only where the title itself carries the count. A number found already wrong is corrected from the code. Every rewritten block is re-read against all its sources and written with `checked: true`; one you could not confirm is left unverified and named in the report.

Done when every candidate is decided, and the report gives counts rewritten and kept, lists blocks found false, and lists blocks left unverified.
