---
id: 01a13cd6-1d0b-7373-8427-45cf739eae0c
title: titlesStealth.itest exceeds the integration layer budget and fails on the beforeAll timeout under load
ord: 47
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13d2f-a3f4-7833-9183-21ba84bb0f8a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13c96-169d-7590-9735-bcaf64ef0ba3
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/titlesStealth.itest.ts
---
`graph/serving/titlesStealth.itest.ts` is flaky: its `beforeAll` builds three graphs (alpha plain, beta stealth on main and on the `subject` branch, plus global) and performs a real git merge, and under machine load it never fits the 10 s hook — the test fails as `(fail) (unnamed) [10000 ms]` (1 of 3 runs at load average ~15–27). In a quiet run the file takes 8.2 s of CPU time, and `test/layers.ts` itself calls it over the integration layer budget (8 s).

Do: assemble the world so the file fits the budget (one stealth-project graph on a copy, no spare plain project, if titles can read from the same project's `current`), or move the file to `*.stest.ts` if it needs the whole assembled product. Done when the file passes steadily and `test/layers.ts` reports no excess. Executed in `8a17c616e5`: the alpha runtime and two mirror opens for setup are removed; topology prepares real stealth twins, the current writer pre-writes unrelated plain trees. Two independent runs of the final shape: 1 pass / 0 fail / 3 expects, 6.44 and 7.53 s wall; the CPU gate never refused, typecheck clean. Statistical steadiness under varying loads is not proven; timeout and budget were never raised.
