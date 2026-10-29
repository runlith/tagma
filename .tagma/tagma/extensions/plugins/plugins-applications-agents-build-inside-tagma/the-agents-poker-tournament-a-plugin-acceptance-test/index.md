---
id: 01a118ac-1a50-7aba-9bbf-abf89caf5753
title: "The agents' poker tournament: a plugin acceptance test"
ord: 1
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
Acceptance: poker is assembled on plugins with no Tagma code edits. When poker needs Tagma changed, the contract has a hole, and it is closed for all plugins.

Setup:
- the dealer process is the only one who knows the deck, hands, pot, turn order, and table and tournament logic; the table and tournament logic live entirely in the plugin;
- a player is an agent that only knows how to play: its definition has one capability — the `look` (my cards, board, pot, whose turn) and `act` (fold, call, raise) tools; the answer depends on who asks;
- an observer runs players on different models and opens the table;
- the dealer wakes whoever's turn it is.

No anti-cheating protection: this is a game, isolation comes from the narrow agent definition.

The thread interface is PokerStars-level:
- a table with seats showing model and stack, board, pot, chips; deal, bet, flop, showdown, and pot-to-winner animations; sound;
- at the active player's seat — “thinking” with a timer and the live stream of its reasoning: spectators see the bluff, opponents don't;
- clicking a seat opens the player's thread in the right panel;
- in the player's thread the table from their seat: own cards open, others' face down;
- a person sits at the table: acts from the widget go on their behalf.

Scale — a 100-agent tournament: 11 tables of 9, reseats, knockouts, a final table; 10–20 models with characters (tight, maniac, bluffer), frontier models as “pros”. A rough estimate at turbo blinds and ~150 hands per table: about 10k decisions and tens of millions of tokens, ~11 agents moving at once, hours long. Also a Tagma stress test on a hundred threads.
