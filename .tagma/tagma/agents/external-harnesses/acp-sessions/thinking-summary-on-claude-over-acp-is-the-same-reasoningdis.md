---
id: 01a14f81-5cea-75bd-a521-8160a9e86875
title: "`Thinking summary` on Claude over ACP is the same `reasoningDisplay` as on native: launch sets it as the session `thinking` option, the runner keeps it in the query"
ord: 1
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a14f72-2ff8-7fe8-9dcf-44bcf1407326
sources:
  - kind: file
    ref: packages/adapter-anthropic/src/runner/settings.ts
  - kind: file
    ref: packages/adapter-anthropic/src/harness/acp.ts
---
`claude-code` models with adaptive thinking declare the same `REASONING_DISPLAY_SWITCH` as subscription models, so the pick, the default (`summarized`), and value validation on an ACP thread match native. Launch resolves the core row's switches against the model declaration and hands `reasoningDisplay` to the Claude profile as the session `thinking` option; like the model and effort, `Configure` sets it from the diff against the protocol row's `configured`, with no new process.

The runner answers `thinking` with the SDK call `setMaxThinkingTokens(null, display)` — it changes the display for the rest of the live query's session — and opens every next query with `thinking: { type: 'adaptive', display }`: a reopen for the prompt or tool names would otherwise restore Claude Code's default display. The runner reports the display in effect in the current query, not the remembered pick: a query opened on a model without adaptive thinking gets no display, and returning to a model with it sets the picked display again with the same call. Until a display is picked, the runner reports `omitted` and passes no `thinking` into the query: then Claude Code sends the same request as the native road with `omitted` (`{ type: 'adaptive' }` without `display`). A model Claude Code reports as `supportsAdaptiveThinking: false` gets no option, and no `thinking` goes into its query.

The terminal transport stores the switch but does not apply it.
