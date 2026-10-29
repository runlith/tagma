---
id: 01a188b6-199d-7ef5-9da5-32671d5f53a4
title: "A reader translates a block into another language: a projection by a chosen model that never changes the block and marks the parts changed since"
ord: 51
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a11127-7009-727d-9639-b5f1db7ababc
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-6948b2fd65e7
---
**Outcome.** A reader opens any block and reads it in his language with one press: a model he chooses translates the title and body into a *projection* that stands beside the block and never changes it. When the block changes, the projection shows exactly which parts no longer match and updates only those. One block can hold projections in several languages.

**Why.** A graph is written in one language — Tagma's own in English — and read by people who think in another. Today they copy a body into a chat to read it. The product already owns everything the act needs: the block, the model catalog and accounts, the cheap-question chain ([[db7ababc]]), the activity record and the block page's lens. This is a convenience over those parts, not a new subsystem.

## What the reader gets

- **Entry.** The block menu's acts section carries one item: `Translate to Russian` when the block has no projection in that language, `Show in Russian` when it has one (no model call then). The language is `translation.language`; empty, the last language translated into in this project, else the system's language. The command palette carries "Translate block" and "Show the original". The item stands wherever the block menu stands; from an outline row it opens the block page in the lens.
- **The lens.** The page enters a translation lens the way it enters the diff lens: the address carries `?lang=<tag>` (exclusive with `?diff=`), an aside pane keeps it as pane state. The strip above the body is the diff lens strip, extracted into one component both lenses use: the word "Translation", a language button, the model chip, the age of the projection, and "Show the original" at its end. The title shows translated and read-only, the original title one muted line under it; the body is read-only. Editing happens in the original.
- **Language in the block.** The language button opens a menu: "Translate again" on top; then the languages this block already has, each with its state tile (filled: current, stale tone: outdated, three marching tiles: translating) and the check on the one shown; then "Other language" with the list of widely used languages, named by `Intl.DisplayNames`. Choosing a language with no projection starts it at once.
- **Model in the block.** The chip names the model that made what is shown; it is the settings `CatalogPicker`. Choosing another model re-translates with it at once; the setting does not change.
- **Translating.** Parts land batch by batch: a translated part replaces its original in place, a part still waiting shows its original dimmed. The strip shows three marching tiles and "Translating, 6 of 14 parts", and a Stop. Leaving the page does not stop the work; coming back shows where it is.
- **Outdated.** When the original changed, every part that still matches shows its translation, and every part that does not shows its *current original* with a stale-tone rule beside it. The strip says how many parts changed, offers "Update translation" (only those parts go to the model) and "What changed", which opens the diff lens from the translated version.
- **Failure.** A failed act is one `Callout` under the strip naming what happened and how many parts stayed untranslated, with "Try again" for those parts. No usable model is a `Callout` with the refusal and a link to `translation.model`.
- **Links.** A label written in the body is translated; a link target never changes. A bare `[[name]]` in a projection shows the target's title in that language when the target has one. A link followed from a projection opens the target in the same language when the target has a projection in it, otherwise the original — never a new model call.

## Limits

Only title and body are translated; fields, edges and sources stay as they are. A projection is the reader's: it is not graph content — no journal entry, no `.tagma` file, no search hit, no delivery to agents — and it is not shared between machines. Agents are not offered the operations as tools: an agent reads the original. Nothing translates without the reader's press.

## Architecture

- **Server module `translations`** (product, under Knowledge graph), `apps/tagma/server/src/translations/`. It imports graph (the block's current title and body in the reader's copy), providers (model access), settings, activity and the model chain. The graph knows nothing of it, and no graph file loads the model client ([[0d2c66a9]]).
- **Translator core**, subject-agnostic: markdown in, markdown out. It splits text into *parts* — the title and each top-level markdown block (paragraph, heading, list, quote, table); a fenced code block is a part that is never sent. Inline code, URLs and link targets are replaced by numbered placeholders before sending and restored after. Consecutive parts are packed into batches under the chosen model's output limit, at most three batches at once in document order — the bound is the provider's rate limit, which no machine figure predicts, and three is the starting value. Each batch carries the block's title as context and `translation.instructions`. An answer must return every part id and every placeholder exactly once; otherwise that batch fails with a reason and the others still land. A later subject — a message, a page — reuses the core with a store keyed to its own subject.
- **Store**: the module's own SQLite table, rows per (project, block identity, language, part source hash) holding the translated text, plus the act's model, time and state. A part is translated when its current source hash has a row. A read segments the current text and answers each part as translated, changed or pending, with counts, the block's other languages and their states, and the translated titles of the blocks the body references. Rows whose source no longer occurs are dropped when the next act for that block and language lands. A block leaving the trash for good removes its rows through the graph's removal event, declared in the graph contract if it is missing ([[e090f46d]]).
- **Operations**: `translate_block` (block, language, optional model and rung, `again` for all parts) starts or joins the one act per block and language and answers at once; `read_block_translation` (block, optional language; without one, only the languages and states); `stop_block_translation`. Landed batches and state changes go out as live frames keyed by block and language; the app re-reads on them and when the block's `updatedAt` moves. An act in flight ends with the server; its landed batches stay, so the next press sends only the rest.
- **Model choice**: the chain of [[db7ababc]], reused rather than copied: its road takes a context — provider, model, account, harness — instead of a thread, and translation is its second caller. Order: the model named in the act; `translation.model` with `translation.reasoning`; the light text model of the first connected provider that declares one; else the refusal `translation-model-missing` with the unblock "choose a model in the lens or set `translation.model`". A named model that cannot be resolved refuses `invalid-selection` and never silently becomes another.
- **Activity**: each act is one `translation` activity with its `model-chosen` note, each batch's input and answer as bodies, and its spend.
- **Settings** in the module's manifest: `translation.model`, `translation.reasoning`, `translation.language` (a BCP 47 tag), `translation.instructions` (text added to every request: terms to keep, tone).
- **App**: inside the Project graph module, `features/graph/translation/`: a repo over the three operations and their frames, and the lens. The block page takes the translation lens beside the diff lens through the extracted strip.

## Choices

- **Local store, not graph content.** A child block or a `.tagma` file would put one reader's language into the shared graph — journaled, searched, delivered to agents and committed into every clone.
- **Projection by parts, not the whole block.** Re-translating everything after a one-word edit costs in proportion to the block, not to the change, and rewords paragraphs the reader already read.
- **A changed part shows the current original, not its old translation.** An old translation reads as current while saying what the block no longer says.
- **The language is chosen in the lens.** The menu keeps the common case to one press; the other languages stand where the result is shown.

## Acceptance

1. One press from the block menu shows the lens at once and starts; a block whose projection fully matches answers from the store with no model call.
2. No translation act changes the block, its journal or the graph files.
3. After one part of a translated block is edited, the read marks exactly that part changed with its current original; "Update translation" sends only that part, and the other parts keep their wording.
4. Code blocks, inline code, link targets and URLs are byte-identical in the projection; an answer that drops or repeats a placeholder fails only its batch.
5. Two languages of one block coexist and are both listed with their states; acting on one leaves the other untouched.
6. Leaving the page during a run and returning shows its progress; after a server restart the landed batches stand and the next press sends only the rest.
7. A block deleted for good leaves no translation rows.
8. With no usable model the act refuses `translation-model-missing` naming `translation.model`; an unresolvable named model refuses `invalid-selection`.
9. Every act is one activity with its model choice and spend.
10. The import check stays green: no graph file reaches the model client, and `translations` crosses only declared relations.

**Proof.** Integration tests through `translate_block` and `read_block_translation` with a scripted model prove 1, 3, 4, 6 and 8; the module check proves 10.
