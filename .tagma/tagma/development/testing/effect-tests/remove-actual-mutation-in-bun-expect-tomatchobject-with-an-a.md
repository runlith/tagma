---
id: 01a14c9f-18ea-7b71-872a-ec9e7fc7bfa3
title: Remove actual mutation in Bun expect.toMatchObject with an asymmetric matcher
ord: 1
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a14c18-c833-7d88-b3bd-66eb312abbba
---
In Bun 1.4.3 (c6da4a4d3, macOS arm64) `const value = { runId: 'next' }; expect(value).toMatchObject({ runId: expect.any(String) })` replaces value.runId with an Any<String> object; an independent `bun -e` outside the checkout confirmed typeof object. A later runId check can go false-positive or wrongly refuse; found in protocolActs. Find the root fix in Bun or a verified release without the defect; add no shared wrappers and no project-wide matcher ban. Proof: the source object stays unchanged and a later comparison of two different runIds gives the right result; the local protocolActs check uses scalar values.
