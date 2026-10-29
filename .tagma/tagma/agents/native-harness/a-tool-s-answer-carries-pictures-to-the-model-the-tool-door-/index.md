---
id: 01a0db91-a95d-7cbe-b90b-800107b62a24
title: "A tool's answer carries pictures to the model: the tool door keeps them by reference, and read, MCP and webfetch answer them"
ord: 56
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/resources/attachments.ts
  - kind: file
    ref: packages/agent-tools/src/read.ts
  - kind: file
    ref: packages/agent-tools/src/webfetch.ts
  - kind: file
    ref: packages/agent/src/agent/AgentToolDoor.ts
  - kind: file
    ref: packages/agent/src/agent/ModelRequests.ts
  - kind: file
    ref: packages/agent/src/thread/attachmentStorage.ts
  - kind: file
    ref: packages/agent/src/thread/compaction/measurement.ts
  - kind: file
    ref: packages/agent/src/thread/compaction/prune.ts
  - kind: file
    ref: packages/chat-ui/src/entries/ToolRow.svelte
  - kind: file
    ref: packages/mcp/src/mcpToolCatalog.ts
---
## 1 Outcome

A Tagma agent sees a picture a tool produced. `read` on a PNG, JPEG, GIF or WebP answers the picture to the model; an MCP tool's image content (Playwright's screenshot) and a fetched image reach the model the same way; the feed shows the picture on the tool's row. A thread whose model takes no images keeps working: every picture in its history reaches that model as a line naming what was left out and where it is stored.

## 2 Problem

On 2026-09-26 an agent reviewing UI screenshots against a mockup could not see them: `read` refuses images by extension ([[c54feff7]]), so the visual review went to a Claude Code harness, whose process lives only as long as the Tagma host — of three review passes, two died without answering across two host restarts. MCP names image parts by kind and drops their bytes ([[1836c85a]]), so a Playwright screenshot is invisible too; webfetch answers an image as its type and size ([[bd350355]]).

## 3 What holds now

- **The wire already carries pictures in tool results.** `ToolResultValue`'s `content` arm takes `file` parts, and all six adapters lower an image file part inside a tool result: Anthropic [[5848b154]], OpenAI Chat and Responses [[f87f2310]], Gemini [[5ba047e4]], Bedrock [[4346ece9]], Devin [[3f858392]]. A file part's `uri` must be a data URL or base64 when it is lowered ([[181ad18b]]).
- **Normalization and price exist** ([[0e5a78c1]]): `normalizeModelImage` fits a picture under 2000×2000 and 5 MB of base64, loading sharp at its first call; `modelImageTokens` prices a picture.
- **Operator pictures travel by reference.** A staged image is stored in the thread's attachment folder, its message holds the location, and hydration puts the bytes back at the wire ([[94f355cf]], [[b770bc01]]). Tagma's `ThreadAttachmentStore.hydrate` resolves `media` parts of user messages only.
- **The tool contract carries no pictures.** `ToolAnswer(value, display, completion?)`; the model projection is the tool's `toModelOutput` or text/JSON (`agentToolModelOutput`); the door's `project` bounds and retains an answer before it is stored, and bounding keeps non-text parts ([[a72809b0]]).
- **Pictures in a tool result are mispriced.** `agentToolOutputText` renders a file part as `[Attached <mime>]`, so pruning ([[09e16680]]) weighs an image result at a few tokens and never clears it for volume; `estimateThreadTokens` prices only `media` parts as pictures ([[28afae60]]), so a hydrated tool picture counts as its base64 text.
- **The catalog knows which models see.** Every row carries `capabilities`, `'vision'` among them; nothing on the request path reads it, so a history holding a picture is sent to a text-only row as it is.
- **The reader has no picture form** ([[ab02f96b]]); the chat already draws operator pictures through `AttachmentStrip` and `context.openImage`.

## 4 Target model

1. **The tool contract.** `ToolAnswer` takes an options object last — `{ completion?, media? }` — with `media: readonly ToolMedia[]` and `ToolMedia = { bytes: Uint8Array; mediaType: string; label?: string }`. A tool hands raw bytes; it decides nothing about size, storage or wording.
2. **The door owns every picture leaving a tool.** For each medium it normalizes through `normalizeModelImage` under `THREAD_ATTACHMENT_SOURCE_MAX_BYTES`; a rejection becomes a line of the answer's text naming the reason, never a failure of the call. It hands the normalized bytes to the thread's attachment port, which keeps them and answers the stored location. The model output becomes the `content` arm: the answer's text, one line per picture naming its label, its source size and the size sent — so the model knows a reduction happened — and one `file` part `{ uri: <stored location>, mime }` per picture. A stored message holds the location, never the bytes: no base64 enters a transcript entry, a rollout or a fork. A host with no attachment port (the promise API, test harnesses) gets the normalized bytes as a data URL in the part.
   Every road on which a tool's answer reaches the model takes this door: the foreground call, a background effect's settlement (`ThreadEffectSettlement`) and an answered question (`ThreadQuestion`).
3. **The attachment port.** `ThreadAttachmentStorage` gains `keep(threadId, image) → StoredThreadAttachment`. `hydrate` resolves a stored location in a `file` part of a tool result — in a `tool` message and in results an assistant message inlines — as it resolves a user `media` part. A tool picture whose file is gone lowers to a line naming it rather than failing the request, because a failure there would fail every later turn of the thread. Tagma's `ThreadAttachmentStore` implements both over the folder its upload already writes; the fork copy and the thread's release already cover that folder.
4. **Models that do not see.** The prepared model request reads the selected row's `capabilities`. For a row without `'vision'`, the messages it sends carry, in place of every picture — user `media` and tool `file` alike — a line naming what was left out and where it is stored. Every request road passes it: the streamed turn, the one-shots and the compaction summary.
5. **Price and pruning.** A picture in a tool result is priced as a picture wherever a `media` part is — `estimateThreadTokens`, and the weight pruning gives a result — so an image result is weighed at its picture cost and cleared by the same rule as text.
6. **`read`.** A file whose leading bytes carry the PNG, JPEG, GIF or WebP signature answers `media`, labelled by its path; a text file named `.png` reads as text. PDF keeps its refusal until its own decision is built. The description says the tool reads images.
7. **The reader.** The display head gains an optional `images: readonly { url: string; mediaType: string; width: number; height: number; label?: string }[]`, filled by the door from what it kept — no tool writes it. The chat's tool row draws them with the attachment strip and `openImage`, and the row estimate counts the strip.
8. **MCP.** `mcpAnswer` turns `image` content into `media`, its base64 decoded; audio and resource parts stay named by kind.
9. **webfetch.** An image response answers `media` labelled by its URL, in place of the type-and-size line.

## 5 Owners and boundaries

- `@runlith/agent` — [[b645577c|the tool contract]] and its door: `ToolAnswer.media`, normalization, the model output, the display's `images`, the attachment port's verb and hydration contract, price and pruning weight, and the strip in `ModelRequests` for rows without vision. It reaches `normalizeModelImage` through the `@runlith/llm` root it already imports.
- `@runlith/llm` — no change; the wire already lowers file parts.
- Tagma server `thread/ThreadAttachmentStore` — `keep` and tool-result hydration.
- `@runlith/agent-tools` — `read` and `webfetch`.
- `@runlith/mcp` — `mcpAnswer`.
- `@runlith/chat-ui` — the tool row.
- out: the Tagma MCP bridge (`mcp-serve`) serves the operation catalog, and no operation answers a picture.

## 6 Rejected alternatives

- **Base64 in the stored answer** (opencode; `toModelOutput` today): every transcript read, fork and wire entry would carry megabytes, and Tagma already keeps operator pictures by reference.
- **Each tool storing its own pictures**: three storage roads and three normalizations for one act; the door is the one place every answer passes before it is stored.
- **A separate `view_image` tool** (Codex): models reach for Read on a PNG, and `read` already resolves and judges the path. Codex hides its tool from rows without vision; the request-time strip gives the same safety for every picture, a model switch included.
- **Normalizing at lowering**: the same picture would be re-encoded on every request.
- **Delegating visual review to a foreign harness**: its bytes are invisible to the operator and it dies with the host.

## 7 Acceptance criteria

- A thread lowered for Anthropic, OpenAI Responses, OpenAI Chat and Gemini carries a `read` PNG as each wire's image block in the tool result; live, a Tagma agent names a known word drawn in a generated PNG it read.
- The stored transcript entry of a read of a 1 MB PNG holds a location, not bytes, and stays under 2 KB.
- A fork's request carries the picture; releasing the thread removes its file.
- A thread moved to a row without `'vision'` sends no picture part, carries the line naming the stored file, and raises no provider error.
- An MCP answer holding an `image` block, and a webfetch of an image URL, each reach the model as an image part.
- The feed's row of an image read shows the thumbnail, and pressing it opens the picture.
- The estimate of a history holding one tool picture prices it as a picture, not as its base64 length; pruning weighs it the same.
- A picture over the source ceiling, undecodable or irreducible answers a sentence naming the reason, and the call is not failed.

## 8 Claims and tasks touched

After the build, revised or superseded with claims written from the code: [[c54feff7]] (its PDF clause stands), [[1836c85a]], [[bd350355]], [[94f355cf]], [[28afae60]], [[ab02f96b]], [[09e16680]]. New claims: the door's picture contract, the strip for rows without vision, the port's `keep`. No open task stands on these owners' pictures.

## 9 Order of building

1. The contract, the door, the port, hydration, the strip, price and pruning, `read`, the display field and the tool row — one task, because none of it is observable alone.
2. MCP and webfetch, after 1.
3. PDF, under its own decision, after 1.

## 10 Contract

`new ToolAnswer(value, display, options?)`: every call site in this repository moves in the change, and nothing outside it constructs one. The display field is optional, so stored displays decode unchanged. `keep` is a new port verb every implementation — the Tagma store and each test double — answers.

## 11 Stored data

Results stored before the change hold no pictures and stay as they are. New results hold the location form operator pictures already use (`/api/threads/<thread>/attachments/<id>`); hydration reads it by the current thread and id, so a fork resolves through its own copied folder. A build older than this one reading such a result lowers the location as base64 and refuses the request: out: a downgrade is not a supported road.

## 12 Who may do what

A picture comes only from what its tool was admitted to read — `read` under its path judgment, an MCP server's own answer, `webfetch` under its network subject — and is kept only in the calling thread's folder, which the attachment route already serves by thread. out: no new permission arises.

## 13 Long-lived things

A kept picture lives in its thread's attachment folder and leaves with the thread through the folder's ledger row; a fork copies it. Pruning clears the result, not the file: a cleared picture costs disk until the thread ends, never context.

## 14 Bounded resources

Per picture: at most `THREAD_ATTACHMENT_SOURCE_MAX_BYTES` read, at most 2000×2000 and 5 MB of base64 kept and sent. Normalization runs sharp in the server process, as an operator upload already does. Each kept picture costs its catalog price on every request until pruning clears it, and pruning now weighs it at that price. A thread's folder has no byte budget of its own; it is released with the thread.

## 15 Rollout

A run already going keeps the catalog it opened with; the next run reads the new `read`. Existing histories are untouched.

## 16 Failures

A picture that cannot be kept (disk, permissions) answers a line saying so, and the tool's effect stands, as a failed retention does. A restart mid-call tears the call like any other; a picture kept for a result that was never stored stays in the folder until the thread ends. A missing file at hydration lowers to a line (§4.3).

## 17 Observability

The row shows what the model was shown; the answer's text names source and sent sizes; the request composition prices the picture; the traced request carries the location, and only the wire carries the bytes.

## Divergences as built

- **Keeping lives in the thread layer, not in the door (§4.2, §5).** The door's floor (`agent/`) stands below `transcript/`, where the source ceiling lives, and below the attachment port; so the door calls an optional `keepPicture` on `AgentToolOutputs`, and the harness wraps every tool-output scope with a keeper that normalizes and calls the port's `keep` (`thread/toolPictures.ts`). The door still composes the model output and the display.
- **A run with no keeper answers words, not a data URL (§4.2).** Every `AgentHarness` has one, because its attachment port is required; only a bare `AgentRunner` or a test door runs without, and there the picture is named as not shown.
- **The effect-settlement road carries no pictures (§4.2).** `settleEffect` answers a value after a restart, not a live `ToolAnswer`, and no settler answers media; nothing routes it through the keeper.
- **The strip names the picture, not a stored location (§4.4, §7).** A tool picture is named by its label — `read`'s path, the fetched URL — and an operator's by its file name; an attachment route would tell the model nothing it can use.
- **`read` answers a picture past the source ceiling itself, unloaded (§4.6, §14).** It compares the size it already stat'ed, so nothing past the ceiling is read into memory; the call answers a sentence and is not failed.
- **The wire vocabulary gained three optional facts (§5 said no change).** `ToolFileContent` carries `width`/`height` so a stored picture prices by its pixels unhydrated; `NormalizedImage` reports its source size for the reduction line; `ResolvedModelCall.images` answers the row's vision. Devin's rows now declare vision for the families other catalogs mark as seeing, since a text-only table would have stripped every picture on that path.
- **Overflow recovery and Tagma's retention were widened (found in review).** Overflow recovery omits tool pictures as it omits operator ones, and Tagma's bounding hands the whole model output to the bounder so a retained answer keeps its pictures; a fork links picture files instead of copying them.
