---
id: 01a1223e-2d13-7027-b088-ffe3cccbfb07
title: "Vendor web on native: Tagma-named tools from the generated fingerprint, one \"reads pages\" condition, decision by run model, vendor failure is a call refusal"
ord: 31
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/capabilities/web.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/tools/vendorWeb.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/turns/runWebs.ts
  - kind: file
    ref: packages/adapter-openai/src/profiles/codexWeb.ts
  - kind: file
    ref: packages/llm/src/llm/protocols/openai/wires.ts
  - kind: file
    ref: packages/llm/src/profiles/vendorWeb.ts
  - kind: file
    ref: packages/llm/src/profiles/webCache.ts
---
`websearch` and `webfetch` stay Tagma names everywhere: journal, feed, approvals, history, and the Claude stream on acp. A provider profile declares vendor web as a record under these names (`VendorWeb.tools`), and the vendor tool takes the place of the same-named Tagma tool. A Tagma tool the vendor did not declare leaves the catalog under vendor web. OpenAI is `websearch` only (the `web.run` Codex opens pages itself).

**Wire.** The vendor wire carries one declaration field `vendorWire` (name and, for OpenAI, namespace with description).
- `ClaudeCodeTools` renames by it to `WebSearch`/`WebFetch` and puts vendor tools first.
- OpenAI Responses lowering emits its namespace tool into `tools`. Stream parsing translates a `function_call` with a namespace back to the Tagma name using maps from that same request's tools; an undeclared pair stays `namespace.name` and travels the unknown-tool road, not a short-name match. A named `tool_choice` of a namespace function the wire cannot express (the server answers `unknown_parameter`), and lowering refuses before the request.
- A call in history repeats on the vendor wire only while the current request declares that tool; otherwise under the Tagma name. So the stream survives a change of web source, model, and provider between turns.

**Shapes come from the generated fingerprint.** Which models have vendor web is decided only by a shape's presence in the fingerprint; neither an id list in code nor a model capability duplicates it.
- For OpenAI the shape is `codexWeb.generated.ts`: the `web.run` declaration from the `webdirect` run (a Codex with a catalog without `tool_mode`, because in `code_mode_only` Codex hides `web.run` inside `exec`), models are the lite models from that run's `/models`. The server accepts a namespace in `tools` on a lite model — verified with a live request on gpt-5.6-sol; Codex itself puts it into `input`.

**One approval for all vendor tools.** The call itself never asks; the `reads-pages` condition asks, taking its level and timeout from the Tagma `webfetch` declaration. `prepare` raises it when the vendor `reads(input)` answers "yes". For `web.run`, only a call of search and reference commands answers "no"; any other command — `open`, `click`, `find`, `screenshot`, or an unknown key — is "yes", so a new Codex command asks until it is parsed. The call's subjects make Tagma tools from `targets(input)`: queries become `websearch`, addresses `webfetch`.

**`threadWeb` decides the source.** `RunWebs` holds the decision until the run settles (`releaseSettledRun`), together with the provider and model it was taken for. A step on another model decides anew, otherwise the old vendor's tools would stay on the new wire; an `agent.web` change takes effect from the next run. Decision inputs:
- the `agent.web` setting: `vendor` by default, set on user and project; settings have no thread scope;
- the road. A native thread has vendor web when the chosen model's profile provides it: model choice changes on the fly, so there is no snapshot for native. A hosted thread has it when the acp profile declares `web: vendor` and the agent holds the `web` capability. The Claude runner learns the value when the session opens (`read_hosted_agent`); `open_hosted_turn` confirms it on every turn.

**Failure is a call refusal, with no Tagma fallback.** OpenAI search goes through the `HttpExecutor` of the same route as the main turn: `chatgptIdentity` identity, on 401 the token recovers once and the request repeats.

**Accounting.** OpenAI search returns no usage, and `model-call` opens none.

**Not verified.** The OpenAI search conversation tail repeats the Codex rule (`ext/web-search/src/history.rs`) from source reading; no gate compares it byte for byte.
