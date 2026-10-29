# How a stand judges

A component stand mounts the real component over synthetic data in a Vite page and exposes a port on `window` that the test drives. The feed's stand, `packages/chat-ui/stand`, is the model: its port is `StandPort` (`port.ts`) on `window.feedStand`, and `act` and `call` (`standPage.ts`) send one serialized function per call, so the same scenario code drives Playwright and MobileSafari. The page records; the host judges the recording with pure functions whose unit tests stand beside them (`displacement.test.ts`, `causes.test.ts`, `momentum.test.ts`, `anchor.test.ts`, `trace.test.ts`).

## The recording oracle

The recorder (`recorder.ts`) samples every frame — the DOM rects of rows and text sentinels, the scroll offset, the touch state — and separates the reader's movement from the component's own.
- Judge the component's writes from its own-write log: the recorder wraps the scroller's `scrollTop` setter, `scrollTo` and `scrollBy` and logs each write's time, frame, offset before and read-back. An offset change alone never says who moved.
- Reader movement starts at any wheel or `keydown` on the scroller, a trusted `touchmove`, or a rail or jump-to-latest navigation. On an engine with `scrollend`, the first `scrollend` that does not answer an own write ends it. The first `scrollend` within one frame tick of an own write is that write's: Chromium fires one right after the feed's instant write while a touch fling still moves, and ending there would record the rest of the fling as the feed's own movement.
- Where no `scrollend` ends it — the scroller has no `onscrollend`, or the write swallowed it — a settle point does: the next reader input, a recording's start or stop, a navigation. Frames after the last offset change no own write caused are then marked still, except frames with the finger down. A discrete wheel run's `endWheel` and a landed navigation also end it.
- Capture touch on the contact target: after a trusted `touchstart` the recorder listens for `touchmove`, `touchend` and `touchcancel` on that event's target in the capture phase. A row unmounted under the finger keeps its touch's remaining events, the lift included; a listener on the scroller would never see the finger lift.

## Causal judgements, not statistical ranges

A judgement fails on a cause the recording shows, never on a value falling outside a spread that a noisy engine produced.
- Momentum stops (`momentum.fixture.ts`): a stopping write is an own write after release whose read-back differs from its offset before — a same-value write does not stop MobileSafari momentum (research ebb8737b) — made while the two-frame pace ending at it still shows at least 2 px beyond one frame cadence. A zero two-frame pace is an interruption only when the previous pace over the window beyond the median frame interval reaches 2 px, so a missed sample or a stall followed by catch-up frames is not a stop. Native controls must show no reversal and no interruption.
- The fling's distance-to-release-velocity ratio, measured up to the first changing own write, has only a one-sided floor: half the smallest ratio of at least five clean controls. A fling may legitimately carry further.
- WebKit wheels (`wheel.ts`): the WebKit lane judges `causal-late`, Chromium `full`. A wheel delivered more than one refresh interval (the median frame interval) after its timestamp is `wheel-late`; one stamped within a refresh interval after an own write is `wheel-after-write`, because WebKit can drop such a wheel (spec 2ea21922). Either may contribute anything from none to its full delta, and a frame covered only by a late wheel is left unjudged. Each fails when an own write lands between its delivery and the scroll event that answered it; a scroll event at an after-write wheel's write target is that write's acknowledgement, not the wheel's. A promptly delivered wheel must show its full displacement from the first frame at its timestamp through the first frame after its delivery.
- Size changes (`causes.ts`): a visible row changes height only as the growing live row, the disclosure the reader pressed, or under a width change; any other change fails with its cause read from the DOM.
- The one range is the momentum frame-to-frame change envelope (`controlEnvelope`), taken from at least five clean control flings over a warmed region. A control that changed a row's size, mounted an unmeasured row or left the region is discarded, never averaged in.

A long native group of scenarios records each scenario's red, reopens the page and fails once with all of them (`native.e2e.ts`), so one Simulator run shows every failure.

## Warmup

`port.warm(reach)` (`premeasure.ts`) starts reader movement with an untrusted wheel, then walks a region in half-viewport steps so every row in it is measured, refusing when a step cannot advance. At each step it waits until the mounted key set stayed the same, and every mounted row's measurement stayed stable, for two consecutive frames. A fixed frame count lets late-mounting or late-measuring rows through, and a control flung over them records size changes. Controls start at `warmed.start` and must stay inside `from` and `to`.

## Chromium touch contexts

tanstack virtual-core's `isIOSWebKit()` (`ios-gesture.ts`) is true for `iPhone`, `iPod` or `iPad` in the user agent, or for `navigator.platform === 'MacIntel'` with `maxTouchPoints > 0`. So in Chromium on a macOS host:
- the host context with `hasTouch: true` runs the feed's iOS branch;
- the same context with `navigator.platform` overridden to `Win32` in an init script runs the non-iOS branch; a scenario whose behaviour differs between branches runs in both (`win32Scenarios` in `feed.e2e.ts`);
- a native scrollbar-thumb case (`thumb-history`, Chromium only) takes a context without touch: a mouse-dragged native thumb exists only on a desktop without touch, and only that context puts the feed on its desktop branch.

Drive a touch fling with CDP `Input.synthesizeScrollGesture` (`gestureSourceType: 'touch'`), a held drag with `touch`; the Chromium lane runs at 4× CPU throttling.

## Timing

Frame time and per-frame work are measured only by a measuring program (`testbed e2e --program stand/frames.bench.ts`), run alone on a quiet machine. It records machine load before and after; compare only adjacent runs at similar load. Never time under load or beside another run, and never turn a timing into an e2e assertion.
