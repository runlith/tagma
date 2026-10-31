---
id: 01a18f57-b835-7eeb-ae67-069e13b4bae4
title: Bun 1.4.4 separates allocator traffic, retained heap and collection-cycle timing
ord: 44
tags: ["research"]
fields:
  {
    "source": {
      "name": "Bun 1.4.4+38afee6c8; WebKit d6375c72; mimalloc 92ef6587",
      "ref": "https://github.com/oven-sh/bun/tree/38afee6c84fcf48c0edb2466aa4b27d287a59c30"
    }
  }
edges:
  - kind: discovered-from
    to: 01a18f4f-b747-7f98-835d-a2108fed156f
  - kind: relates
    to: 01a16e53-927f-716f-9a8e-d3c60b6bdff2
  - kind: relates
    to: 01a16e6d-a2e5-7580-aee5-3190fd2e52b9
---
Read Bun 1.4.4+38afee6c8 on Darwin arm64, with WebKit d6375c72affe0f70222cdcb45012b10f0bf3a9d5 and mimalloc 92ef6587c57b262f6e6abf513f7776a2f8d12aeb. Source conclusions apply to those revisions. The standalone probes were reported by [[01a18f50-755f-752a-8cda-4a1a813a1b0f|jsc-evidence]]; they were not retained as maintained fixtures and are samples, not overhead benchmarks.

**Allocator traffic.** `heapStats().mimalloc.malloc_requested` is cumulative requested bytes from mimalloc's current subprocess and its heaps. Thread-local merging can lag and aggregation is not an atomic all-thread snapshot. It includes other VMs and native traffic; JSC allocates individual cells from reusable free lists, and some system allocations bypass mimalloc. A worker allocating 64 × 1 MiB Uint8Arrays moved the main reader from 2,802,144 to 73,252,544 bytes; the worker read 73,106,264. The source declares the monotone counter and aggregated scope in [mimalloc-stats.h](https://github.com/oven-sh/mimalloc/blob/92ef6587c57b262f6e6abf513f7776a2f8d12aeb/include/mimalloc-stats.h). This is process allocator-request traffic, not exact cumulative serving-VM JS allocation.

**Heap gauges.** Bun's [v8 compatibility implementation](https://github.com/oven-sh/bun/blob/38afee6c8/src/js/node/v8.ts) assigns `total_allocated_bytes` from `heapCapacity`; its name does not make it an allocation counter. The [HeapStats contract](https://bun.sh/reference/bun/jsc/HeapStats) distinguishes post-GC retained cells from the current type census. The [bun:jsc implementation](https://github.com/oven-sh/bun/blob/38afee6c8/src/jsc/modules/BunJSCModule.h) walks object types and obtains/parses allocator JSON for `heapStats()`. It is a census, not a cheap scalar read; heap growth and retained-size deltas do not measure cumulative allocation.

**Per-VM collection cycles.** `node:v8.GCProfiler` attaches a VM heap observer. Its `cost` is collection prologue-to-epilogue wall time in microseconds, not mutator suspension. Events lack individual timestamps, omit cycles straddling session boundaries and accumulate in a native vector until `stop()`. Timer rotation bounds a time window, not event memory when the loop stalls. These conditions follow from [GCProfilerObserver](https://github.com/oven-sh/bun/blob/38afee6c8/src/jsc/bindings/NodeV8.h). One forced full collection yielded one event costing 315.084 µs, with before/after used heap 575,629/670,886 bytes. `PerformanceObserver.supportedEntryTypes` omitted `gc`; accepting that observation request emitted no events after `fullGC()` in the probe.

**Inspector and logs.** JSC's [Heap agent](https://github.com/oven-sh/WebKit/blob/d6375c72affe0f70222cdcb45012b10f0bf3a9d5/Source/JavaScriptCore/inspector/agents/InspectorHeapAgent.cpp) can attach an event-only per-VM observer; its timestamps cover collection cycles. Bun's [in-process Session dispatcher](https://github.com/oven-sh/bun/blob/38afee6c8/src/js/node/inspector.ts) does not expose that domain: `Heap.enable` and `HeapProfiler.enable` returned `ERR_INSPECTOR_COMMAND -32601`. A separate external JSC inspector transport and its cost were not tested. `BUN_JSC_logGC` prints `p=` collector stop-phase milliseconds, distinct from `cycle`; [Collector.cpp](https://github.com/oven-sh/WebKit/blob/d6375c72affe0f70222cdcb45012b10f0bf3a9d5/Source/JavaScriptCore/heap/Collector.cpp) clocks from after stopping the periphery to before resumption, excluding acquisition/resume tails. Tags contain a heap pointer or `all`, without a tested JS mapping to a particular VM. A sampled log reported `p=0.418916ms` and `cycle 0.402083ms`.

These checked APIs provide neither exact cumulative serving-VM JS-byte allocation nor a hard-memory-bounded exact mutator-pause stream. A loop-delay histogram is a bounded responsiveness observation; without an exact collection identity or event counter it cannot attribute those delays to GC. Sampling profiles, heap snapshots and collection-cycle timings answer different questions.