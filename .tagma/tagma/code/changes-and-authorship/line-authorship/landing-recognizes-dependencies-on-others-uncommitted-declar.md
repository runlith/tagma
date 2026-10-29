---
id: 01a16a2c-1236-7dd3-bb4e-82159ac959b7
title: Landing recognizes dependencies on others' uncommitted declarations through imports and local scopes
ord: 63
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16a26-9f6d-77e4-b76a-ec6540a215c3",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16a26-4ad8-77b0-9788-e408ef90b529
---
Landing recognizes dependencies on others' uncommitted declarations through imports and local scopes.

The prepared-change check tells local shadowing apart from type/value/namespace spaces through the code-facts language port; change-record matches the selected references against working definitions by the lines' origin coordinates. The binder loads lazily in the existing installation-lifetime walk-worker pool, over the passed texts: noLib/noResolve, no semantic diagnostics and no library types. Import targets pass through Holdings and the binder reads them only at others' uncommitted lines; clean targets and chains through them are never parsed. When the checkout holds no foreign file at all, Holdings cuts the check off before import facts are read and before the binder starts. Otherwise, files of the delivery that import a foreign file also become roots.

For an imported foreign file a conservative name-based link additionally applies — not by receiver type: a missing foreign top-level declaration or a class, interface or object-type member, including a Context.Service type argument, is matched against used identifiers and importer property names. That is how `checkouts.checkoutsMoved`, a renamed receiver and destructuring are caught by member spelling without reading Effect. A name match can yield a false lines-held; the refusal names the name, the file, the holder and the ways out — taking, paths+whole, or the holder's landing. A file with no matching import never links to someone else's same-named member.

Facts are reused inside one preparation per file, visits per path+name+meaning. Import facts additionally persist per root/path+content digest in the worker through the existing code-facts ParseMemo: one latest version per path, LRU within a bounded share of machine memory. Target contents/paths re-resolve; their freshness is never cached. The native module cache and lazy Promise load TypeScript/OXC one instance per worker lifetime. The worker returns to idle and serves later landings rather than being created per call.

A separate pool defect: at width=3 four concurrent requests raised four live workers. The public makeWalks test took red with 4 instead of <=3; green keeps the shared limit with the urgent reserve inside it (background capped at size−1 when size>1), four results preserved. At size=1 the shared limit is one, so the urgent queue waits for the already-running job but overtakes waiting background.

Checks run through a real native submit_work/makeDoorWorld: the source CopyWriting, foreign import/export alias, local declarations, type/value, shorthand, Svelte fragment and namespace re-export. Scenario 5134b560 took red landing the importer with a missing service member; green refuses in own/shared importers, at destructuring/renamed receiver, accepts taking, and never refuses same-named access without an import. An import change in an already-read file checks fact invalidation. The single reviewer gave three confirmed findings — shorthand value symbol, an unsupported Svelte-root name, namespace prefix — all fixed at the adapter/worker and checked through public contracts.

## Samples

macOS arm64, Bun 1.4.3, 12 logical cores, 32 GiB RAM. File — 4000 unique declarations `export const valueN = N;` plus an import/consumer; native time measured with a Clock around atNative, worker time as the span, OXC as the direct import-fact call. These are single elapsed-time observations, not CPU time, not a percentile and not a controlled A/B.

At load average 15.80/12.34/10.58 before memo: without foreign files — 2680 ms native, 0 TS and 0 import jobs. Shared file — 4436 ms native, 2 TS texts, worker 2006.24 ms. Own file next to an unrelated foreign file — 3475 ms native, 0 TS, 1 OXC read, import worker 756.53 ms; the latter includes a cold load and is not reported as pure OXC time.

After memo and the pool fix, load average 19.21/15.66/13.29, one DoorWorld and one worker #2 in every dependency/import call:
- A successful landing without foreign files: 1139 ms native; 0 import jobs, 0 OXC and 0 TS.
- First importer attempt with a peer-only member (lines-held): 900 ms native; import worker 327.29 ms, OXC 17.58 ms; 3 TS texts, binder worker 115.29 ms.
- Next identical attempt on the same worker (lines-held): 273 ms native; import memo hit, 0 OXC reads, import worker 0.340 ms, fact lookup 0.009 ms; 3 TS texts, binder worker 40.75 ms.
- Two consecutive successful landings of another 4000-line file next to an unrelated foreign file, with changed content: 826/709 ms native; 0 TS; OXC 9.37/9.99 ms, import worker 9.76/10.30 ms. A changed digest correctly re-reads even though the module is already warm.

The temporary measuring test is deleted after the measurement; the data composition, the successful-landing versus refusal difference, the counters and the method are preserved here. Final server typecheck: exit 0, 5561 files; the public pool test — 4 pass/23 expect, the service-member and import-fact invalidation test — 1 pass/30 expect, binding forms — 1 pass/47 expect. The source scenario and fold checks also passed; no second review ran after the operator-ordered widening and the pool fix.
