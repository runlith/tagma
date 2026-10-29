---
id: 01a0c697-d47f-7f64-822f-ee48ce8527cd
title: A finished background command's bytes are served by HTTP and the CLI, but no native or MCP operation reads them
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "Refused `terminal-unknown` on both streams of both commands, and the unblock (\"read this project's terminal inventory\") cannot help: a bounded command is not a terminal. The same bytes ARE served by GET /api/commands/:execution/:incarnation/bytes?project=5 and by `tagma command bytes` (both read whole, 56 pass / 0 fail visible), so the record exists and the door exists — it is only absent from the operation catalog: api/operations.ts maps read_terminal_bytes to terminals.bytes and nothing to commands.bytes.",
    "command": "read_terminal_bytes execution=4b0e7d7a-133a-47a3-b515-2af20ecda0cf incarnation=26 stream=stderr offset=0 (after `bash background:true` → wait_command answered Decided, exit 0, stderr durableThrough 7003, record available)",
    "expected": "Read the 7003 retained stderr bytes of the command this thread launched in the background, as the ending notice promises: \"Its output is held with the execution and is read by that reference.\""
  }
---
Filed from project `runlith`.

Second sighting, on server build after 7832a25ae3. The way through for an agent today is a shell `curl` against its own server, which is the window and not a door.