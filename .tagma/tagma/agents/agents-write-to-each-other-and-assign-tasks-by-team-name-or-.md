---
id: 01a14b6d-b1e1-73b9-a839-ccd1423cdc33
title: Agents write to each other and assign tasks by team name or thread id, to one recipient or several at once
ord: 4
---
Agents talk to each other: with a plain message that owes no answer, or with an assignment the recipient owes a final answer. One word can go to several agents at once.

**How.** The native agent's `send_message` and `send_task` tools; a CLI thread calls the same-named operations over Tagma MCP on behalf of its thread from its grant. `to` is always a list: a name in the own team (threads under the same birth root) or a thread id — that reaches any thread of this owner on the server, in another team and in another project; the receipt marks someone else's team. Each recipient sees the words once, knowing nothing of the others. Text — up to 20,000 characters; `inReplyTo` — the envelope being answered.

**Delivery.** A working agent reads an incoming message at its next step, never inside a long tool or model call; an idler starts a turn. A working agent's assignment stands behind its current turn, an idler starts at once. An incoming word is marked with the sender `from`, its `thread`, and the `envelope` receipt. The answer names per recipient the envelope, delivery state, and the run the word opened or joined. Agent-message tool waiting is cut short only by the operator's words and a due report.

**Limits and refusals.** At least one unknown address — sent to nobody; the refusal lists the names the own team answers to and reminds that another team is reached by id from `list_agents`. A call key makes sending idempotent: a repeat answers with the same envelopes, the same key with different words — `key-reused`. In review mode the operator confirms every send. A plain child takes its parent's words as the operator's words.

**Links.** The final answer and reports; an assignment with recipient context compaction (`compact`) — in the compaction record; interruption.

Code: packages/agent/src/collaboration/sendTools.ts#sendTools, packages/agent/src/collaboration/collaborationVerbs.ts#sendMessageInput, packages/agent/src/collaboration/collaborationVerbs.ts#taskInput, packages/agent/src/collaboration/ThreadEnvelopes.ts, packages/agent/src/collaboration/envelopeActs.ts, apps/tagma/server/src/threads/operations/collaboration.ts#COLLABORATION_PAIRS
