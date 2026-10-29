---
id: 01a15b94-3ab3-7f8e-9055-3049d8ecdc6e
title: "Image generation: an image model at the provider adapter and a generate_image operation for an agent on any model"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a1223e-2d13-7027-b088-ffe3cccbfb07
  - kind: relates
    to: 01a12c24-69a2-7f74-a6cf-a29052b10a62
  - kind: relates
    to: 01a14863-b077-72ab-b6a0-485a8e1fddab
  - kind: relates
    to: 01a15b94-3ab3-7f8e-9055-304a96d77b04
  - kind: relates
    to: 01a15b94-3ab3-7f8e-9055-304b649d344f
sources:
  - kind: file
    ref: packages/adapter-openai/src/profiles/openai.ts
  - kind: file
    ref: packages/llm/src/profiles/contract.ts
---
**What the user gets.**
- The operator asks the agent to draw or fix a picture — an icon, a diagram, an illustration, a screen mock. The picture appears large in the feed, the agent sees it and puts it into the project when needed.
- Any model draws. A thread on Claude, Kimi or GPT generates through the account of a provider that can draw pictures — first through the ChatGPT subscription. Hosted agents (Claude Code and others) get the same tool through Tagma MCP.
- Edit: the agent passes paths of pictures — attached by the operator, generated earlier, project files — and gets the changed one back.
- The picture opens full-size, copies, and saves to a file.
- The agent and the operator see an exhausted picture limit with its reset time; where the vendor reports this limit, its window stands beside the account quotas.

How it works in Codex is in [[96d77b04|the Codex reading]]; who else draws and what other agents' contracts are is in [[649d344f|the provider reading]].

**Concepts.**
- **Image model** — a second model kind a provider adapter declares beside text ones. The declaration says what the model can do — generation, edit and how many input pictures, transparent background — and how to call it. The kernel knows the concept but no vendors ([[6f758080]]).
- **Generation** — one image-model call: a description and optional input pictures in, pictures out. For the kernel the call is synchronous; a vendor answering with a polled task (fal, Replicate) is polled inside its own adapter.

**Layout.**
- **Contract in `@runlith/llm`** ([[249ce587]]).
  - Image models are declared in `ProviderDescription.imageModels` (what the model can do: how many input pictures and of which types, transparent background), the implementer is `ProviderRegistration.images` beside `profile` and `quota`.
  - Request — description, input pictures as bytes, background. Answer — pictures as bytes with type, the vendor's request id and answer headers; quota from the answer headers (and from the refusal) is read by `ImageProfile.quota`. A refusal is an `LLMError` with the vendor's words, and for an exhausted limit a `QuotaExceeded` with `resetsAt`. An option the model lacks is refused by the implementer before the network (`checkedImageRequest`).
  - A 429 with `usage_limit_reached` in the body is classed by the shared status parse as `QuotaExceeded` for any call, not `RateLimit`: such a refusal is retried by neither wire nor turn.
  - The OpenAI Images protocol — `POST …/images/generations` and `…/images/edits`, JSON with base64 — is one protocol module. On it: OpenAI by subscription and by key, xAI and Meta Muse.
  - The contract joins the adapter contract ([[52b10a62]], doors of `@runlith/tagma/adapter` — [[ea5c74f4]]): `defineAdapter`, contract tests and template ([[e0801f50]]) know image models.
- **OpenAI adapter** ([[c432f43a]]). `openai-oauth` declares `gpt-image-2` on `https://chatgpt.com/backend-api/codex/images/*`.
  - Identity is the same `chatgptIdentity` as the turn and the web ([[cccbfb07]]). Token recovery on 401 covers pictures with no extra work.
  - The body shape (fields after `model`: `quality`, `size`) is taken from the Codex 0.162 capture in `codexImages.generated.ts` by the `codex-images` command. The request carries Tagma identity, not Codex: `version`, `x-codex-image-turn-id` and the Codex cookie are not sent — the backend accepted a live request without them. Replay holds the body byte for byte, the header set with these differences, the `content-type` value and the declared `accept` difference (`application/json` vs Codex `*/*`).
  - The picture limit comes in the picture answer not as `x-image-gen-*` but as `x-codex-primary-*` with `x-codex-active-limit: imagegen_premium` (1440-minute window); `wham/usage` does not report it. So the picture answer's headers — of success and of refusal — are parsed by `ImageProfile.quota` into a window `bucket` tagged `images`, not by the provider's `quota.fromHeaders`: that would read them as a session window. `ImageModels` merges the window into the account quota (`AccountQuota.merge`), and it survives the turn's later observations.
  - A 429 `usage_limit_reached` is a refusal with the reset time from `error.resets_at` or `x-codex-primary-reset-at`, no retry.
- **Server `images` module** — new, product, above `threads` and accounts ([[f92da92b]]). It owns the `generate_image` operation with `tool` and `callers: 'thread'` — as `capture_page` does ([[54c5fcd2]]). The native agent gets it as a tool, the hosted agent through `tagma mcp serve` as an `image` picture ([[8e1fddab]]). The operation:
  1. Picks the image model (`ImageChoice`) by the `agent.images` setting (user and project, as `agent.web`): `auto`, `off` or `<provider>/<model>`. `auto` is the first image model among providers with an account, subscriptions before keys (`pickerOrder`). The account is that provider's default account. Model call, credentials and quota merge are `ImageModels` of the providers module, on the same model client as turns.
  2. Reads input pictures by path — absolute ones, and a relative path, as for every operation, resolves in the calling thread's scratch — and refuses before the network when there are more than the model declares or the format is foreign to it.
  3. Calls the model; cancelling the turn cancels the request.
  4. Keeps the vendor's raw answer in the thread's attachments folder without recompression (`Attachments.keep`) — it lives as attachments do ([[1f601161]]) — and answers with path, address, sizes and model, handing bytes in `media`. The copy for the model is made by `pictureKeeper`, as for any tool picture. A second file is the price of one path for tool pictures. Pictures named by the operation's own display are not replaced by the agent kernel's copy: the feed line shows the original.
- **When the tool is offered.** Only when an image model is picked: a new `images` fact in `AgentNeed`, read when the run context opens: the tool set changes with the next run, as the model menu does, and a call inside a run where the model disappeared answers with a refusal. The `images` capability joins the Tagma agent through `joins`. A hosted agent gets the tool through MCP always, and without a model the call answers with a refusal. A direct call with no model is a `no-image-model` refusal with two exits: sign into an account of a provider that draws, or pick a model in settings. The call has no own confirmation.
- **Tool description** follows Codex: draw at once, without asking again; edit by paths; transparent background when cut-out is asked. No image model is named in the description ([[c9e0c28]]). The answer tells the agent the original's path and that the operator already sees the picture.
- **Feed and client.**
  - A `generate_image` line shows the picture large — feed width with a height cap — together with the description. While the call runs, the line says the picture is being drawn.
  - Full-size viewing and copying already exist (`ImageViewer`, `ImageMenu`). The picture menu gains "Save picture…" — by one mechanism for all feed pictures ([[dd380bf6]]); the original is saved.
  - The `agent.images` setting is one field in the "Web and pictures" card beside `agent.web`: a choice from the `image-model` catalog the client builds from the provider catalog's `imageModels`.

**Decisions and rejected variants.**
- **Own Images endpoint call, not the hosted `image_generation` tool in Responses.** The hosted tool ties generation to OpenAI's chat model and the Responses protocol and puts bytes into the model output; SIWC has none of it. Codex no longer sends it and draws with a function over `/images/*`. An own call gives generation to an agent on any model and any provider with an Images API.
- **Provider declaration, not a text model's `ModelProfile`.** The vendor web is a Tagma tool variant for one model's conversation ([[cccbfb07]]). Generation needs no conversation, and its choice does not depend on the thread's model.
- **An operation, not only a native tool.** One implementation reaches the native agent, hosted agents through MCP, and later plugins and CLI — as `capture_page`.
- **No vision gate.** Codex hides the tool from models with no pictures on input so the model sees the result. Tagma hands such a model the picture in words (`picturesLeftOut`) and by path, so it can still draw.
- **Other harnesses' pictures are not collected** — the operator's decision. The terminal Codex `imageGeneration` and ACP pictures do not move into the feed.
- **Paths instead of "last N conversation pictures".** In Codex that makes up for pictures with no file. In Tagma every picture has a file: an attachment carries a path, generation answers with a path.

**Stages.**
1. **OpenAI subscription.** First step is capturing a real Codex request and a live request over our wire with the `openai-oauth` account. If the backend refuses our client, the stage stops and the operator decides. Then: contract, protocol, `openai-oauth` declaration, `images` module, setting, feed line, "Save", quota.
2. **API keys**, one declaration and live request per provider:
   - `openai` — `api.openai.com/v1/images/*`; the key needs Organization Verification;
   - `xai` — `grok-imagine-image*`;
   - `muse` — `muse-image-1.0` on `api.meta.ai/v1/images/*`.
3. **Google (Nano Banana)** — once a Google provider exists.

Later if needed: aspect ratio and size, several pictures per call.

**Acceptance.**
- A native thread on a non-OpenAI model with connected ChatGPT: the agent draws a picture on request, the feed line shows it large, and the file at the answer path is the vendor answer's raw bytes.
- Edit by the path of an operator-attached picture and by the path of a generated one returns the changed picture.
- A hosted Claude thread gets the tool through MCP and sees the picture.
- An exhausted limit is a refusal with reset time at the agent and in the feed, no retry.
- With no image model the tool is not offered to the thread; a direct call answers `no-image-model`.
- Cancelling the turn cancels the request.
- "Save picture…" saves any feed picture's original to the desktop and in the web client.
- A fake adapter with an image model passes the contract tests and draws in a thread with no kernel changes.
- Replay of the captured Codex request matches Tagma's request in headers and body.
