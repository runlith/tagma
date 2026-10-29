---
id: 01a0c6cf-2598-7080-b939-60f5a014cd4c
title: "Cover the Tagma product with zones: cutter, builder and reviewer over the 35 modules its manifests reach, leaves first"
ord: 200
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: .agents
  - kind: file
    ref: apps/tagma/app/package.json
  - kind: file
    ref: apps/tagma/desktop/package.json
  - kind: file
    ref: apps/tagma/server/package.json
---
Every directory of the Tagma product gets an owner in the graph — a module or an area with claims written from the code, verified, reviewed and committed — so that a reader entering through any file of it reaches what it is and why the product has it, and a change to it is measured. The product is `apps/tagma` (server, app, desktop) and the workspace packages it reaches through its manifests: 35 modules in all, measured on 2026-09-22 from `package.json` dependencies. Sizes are tracked non-test lines (`git ls-files`), never a directory walk: `executions` measured 36k by walk and 9.7k tracked, the rest being ignored `.tscheck` output. The Git kit [[adeeb4ba]] is the one already built and the reference shape for the rest.

**Scope.** In: `apps/tagma/server`, `apps/tagma/app`, `apps/tagma/desktop` and the packages they reach — `agent`, `agent-sources`, `agent-tools`, `chat-ui`, `desktop-host`, `dev-runner`, `error-boundary`, `executions`, `files`, `floating-frame`, `git`, `layer`, `llm`, `markdown`, `markdown-editor`, `mcp`, `ndjson-rpc`, `package-boundary`, `performance`, `primitives`, `query`, `ripgrep`, `scroll-follow`, `seam`, `source-comments`, `sqlite-process`, `testing`, `trace`, `trace-bundle`, `tsconfig`, `utils`, `window-behavior`. Out, for a decision of their own: the twenty packages no Tagma manifest reaches (`execution-host`, the audio, transcription and tts families, `agent-zod`, `desktop-input`, `i18n`, `visual-identity-node`) and `audio-transcription-playground`. The five areas that hang at the project root today — [[8ec9c71c]], [[e0ee2866]], [[3bf662bf]], [[8faf533f]], [[a3ff58c6]] — move under their modules when those are cut, revised rather than recreated.

**Who does what.** Three roles, each an agent definition in `.agents/` of this checkout, each run on the model the bench measured for it, overridable at launch:
- `zone-cutter` (Opus 5 xhigh) draws the shape: one package or app part per run, from its boundaries — manifest, boundary law, measured imports, exported surface — into module, areas, `depends-on` edges and boundary claims; opens one `#task` per area under this decision; may spawn `code` diggers on DeepSeek for surface maps of large directories. One head per tree.
- `zone-builder` (Muse Spark 1.3 max, or DeepSeek 4.1 Flash max when the Muse subscription window is spent — the two measured within one defect of each other under the full brief, Muse the tighter writer, DeepSeek the cheaper by any price) fills one area per run with claims written from the code, applied to the graph and verified; for a package under about three thousand lines it writes the module too, and no cutter runs.
- `zone-reviewer` (DeepSeek 4.1 Flash max) reads one zone per run against its code and reports verdicts and omissions; for a zone the product turns on — the graph, the agent kernel, the harness — the same definition runs on Opus 5 xhigh, whose reading goes one file below the zone.
- The head thread cuts what it chooses to cut itself, judges every review, repairs at the owner, runs the doctor and commits. Nothing is merged on a builder's word.

**Order.** Waves follow the measured dependency depth, leaves first, because a module's `depends-on` edge can only point at a module that exists: wave 0 the leaf packages (`utils`, `files`, `trace`, `executions`, `layer`, `sqlite-process`, `ndjson-rpc`, `package-boundary`, `source-comments`, `ripgrep`, `testing`, `tsconfig`, `error-boundary`, `markdown`, `markdown-editor`, `scroll-follow`, `window-behavior`), of which `executions` and `layer` are cut first and the rest go to a builder alone; wave 1 `llm`, `performance`, `primitives`, `query`, `trace-bundle`, `seam`, `floating-frame`, `desktop-host`, `dev-runner`; wave 2 `agent`; wave 3 `agent-sources`, `chat-ui`, `mcp`; wave 4 `agent-tools`; wave 5 the server; wave 6 the app and the desktop. Inside a wave the packages are independent and run in parallel; `ready_tasks` names what may be taken, and the head hands out from that answer, not from memory. The server is cut with its own `boundary.direction.ts` as the authors' cut, read first. A `depends-on` edge follows the imports of the sources a package ships; a workspace package reached from its tests alone is a devDependency and no edge, so `layer` and `executions` stand as leaves although their suites import `testing` and `package-boundary`.

**A zone is accepted when** the reviewer's verdicts leave no FALSE, OVERBROAD or UNSUPPORTED unresolved and every omission it names is written or declined with a reason; every container is qualified where an act beneath it differs and the exception is its own claim; every claim is verified after a reading of its sources and every symbol anchor resolves; the doctor over the zone's paths stands clean; the prose comments under the zone's directories are stripped with `strip_comments` and `comments-standing` clears — the graph replaces them, so they leave only after the zone that carries their reasons is accepted, never before a builder has read them; and the graph is synced. `writing.comments` stands at `forbid` for the whole cover, so no change adds prose the graph would have to replace again. A zone that fails review goes back to its builder with the review, once; a second failure is the head's to repair.

**Why this shape and not another.** One agent reading a package whole was rejected for anything above a few thousand lines: the cut is read from boundaries, which are small, and the claims from the code, which is large, and the two readings need different heads — three of nine builders drew a fifth area over code they did not own when nobody had cut first. Opus as the bulk builder was rejected: under the full brief it was first by a margin that did not justify thirty-five times the price of a draft that a reviewer repairs; Sonnet as the standing reviewer was rejected for the same reason — the same findings as DeepSeek at sixty times the price. The measurements are [[343ac205]], [[f8bcc2ba]], [[7df9bc43]], [[e7e1c034]] and [[32ddf58b]].

**What is not settled.** The reviewer's two shared blind spots — a totality word over the nested case, a body resting on a comment — are answered by explicit checks in its brief, and that brief has not been measured since. Opus as a reviewer was measured once; Muse as a reviewer flags true sentences and is not used for review. A package's boundary that its manifest and its imports disagree on is the cutter's finding, filed under the package, not resolved by this decision. Divergences met while building are recorded as deltas of this decision by the task that met them, never by rewriting this text.
