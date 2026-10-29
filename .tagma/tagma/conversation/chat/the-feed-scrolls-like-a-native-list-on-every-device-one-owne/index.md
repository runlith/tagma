---
id: 01a18327-c7aa-7718-b037-fece2ea21922
title: "The feed scrolls like a native list on every device: one owner moves the position, and the rail reads one fact from it"
ord: 78
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a118f1-5f59-7eb8-856a-a0deb7bb8a8f
  - kind: relates
    to: 01a118f1-5f59-7eb8-856a-a0e18d75d711
  - kind: relates
    to: 01a14778-f056-76a3-822f-80720c2fae8e
  - kind: relates
    to: 01a14f4a-f4a6-7342-a011-3a1876fcb7d4
  - kind: relates
    to: 01a1808a-0601-7f7a-a05f-e69d5f44eb38
sources:
  - kind: file
    ref: packages/chat-ui/src/ChatComposerOverlay.svelte
  - kind: file
    ref: packages/chat-ui/src/MessageNav.svelte
  - kind: file
    ref: packages/chat-ui/src/rowEstimate.ts
  - kind: file
    ref: packages/chat-ui/src/transcriptMessageNavigation.ts
  - kind: file
    ref: packages/chat-ui/src/TranscriptViewport.svelte.ts
  - kind: file
    ref: packages/chat-ui/src/TranscriptVirtualizer.svelte.ts
---
**Outcome.** Reading a thread feels like a native list on every device Tagma reaches — desktop app, desktop browser, phone browser: no jump, no pull-back, no lost inertia, no blank band, no frame over the display's refresh interval, at any history length the browser can lay out and while the agent streams. The message rail always shows the message being read. One owner moves the feed's scroll position; everything else asks it.

**What the reader meets now.**
- On a phone the history jumps, stops its inertia and is dragged away while scrolling, worst while older pages load.
- The rail lit the message before the last while a run worked at the tail (fixed in f7fbae6d; its counter-cases are task 80b5f328).

**Roots** (read in code at HEAD `f7fbae6d`, tanstack virtual-core 3.17.8 installed; *unverified* marks what still needs the stand).

1. **Paging fights the reader.** After an older page lands, `TranscriptVirtualizer.applyPrepend` re-pins the first visible row to the screen offset it had before the page, every frame, until it is stable for 30 frames or 180 frames passed (`TranscriptVirtualizer.svelte.ts` `applyPrepend`). Only a wheel, `touchmove` or key event cancels it (`markGesture` → `clearPrepend`). iOS momentum after the finger lifts sends none of them, so while a fling carries the reader on, the loop writes the old position back every frame — the feed is dragged against the reader for up to 180 frames. The same loop starts whenever a held activity stretch scrolls out of view while the feed is paused (`ChatTranscript.svelte` `releaseStretches`).
2. **Many writers, each with its own policy.** Tagma moves the feed through five entry points — `FollowingViewport.scrollToBottom` (`scrollTop = scrollHeight`), `TranscriptViewport.scrollBy`, `applyPrepend`, `anchorEnd` → tanstack `scrollToEnd`, `scrollToRow`/`reaim` → tanstack `scrollToIndex` — and tanstack 3.17.8 writes on six internal paths: size adjustment, prepend anchor sync, `followOnAppend`, the mount write with `initialOffset: MAX_SAFE_INTEGER`, the iOS deferred replay and the reconcile loop. Tagma tells its own writes from the reader's by time windows: a 250 ms gesture window, which expires in the middle of momentum, and a 1.5 s auto-scroll mark. Four Tagma paths defer only inside the gesture window (`sync`, `reanchorEnd`, `widen`, `scrollToFn`); `applyPrepend` and `scrollToBottom` never defer. Tanstack's iOS replay 150 ms after touch end can re-apply a delta Tagma's `anchorEnd` already corrected (*unverified on a device*).
3. **A second policy bent into the library.** Tagma replaces tanstack's `resizeItem`, `indexFromElement` and `shouldAdjustScrollPositionOnItemSizeChange`, suppresses `scrollToFn` writes while `chasing`, reads its caches and sets the list height by hand, while the library's own end anchoring, prepend anchor, `followOnAppend` and iOS deferral stay live. The installed 3.17.8 predates the library's touch-only deferral (3.19.5, #1318), held corrections (3.19.5, #1319) and iOS 27 fling handling (#1307, #1332).
4. **Writes the browser will not take.** With a finger down iOS ignores a `scrollTop` write; during momentum a write stops the inertia on iOS 26 and earlier and is overridden within one or two frames on iOS 27; a touch that catches a fling sends no touch or pointer event; the first momentum scroll event can arrive 159–253 ms after `touchend`; desktop Safari discards writes during its trackpad rubber band (TanStack/virtual #1307 and #1287, measured by its maintainers on iOS 18.2, 26.5 and 27.0 simulators and an iPhone on 27.0.1; WebKit 187449). Roots 1 and 2 write through all of these.
5. **Estimates assume the desktop column.** Text estimates divide by 78 or 72 columns × 1.31 whatever the feed's width (`rowEstimate.ts`); attachments are a fixed 102 px; code, tables, headings and the `@min-[34rem]` spacing are not distinguished. On a phone column prose is estimated roughly 2× short (arithmetic from the constants; not measured). Each row measured on its way into view shifts everything after it by its error. The measured-size memory is keyed by width and disclosure only, not content revision, font or zoom.
6. **A late body clips one frame.** A row's box has a fixed height and clips (`TranscriptRow.svelte`); a body that renders late (markdown, highlighting) is re-measured on the next animation frame (`measureRowLater`), so its growth shows clipped or blank for a frame.
7. **The composer scrolls by hand.** A drag or wheel over the composer card becomes `preventDefault` plus `scrollBy` (`ChatComposerOverlay.svelte`): no inertia, and the reader's own fling ends where the finger lifts.
8. **The feed's scroller has no overscroll containment**, while the phone's other lists do (`overscroll-contain`); a fling past the feed's edge may chain to the page on iOS (*unverified*).
9. **Nothing tests real layout.** The feed's scroll tests run in jsdom with faked `scrollHeight`; no test runs a real engine, inertia or a phone, so each rework passed its tests and failed in hand.
10. **One mechanism, several copies.** Row windowing over measured heights exists as tanstack in the feed, `ExplorerView`, `ToolDiff` and the speech call transcript (`speech/calls/TranscriptView.svelte`, which also uses `scroll-follow`), and by hand in `ColumnWindow`. `WorktreeWindow` windows server subscriptions, not geometry, and is not one of them.

**Decision: one owner of the position, first on tanstack virtual-core 3.19.8.** The library's current core already holds a correction it cannot write — it shifts the rendered row starts and the total size instead of writing `scrollTop`, and writes once in the first paint where the write lands — defers only for touch-driven scrolls, handles WebKit bounces, makes commands wait for or stop an iOS 27 fling, and cancels stale anchor work on explicit navigation; all of it was measured on iOS 26 and 27. Roots 1–3 are Tagma's own writers and overrides around an old version. So the feed's owner is the library as designed: Tagma deletes its writers and overrides and keeps only policy — following, commands, the rail. An own engine is written only if the stand shows a budget failure the library's model cannot meet; the failure is named here before that work starts. The design constraints for that case stand under "If the library fails".

**Contracts** (whatever implements the owner).

*Position.* The position is an anchor: the tail, or a row key and the reader's offset into it. A layout change — a row resizing, a page prepending, the width, the composer, the pinned region, the keyboard — re-projects the anchor; while the projection is inside the scroll range the anchor row moves less than 0.5 px. A disclosure toggled by the reader anchors the control they pressed, not the row start. When the anchor row disappears (regroup, withdraw, collapse, verbose filter) the anchor moves to the nearest surviving row after it, else before it, at offset 0.

*Writes.* Only the owner writes the scroll position. A correction is held exactly while a write cannot land — finger down, iOS momentum, WebKit overscroll, a scrollbar thumb drag — as shifted row positions and size, never as a transform, and written in the first frame it can land; on every other platform and moment it is written in the frame it arises. The window, the end threshold, the paging trigger and the reading line all read the held position. Commands — a rail select, jump to latest, `Cmd+Alt+[`/`]`, a keyboard scroll — act at once; on iOS they stop the fling first; they are never queued behind momentum.

*Authorship.* Reader movement is known by its input — wheel, touch, keys, a press on the scroller — and by any movement the owner did not cause. A clamp after a shrink, the rounded read-back of the owner's fractional write and the owner's own smooth scroll are not the reader's. A movement the browser makes — focus, find-in-page, selection autoscroll — re-derives the anchor from where the view now is.

*Following.* The rules of [[76fcb7d4]] stand: a scroll ending at the bottom follows; a wheel or downward key at the bottom follows even without a scroll event; press and selection hold the feed still and an unmoved feed returns to the tail on release. Streaming rows below a key anchor never move the reader.

*Paging.* An older page is inserted as a correction under the same hold rule; no settle loop and no screen-offset re-pinning exist. The trigger distance is measured in viewports ahead of the reader.

*Sizes.* An estimate takes the measured content width of its kind (body, user bubble, tool well), line heights from the text-style tokens, block structure (code, tables, headings, lists) and known media aspect; rows above the reader are estimated high, so a held correction is a shrink the space above absorbs. A measured size is kept per key with width, disclosure, content revision and font/zoom epoch, and wins over any estimate. A row's box grows in the same frame its content does: no clipped or blank frame for a late body. `estimate` stays the entry-kind descriptor's field ([[8d75d711]]); its width input reaches every registered kind.

*Mounted rows.* The live-row contract of [[8d75d711]] holds. A row holding focus or an end of the selection stays mounted. Find-in-page and VoiceOver over unmounted rows are not provided.

*The rail.* Its tiles are `VisibleFeed.users`. The current message is the last tile whose row starts at or above the reading line, computed from row positions, never from rendered rows ([[5f44eb38]]). The line stands at a fixed offset under the top — at most the middle of the visible height — and over the last screen of scroll moves to the last visible pixel above the composer; its place there is fixed by the reader's position at their last own movement, so growth or shrink below never changes the tile (task 80b5f328). A thread that fits one screen lights its last message. A select lights its row until the reader moves; a select that cannot reach its landing gap keeps its row current while it is visible. A select more than a few viewports away jumps at once to one viewport short of its target and travels that last viewport smoothly: traversing the whole distance would mount every row in between, and a smooth scroll whose target keeps moving as those rows measure restarts and stutters.

*Phone.* A drag that starts on the composer card does not scroll the feed — the composer is a fixed bar, as in native messengers; drags anywhere else are the native scroller's. A wheel over the composer reaches the feed as the reader's scroll. The feed's scroller contains its overscroll. The shell's `visualViewport` height and offset reach the feed as one viewport change, applied once, and a pinch zoom is not taken for the keyboard. The scroller's composer mask stays only if the stand shows it costs no frame on WebKit.

**Proof.**
- *Owner policy, unit:* scenario tests and a seeded random-sequence test against a DOM-port fake that encodes the measured browser behaviour — writes ignored under a finger, stopping or overridden in an iOS fling by version, discarded in a bounce, clamped at the range ends, rounded to device pixels. Invariants: in-range anchor drift under 0.5 px; no write while a write cannot land, commands excepted; the tail stays the tail; a paused reader is never moved by growth below.
- *Rail, through the surface:* the cases of f38a25ae and 80b5f328.
- *The real app.* The same recorder, scenarios and budgets also run against the real app served by the e2e world over a thread seeded through product operations — markdown with code, tables, images, block and thread references — because the app's row renderers (fallback-first markdown, a shared renderer cache, references rewritten after mount) decide row-size changes the stand can only mirror. The gate is both.
- *The stand.* The real `ChatSurface` over a synthetic 10 000-entry thread, its markdown rows following the app's renderer lifecycle on the same kit renderer, — long markdown, code, tool wells, images, a streaming run — with scripted page latency standing in for a remote connection. Lanes:
  - Chromium desktop: wheel and trackpad gestures, and a touch fling through CDP `Input.synthesizeScrollGesture`, at 4× CPU throttling;
  - WebKit desktop through Playwright. Its wheel injection waits for a page frame before the native dispatch, so a wheel that reaches the page more than one frame after its timestamp cannot be told apart as the driver's or the engine's (2b40a488). The stand reports such a wheel step as `wheel-late`, with its delivery lag, measured refresh interval and the containing page-frame interval; the last is observed timing, not a JavaScript stack attribution. A wheel whose native timestamp falls within one frame after an own write is reported and judged the same way, because WebKit can drop such a wheel (98c0c0fe). It judges the step only causally: it fails if an own write lands between the wheel's delivery and its scroll, using the scroll event's timestamp rather than the frame sample. A promptly delivered step must contribute its full displacement from the first frame at or after its event timestamp through the first frame strictly after its delivery: the scrolling thread can expose it before the JavaScript event arrives or after the containing frame's timestamp. The report counts late steps per run;
  - iOS Simulator with MobileSafari, one iOS 26 runtime and one iOS 27 runtime, flings synthesized by XCUITest or idb, a page-side per-frame recorder. This machine holds only the iOS 26.0 runtime; the iOS 27 runtime is installed for the stand.

  Scenarios: open at the tail; fling up through unmeasured history and through a page landing mid-fling; read while streaming; select from the rail during a fling; jump to latest; expand and collapse rows above, at and below the anchor; change the width; open the keyboard.
- *Budgets*, from DOM rects of text sentinels, independent of the owner's geometry; a comparison against a scroll offset or a gesture tolerates one device pixel instead of 0.5 px where the engine snaps scroll offsets to device pixels (Chromium):
  - what the reader sees moves only with the reader, judged on text sentinels visible in both frames of a pair (a correction may legitimately rebase `scrollTop` by an inserted height while the screen stays still, and growth below moves only off-screen rows):
    - with no reader input and no momentum, the anchor stays within 0.5 px on screen with no cumulative drift — the top visible row when paused, the last row's bottom when following the tail, the pressed control across a disclosure — and every other visible sentinel moves by exactly the summed DOM height change of the rows between it and the anchor, ±0.5 px;
    - while visible, a row changes height only when it is the growing live row, the disclosure the reader pressed, or a row inserted or removed; any other visible row's size change fails, attributed by cause from the DOM alone (body re-rendered with the same source, reference text rewritten, image loaded) — a body that lands after its first paint is a failure, not an exemption;
    - while the reader moves and nothing changes structurally, every visible sentinel moves by minus the browser's scroll delta, ±0.5 px;
    - while the reader moves and a structural change lands in the same frame, all visible sentinels outside the changed rows move by one common delta: under a finger the reference is the synthesized gesture, whose path and speed the scenario knows (touch events reach the page coalesced and not frame-aligned while the compositor scrolls) — over a drag with no fling a visible sentinel's total screen displacement equals the gesture's distance ±0.5 px, frames with no structural change are judged by rigidity alone (the feed writes nothing in them; their pace is the gesture synthesizer's, which exceeds its nominal speed by several pixels in single frames), and a structural frame's displacement does not exceed the largest per-millisecond displacement of the same drag's non-structural frames times its own interval, plus one device pixel; on iOS the drag ends at rest (no movement after release); in momentum its change from the previous frame is no larger than the largest frame-to-frame change seen in control flings at the same speed;
  - 0 px of unmounted area enters the viewport;
  - an iOS fling through unmeasured history and a page landing is unobstructed: after release the offset moves monotonically with no frame where its speed falls to zero or reverses above the end-of-fling speed, and its distance divided by the measured release velocity stays within the spread of the same ratio over at least five control flings, each through a region measured beforehand and observed to see no row size change and no mount of an unmeasured row (synthetic idb swipes with identical arguments vary in release velocity — 866 px and 991 px after release in two runs — so raw distance is no measure);
  - in continuous motion — a fling, a drag, a glide, streaming growth — the feed's main-thread work per frame stays within 8.3 ms without throttling (a 120 Hz display on a current machine) and within 16.7 ms at 4× throttling (a weak machine on a 60 Hz display) in Chromium, measured in a quiet window and reported as script, layout and paint; a discrete navigation (a far rail jump, opening a thread) must mount a viewport of rows in one frame, so it is judged by its response instead — the first final paint within 50 ms unthrottled and 100 ms at 4× — and the motion that follows it by the per-frame budget;
  - the gold tile read from DOM rects matches in every sampled frame.
- The stand first runs on HEAD; its baseline numbers are added here. It launches browsers and a simulator, so it runs only on the operator's word written into its task.
- Unproven by this proof: a physical ProMotion iPhone and Android hardware.

**Parts and order.**
1. Rail correction, task 80b5f328.
2. The stand, its lanes, corpus, recorder and budgets; the HEAD baseline.
3. The single owner on 3.19.8: upgrade through the package manager; delete `applyPrepend` and its hold/track/release calls, `reanchorEnd`, `pinResizedRows`, the `scrollToFn` suppression and `chasing`, the gesture-window authorship and `FollowingViewport`'s writes; follow through `anchorTo: 'end'` and `followOnAppend`; commands through the library; the contracts above. Gated by the stand.
4. Sizes: per-kind estimates, the memory key, the late-body frame.
5. Phone: composer drags, overscroll containment, the viewport change, the mask decision.
6. The other measured-height lists — `ExplorerView`, `ToolDiff`, the speech call transcript, `ColumnWindow` — onto the same owner, after 3; `scroll-follow` retires with the speech transcript's move.

**If the library fails.** An own engine then meets the same contracts with: row sizes in `ChunkedList` extended with per-chunk size sums (splice, offset→index and index→offset without touching the untouched tail); absolutely positioned rows, whose starts above the anchor are held like #1319 rather than translated; reads in the `ResizeObserver` callback, then spacer and size writes, then the scroll write, all imperative — never through an async Svelte batch, which may defer its DOM commit; new rows mounted outside the observer callback. It gets its own `#module` card, and [[8b7128c3]] retires.

**Rejected.**
- *A `translateY` buffer for held corrections:* it puts the top of the thread above the scroll origin — a false top that ends the fling mid-history — leaves a blank band at the bottom, makes every row the containing block of its fixed descendants, and repaints all mounted rows when the layer comes and goes.
- *An own engine before measurement:* the library's current core already implements the hold and the iOS behaviour this spec needs, measured on devices; replacing it is justified only by a failure it cannot fix.
- *Rendering every row with `content-visibility: auto`:* threads reach thousands of heavy rows (markdown, highlighted code, widgets); mounting them all costs memory and mount time on weak machines.
- *A bottom-origin scroller (`column-reverse`):* it makes prepends free but moves the reader whenever the tail grows while they read history — the main activity during a run.

**Out of scope.** The rail on narrow feeds (it shows from a 56 rem feed width; whether that hiding meets [[e7449703]] is a separate question); a whole-thread rail ([[5620c714]]); the thread-view refactoring of [[b7bb8a8f]], whose contracts this work keeps.
