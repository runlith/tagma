---
id: 01a14bc0-75a6-714a-8bc7-d49c33647573
title: Up arrow in the composer returns the operator's earlier messages in this project
ord: 3
tags: ["feature"]
sources:
  - kind: file
    ref: packages/chat-ui/src/composerKeys.ts
---
The operator repeats or edits an earlier message without typing it again.

**How.** ↑, when the cursor is at the very start of the field, substitutes the previous message; further ↑ reach older ones; ↓ at the end of the field moves back toward newer ones; Esc returns what was typed before browsing.

**Behaviour.** Every send writes the message text into history — together with the `[[…]]` links of mentioned blocks: the last 100, freshest first; an immediate repeat of the same text is not written twice. History is one per project for all its threads; this browser keeps it, it does not cross to another device. Editing the substituted text leaves browsing: from there it is an ordinary draft.

**Limits.** Attachments never enter history. ↑ in an empty field of a thread with no running turn, where there is something to roll back, edits the last message through rollback (A1) instead of history.

**Related.** Composer, draft.
