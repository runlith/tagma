---
id: 01a0dfad-1932-763b-86e6-a604679924a3
title: The agent asserts code-behavior claims without reading the code and graph, and retells unverified child-agent conclusions as fact
ord: 54
tags: ["reflection"]
fields:
  {
    "actual": "Twice the agent told the operator as fact how a guest is treated in one product flow, retelling an Opus reading of a single component row, and carried it to the operator as a “product question” with policy proposals. The path up the call stack wasn't read: the command that starts the flow first requires authentication and opens registration — the guest never reaches that row, the branch is dead. The operator caught the error himself; cost — a few extra turns, a wrong question about a “behavior change”, and lost trust in the summary.",
    "command": "A Tagma agent (Opus 5.5) in another project summarizes two child reviewers' reports (arch-review-astra, arch-review-opus) and answers the operator about current guest behavior in one product flow.",
    "expected": "Before asserting how the product behaves, the agent reads the whole code path (or the owners in the graph through read_owners) and tells a child agent's code reading apart from a checked fact; the unverified is marked unverified or checked before answering."
  }
---
Classification: an agent-loop and system-prompt defect, not the project's.

Two failures:
1. A behavior claim ("as now") built on one code row without reading the callers: the condition in the handler taken as the behavior, though the guard higher up the stack makes it unreachable. The check cost one grep on `onSelectGame`.
2. A child agent's report, marked by itself as a reading from code ("by the code it comes out"), the lead carries to the operator as an established fact and builds a product question on it.

What should have held: the "MUST claim only what you checked" and "A verified claim outranks a guess" instructions sit in the prompt but don't fire when summarizing others' reports. Possible remedy: an explicit rule for summaries — every current-behavior claim taken from a child's report is either rechecked by the lead against the code before reaching the operator, or passed on marked "unverified"; questions to the operator about "product choice" are asked only after checking the divergence is actually reachable.
