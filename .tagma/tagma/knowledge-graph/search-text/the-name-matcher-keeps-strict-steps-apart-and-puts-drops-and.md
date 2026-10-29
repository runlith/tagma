---
id: 01a17364-d5ef-7b11-9116-b0be457b1aa7
title: The name matcher keeps strict steps apart and puts drops and typos in one band by density; text next to a name is searched by words only
ord: 2
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a1734b-d7e6-7660-80b4-37dff267eadb
sources:
  - kind: file
    ref: packages/search-text/src/match.ts
---
Strict steps — the whole name, prefix, word start, initials, substring — stand apart with margin, and no in-step tweak moves a match to a neighboring step. The exact name must stand first and be Enter-picked: if that rule is broken, the keypress runs the wrong command. So a multi-word name typed whole gets its own bonus (`Hit.exact`): without it a word sum wouldn't tell it apart from the same words in another order. A consumer with its own order (favorite models, groups) doesn't put it above the exact name.

Dropped letters and a typo are scored in one band by nearness to the same word typed straight. When a typo was a separate step below subsequence, eight letters scattered over a long name walked past a name with one wrong letter, and what was wanted left the visible list.

Typos are forgiven for words from 4 letters, two from 8 (Algolia defaults). A short word with a forgiven edit matches a large part of the list.

Text next to a name (a description, keywords) and a name-phrase (`prose`, a thread title) are searched by words, substring and a typo in a word only, with no subsequence: scattered letters match a sentence nearly always. A description or keyword match stands below any name match.

`fold` keeps the string length one to one, so answer positions highlight the source row with no recompute. It strips diacritics only from Latin, folds ё to е and ς to σ: NFD on other scripts breaks a letter into parts (a Korean syllable falls apart into jamo), and then anything would match. A surrogate pair folds and compares whole, and highlighting doesn't split it. Otherwise a subsequence would assemble one symbol from halves of two different ones. The query carries no positions, so before folding it's brought to NFC: a letter typed with a separate mark matches the same letter typed as one symbol.

A name-phrase takes a substring of any length. Hieroglyphs, kana, Thai and other spaceless scripts count every symbol as a word start, otherwise a word mid-title wouldn't be found.
