---
id: 01a15b94-3ab3-7f8e-9055-304b649d344f
title: "Image generation at Tagma providers and in other agents: OpenAI, Meta Muse, xAI, Google, ai-sdk, opencode and pi contracts (read 2026-10-20)"
ord: 2
tags: ["research"]
fields:
  {
    "source": {
      "name": "OpenAI, Meta Muse, xAI, Google, Anthropic and StepFun docs; opencode, ai-sdk, pi-mono, kilocode, qwen-code, cline and gemini-cli code and runlith adapters",
      "ref": "developers.openai.com, dev.meta.ai/docs, docs.x.ai, ai.google.dev, platform.claude.com — 2026-10-20; .external HEAD 2026-08-09…2026-10-14"
    }
  }
---
Which of Tagma's model providers and which other agent tools generate images, by which path and on which terms. Vendor documentation read 2026-10-20, code in `.external` (HEAD: opencode 2026-10-14, pi-mono 2026-08-09, ai-sdk 2026-08-15, qwen-code 2026-08-17, cline 2026-08-14, kilocode 2026-08-16, gemini-cli 2026-08-16) and in the runlith adapters. Codex is in the neighbouring reading.

## Providers

| Provider | Path | Model | Endpoint | Edit |
|---|---|---|---|---|
| `openai-oauth` | ChatGPT subscription | `gpt-image-2` | `chatgpt.com/backend-api/codex/images/*` (as in Codex) | yes |
| `openai` | key | `gpt-image-*` | `api.openai.com/v1/images/*` or Responses hosted tool | yes |
| `muse` | key, `api.meta.ai/v1` | `muse-image-1.0` | `/v1/images/generations`, `/edits`; in `/v1/responses` only the `image_generation` tool | yes, 1–10 inputs |
| `xai` | key, `api.x.ai/v1` | `grok-imagine-image`, `-2.0`, `-quality` | `/v1/images/generations`, `/edits` | yes, up to 5 inputs |
| `anthropic` | — | — | — | no generation |
| `kimi`, `deepseek`, `devin`, `opencode-go`, `openai-compatible` | — | — | — | no generation found |
| `stepfun` | Step Plan subscription | `step-2x-large`, `step-image-edit-2` | `/step_plan/v1/images/*` | withdrawn 2026-10-10 |
| Google — no provider | key | Nano Banana family | `generativelanguage.googleapis.com` | up to 14 references |

All synchronous from one request; Muse also has SSE via `stream:true`. The answer is base64, Muse and xAI optionally a time-limited URL.

**In Tagma now.** The model declares only input: `ModelCapability = 'text' | 'vision'` (`packages/llm/src/models/description.ts:10`). `grep -i image` over adapters finds only input pictures. `packages/llm/src/llm/protocols/openai/stream.ts:73` recognizes `image_generation_call` in an answer, but Tagma sends no requests with such a tool.

**OpenAI** ([image guide](https://developers.openai.com/api/docs/guides/image-generation)). Images API and Responses hosted tool, base64 answer, editing several inputs up to 50 MB, `partial_images` 0–3. The key needs Organization Verification. On a ChatGPT subscription generation spends Codex limits and is unavailable on Free ([Codex pricing](https://developers.openai.com/codex/pricing), on 2026-09-07). The official SIWC has no image generation among preview limits.

**Meta Muse.**
- In the `muse` adapter it goes by key to `https://api.meta.ai/v1` (`packages/adapter-muse/src/models/muse.ts:5,84–95`).
- Muse Image launched 2026-08-25 ([image-generation](https://dev.meta.ai/docs/image-generation), [models](https://dev.meta.ai/docs/models), [blog](https://developer.meta.ai/ai/resources/blog/build-with-muse-Image/)):
  - input: `prompt`, `n` 1–10, `size` only as aspect ratio, `output_format` webp (default), png or jpeg, `reasoning_strength`, `tool_enablement` (picture search, web, shell); edit — `images` 1–10;
  - output up to 1600 px;
  - $0.01 per picture, refusals unbilled ([pricing](https://dev.meta.ai/docs/pricing)).

**xAI.**
- API ([docs.x.ai](https://docs.x.ai/docs/guides/image-generation)): `n` up to 10, up to 5 input pictures, $0.02–0.05 per picture; edit bills input too.
- Only third parties write about the subscription:
  - pi-xai-oauth 1.7.2 (2026-10-13) sends the OAuth bearer straight to `/v1/images/*` "matching official Grok Build behavior" and spends separate Imagine allowances;
  - Hermes reports the backend "has been seen to reject standard SuperGrok subscribers with HTTP 403".
- Grok Build has `image_gen`, `image_edit`, `image_to_video` tools.

**Google.** Tagma has no Google provider; the `packages/llm/src/llm/protocols/gemini.ts` protocol uses only the OpenCode Go gateway, and pictures there are input only.
- Nano Banana ([image-generation](https://ai.google.dev/gemini-api/docs/image-generation)): 0.5K–4K resolutions, up to 14 references, $0.034–0.24 per picture, no free tier. Model ids and paths retold from the page — verify against code.
- Gemini CLI has no built-in generation: only MCP Imagen/Veo/Lyria and the nanobanana extension, which works by key.

**Others.** Anthropic per [Vision docs](https://platform.claude.com/docs/en/build-with-claude/vision) is an "image understanding model only"; Claude Code generates only through MCP and skills. Kimi, DeepSeek, OpenCode Go and Devin return text — inferred from documentation and search, not from a full API reference. StepFun withdrew its image models on 2026-10-10 with no replacement ([notice](https://platform.stepfun.com/docs/zh/guides/image-offline-notice)).

## Other agents

- **Agent tool:**
  - kilocode `generate_image` — OpenRouter `chat/completions` with `modalities:["image","text"]`; the file written by `path` with `write` permission;
  - qwen-code `image_gen` — DashScope, then PNG download by URL with limits and private-host protection; file in `.qwen/generated-images/<session>/`;
  - Cursor `GenerateImage` — since 2.4 (2026-01-22), preview in the feed and saving into `assets/`;
  - Grok Build;
  - pi through an xAI extension.
- **SDK only, no tool:** opencode, pi-mono, ai-sdk, cline.
- **None at all:** gemini-cli (except MCP), crush, aider, kimi-cli, goose, continue, Claude Code.

**"Image model" contracts.**
- **ai-sdk `ImageModelV4`** (`packages/provider/src/image-model/v4/`):
  - model: `{provider, modelId, maxImagesPerCall, doGenerate}`;
  - input: `prompt`, `n`, `size`, `aspectRatio`, `seed`, `files` (bytes or URL), `mask`, `providerOptions`, `abortSignal`;
  - output: `images` (base64 or bytes), `warnings` — an unsupported option gives a warning, not a refusal, `providerMetadata`, `usage`;
  - `generateImage` splits `n` by `maxImagesPerCall` and repeats twice.
- **opencode `packages/ai`:**
  - `ImageRequest {model, prompt, images?, mask?, n?, size?, aspectRatio?, seed?, format?, providerOptions}` — options typed per model, an unsupported one gives `UnsupportedOperation` before the network;
  - inline, stream and queued routes — submit-then-poll at fal, BFL, Replicate;
  - at Meta Muse a history repeat carries a signed `image_generation_call` handle instead of bytes, holding the edit state.
- **pi-mono `ImagesProvider`:** `generateImages(model, {input}) → {output, usage, stopReason}`, never throws; the account is a key or OAuth, as with chat providers.

## Conclusions

- Generation by key is given by OpenAI, xAI and Meta, and all three answer in OpenAI Images API shape — JSON with base64, edit through input pictures. Google answers differently.
- The shared contract of all samples is description and input pictures in, picture bytes and warnings or refusals out. They differ in how they handle an option the model lacks.

## Not established

- Lifetimes of signed URLs at Muse and xAI; the input picture size limit at Muse and xAI.
- What a picture costs inside the subscription limit at OpenAI.
- Exact OpenAI and Google model ids — from retold pages, not raw text.
