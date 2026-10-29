---
id: 01a12755-311a-70dd-9305-983c3fc232a5
title: The whole server falls over from an unhandled EPIPE when writing to a broken pipe
ord: 159
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a12592-46d7-7949-ade0-efb0aee29f9b
---
On October 10 at 21:24:07 the main server process (pid 71744, build `20261010T132708440Z`) fell over with an unhandled error. It happened right after 12 parallel `tagma op read_checkout`, and all 12 answered in 0.1–0.15 s. `serve.log` kept:

```
EPIPE: broken pipe, write
 syscall: "write", errno: -32, code: "EPIPE"
      at end (unknown:1:1)
      at internal:fs/streams:402:23
      at _destroy (internal:streams/destroy:63:18)
      at destroy … finish (internal:streams/writable:482:21)
Bun v1.4.2 (macOS arm64)
```

None of our frames are in the stack trace. This is `end()` on a node-like writable over a pipe: a child process stdin or a socket with no `error` handler. The server's stdout and stderr go to a file (`installation/process/launch.ts`), so they are not it. This thread's `bash` call at the same moment got "process died".

To do: find the writable in the server process that writes into a child's pipe and closes it with no `error` handler. Candidates: `packages/mcp/src/sdk.ts` (`child.stdin.end()` when closing the stdio transport), node-`spawn` in `packages/executions/src/HostLauncher.ts` and `sandbox/engine/docker/helper.ts`, plus any `Bun.spawn` with `stdin: 'pipe'`. The error must be handled on its own terms at the owner of that stream: a broken pipe means "the child is gone". Catching everything with a global `uncaughtException` is forbidden.

Done when reproduced (the child dies before or during `end()`), the owner is fixed, and a test that kills the child and then closes its input passes without bringing the process down.
