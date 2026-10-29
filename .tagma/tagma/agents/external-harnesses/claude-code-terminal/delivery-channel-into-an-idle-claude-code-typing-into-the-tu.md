---
id: 01a10482-7407-7503-887a-570b1254d311
title: "Delivery channel into an idle Claude Code: typing into the TUI or stream-json"
ord: 1
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a10482-425d-73da-8cef-d68ca6cf58e6
---
## Question

How to deliver words to an idle Claude Code when typing into its interface with screen verification gives no acceptance contract.

## Options and their cost

- **Typing into the TUI (now).** This is interactive Claude Code on subscription limits. The channel is fragile: input profile revisions, CLI updates, execution changes. The fixes in [[a6cf58e6]] make it honest, but that does not make it a contract.
- **`--input-format stream-json`.** This is Claude Code's programmatic channel for incoming messages (with `--replay-user-messages` for acknowledgement), but it only works in `claude -p` print mode.

## What will decide

- Measurement after [[a6cf58e6]]: how often typing still goes unacknowledged or needs redelivery.
