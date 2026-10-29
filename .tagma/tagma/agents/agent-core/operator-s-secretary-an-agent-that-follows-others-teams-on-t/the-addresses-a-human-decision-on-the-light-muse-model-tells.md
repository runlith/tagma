---
id: 01a16503-2038-72ab-9b6b-2a466d391f5d
title: The "addresses a human" decision on the light Muse model tells a question hidden in a report apart from a mention of an answered one
ord: 8
tags: ["experiment"]
fields:
  {
    "status": "done",
    "verdict": "confirmed"
  }
edges:
  - kind: relates
    to: 01a16449-f3a3-7a52-9c4a-904c8105540f
---
**Hypothesis.** The subscription light model Muse (`muse-spark-1.3-contributor` on the `minimal` rung) tells a question to a human hidden in a long report apart from a mention of an already answered question, from a root's final text.

**Setup.** 2026-10-22, server built from `2ff9251860`. Roots on muse-spark-1.3-contributor xhigh, all subscribed; each has a working performer, so the lead does not rest at the end of the turn and the server poses the decision. `threads.decisionModel` is unset, no OpenRouter key — so the decision travels the `provider-light` road.

The lead ends the turn with a prepared report on reviewing the notifications module, about 2,400 characters. The texts, the question, and the model answer are in each thread's `decision` activity record.
- Lead A (`01a164ed-f909-7f4e-9d15-5bef4aad5683`): one line "Operator, question: delete the test threads after review or keep them?"
- Lead E (`01a16500-1968-7ac2-af4d-80182c7f3f1e`): mid-report "By the way, a reminder about my yesterday's question: may I raise the open-notification limit from twenty to fifty? I won't touch that part without your answer." — about 7% of the text.
- Lead D (`01a164ff-148f-7616-9d34-5a6b9206ff`): the same report, but instead of a question: "Yesterday I asked…; you answered keep twenty, so I keep it." This is the trap.
- Lead C (`01a164ff-14a0-78bd-b64c7641b52ac3`) was conceived as E. It refused to repeat the prepared text, judging it a lie about its own work, and wrote its own report without a question. Lead E received the same prepared text with a direct note that it is a test text.

**Observation** (one run per text):

| Text | Answer | Correct | Time | Input tokens |
|---|---|---|---|---|
| A — direct question | `true` | yes | 0.84 s | 641 |
| E — hidden question | `true` | yes | 1.47 s | 1,075 |
| D — question already answered | `false` | yes | 2.06 s | 1,070 |
| C — own report without question | `false` | yes | 1.23 s | 818 |

The model receives only the decision system line, the text, and the question — no agent prompt or thread history.

The event line at E carried the report's opening, not the question itself, so a subscriber would have to open the lead's answer to see it. The idea is [[755d2212]].

**Conclusion.** On these four texts the model answers correctly; this is one run per text, not an accuracy measurement. For the "addresses a human" event the subscription light model suffices; that consumer needs no decision models (Jev, Mercury Decide through OpenRouter).

Not verified:
- other providers and their light models;
- text at the window limit;
- answer repeatability.

A lead on Muse does not pass a prepared text off as its own report until told it is a test. Future probes serve the prepared text with that note.
