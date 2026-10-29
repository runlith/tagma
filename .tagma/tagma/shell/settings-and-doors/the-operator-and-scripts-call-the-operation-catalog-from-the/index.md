---
id: 01a14c05-9e8f-7c75-a633-b2ae2265adc4
title: The operator and scripts call the operation catalog from the terminal via tagma op and JSON
ord: 6
tags: ["feature"]
fields:
  {
    "state": "partial"
  }
edges:
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2ac8ddf7b0e
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2ad5afaf792
sources:
  - kind: file
    ref: apps/tagma/server/src/cli/door.ts
  - kind: file
    ref: apps/tagma/server/src/cli/verbs/op.ts
  - kind: file
    ref: apps/tagma/server/src/composition/http/operations.ts
  - kind: file
    ref: apps/tagma/server/src/http/starting.ts
---
**Value.** The operator and scripts call product operations from the terminal without a separate CLI verb for each action.

**How.** `tagma op`: catalog and help, then a named operation with JSON from a string, file or stdin.

**Behaviour.** The CLI passes the server the project and cwd, keeps the session's origin and prints the JSON result. A repeat with the same call key uses the act's identity. A destructive action demands an explicit confirmation flag. While the server answers that it is starting and asks to wait, the shared door waits and retries admission; the wait does not mask silence from the server.

**Limits.** The door's promise for any operation is partly fulfilled: the CLI enumerates the whole catalog but calls over HTTP, so it cannot run socket-only operations from the same list. Call them through their live channel. A named call needs JSON mode; the operation's meaning and its own conditions are not replaced by the CLI.
