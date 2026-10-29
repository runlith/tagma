---
id: 01a16195-4d3b-7f1c-876b-ce47cf2c05e7
title: The standing TS 7 checker API gives the verdict by position, and alias is only value flow from the target
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/navigation-ts/src/engine/semantics.ts
---
Each position's verdict comes from the symbol at that point from the standing API checker (`getSymbolAtLocation` in a batch per file), not from language-service reference search. The TypeScript 7 checker API never throws on idle, so a quiet checkout never cools; reference search goes through short-lived pool checkers that TS 7 drops after 30 s and walks every program file, not just ripgrep candidates. Reference search also does not know the spec's rules about alias and type projection.

Symbol identity is declarations (`path#node index`), not a symbol id: files parse once for all programs, and one declaration in different programs yields one key.

Alias is only value flow from the target: renaming on import and export, destructuring whose property resolves to the target, assignment into a variable (at declaration or through `=`) and into a property of a fresh object literal (with no contextual type or with a context from its own literal). A target's value in a member with a declared type is that member's implementation, not an alias: otherwise one shared stub substituted into several services would merge their methods into one symbol. An explicit type projection `Owner['Service']['m']` on a variable is the target's implementation, though the value did not come from it; a variable under another name goes to `aliases` so the kit finds its calls.

Hops count as one counter for the whole chain: an alias id already carries the spent depth, and the alias judge continues it instead of starting over. A hop past two gets "unchecked: alias chain cut", and its places too — not "another symbol".

A question asked on a renamed import (`aid` instead of `helper`) searches the question's name and returns the source name in `aliases`, or places under the source name would never be found.

An object literal without contextual type is another symbol when it lacks at least one required member of the target's owner, and "unchecked" when the shape matches: the engine never proves a structural implementation.
