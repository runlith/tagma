---
id: 01a0c86e-dba5-7c20-970d-0eaffe3badc4
title: "The shared door-laws suite cannot see the one state where the double and the door disagree: every overlay it declares is unarbitrated"
ord: 30
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0c83d-a948-705b-9759-5feb6cb7053e
sources:
  - kind: file
    ref: packages/primitives/src/door-laws.test.ts
  - kind: symbol
    ref: packages/primitives/src/overlay-policy.ts
    symbol: specOf
  - kind: symbol
    ref: packages/primitives/src/testing.ts
    symbol: makeOverlay
---
`door-laws.test.ts` exists because the published double once drifted from the real door — a plain map where the door had a signal — and every opener test stayed green while the product looped. Its answer is to run both doors through one suite of cases, so a law the double cannot honour fails there rather than in an e2e three layers up. That is the right shape, and it has a hole in exactly the place it was built to cover.

The suite declares its two overlays as `Overlay.define()('door-laws/first', { as: 'snackbar' })` and presents them with `First.present(View)` — a view and no policy. `specOf` marks a request with no policy `arbitrated: false`, and the queue raises an unarbitrated request the moment its chunk is ready, without a pass. So no case in the suite ever leaves a request `queued`.

That is the one state where the two doors disagree, and they disagree on two verbs of the five, not all of them. The stub answers `anyOf` from `live.has`, true from the instant `open` returns, and its `stateOf` knows only `active`. The real door answers `anyOf` through `queue.showing`, false while a request is `queued`, and its `stateOf` answers the word `queued`. `isOpen` is not a divergence: the real door reads it as `stateOf(id) !== undefined`, so it counts a waiting request open exactly as the stub does. So for an arbitrated overlay waiting its turn — behind a blocker, a cooldown, or an occupant that will not share — a suite using the double sees an overlay that is up and showing, and production sees one that is up and not showing. That is the raised-versus-shown distinction the doubles are documented to preserve, and it is the distinction a mark, a latch and a cooldown all rest on.

The divergence is recorded as a claim under the testing door. What is missing is the guard: add a case to the shared suite that declares an overlay WITH a policy and puts it in a state where it must wait — a blocker fact held up, or a second overlay it cannot coexist with already on screen — and assert `isOpen`, `anyOf` and `stateOf` across both doors there. The suite's `doors` table already parameterises everything else; the real door needs a `Profile`-style fact to move, which `test-utils/profile.svelte.ts` already provides.

Expect the case to fail against the double when first written. That is the point, and the decision then is whether the stub should model `queued` — `presentOnOpen` already distinguishes raised from shown for `presented`, so the same seam could carry it — or whether the stub should refuse arbitrated keys outright rather than answer for them wrongly.
