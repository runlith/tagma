---
id: 01a18404-f6df-7814-bb9e-c815d7dbe006
title: "The feed meets its frame budget: continuous motion within the refresh interval per frame, a far rail jump and opening a thread within the response budget"
ord: 7
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a18353-fc02-75a8-8ad8-55e6ba48c4e2
  - kind: implements
    to: 01a18327-c7aa-7718-b037-fece2ea21922
sources:
  - kind: file
    ref: packages/chat-ui/src/TranscriptVirtualizer.svelte.ts
  - kind: file
    ref: packages/markdown/src/render.ts
---
Split from ba48c4e2 so the feed's owner change can land on its invariants. Measured on the feed stand before its final method (geometry recorder active, so indicative only): at 4× CPU throttling in Chromium a frame mounting an unmeasured row took 59–174 ms; a rail select far into history in WebKit took 581 ms and 448 ms frames while about 41 heavy rows mounted at once. Since b039ec4b markdown parsing runs synchronously in the mount frame, which moves its cost into exactly these frames. Find the cost per frame by owner — row mount, markdown parse, highlighting, measurement, overscan size — on the stand's timing-only lane against the c76a2289 baseline, and remove it at the producer (spec rule: cost is removed where it arises, not hidden behind throttling). Accepted on the spec's budgets, in Chromium in a quiet window, reported by script, layout and paint: in continuous motion (a fling, a drag, a glide, streaming growth) the feed's main-thread work per frame is within 8.3 ms unthrottled and 16.7 ms at 4×; a discrete navigation (a far rail jump, opening a thread) reaches its first final paint within 50 ms unthrottled and 100 ms at 4×, and the glide after it keeps the per-frame budget; zero blank area and the invariant lanes stay green.

A rail select far into history changes behaviour here too (spec 2ea21922, the rail): it smooth-scrolls ~35 000 px over ~1.9 s through 43 unmeasured row mounts with 474 ms and 524 ms frames, restarting from rest whenever the library re-issues the scroll after rows above the target measure. It becomes an instant jump to one viewport short of the target plus a smooth last viewport.

Timing-only attribution on 2026-10-28, Chromium 151.0.7922.71, Apple M2 Max/12 cores, 4× CPU: five identical touch controls over one fully loaded page and the same premeasured 12,000 px region had maximum frame intervals 199.3/200.0/182.6/209.1/200.6 ms, with no geometry recorder during capture. One detailed control reproduced 207.4 ms elapsed and 202.322 ms main-thread work. Its scroll dispatch consumed 185.070 ms wall/184.790 ms thread CPU; the principal function consumed 169.569/169.333 ms. Identical rebuilt bundle bytes and a source map locate that function at virtual-core 3.19.8's observe-offset scroll callback, reached through TranscriptVirtualizer.options.observeElementOffset and synchronous publish/mount. The measured owner is the feed's synchronous scroll path; markdown versus mount internals remains unattributed. These are local observations under memory pressure, not a quiet-window comparison. Reproduce with `bun run bench --controls --count 1 --output <report> --traces <directory>` in packages/chat-ui. Preserved evidence is in [[01a18355-1f4c-7eaf-a7b4-c56cc81b6145|feed-stand]]'s scratch: timing-controls.json, timing-control-detail.json and timing-control-detail-traces/control-1.json.

Split by owner, 2026-10-28 on the tree carrying ba48c4e2's uncommitted changes, Chromium 151 headless at 4×, V8 sampling and layout-invalidation traces on a fully loaded machine (load average 18–46), so shares hold and absolute times do not: the 200 ms control frames no longer reproduce — the same control fling peaks at 42–45 ms of work (p95 24–26 ms). Through measured history ~90% of each long frame's 9–13 ms Layout is invalidated by the message rail: `MessageNav` tiles animate width and height with `transition-all`, so each change of the current message re-lays out every frame of its 150 ms transition, and each such pass costs ~10 ms for 16 dirty objects because it walks the mounted feed; a row mount there costs ~2 ms of layout. Through unmeasured history the worst frames (20–30 ms) are Svelte mount and flush 40–50%, markdown parse and sanitize 21–32% (DOMPurify about 60% of it), forced layout in `measureRow` 11–51%, and `MessageMeta`'s Lucide copy icon up to 20%; highlighting runs off-thread and relayouts code blocks only when its colours land. A rail select far into history used to mount the whole ±20-row window (~45 rows for ~4 visible) inside one scroll handler — 106–213 ms frames (1.1 s under invalidation tracing): Svelte mount and flush ~40%, markdown 16–31%, `measureRow` 15–20% (two height reads per row interleaved with box writes, so one layout per row), `MessageMeta` 5–10%, `inStep`'s `getAnimations` 3%, `clipFade` up to 4%.

Result of 908ca48355 (rail tiles by `scale`, a pixel window of one viewport each side, one read pass and one publish per mount, a far select's instant leg with its landing mounted in the same task, `inStep` only on moving marks, `clipFade` through its observer, DOMPurify configured once). Quiet window on 2026-10-29, Chromium 151, M2 Max, load average 5–7, busy share 0.23–0.32, prebuilt c76a2289 bundle against the current one, alternating arms. Main-thread work per frame, p95/max in ms, base → current:

| scenario | 4× (budget 16.7 ms) | 1× (budget 8.3 ms) |
| --- | --- | --- |
| control flings through measured history | 16.7–20.5/35–36 → 7.5–7.6/29–32 | 4.5–4.6/7–9 → 2.0–2.5/7–10 |
| far rail jump | 42/367 → 16/176 | 42/59 → 3.8/34 |
| open at the tail | 48/141 → 5.9/54 | 9.2/33 → 1.3/7.9 |
| wheel fling | 8.7/39 → 4.3/29 | 1.5/7.0 → 1.1/8.7 |
| touch fling through unmeasured history | 6.5/36 → 3.1/23 | 1.8/7.5 → 1.1/5.9 |
| page landing mid-fling | not measured on base (driver refused) → 2.7/26 | not measured on base → 1.1/11.3 |
| rail select during a fling | 23/103 → 16/44 | 7.2/9.8 → 4.5/7.5 |

Frames over the 4× budget fell from 18–33 to 4–6 per control fling; invariant lanes stay green with 0 px blank (WebKit page-mid-fling's one red is 85b6caee). The budget is not met yet: the far jump's landing frame (176 ms at 4×, 34 ms at 1×) spends about a third in virtual-core rebuilding the measurements of all rows and forced `scrollTop`/`scrollHeight` reads (the window's `scrollToFn` sizes the list before every compensating write, so each measured row above the reader rebuilds the whole list), the rest in mounting ~12 rows (Svelte, markdown, `MessageMeta`'s icon, `clipFade` reads); the remaining fling frames over budget (18–32 ms at 4×) are row mounts dominated by DOM insertion and `clipFade` reads in the observer delivery.
