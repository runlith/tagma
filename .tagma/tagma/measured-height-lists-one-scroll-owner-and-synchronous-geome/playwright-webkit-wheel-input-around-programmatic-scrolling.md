---
id: 01a1851e-f784-7801-bb0e-5a212b40a488
title: Playwright WebKit wheel input around programmatic scrolling
ord: 4
tags: ["research"]
fields:
  {
    "source": {
      "name": "Playwright WebKit",
      "ref": "playwright-core 1.60.0, WebKit 26.4 build 2287 (headless macOS arm64)"
    }
  }
edges:
  - kind: relates
    to: 01a1851a-39a3-760f-9292-7af698c0c0fe
---
## Observation

On 2026-10-29, Playwright 1.60.0 headless WebKit 26.4, build 2287, ran on macOS Darwin 25.0.0 arm64 (Apple M2 Max), under the managed testbed engine. This is Playwright WebKit, not Safari.

A plain 1,000,000 px scroller began at 400,000 px, away from either edge. Each trial sent eight sequential trusted Playwright wheel calls of +100 px, and in write trials scheduled one positive jump after the third delivered wheel. The requested write delay was 0, 5 or 10 ms after that wheel's DOM event timestamp, twice each per cell. Each write read the live scrollTop as its basis. The measurement used a scroller `onwheel` handler that could cancel the event, so this is not a no-blocking-listener control. The recorded outcome waited for eight consecutive animation frames at the same position after the driver calls and write completed; this is a stability observation, not a proof that arbitrarily delayed input cannot arrive later. The no-write baseline had six trials. Six repeats per cell are a coarse exploratory estimate, not a reliable rare-event rate; the repeats are not independent of engine scheduling.

The table is counts of 100 px deficits relative to the sum of delivered DOM wheel deltas and the observed write delta, out of six trials per cell. In all 22 deficit trials the live offset at the write included the first two wheel deltas but not the triggering third; the next observed wheel saw exactly the post-write offset. The traces are consistent with losing the triggering pre-write delta, but do not prove attribution to that wheel over a later wheel in all cases. One scrollTo/500 trial additionally had eight completed driver calls but only seven DOM wheel events; its absent input has no timestamp and is not included in the delivered-input deficit count. A 100 px deficit does not establish a post-write wheel loss.

| Method | +50 | +500 | +5,000 | +50,000 |
| --- | ---: | ---: | ---: | ---: |
| scrollTop | 2/6 | 3/6 | 2/6 | 3/6 |
| scrollTo | 4/6 | 3/6 plus one undelivered | 3/6 | 2/6 |
| scrollBy | 0/6 | 0/6 | 0/6 | 0/6 |

No-write baseline: 0/6 delivered-input deficits, no missing DOM wheel events. All requested jumps read back as the requested delta. At requested 0 ms the observed write minus trigger timestamp was 0–6 ms; at 5 ms, 4–6 ms; at 10 ms, 9–11 ms. The DOM clock readings were quantized near 1 ms, so endpoints are approximate. A requested 0 ms write had 16/24 deficit trials, 5 ms had 5/24, and 10 ms had 1/24; there were two trials for each method/jump/delay combination.

The next observed wheel's timestamp was 10–59 ms after the write in the 0 ms group, 6–40 ms in the 5 ms group, and 2–72 ms in the 10 ms group. Only nine trials had a next-wheel timestamp 1–6 ms after the write: one at requested 5 ms, eight at requested 10 ms. Their aggregate deficit was zero, and their DOM delivery lag was 0–1 ms. They cover scrollTop/50, scrollTo/50/500/5,000/50,000 and scrollBy/50/500/5,000/50,000, not every method/size cell. The slow-delivery feed observation, with a wheel timestamp 2–4 ms after the write and delivery 50–68 ms later, was not reproduced. Sequential Playwright wheel calls took 5–213 ms apiece on this run, and the requested post-write event interval was not directly controlled.

## Busy-task extension

Two further 42-trial arms used the same scroller and driver, with a 60 ms page-thread busy loop immediately after the write and a no-write busy control. The measurement listener on the scroller was explicitly passive in both arms; one arm added exactly one no-op `document` wheel listener with `passive: false`. Each method/size cell had six trials, two per requested 0, 5 and 10 ms trigger-to-write delay. The write used the live offset; busy time measured 60–61 ms and began within 0–1 ms of the write. The small sample is exploratory, and the two arms ran sequentially rather than under identical machine load.

The table counts 100 px deficits against the delivered DOM deltas and observed write delta, out of six trials. Both no-write busy controls were 0/6. One passive-only scrollTo/50,000 trial had eight completed driver calls but seven observed DOM wheel events; the absent event is untimed and excluded from its delivered-delta deficit. All requested jumps read back as requested.

| Listener arm | Method | +50 | +50,000 |
| --- | --- | ---: | ---: |
| passive only | scrollTop | 1/6 | 0/6 |
| passive only | scrollTo | 0/6 | 0/6 plus one undelivered |
| passive only | scrollBy | 0/6 | 0/6 |
| document non-passive | scrollTop | 3/6 | 2/6 |
| document non-passive | scrollTo | 2/6 | 2/6 |
| document non-passive | scrollBy | 0/6 | 0/6 |

In the document non-passive arm all nine deficits occurred with the third, pre-write trigger absent from the live offset at the write, and are consistent with losing that input; aggregate positions do not prove which wheel was lost. The passive-only scrollTop/50 deficit had the trigger already in the write basis, so it cannot be classified as a triggering-wheel deficit; the post-write event timestamps began 60 ms after the write, and the aggregate deficit does not identify which later event was lost.

The first post-trigger event timestamp was 60–131 ms after busy start with passive observation only and 60–69 ms with the additional non-passive document listener. No observed post-trigger timestamp fell during either busy interval or 1–6 ms after the write. DOM timestamp-to-delivery lag was 0–28 ms and 0–12 ms respectively. Thus neither arm reproduced an input timestamp 2–4 ms after the write followed by 50–68 ms deferred delivery, and neither proves that boundary safe. The sequential driver calls took 4.9–163 ms and 4.3–93 ms respectively; event times have approximately 1 ms resolution. Requested trigger-to-write delays 0/5/10 ms yielded 0–10/5–17/9–11 ms in the passive-only arm and 0–2/5–6/10–11 ms in the document non-passive arm.

The extension's scratch programs are `wheel-passive.ts` and `wheel-passive-document.ts`; their `wheel-passive-results.json` and `wheel-passive-document-results.json` records include event timestamps, live offsets, writes, driver calls and stability frames, with summaries produced by `analyze-paired.ts`, in the scratch directory named below.

## Direct-driver attempt

Playwright 1.60.0's WebKit `RawMouseImpl.wheel` awaits `Page.updateScrollingState` and an evaluated `requestAnimationFrame` before sending `Input.dispatchWheelEvent` (`playwright-core/lib/coreBundle.js:44584–44595`), so a wheel waiting at that frame gate cannot be dispatched during the occupied page task. One testbed attempt to reach the in-process page's `_delegate._pageProxySession.send` directly failed before injecting any input: the page-proxy session with a callable `send` was unavailable from that object. The direct-driver program stopped with `direct WebKit page proxy session unavailable`; no direct-input trials were run, and whether the feed's delayed-input loss is a driver or engine effect remains unresolved. The failed attempt and an unverified preload are in the scratch directory as `wheel-direct.ts` and `webkit-wheel-preload.ts`.

## Interpretation and limits

The observed delivered-input deficits can arise even at a 50 px jump, under these particular timings. They are consistent with a write meeting the trigger wheel before its scroll delta appeared in the live offset. This result does not establish whether the separate delayed-delivery post-write loss depends on jump size or method, or whether Safari behaves the same. No mechanism choice follows from this experiment alone.

The scratch experiment and raw timestamp, readback, scroll-event, frame and driver-call records were kept at `~/.tagma-dev/scratch/01a1851b-b881-770b-86aa-e1decd9381ee/wheel-measure.ts` and `wheel-results.json`, with `analyze.ts` and `wheel-summary.json` beside them. This scratch is not a durable repository artifact; reproduction after its removal requires reconstructing the program from this description.
