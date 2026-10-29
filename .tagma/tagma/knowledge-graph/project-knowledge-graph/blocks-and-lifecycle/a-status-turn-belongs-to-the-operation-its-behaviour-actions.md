---
id: 01a132b4-f7da-73a3-afc6-9ddd07ea2f2e
title: A status turn belongs to the operation its behaviour `actions` declares; any undeclared turn is made by `update_block`
ord: 7
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/tags/actions.ts
  - kind: file
    ref: apps/tagma/server/src/graph/vocabulary/actions.ts
---
The owner is the turn (word + the phase it is entered from), not the word: `initial` from active is the holder returning (`release_block`), the same `initial` from the end is a reopen, which has no owner. The `claimed` word is guarded only on a tag bound to `core/holder`, because the `claim_block` turn is declared in that behaviour; a tag with the `claimed` word but no holder moves into it through `update_block`.

Hence one `TagActions` projection — `update_block`, `assertNotOperated`, `illegal-transition`, the tag line, and the app menu read it instead of deriving it again; a new behaviour with a turn changes every surface at once. For a multi-tag node (`actionsOn`) the server projects all of its tags' contracts together: a holder bound on one tag guards the `claimed` status bound on another. One word may be the turn of several operations (two verdicts on one word), and the refusal names them all.

The app and CLI read the narrow `TagReading` through `ServedTags`: the per-tag projection arrives in `read_vocabulary`, and the per-node `NodeActions` in the row's `actions`. `Blocks.records` takes it from the server-side `actionsOn` together with the vocabulary revision; menu and outline accept only a row with a matching revision, or resync would mix new turn owners with old gates. The first read shows loading or an error with Retry; an update of the same project keeps the old outline and closes the menu until the answer. Filters are not dropped while the vocabulary is unknown.

The operation id in `actions` is a string (importing the operation catalog into the behaviour wire would create a cycle), so `registerBehaviours` refuses an operation missing from the catalog.
