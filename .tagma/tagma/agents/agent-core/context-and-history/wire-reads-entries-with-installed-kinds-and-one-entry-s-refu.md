---
id: 01a15208-9958-790e-b6dd-4de6a15337e5
title: Wire reads entries with installed kinds, and one entry's refusal stays a diagnostic line
ord: 8
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/wire/WireEntryKinds.ts
  - kind: file
    ref: packages/agent/src/protocol/http.ts
  - kind: file
    ref: packages/chat-ui/src/EntryKinds.svelte.ts
  - kind: symbol
    ref: packages/agent/src/transcript/kinds.ts
    symbol: ThreadEntryUnreadable
---
An entry's wire form is a JSON codec (`Schema.toCodecJson`) of its kind's schema on both sides: the wire schema's outer side is `Unknown`, and RPC serialization checks it only with `isJson`, so a memory value with an optional key of `undefined`, handed over as is, drops the whole subscription frame. So the opaque kind fields (`toolInput`, `toolOutput`, a question's `data`) are declared `Schema.Json`: a producer translating someone else's value through `toJson` (`toolInputJson`, `toolConfirmationData`) meets a compile refusal for non-JSON. The wire codec uses the call context's `ThreadEntryKinds`: in the browser, features contribute the server owners' schemas to the `WireEntryKinds` point. `Door` and `Live` hand one stable reader (`readingOf`) to every request and subscription. That reader resolves each entry against the point's current items, so a subscription already running decodes a kind that joined after it started. An unreadable entry with kept identity becomes `ThreadEntryUnreadable`, carrying the original `ThreadEntryUndecodable`: it takes the line's place without hiding neighbors or admitting an unknown body. Damaged optional metadata does not block that diagnosis; of it only the read fields survive. That is the ingress outcome's form, not the journal entry; reverse coding refuses, the original entry stays available once its kind is installed.
