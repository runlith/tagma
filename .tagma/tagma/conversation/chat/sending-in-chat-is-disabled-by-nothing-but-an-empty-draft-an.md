---
id: 01a12cb2-3ea1-7577-9306-18d43830975e
title: "Sending in chat is disabled by nothing but an empty draft: anything the send must wait for queues it instead"
ord: 42
tags: ["rule"]
edges:
  - kind: discovered-from
    to: 01a12cb2-2d1a-748b-8670-c65c166cd559
sources:
  - kind: dir
    ref: packages/chat-ui
---
Settings, recap, an open question and another command in flight block neither the button nor Enter. Sends wait in press order; only the server can refuse, and then the draft returns.
