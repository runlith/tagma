---
id: 01a1844a-f044-78b6-bc37-d796364dab23
title: A fresh code project under the shipped place law alone reads as a table of contents (hono, GPT Terra)
ord: 5
tags: ["experiment"]
fields:
  {
    "status": "done",
    "verdict": "confirmed"
  }
edges:
  - kind: relates
    to: 01a18319-42dc-76d5-8f38-ae98aa192705
---
**Hypothesis.** An agent working in a fresh code project under nothing but the law Tagma ships — no rules, skills or catalogs of the user's own — leaves a graph that reads as a table of contents: parts appear once the root outgrows a screen, every block stands under the owner of what it is about, and no list holds more than 20 rows of one role.

**Setup.**
- Polygon: `honojs/hono` at `ed1d5f7` (2026-10-28), shallow clone at `/opt/workspaces/hono`; 21.4k lines of source and 45.6k of tests in `src/` — 27 middleware, 14 helpers, 9 adapters, 7 routers, jsx, client, validator, utils, core.
- Project `hono` (id 43), registered with `add_project` and default storage (stealth) and catalogs (core, software-development). `rules.global.enabled` and `skills.global.enabled` are false in it, so no rule or skill of the operator's machine reaches it.
- Tagma at `623e5c9425` with the place law (`parent-required`, the 20-row write answer, parts drawn in the start map).
- Agent: `tagma`, openai-oauth/gpt-6.1-terra xhigh, a fresh thread per task, tasks given one after another as a user would over a week, with no word about how to shape the graph.
- Tasks, verbatim, in order:
  1. "I just cloned hono and want to work on it with agents over the coming weeks. Study the codebase and document how it is built in this project's knowledge, so future sessions can find their way around quickly." When the agent proposed to cover only the core, it was told: "The whole codebase, every part of it — future sessions will work anywhere in it, not only in the core."
  2. "Bug: with the prettyJSON middleware, a request with `?pretty=false` still gets pretty-printed JSON. `false` (and `0`) should turn it off. Please fix it."
  3. "Our load balancer sends request IDs like `lb.4f2a:9c1e` in X-Request-Id, and the requestId middleware throws them away and generates new ones, so our logs no longer line up. I want to decide myself which incoming IDs are accepted. Please add that to the middleware."
  4. "We are going to build an app with about 300 routes on Cloudflare Workers, where every request may hit a cold start. Which of hono's routers should we use and why? Keep the answer where the next person asking will find it."
  Tasks 2–4 ran at once, each in its own thread.
  5. "appendTrailingSlash lets me skip some paths, but trimTrailingSlash doesn't, and I need to keep `/files/` style directory URLs untouched while trimming everything else. Please give trimTrailingSlash the same `skip` option."
  6. "When the timeout middleware fires, the client gets its 504 but the handler keeps running in the background, and on Workers we pay for that CPU and its fetches. I want handlers and the things they call to be able to notice the timeout and stop. Before anything is built, write down how it should work — I want to read and approve it first."
  7. "Read how Fastify generates and accepts request IDs (genReqId, requestIdHeader and related options) and compare it with our requestId middleware. Is there anything there worth taking over? I don't want code yet — just the findings, kept for later."
  Tasks 5–7 ran at once.
  8. "I read the spec for cancelling work when the timeout middleware fires, and I approve it as written. Build it."
  9. "One thing for the future: a middleware must never read environment variables or other globals for its configuration — everything it needs comes in through its options. Make sure every agent working here knows that from now on."
  10. "Commits in this repository follow Conventional Commits, with the middleware, helper, adapter or router name as the scope, like `fix(cors): ...`. Every agent working here should follow that from now on."
  Tasks 8–10 ran at once.
- The clone has no installed dependencies: corepack's pnpm 12.6.0 fails on this machine, so the project's own checks do not run. The agents fixed and tested with `bun test` but left their work uncommitted; the parent landed it under their authorship (`507a4ccd3c`, `46d01979e1`). Commits are outside the hypothesis.

**Measured at the end.** Root rows; whether parts exist; the share of sourced blocks standing under the owner `read_owners` answers for their sources; lists over 20 rows of one role; `parent-required` refusals and whether the agent recovered alone; container title length.

**Observation.**

After task 1 ([[01a1844b-0d6a-7a8c-9364-978a26a19866|hono-1]], with four sub-agents): the root holds the shipped Tags container and four parts it made itself — HTTP framework, Application features, Runtime integrations, Building and testing Hono; all 22 module cards stand in them, three test and benchmark modules first born at the root moved into Building and testing within the same work; explanations stand under modules; the longest list is 9 rows. All 27 middlewares are one module card. The agent first narrowed the request to the core and asked.

Tasks 2 and 3, small fixes in one middleware each, wrote no block, which the law allows. Task 4 saved its answer as a note under the router module [[71b4c28c]], not at the root.

Tasks 8–10: the spec was found without its name, built (`3c3253f6f5`) and closed, its explanation updated; the module rule [[c6e1e248]] stands under the middleware module, the project rule [[177e9638]] at the root. The rule thread first left recording the rule to its parent agent, reading a parent's instruction as not the operator's — an artifact of giving tasks from a parent agent rather than as the user.

Measured after task 10 (108 blocks): the root holds Tags, the four parts and the project rule; 60 of 63 sourced non-module blocks stand under the module whose directory holds their sources, and the other three are defensible — root config files under the build module, a docs note under its part, a router-interface explanation (`src/router.ts`) under the routers rather than the core; the longest list is 9 rows, so the 20-row write answer was never reached.

Task 5 wrote no block. Task 6 wrote the spec [[18c1b7bf]] under the middleware module with a `relates` to the HTTP core module, though the change spans modules of two parts — a borderline reading of "the part when it spans the part". Task 7 put its reading [[ba1f9fa0]] and the idea discovered from it [[66178606]] under the middleware module that owns `requestId`.

Refusals over all 18 threads of the project: none was `parent-required` — every write named a parent. Ten writes were refused, each recovered by the agent alone on its next call: five `tag-undeclared` for a tag word written `#module`, `#explanation` or `#rule` (a Tagma defect, [[05de0731]]); four `operation-only` for a #module created through apply_batch instead of set_module; one `final-to-many`. Container titles run two to five words (parts: "HTTP framework", "Application features", "Runtime integrations", "Building and testing Hono").

**Conclusion.**

Confirmed for this run: under the shipped law alone, one model left a graph that reads as a table of contents — a root of Tags, four parts and one project rule, every module card in a part, 60 of 63 sourced blocks under the module owning their code and the rest defensibly placed, no list longer than 9 rows. Small fixes wrote nothing; an answer, a reading, an idea, a spec and a module rule each landed under the module they are about, and the project-wide rule at the root. The place law never had to refuse.

Not tested: the 20-row write answer never fired, because no list came near it; the "parts once the root outgrows a screen" step was not observed as a transition, because the agent made its parts while writing the first module cards; one model, one codebase, ten tasks. Tasks were relayed by a parent agent rather than typed by a user, which made one thread hand the rule back to its parent before recording it. One placement is borderline: the timeout spec spans the HTTP core and the middleware, two parts, and stands under the middleware module with a `relates` to the core.
