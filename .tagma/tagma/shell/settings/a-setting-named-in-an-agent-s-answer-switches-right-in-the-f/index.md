---
id: 01a165cd-9463-754c-83d4-701e195e3de6
title: A setting named in an agent's answer switches right in the feed
ord: 6
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a2b526a4f0
---
**Why.** The agent names a setting in the answer ("enable `telemetry.cpuSampler`"), and the operator must go to Settings to find the key or spend an agent turn on "switch it on". A key with `operatorOnly` the agent cannot write at all. A chip in the answer lets the operator change the value where they read about it.

**What the operator sees.**
- Inline code in the thread feed whose text exactly equals a key id from the home thread's settings catalog becomes a setting chip. Other code (`Effect.fn`, `package.json`, a nonexistent key) stays ordinary code and a file link, as now.
- A boolean key's chip carries a mini-switcher of the current value: clicking it switches at once. Clicking or hovering the key text opens a popover with the name, description, the same control as the Settings screen, the layer and the value's origin, and an "Open in Settings" link to that key.
- Non-boolean keys' chips show the current value as text (`settingText`); changing — in the popover. `managed`, `rows`, `colors` keys and lists are not edited in the popover: it shows the value and leads to Settings.
- A chip shows the effective value from the client's catalog, not what stood when the agent wrote. The client's catalog is not live: a write from the Settings screen or from a chip puts the answer into the shared cache, and an agent's write becomes visible on the reread the popover's opening makes.
- "Open in Settings" opens the home thread's project's Settings (`project` address parameter), even when another home's thread stands in the side panel.
- A chip is never set inside a file link: one place — one action.

**Where it writes.** Into the layer the effective value came from (`entry.from`); by default — into the machine (`user`) layer, if the key declares it, otherwise into the project. The write is the same `write_setting_layer` operation as the Settings screen; it is the operator's own act, so `operatorOnly` is honored.

**Agents write the key exactly.** The settings module declares a doctrine section in the system prompt: an agent names a setting to the operator by its exact key in backticks, never by name or paraphrase. Rendering never guesses a setting by words.

**Device.**
- Markdown rendering does not change and knows no catalog. After rendering, `MarkdownBody` matches the block's inline code against the catalog's keys and mounts the chip component where they matched; the popover is the shared hover `Popover` primitive.
- The catalog is the home thread's project's `SettingsRepo.catalog`; after writing, the catalog's cache takes the write's answer. The key set is matched by their set, so a value change does not remount chips or close the open popover.
- `SettingControl` and the layer-answer computation are reused, no second copy.

**Acceptance.**
- An answer's key renders as a chip; a boolean switches with a mini-switcher click, the write goes to the layer by the rule above, and the chip shows the new value.
- A nonexistent key and ordinary code stay code; a file path stays a link.
- While the answer streams, no chips.
- The native agent's system prompt holds the setting-keys section.
