# The native iOS lane

MobileSafari in an iOS Simulator clone: input through idb HID, page reads through Web Inspector and a page channel. It needs macOS on arm64, Xcode with an installed iOS runtime, and `python3.11` on `PATH`. Its code is `packages/e2e/src/lanes`.

## Preparing the machine

- Run `bun packages/e2e/scripts/fetch-ios.ts` once per machine, and again after a runtime, Xcode or tool pin changes. It installs the pinned idb companion and client (SHA-256 verified, in a private Python environment) into `E2E_IOS_BUILDS` (default `~/.cache/runlith/ios-builds`), then prepares one onboarded Safari template per runtime in `E2E_IOS_RUNTIMES` (comma-separated, default `26`) for `E2E_IOS_DEVICE_TYPE` (default iPhone 17 Pro).
- A runtime is named by identifier, exact version or major version; the newest installed match wins. A missing one fails with "install an iOS <n> runtime in Xcode".
- A template is keyed by its identity: a layout number (bumped when onboarding changes), runtime identifier and build, CoreSimulator version, device type, and the pinned companion, client and Python versions. A run reuses the shut-down template of its identity. Building one boots, onboards Safari and shuts down for minutes, close to the 3-minute hang guard: prepare ahead, never in a run's first hook.
- Building a template sweeps the ones it supersedes: same runtime and device type, other tool or CoreSimulator versions, a runtime build no longer installed, or a missing or unreadable record (a half-built template). Templates of other runtimes and device types stay.
- Each test clones the template into its run's private device set, boots the clone and deletes it with its scope; a later run retires the sets of runs whose root is gone or which testbed answers dead, and fails when testbed cannot tell. Never delete devices or sets under the build cache by hand.

## One Simulator run at a time

Registering a selected `ios` test takes the machine-wide lane lock (`simulators/lane.lock` in the build cache) until that file's tests end. Another process waits in a synchronous loop that blocks its worker's JavaScript: it is waiting, not hung, and its `waiting for the machine-wide Simulator lane lock` line may appear only once the lock is taken. A blocked worker keeps its budget units, so keep iOS scenarios in few files and run them with `--parallel=1`. Runtimes of one test run one after the other.

## Registering and the session

`ios(name, async (phone) => …, { runtimes, deviceType })` from `@runlith/e2e/ios` registers `name [ios-<runtime>]` per runtime; `ios.effect` takes a scoped Effect body; `iosSession(options)` opens a session in an Effect scope. It runs when `E2E_LANES` is unset or names `ios`, and `E2E_IOS_RUNTIMES` filters `runtimes`.

- `open(url)`: the first call launches MobileSafari and attaches Web Inspector. A URL differing only in its hash waits for `hashchange`; any other waits for the load event and checks the landed URL. A relative URL resolves against the current page. Serve pages on `127.0.0.1`: the Simulator reaches host loopback.
- `evaluate(expression, schema)` runs the expression in the page, awaits a promise it returns, and decodes the value with `schema`. It travels over a page WebSocket channel to the host because Web Inspector answers nothing while a native pan runs; never read the page through Web Inspector during a gesture.
- Only JSON data transfers. NaN, Infinity, `-0`, cycles, accessors, class instances and DOM nodes, symbol keys, array holes and array properties fail with `UntransferableValue`; an `undefined` property is dropped. A throw fails with `IOSUnavailable`. Return plain records.
- `recording(selector)` starts a page-side recorder on a scroller and answers `{ result }`. `result` resolves after a trusted release or cancel and 45 still frames, with frames, touches, scroll events and the release velocity taken from the first momentum frames. Start it before the gesture; await `result` after.
- `screenshot(path)`, `udid`, `deviceSet`, `runtime` and `timing` (clone and boot milliseconds) describe the device.
- A page `Error` or unhandled `Error` rejection fails the test as `PageFailed`; the body's end flushes reports still in flight. A failure writes the screenshot, the console, the idb driver log and the last page recording.

## Input

Two coordinate spaces: `touch` takes CSS layout-viewport points, as in Chromium; `tap(point)` and `swipe({ from, to, duration, delta })` take Simulator display points. Convert DOM geometry with `pagePoint`, or input lands under Safari's chrome. `tap` and `swipe` are atomic idb gestures; `swipe` lifts at speed, so it flings.

`touch.press`, `move` and `release` (`src/touch.ts`) hold one finger across page-side waits. Calls are ordered, a second press fails, and the session scope releases a finger left down. The iOS adapter (`lanes/hid.ts`, `lanes/hid.py`) keeps one HID stream open from press to release:
- The CSS-to-display mapping is a native accessibility read, resolved once at press and kept until release. A read per move left the finger still long enough for iOS to start long-press text selection, and the drag never panned.
- Move soon after press: a finger held still after press past the long-press window starts text selection, and repeating its position does not count as movement.
- A move is sampled at 120 Hz in steps under 5 points and eased to zero speed at its end; a resting finger repeats its position, as a resting digitizer does. A lift at speed flings, and the ease is what lets a held drag lift without momentum: use `swipe` for a fling.
- A move resolves when its samples are written to idb, not when the page saw them. Before the next step, wait in the page for the fact you need: a `touchmove` count, a pressed or released promise, a new scroll offset.

## Momentum in MobileSafari

A test that judges a fling respects:
- Where the scroller has no `onscrollend` — the stand's recorder tests for it — the end of a reader's or momentum's movement is a settle point the test chooses: the next input, a recording's start or stop.
- `requestAnimationFrame` samples momentum out of phase with its scroll updates: a frame can repeat the previous offset, or a stall can be followed by catch-up frames a few milliseconds apart, while momentum runs. Measure pace over two frames, and count a stop only where the previous pace over the window beyond the median frame interval reaches the missed-pixel threshold (`packages/chat-ui/stand/momentum.fixture.ts`, reference `stands`).
- On iOS 26 a page write that changes `scrollTop` stops the fling, and a write of the same value does not (research ebb8737b). Count only writes whose read-back differs from the offset before them as stopping writes; a component that must keep momentum holds its correction rather than writing it.
- Swipes with identical arguments release at different velocities: judge a fling's distance by its ratio to the release velocity, never by raw distance.

## Changing the lane

`src/lanes/ios.e2e.ts` is the lane's conformance: navigation, transfer refusals, a mapped tap, the held touch (`src/testing/touch.ts`, shared with Chromium's `src/touch.e2e.ts`), a native fling and a stopping write, the keyboard. `src/lanes/ios-contract.e2e.ts` runs a nested testbed to prove page errors fail a test. Run both after changing the lane.
