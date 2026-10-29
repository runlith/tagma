---
id: 01a18353-4910-704e-8b7d-d7f17111dc21
title: End-to-end tests drive the real app in real engines — Chromium, WebKit, Electron, iOS Safari — against an in-process server, under testbed
ord: 25
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a1702a-d36c-7ded-95b9-0825c6569513
  - kind: relates
    to: 01a18327-c7aa-7718-b037-fece2ea21922
sources:
  - kind: dir
    ref: packages/testbed
  - kind: dir
    ref: packages/window-behavior/e2e
  - kind: file
    ref: apps/tagma/server/src/composition/testing/pageWorld.ts
  - kind: file
    ref: packages/code-editor/stand/editor.bench.ts
---
**Outcome.** Any agent writes an end-to-end test the same way: it drives the real app in a real engine — Chromium, WebKit, the Electron shell, iOS Safari — against a real Tagma server whose state the test seeded, and asserts what the user sees. The same stack carries measuring stands: a component in real engines, recorded frame by frame against budgets. It runs on a developer's Mac beside other agents and in CI, deterministically: seeded state, scripted agents, waits on facts.

**What stands now.** No product e2e exists. Two package-level islands use Playwright: `packages/window-behavior/e2e` (Playwright Test runner, Electron) and `packages/code-editor/stand/bench.ts` (a measuring bench over `playwright-core` and Chrome). The server's itests already serve the in-process runtime over real HTTP and WebSocket on a loopback port (`composition/testing/pageWorld.ts`), and CI already fetches a pinned Chrome for Testing for the managed browser (`apps/tagma/server/scripts/fetch-browser.ts`). Launching a browser is a live check that needs the operator's word ([[c6569513]]).

**Design.**

*One runner: testbed.* An e2e file is `*.e2e.ts`, a third kind beside unit and itest: it may open sockets, spawn processes and launch browsers. It runs under testbed and `bun test`, so it shares worlds, the machine's process budget, the guards, the hang guard and the run report with every other test; `test:e2e` runs the e2e files, and `test`, `test:integration` and `check:change` never select them. Browsers are driven through `playwright-core` as a library, not the Playwright Test runner.

*The server.* An e2e world is the door world — the full runtime in process — served over real HTTP and WebSocket on a loopback port with the built app, the way `pageWorld` serves it now. Its state is made through product operations — projects, threads, entries — never by writing stores; a turn's agent is a scripted model, never a live one. One world per worker; each test takes a fresh project as its tenant. The world never reaches the operator's server or data directory ([[8162ede6]]).

*The browsers.* One browser process per worker with its own temporary profile directory and the mock keychain ([[31cd14cf]]), and a fresh isolated context per test — an ephemeral storage partition, since a browser context has no profile directory of its own. Electron has one persistent context, so its app is relaunched per test. Lanes:
- **Chromium** — the pinned Chrome for Testing the managed browser already uses; CDP for traces, CPU throttling and synthesized touch flings;
- **WebKit** — Playwright's WebKit build, the desktop engine; it is not iOS Safari;
- **Electron** — the built desktop app through Playwright's Electron launch;
- **iOS Safari** — MobileSafari on the iOS Simulator with real gestures and page-side recording. No source shows one tool giving real momentum flings, page JavaScript and CI together: XCUITest velocity swipes and safaridriver's single-finger W3C touch are the candidates for flings, safaridriver (`safari:useSimulator`) or the Web Inspector protocol for page JavaScript; whether a synthetic swipe produces UIKit momentum is unconfirmed and is the lane's first measurement. GitHub's macOS images carry iOS 26.x runtimes only (macos-26 image of 2026-08-24: 26.2, 26.4, 26.5), so CI runs iOS 26 and the iOS 27 lane runs on a developer Mac.

A test names its lanes; the default is Chromium.

*Waits and failures.* Every wait ends on a fact — an element, a feed event, a server answer — with no deadline of its own; testbed's hang guard is the only bound. A failing test leaves its Playwright trace, a screenshot, the page console and the world's activity record in the run report.

*What an e2e test asserts.* A product outcome through the real door: a sent message appears and the reply streams, a refusal shows its words, a thread opens where the link said. Layout, copy and visual snapshots are not e2e assertions; a screenshot is a failure artifact only.

*Stands.* A stand mounts one surface on a stand page built by Vite over synthetic data, without a server, in the package it measures (`packages/chat-ui/stand`). Load-independent invariants — position drift, blank area, the current rail tile — are assertions in an `*.e2e.ts` file. Load-dependent budgets — frame time — are a quiet-window measuring command reported against a recorded baseline, never a pass/fail in a shared run.

*CI.* An `e2e` job on a macOS runner with the Chromium and WebKit lanes; an `e2e-ios` job with Xcode and the iOS Simulator runtimes; the Electron lane after the desktop build. Like the rest of the workflow, it runs on dispatch.

**Parts.**
1. The `e2e` kind in testbed, the `test:e2e` command, the browser fixtures and lanes, failure artifacts.
2. The e2e server world over `pageWorld`'s serving path with the built app, seeding helpers and the scripted model.
3. The first flow: open a thread, send, see the scripted reply stream, scroll the feed.
4. The feed stand of [[2ea21922]] on the stack, with its invariants and its quiet-window budget command.
5. The iOS Safari lane.
6. `window-behavior`'s e2e and the code-editor bench onto the stack.
7. The CI jobs.

**Rejected.**
- *Playwright Test as the runner:* a second runner with its own workers, budget and report beside testbed; it runs on Node, so it cannot build the Bun runtime in process and would need a separate server per worker.
- *A `tagma:try` instance per run:* a full install, execution host and bundle build per worker, slower and with state outside the test's reach; the in-process door world already serves real HTTP.
- *Cypress:* no WebKit or iOS Safari, runs inside the page.
- *Screenshot regression suites:* layout is not a test assertion here ([[4f387de2]]).

**Law.** A headless `*.e2e.ts` run under testbed is a test, not a live check ([[c6569513]], amended on the operator's word, 2026-10-28): an agent runs the e2e files it wrote or its change affected. The iOS lane and a headed browser stay live checks; the operator allowed them for this work, including installing an iOS 27 Simulator runtime.

**Acceptance.** `test:e2e` runs the first flow green on the Chromium and WebKit lanes on a developer Mac under testbed, in parallel with other test runs on the machine's process budget, leaving no process behind; a deliberately broken assertion leaves its trace, screenshot, console and activity record in the run report; the feed stand of [[2ea21922]] runs on the same fixtures; the iOS lane records a real fling on MobileSafari; `window-behavior`'s e2e and the code-editor bench run on the stack, and the Playwright Test runner leaves the workspace.
