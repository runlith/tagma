---
id: 01a16449-f3a3-7a52-9c4a-904bea933fa1
title: "Operator's secretary: an agent that follows others' teams on the operator's question without owning them — from shared product capabilities"
ord: 100
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a1641a-d824-799d-94d3-3d223d0040b2
  - kind: relates
    to: 01a16425-1e63-70b5-afdd-28ffe46b150a
---
The operator runs several teams of 5–10 agents and cannot keep in mind who is doing what: walks through threads, forgets ideas, loses the picture. What is needed is an agent — a secretary — through which the operator asks "what is the state of X", orders any thread ("tell the third one", "bring it", "stop"), and records ideas into the graph without entering the teams.

## Why not a "lead agent above the teams"

A root that owns the teams receives their reports into its own context: noise moves from the operator to it, the picture lives in its correspondence and is lost when the root compacts, the archived root takes all teams with it, and every retelling distorts. The secretary owns no teams: the server holds the state, the secretary reads it on demand and acts addressed by thread id; it can be replaced with a fresh one without loss.

## What it is built from

Nothing here is built for the secretary alone: every part is a shared product capability, and the secretary is an ordinary agent using it.

- Independent birth — [[3d0040b2]], done: the secretary births a lead as a root with its own team, and the lead answers to it for the task.
- Question routing — [[e46b150a]]: a performer's question is answered by its parent, finally; only a root with no parent asks the operator. Without this, "awaits the operator" would mean every performer's every question.
- Decisions — [[8105540f]]: a cheap typed model answer to a question about a text; its first consumer is the "addresses a human" event.
- Thread events and subscription — [[e82af907]]: a single owner of what happened to a thread, and an agent's subscription to any threads; this is what wakes the secretary without the operator's question.
- `read_attention` for the agent — [[b32812f7]]: the secretary sees the same "Attention" the operator sees under the bell.
- The secretary's definition and the leads' brief — [[c6dedc4]]: leads bring meaning (milestones, decisions, questions), facts come from the subscription.

## Order

Decisions and `read_attention` go first and in parallel. Events go after [[e46b150a]], because it changes whose question awaits the operator, and after decisions, on which "addresses a human" stands. The secretary and the brief go after events.

## Decided in the course of the work

- **A parent's answer to its child's question is final.** Raising the question to ancestors is gone: a question does not travel from great-grandchild through father and grandfather to great-grandfather. `agent.approves` narrows what the parent answers for; by default, everything.
- **`agent.worktrees` defaults to `allow` for all users.** In trust, a new worktree does not ask the operator; in review, it does.
- **Decisions default to the subscription's light model.** Decision models through OpenRouter are an optional road. Per [[6d391f5d]], the light model suffices for "addresses a human".
- **The secretary is a `tagma` agent with a note** (the `secretary` definition in the operator's personal library; the lead brief is its section). Any Tagma thread leads teams the same way when told so; the note is needed so a fresh thread with a clean context behaves this way without explanations.

## Done last

"Attention" shows the operator only questions whose approver is them ([[88b55e10]]). A line that does not wake a sleeping subscriber waits for its next turn in the inbox, and the next line of the same group removes it ([[1f559854]]).

## Deferred until experience with the secretary

- The creator's rights over a root they birthed: stopping, continuing, model change, archive, and rollback of such a thread currently need the operator's consent.
- A goal and outcome line in `list_agents`: reading economy, not a new capability.
- Comparison of decision models (Jev, Mercury Decide, the subscription light model) on labeled final root texts.
- A teams board in the interface.

The spec closes once its parts close; the operator's check is not a closing condition.
