---
id: 01a15bbc-e9df-7400-9ebd-3a897a48b1aa
title: "Claude Code 2.1.304: a priority-next word embedded mid-turn arrives as a replay echo with the send uuid at embed time, with and without a picture; command_lifecycle yields queued, started and completed — probe 2026-10-21"
ord: 5
tags: ["research"]
fields:
  {
    "source": {
      "name": "Claude Code CLI via Claude Agent SDK",
      "ref": "claude 2.1.304, @anthropic-ai/claude-agent-sdk 0.3.292, haiku model"
    }
  }
---
**Probe.** The script opened one `query` the same way the runner does: streaming input, `includePartialMessages`, `replay-user-messages`, `bypassPermissions`, `settingSources: []`. The only difference — `tools: ['Bash']`. The prompt asked for two `sleep 5` calls in a row. As soon as an assistant message with the first `tool_use` arrived, the script sent a word with `priority: 'next'`, `client_composed: true` and its own uuid. Two runs, one per variant: a word of one text block and a word of three text blocks with a PNG picture. The second repeats the shape of a Tagma steer with an attachment. The script was not kept: the result cannot be reproduced from this record.

**Observation (both runs).**
- ~25 ms after sending, the SDK yields a `type: 'command_lifecycle'` message with `command_uuid` equal to the word uuid and `state: 'queued'`. This type is not in SDK 0.3.292 types.
- The word is embedded into the running turn after the first call's `tool_result`. 4–10 ms after `tool_result` comes `type: 'user'` with `isReplay: true` and the send uuid. Its content is the word blocks as-is, picture included. Next comes `command_lifecycle` with `state: 'started'`.
- There is no separate turn for the word. At the turn end, `command_lifecycle` yields `state: 'completed'`, and `result` carries `user_message_uuids` = [prompt uuid, word uuid].
- Assistant messages and stream events after the embed do not carry `user_message_uuid(s)`. Only the turn's first frame carries them.
- The model executed the word in the same turn.

**Observation on the October 20 incident** (thread `01a15ac1-2b9a-7fc6-b993-3b1f606e8186`, execution stdout `ca8ed8d8-0589-4f06-aabd-bb8e5446d52b`/167, session journal `f9fc36d8-c6b0-437c-bf0d-a05bb0ebce31`).
- The word embedded at 22:23:32 is steer `…:9`. The runner answered it `injected` between `_tagma/said` messages 22:23:23 and 22:23:38 (stdout 5362925).
- Steer `…:10` is the 22:29:23 word (`7e64144d…`), embedded at 22:29:25.255. The `injected` reply stands on stdout 6175266, right after the `_tagma/said` message 22:29:24.
- The protocol row held `…:10` unanswered for another reason. Cursor 6166843 stood before the `read_output` frames (6173686–6174218), and the drive crashed on recording them. The driver never read up to the reply at 6175266.

**Conclusion.** On 2.1.304 the runner confirms an embedded word by the very fact with which Claude Code takes it: a replay echo with the send uuid at embed time. `command_lifecycle` `started` arrives at the same moment. There was no minutes-long lateness in the incident: two different steers and the drive death added up to that picture. The probe did not verify embedding during parallel MCP calls, on Escape, or when merging several words.
