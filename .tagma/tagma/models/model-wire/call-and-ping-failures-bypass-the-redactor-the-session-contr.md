---
id: 01a0ca76-9d9c-7f5c-952e-eb6542cb8372
title: Call and ping failures bypass the redactor the session contract promises
ord: 55
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e816-39cd-7538-8d2b-77224fe6b496",
    "status": "done"
  }
---
McpSessionOptions promises the redactor is taken out of every failure a session builds, but McpSession.under() carries the timeout and the abort without redact, so McpCallFailed reasons from calls and pings — including the aborted-run reasons — pass through said() as the identity function. Only the connect path threads the function through, and scrubbed() only handles connect failures.

Either thread options.redact through under() so call and ping failures are scrubbed like connect failures, or narrow the contract in McpSessionOptions and the limitation claim [[9a73e258]] to connect and listing. Evidence: packages/mcp/src/McpSession.ts under() at :148 versus the connect-time under at :261, said() at packages/mcp/src/sdk.ts:150.