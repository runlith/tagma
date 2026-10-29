---
id: 01a0c71b-442e-73e9-9766-31e14c188e0d
title: "A method whose name is also a local binding cannot be anchored: the symbol reader prefers the local declarations"
ord: 11
tags: ["reflection"]
fields:
  {
    "actual": "three one-line regions (159, 169, 272), the `const session = yield* self.session();` locals in ask/authority/subscribe — `constructRegion` collects declarations before members and discards the members when any declaration exists, and it scans lines without scopes, so the method is unmeasurable by name. The claim about it fell back to a whole-file source (b6ad8cc7), which rings on every edit of the 615-line file.",
    "command": "symbolRegion('packages/executions/src/ExecutionClient.ts', lines, 'session')",
    "expected": "the `session()` method of `ExecutionClient` (lines 95-133), so a claim about the connection build could bind to it"
  }
---
Filed from project `runlith`.

Measured while building the executions client zone (areas ca298040 / e3a0cae2 / fb25686f). Cost: one claim's source is the whole file instead of the method, so drift is noisier than it needs to be. The reader's own rule — a definition wins over a member — is deliberate for a name declared twice at file level; the case here is a local variable shadowing a method, which the line scan cannot tell apart. No workaround was applied to the project.