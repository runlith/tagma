---
id: 01a15b2c-e929-7fed-bccd-71788e04b290
title: "\"`tagma op <id> --help` shows no input schema for the operation, and a plugin process has nowhere to learn `create_thread` or `start_turn` inputs\""
ord: 6
tags: ["reflection"]
fields:
  {
    "actual": "Prints only meaning, grammar, and the refusal list; `tagma op --json` returns only id and meaning. Input fields are learned only from server sources or from `body-shape` refusals, one field per call.",
    "command": "tagma op create_thread --help",
    "expected": "The operation's input schema (fields, types, requiredness) next to meaning, grammar, and refusals — as the server decodes it."
  }
---
Filed from project `runlith`.

This came up while writing the built-in `plugins` skill. A plugin process calls operations open to external callers (`create_thread`, `start_turn`, `queue_turn`, `read_statuses`, `read_endings`, `pin_view`, `send_notification`) over HTTP. Most of them have `tool: undefined`, so an agent never sees their schema even in its own tool catalog. An agent writing a plugin in another project cannot read Tagma sources, and a skill must not restate schemas the server serves. For now the skill lists the main fields of these operations by hand.

Aside: `tagma op --json start_turn` parsed `start_turn` as an operation id and ran it with `{}`. The server refused `body-shape`. That CLI behavior is expected, not a defect.
