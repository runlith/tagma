---
id: 01a16457-eac7-7dfc-8196-a3804bc6dc34
title: Parent hands a child's question to the operator explicitly, and decides itself if the operator does not answer in time
ord: 1
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a16425-1e63-70b5-afdd-28ffe46b150a
---
A parent answers for its child's questions finally. But sometimes it is formally allowed to approve an act and still does not take the decision: it is destructive, yet refusing also looks wrong. Now it has only "yes" or "no".

**Idea.** The parent gets a third answer — "to the operator". The question goes straight to the operator, past the parent's ancestors, and stands with a deadline; 5 minutes by default. The operator answers "yes" or "no", and the question closes. If the operator does not answer in time, the question returns to the parent marked "the operator did not answer", and the parent must decide itself. It cannot hand the question to the operator again. A question cannot hang: it always ends with someone's decision.

How this differs from the current question deadline: now an expired question is simply refused, while here the decision after the deadline returns to the parent.

**Unclear.**
- Whether this ever happens. Likely rarely: in trust few acts ask — deleting a thread, a plain child, archiving someone else's subtree, sweeping git commands in the shared checkout, a commit into someone else's checkout ([[bad9bb51]]). And a destructive shell command like wiping tables runs in trust with no question at all. So the idea mostly concerns review. How often parents hesitate in practice will show in their answers once a parent answers for a child finally.
- Whether the deadline should be a setting, and whether such a question sends an urgent push.
- What to do with the operator's answer arriving after the question returned to the parent.
