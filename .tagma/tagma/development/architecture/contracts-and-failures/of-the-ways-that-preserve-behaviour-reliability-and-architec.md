---
id: 01a0db59-6036-7f53-979d-471d2393aff1
title: Of the ways that preserve behaviour, reliability, and architecture, every change chooses the fastest
ord: 3
tags: ["rule"]
---
Cost grows with what the work touches: no O(n²) where O(n) suffices, no re-reading the known, no recomputing the unchanged, no full re-reading for a single change. Cost is removed at the producer, not with cache, throttle, or debounce at the consumer. At equal cost, the simplest way wins.
