---
id: 01a15b94-3ab3-7f8e-9055-304a96d77b04
title: "Codex: image generation — the image_gen.imagegen function the client executes with a POST to the ChatGPT backend's /images/generations with gpt-image-2 (main 6fb1c39, read 2026-10-20)"
ord: 1
tags: ["research"]
fields:
  {
    "source": {
      "name": "openai/codex, codex-rs",
      "ref": "github.com/openai/codex main 6fb1c3903d42 (2026-10-20, ≈ rust-v0.164.0-alpha.8), .external/codex clone"
    }
  }
---
How Codex generates images — from the model tool to file and display. Static reading of `codex-rs` on main `6fb1c3903d42` (2026-10-20, ≈ rust-v0.164.0-alpha.8); no builds and no live requests to the backend. Paths relative to `codex-rs/`.

## Observations

**Model tool.** Generation is an `ext/image-generation` extension Codex executes itself. The model sees the `image_gen.imagegen` function in the namespace (`ext/image-generation/src/tool.rs:680–710`, description in `imagegen_description.md`): `prompt`, `transparent_background`, `referenced_image_paths` (up to 5 absolute paths) or `num_last_images_to_include` (1–5 recent conversation pictures), but not both. The description orders generating without asking again and warns the call takes minutes.

**When the tool exists** (`core/src/tools/spec_plan.rs:782–817`):
- the `image_generation` feature is stable, on by default; the old `imagegenext` name stays an alias;
- the plan is not Free;
- `provider.capabilities().image_generation` is true by default, false on Amazon Bedrock;
- the chat model's input modalities include an image — so the model sees the result;
- entry is through the Codex backend (ChatGPT) or actor authorization. Under an API key the tool is not registered, though the HTTP client can do `https://api.openai.com/v1/images/...`: `extension.rs:41–46` skips it, `spec_plan.rs:1639–1642` removes it.

**Wire.** A plain JSON POST — no SSE and no multipart (`codex-api/src/endpoint/images.rs:62–105`, `codex-api/src/images.rs`):
- URL on ChatGPT entry — `https://chatgpt.com/backend-api/codex/images/generations` or `/images/edits` (`model-provider-info/src/lib.rs:426–445`, `codex-client/src/provider.rs:55–76`);
- headers: `Authorization: Bearer <access_token>`, `ChatGPT-Account-ID`, `version`, `originator` and the thread's `User-Agent` (default `codex_cli_rs`), `x-codex-image-turn-id` with the turn id (not the call), optional `x-codex-turn-metadata`, `Content-Type: application/json`. No Responses session headers (`ext/image-generation/src/backend.rs:135–154`, `codex-api/src/endpoint/session.rs:48–108`);
- generation body — `{"prompt","background":"opaque"|"transparent","model":"gpt-image-2","quality":"auto","size":"auto"}`, no `n`. Edit is the same fields plus `images: [{"image_url":"data:…"} | {"file_id":"…"}]`. Local files are read uncompressed and leave as data URLs (`tool.rs:484–563, 638–671`);
- answer — `{created, data:[{b64_json, generation_id?}], background, quality, size, usage}`, the first picture taken; `x-codex-imagegen-request-id` kept for diagnostics;
- no HTTP timeout on the request. Up to 4 retries on 5xx and network failures, no retry on 429 and 401; delay 200 ms exponential or by `Retry-After` (`model-provider-info/src/lib.rs:68,454–459`, `codex-client/src/retry.rs`).

**Quota.** Pictures have their own `image_gen` limit. Exhaustion is HTTP 429 with `error.type: usage_limit_reached`, `x-codex-active-limit: image_gen` and `x-image-gen-{primary,secondary}-{used-percent,window-minutes,reset-at}` (`codex-api/src/api_bridge.rs:185–222`, `rate_limits.rs:57–101`). This shape is fixed by the mock test `app-server/tests/suite/v2/imagegen_extension.rs:682–705`, not a recorded real answer. The model gets the error text, the interface a `failure {usageLimitExceeded, limitId, resetsAt}` (`tool.rs:320–345`). A successful answer publishes no quota.

**Result.**
- **File.** `$CODEX_HOME/generated_images/<thread>/<call>.png` (`artifact.rs`; the root is set by app-server in `app-server/src/extensions.rs:112`). Without that root — `<cwd>/generated_images/` through the environment filesystem, refusing on a symlink and on an existing file (`tool.rs:347–465`).
- **Model.** `function_call_output` with `input_image` (data URL, detail high) and text: the picture is saved at such-and-such path, copy it rather than move, the user already sees it, no need to repeat it in the answer (`artifact.rs:38–46`, `tool.rs:744–763`).
- **Interface.** The app-server `imageGeneration` element (`app-server-protocol/src/protocol/v2/item.rs:417`): `status` in_progress → completed | failed, `revisedPrompt` (equals `prompt`), `result` base64 or `fileId`, `savedPath`, `inputImages` (path and sha256), `failure`. A plain TUI cell draws prompt, status and path. The full-screen transcript draws the picture by `savedPath` in Kitty- or Sixel-capable terminals (`tui/src/transcript/layout.rs:221–226`).
- **Storage.** The attachment store in the open code is an `InlineAttachmentStore`: bytes stay in the process, no network fetch (`app-server/src/message_processor.rs:374`, `attachment-store/src/lib.rs:169–190`). The rollout keeps the picture as bytes (`rollout/src/policy.rs`); compaction does not promise to keep it in the model context.

**Hosted tool Responses.** `{"type":"image_generation"}` is not built in the code; tests assert its absence (`core/tests/suite/responses_lite.rs:396,674,713`). `ResponseItem::ImageGenerationCall` is only accepted from old histories. The clone is shallow, and the extension already stands at the history edge (2026-08-16), so when and why Codex changed path is invisible.

## Conclusions

- Generation in Codex is not tied to the chat model: it is a separate HTTP call to a separate model (`gpt-image-2`) on the same account. The chat model only decides when to call and looks at the result.
- The vision gate exists to show the result to the model, not for generation itself.
- "Last N conversation pictures" makes up for the lack of stable file-less picture references; the code itself calls this path best-effort (`tool.rs:538–540`).

## Not established

- What a real 429 of an exhausted picture limit looks like: the shape is known only from Codex's mock test.
- Numeric limits by plan.
- When and why Codex stopped sending the hosted tool.
