---
id: 01a0d136-c214-7131-a5e1-ff49fd277fc5
title: A thread row reads state, then what it is doing, then model, ring and time in aligned columns that drop by width, with exact figures in a peek
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
**Outcome.** One reading of a row answers two questions:
- what state is the thread in;
- what is it doing now.

Model and context stay on the row, as columns that line up down the list. Hovering a row, or pressing Space on it, opens a peek with the exact figures and the actions for its state.

**Problem.** Problems 2, 3, 4, 7 and 9 of [[f943c3ed]]:
- the model wall;
- five marks per row;
- a dot that encodes the cache;
- a working row that says nothing;
- a mono time whose meaning is only its colour.

**Holds now.**
- `ThreadRow.svelte` lays out the row. `ThreadLife.svelte#threadMark` gives the tone plus a cache fill.
- `ModelPlate.svelte` has parts gated at 16, 20, 23 and 28rem. `ContextRing.svelte` turns red at `share >= 1` and spins while compacting.
- `ActivityBadge.svelte` shows a spinner and count, a warning, or a history icon.
- The stamp uses the `stamp` utility, which is mono.
- `detail` gives no second line while working.

## Target

### The state dot means state only
Its fill never carries the cache.

| State | Mark |
|---|---|
| working | a spinning amber ring |
| waiting on you | blue, with a halo |
| failed | red, with a halo |
| finished and unread, **roots only** | green |
| cut | an amber square outline |
| quiet (idle, finished and read, stopped by you, harness unmeasured) | hollow grey |

A child whose run completed is quiet whether or not anybody opened it. The harness mapping of [[d8664aa0]] stands: confirmed working is working, waiting is waiting, and idle or unmeasured is quiet.

### The title
The root's title, or the child's agent name, as today. The slot before it stays empty; the worktree spec fills it.

### The second line
It shows only when there is something to say, in the state's tone:
- **Working:** the open tool call from `activity.calls[0]`, as its `title` or else its `name`, with "+N" when more calls stand open. While `activity.phase` is compacting, it says "compacting". It is empty when no call stands.
- **Waiting:** the ask's first non-empty line. The text comes from `ask.text` ([[595698df]]); a harness row uses `harness.question.prompt`, as today. Without a text it says "waiting on you".
- **Failed:** `failedRowDetail(...)` followed by whether a continue can go on, from `threadFailureReading(outcome.failure).retryable`: "can continue", or "fails again as is" when retryable is false.
- **Cut:** "cut short — continue".
- **Finished root, unread:** the first line of its final answer (`saidLine`, [[595698df]]). Nothing shows until the row carries it.
- **Collapsed team:** who is working, as the names of up to three working members and "+N" ([[e08ed2e3]]).

### The right side, in this order
1. **Signals, only when present:**
   - the uncommitted files count (`heldPaths`);
   - the count of processes running now. It opens the existing activity panel on click. The history icon and the unknown and warning faces leave the row; the peek shows them.
   - a collapsed team's counts: working, asking and failed ([[e08ed2e3]]).
2. **The model:** the vendor glyph, the short model name, and the effort as a lowercase word in quieter ink, for example "Opus xhigh", "Sol xhigh", "Step 5 high". This uses `modelWords(row).model.short` and the rung id in lowercase. A harness row keeps its CLI glyph and its model and effort words.
   - **Same as parent is quieter:** a child whose provider, model and reasoning all equal its parent row's draws the model at reduced opacity. A reviewer on another model then stands out at full ink.
3. **The context ring:**
   - its arc is `contextShare`, turning red from 0.8;
   - it spins while compacting, as today;
   - a centre dot means the cache is warm, from `warmthFilled(cacheWarmth, now)`, waking once at a promise's expiry as in [[0826e089]].
4. **The time:**
   - amber: how long it has run (`runningSinceOf`);
   - blue: how long it has waited (`ask.askedAt` when present, otherwise the run's start);
   - grey: the last event (`node.lastEventAt`).

   It is set in the UI face with tabular numerals, not the mono `stamp`.

**Columns.** The right side is laid out as fixed-width columns, with the model flush against the ring, so the rings and the times line up down the rows. Signals take the space to the model's left.

### Width tiers
They are read by the column's own container query, and parts drop in this order:
1. the effort word, below 400px;
2. the model name, below 340px (the glyph stays);
3. the ring (unless it is red) and the files count, below 290px;
4. the glyph, below 250px.

A red ring and a running-process count never drop.

### Peek
It opens on hover after a short delay, or with Space on a focused row. Escape, leaving the row and the peek, or Space again closes it. It shows:
- the full model label, effort and account;
- context as a percentage, with tokens when the row carries `contextTokens` ([[595698df]]);
- the cache as words (`warmthWords`);
- the uncommitted files, and the processes running now (the activity reading `ActivityBadge` draws today, with its link to Processes);
- the worktree, "main" for now;
- a team summary: working, asking, failed and finished counts;
- the last assistant line (`saidLine`) when present.

It offers actions by state:
- an ask: Allow, Deny, Open;
- a failure or cut: Continue, Open;
- working: Open, Stop;
- otherwise: Open, Pin, Archive.

Every action goes through the operation the menu or the conversation already uses, and each greys only on its own row's act ([[46899e82]]).

**Owners.**
- [[2028d329]]: `ThreadRow`, `ThreadLife`, a new peek component beside them, and `harnessRow.ts`.
- The plate (`ModelPlate`, `modelWords`) and the ring (`ContextRing`) are drawn in this column and also by the conversation rail ([[aeb922f0]]). The ring's new red threshold and cache dot apply in both places; the tiers apply to the column alone.

**Rejected.**
- Removing model and context from the row: with ten sub-agents, the model answers who is who.
- Tick bars for effort, which the operator rejected.
- Keeping the cache as the dot's fill.

**Acceptance.**
- With the page's data at 480, 400, 340, 290 and 250px, parts drop in the stated order, and a red ring and a process count remain at 250px.
- A working row with an open call names the call.
- A reviewer on Sol under an Opus parent reads at full ink, while its Opus sibling is faint.
- No child row is ever green.
- Rings and times align in one column across rows.
- Space and hover open the same peek. Allow in the peek answers the ask, and the row leaves the waiting state when the feed brings the answered row.

**Claims touched.** As sentenced in [[f943c3ed]]:
- Dies: [[d6a850aa]], [[c4f13097]], [[59f79ad4]], [[77e8586b]].
- Absorbed: [[8e5093bd]], [[2b413c44]], [[65ee6966]], [[f87ae17e]], [[5ccdc4e3]], [[e8a28eaf]], [[35a9f05e]].

The tasks write the new claims from the code and close this decision into them.

**Order.** [[79b59d15]], then [[400289b2]]. Neither waits on the server: fields that are not carried yet leave their line or figure empty.

- **10. Contract:** it reads only row fields, and treats absent optional fields as unknown.
- **11. Stored data:** out, because nothing is stored beyond today's browser marks.
- **12. Who may do what:** the peek's actions call existing operations, which judge them as they do today.
- **13. Long-lived things:** the peek is the one long-lived thing. One peek is open at a time, its hover timer is cancelled on leave, and it closes when its row leaves the list.
- **14. Bounded resources:** the peek reads the activity panel's existing reading only while open ([[501ae1f4]]).
- **15. Rollout:** out, because this is client-only; a reload shows it.
- **16. Failures:** an action's refusal speaks through the failure channel as the menu's acts do, and the peek stays open.
- **17. Observability:** the acceptance run at the five widths, on the page's data.
