---
id: 01a0f506-737c-711f-9c79-3b3c3d39abda
title: Join the compiled tag model into one guarded format transition for existing and new graph trees
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f4aa-7bd1-7b96-a4ab-6c853924d378",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f483-46cc-7e9a-97aa-8b51fcaf4455
---
Integrate the tag model's compiled declarations, permanent identities, behaviour contracts, catalog profiles and candidate writes into one guarded format transition, following [[fcaf4455]] and [[6bf40362]]. Class: complex, Opus high. This is the only task that raises `VOCABULARY_FORMAT` and declares new writable metadata on `#tag`/`#catalog`; individual feature implementers do not each do it.

Before the switch, verify compiler/identity/contracts/profiles on isolated fixtures and prove every declaration write road rejects unsupported form. Raising the marker must cover an existing format-1 store and existing format-1 tree descriptor, not merely stamp a previously absent file. The declared schema, store marker, tree marker and actual candidate publication cannot disagree. Preserve unknown-future-format read-only behaviour and the old accepted law's semantic projection. No physical carrier rewrite belongs here; [[8a83b3c9]] is separate.

Acceptance uses public graph operations on fixture trees: create and rename a subtype with carriers; inherited gates; exact/descendant/contract selection; catalog upgrade retaining local allowed additions; blocked structural upgrade with accepted law unchanged; old-format data readable and no partially active declaration after failure or concurrent adoption. The standing shared graph is never the test fixture. Mark the implementing parts complete only after their public paths are joined, and record claims from that joined code.
