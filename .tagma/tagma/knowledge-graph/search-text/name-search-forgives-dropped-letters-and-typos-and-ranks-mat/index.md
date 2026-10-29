---
id: 01a1734b-d7e6-7660-80b4-37dff267eadb
title: Name search forgives dropped letters and typos and ranks matches in every list, and full-text search offers something near when there is no exact hit
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0ca5c-5906-74eb-a8b8-6650cb732496
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a640beeb16
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03c4281cc328
---
**What the user needs.** A user who typed a name with a dropped, extra, wrong or transposed letter sees what they want at the top of the list, not emptiness. Right now only file Quick Open does that, and only for dropped letters. Slash commands, skills, the Projects/Actions/Settings palette groups, the folder, branch and model pickers, settings search and the thread filter search by substring. Blocks and conversations search through FTS, which forgives no typos.

**Behavior** — like VS Code, Raycast and Algolia, i.e. the way a user of modern tools expects.
- Steps top to bottom: the whole name; the name prefix; a word start in the name; initials (`ri` → `refresh-instructions`); substring; then on one step dropped letters (a subsequence) and typos. Within a step, higher is the match whose letters stand denser and on word starts: a name with one wrong letter beats eight letters scattered over a long name. Ties keep the list's original order.
- Trees (folders, threads in the column) aren't reordered, only filtered. A thread title is a phrase, so it's searched by words, with no scattered letters.
- A typo is one edit (an extra, dropped or wrong letter, or a neighbor transposition) for a word from 4 letters, and two edits from 8 letters. These are Algolia's defaults. Below 4 letters typos aren't forgiven: otherwise a short word matches half the list.
- A description, keywords and other text next to a name are searched by words — word start, substring, a typo in a word — and stand below name matches: Raycast puts title above keywords, VS Code puts label above "similar commands". A subsequence over long text isn't searched, because it matches nearly anything.
- Every query word must match. Fuzzy matches are always in the list, below exact ones; the exact name is always first and selected.
- The name's matched letters are highlighted where the row shows the name.
- The keyboard layout isn't guessed: neither VS Code, Cursor nor Raycast do that, and one layout table doesn't fit every user.
- A command typed whole with an argument (`/model gpt`) runs only on its exact name.

**Mechanism.** One name matcher in the `@runlith/search-text` kit (`./match`) for browser and server: case and diacritic folding that keeps positions, steps and list ranking. Its subsequence is the Quick Open algorithm from `checkout-files/finding/score.ts`, moved to the kit; file search keeps only path weights: the file name matters more than the directory, recent files rank higher. It ranks every local name list, with no second implementation left. Content search — agent prompt text sections, process rows — stays substring search, like Ctrl+F.

The server indexes — the graph blocks and thread conversations — are a different mechanism: trigram FTS. When the strict query found nothing, the fallback query searches trigram-near words and marks the results as approximate; both the screen and the agent see that mark. That's how search engines behave with "did you mean": a typo isn't mixed into exact full-text matches.

**Acceptance.**
- `/delg` finds `/delegation`, `/compcat` finds `/compact`, `/start` finds `/delegation` by description, `$artifcats` finds `$artifacts`.
- An exact name ranks above any fuzzy match; an empty query doesn't reorder the list.
- `icomdark` in Quick Open finds `icon-dark.svg`.
- No name filtering through `includes` remains in app and chat-ui except content search.
- A block, thread or call whose query has one word with a typo is found when strict search is empty, and marked approximate. The trigram index sets the limit: a neighbor transposition is found in a word of any length, one other edit from 6 letters, two from 9. An inner edit in a 4–5 letter word (`plnt` → `plant`) isn't found: such spellings share no trigram. Full coverage needs a dedicated index word dictionary, and that's a separate decision.
- Ranking a local list of hundreds of rows takes fractions of a millisecond; Quick Open with typos stays in the file worker, and the measurement on runlith shows what the typo step costs.
