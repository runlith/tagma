---
id: 01a14faf-e87b-7861-a541-f7f557524b3d
title: "A new agent's default model is the first subscription found: Claude through Claude Code, then ChatGPT on GPT-6.1 Sol; with no sign-in at all the draft offers sign-in"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-92984519ff2b
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/providers/Group.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/birth/BirthSettings.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/composition/adapters.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/models/preference.ts
  - kind: file
    ref: packages/adapter-openai/src/models/openai.ts
  - kind: file
    ref: packages/llm/src/models/description.ts
  - kind: symbol
    ref: apps/tagma/server/src/native-harness/contract/wire/operations/models.ts
    symbol: MODEL_OPERATIONS
---
## Behavior

| Sign-in found | "New agent" draft starts on |
| --- | --- |
| only Claude Code | Claude Opus 5.5, provider `claude-code` (Agent SDK) |
| only Codex CLI with a ChatGPT subscription | GPT-6.1 Sol, provider `openai-oauth` with the Codex account |
| Claude Code and Codex | Claude Opus 5.5 |
| ChatGPT sign-in inside Tagma itself, another subscription or a key | first provider in the common order |
| nothing | sign-in card, no model |

The operator's saved choice outranks the order: the order decides only while no choice exists. While no choice exists, a new sign-in — e.g. the user signs into Claude Code later — changes the default without a restart.

The model is the provider's `defaultTextModel`. For `claude-code` that is already `claude-opus-5-5`. For `openai-oauth` it becomes `gpt-6.1-sol`; it is currently `gpt-5.6-terra` because `DEFAULT_OPENAI_OAUTH_MODEL = DEFAULT_OPENAI_MODEL`. The `openai` API provider default does not change.

## Design

### Provider order

`pickerOrder` (`packages/llm/src/models/description.ts`) currently sorts by `AUTH_ORDER` — oauth, api-key, cli — so a CLI subscription sorts after all keys. It becomes: subscriptions (`oauth` and `cli`) — one group before `api-key`; inside the group — the adapter order in `composition/adapters.ts`, with `anthropic` moving ahead of `openai`. The core names no vendors: priority is the order composition holds. The default, model picking (`pickableProviders` follows the catalog's `providerOptions`) and the Providers screen all read this order.

### Default candidates

`fallbackModel` (`native-harness/models/preference.ts`) walks the catalog in this order and takes the first provider that:

- **can host a Tagma agent** — a wire provider or a CLI provider that `HarnessRegistry.seating` seats into a harness with agent hosting (currently `claude-code`). A CLI provider without hosting (`codex`, `devin`) is no candidate: its models go only in its own CLI;
- **holds a sign-in** — for wire, a saved account, as now, including the Codex sign-in borrowed by `openai-oauth`; for a CLI provider, a signed-in entry, i.e. a `ProviderAccounts.of` row without `problem`. CLI sign-in defaults to `DefaultLoginBook` (`claude auth status`), read at most once per `LISTED_MS`.

Birth without a named model (`makeBirthModels`) makes the same choice: default and birth have one owner.

### No sign-in at all

- `read_model_defaults` answers with a new 'no connected model' arm instead of the first account-less provider's model; the fallback `catalog.defaultModel` goes away. The same work fixes the operation's grammar.
- Birth without a named model refuses `no-model-connected` with exits: sign into Claude Code, sign in with ChatGPT, add an API key in Providers. The `no-provider` refusal (no adapter installed at all) stays.
- The "+" menu shows "No model connected" under "New agent".

### Sign-in card

The card stands in the empty draft while `read_model_defaults` answers "no model". It has three rows:

- **Claude.** State comes from the `claude` accounts section:
  - Claude Code not found — "Install Claude Code". A Tagma terminal opens in the draft's project with the official install command declared by the harness adapter; for Claude that is `curl -fsSL https://claude.ai/install.sh | bash` (Anthropic docs). Once the command finishes, Tagma re-reads the CLI (registry `recheck` and agent-type rescan), and the row becomes "Sign in".
  - found but not signed in — "Sign in": the `claude-code` provider's `begin_sign_in`, `external-cli` flow (`claude auth login` in a terminal).
- **ChatGPT** — "Sign in with ChatGPT": the `openai-oauth` provider's `begin_sign_in` in a browser. No Codex needed for it.
- **API key** — a link row to the Providers screen. Other subscriptions (xAI, Muse, Devin) connect there too.

The sign-in flow — begin, wait, complete, poll — currently lives inside `providers/Group.svelte`. It moves to an owner in `features/providers` used by both Providers and the card: no second copy of the sign-in logic. Once sign-in completes, the card re-reads the default, the draft stands on the found model, and the user writes the message with no second step.

## Affected owners

- `packages/llm` — `pickerOrder`;
- `composition/adapters.ts` — adapter order;
- `adapter-openai` — `DEFAULT_OPENAI_OAUTH_MODEL`;
- `native-harness` — `fallbackModel`, `makeBirthModels`, `modelDefaults` and wire `read_model_defaults`;
- `external-harnesses` — the install command in the harness adapter declaration (`HarnessAdapter`); vendors without a verified official command have none;
- the app — `ModelDefaults`, `BirthSettings`, the draft's card, the sign-in flow owner in `features/providers`.

The default-model feature is fixed in the same work: the default order and birth without sign-in.

## Implementer proof

- An owner test through the public `read_model_defaults` operation on fake accounts, one case set: CLI-Claude-only sign-in gives `claude-code` / `claude-opus-5-5`; borrowed-Codex-only sign-in gives `openai-oauth` / `gpt-6.1-sol`; both give `claude-code`; nothing gives the 'no model' arm, and model-less birth refuses `no-model-connected`. No text assertions.
- Typecheck and the affected owners' tests.
- A live run on one's own `tagma:try` with an empty data dir: the draft starts on the ordered model, the no-sign-in card opens and leads into sign-in.
