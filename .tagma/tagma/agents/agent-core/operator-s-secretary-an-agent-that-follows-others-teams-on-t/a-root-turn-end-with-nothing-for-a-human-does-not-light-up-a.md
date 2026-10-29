---
id: 01a164aa-fc2d-71c6-81c5-5acb475314ba
title: A root turn end with nothing for a human does not light up Attention
ord: 5
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a14bc0-7696-71f4-8eeb-ff1e8a780ecb
---
A root turn end with nothing for a human does not light up "Attention".

The secretary is a root thread, woken by subscription events. Each such turn ends, and "Attention" files it as finished (`finished` on an unseen root) even when the event asked nothing of the operator and the secretary only noted it to itself. The more teams it runs, the louder this noise. Any root that keeps working after its children's reports does the same.

Idea. A finished root reaches "Attention" only when the "addresses a human" decision ([[e82af907]]) answers "yes" on the turn's final text. That is the same decision that already yields the `addresses-human` event.

Open.
- Does this cover every root or only ones woken by something other than the operator's word.
- Cost — one decision call per root turn end.
- How much it gets in the way in practice will show after the first days with the secretary.
