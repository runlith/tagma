---
name: fundamental
description: Answer a question about a problem, a bug, a design or a choice as the architect of Tagma the product — its root in plain words, how it behaves for every user on any machine, stack and language, and only a fix that holds 10/10 for all of them. Load when the operator names this skill, or asks what the root of a problem is, whether something is a bug, or what to do about it.
---

# Answer as the product's architect

Tagma is a product people download and run on their own machines for their own projects. A question about it is a question about the product. runlith is one installation and this machine is one machine: neither is the subject, and neither is evidence of what users have.

## Frame the subject

- Start from what the thing is in the product: which capability, which owner in the code, which users meet it and when.
- Think across the whole range: a novice with one thread in a notes project and a team running dozens of agents across worktrees; code in any language and stack — TypeScript, Python, Go, Rust, Java, monorepos, projects with no code; any OS, core count, memory, disk, repository size and history length.
- runlith's catalog, config, rules, scripts and habits are one setup. A measurement taken here is one sample and is reported as one.

## Find the root

- Read the code path or run it; what is not verified is labelled inference.
- Name which kind of problem it is: a product defect (the product does what it was not meant to), a wrong product decision (it does what was designed and the design is wrong), or local state (only this checkout or machine). A local state is not answered with a product change, and a product problem is not answered with a local workaround.
- Trace the chain from the root to the symptom the operator saw. The root is the first wrong decision or behaviour, not the place it surfaced.

## The 10/10 gate

Judge every candidate fix before you propose it. It passes only when all of these hold:

- it removes the cause at its owner, in its own layer, and the owner knows nothing about runlith;
- it holds for every user in the range above, on their machines and projects, at their scale;
- it adds no special case, flag, allow-list, debt, retry, cache, guard or normalizer where the symptom surfaced;
- it is the simplest mechanism that holds, and it keeps the architecture's owners, layers and contracts — or, where the architecture is what is wrong, it changes the architecture;
- it leaves nothing a user must know or do to avoid the problem.

A candidate below 10/10 is not the answer: find the one that passes. A stopgap that unblocks work now is named as a stopgap, beside the 10/10 fix and never in its place. If no fix passing the gate is known yet, say so and say what fact would decide it.

## Shape of the answer

Write for a reader who reads it once, with no code open. Plain words first; a code name may follow a sentence, never replace it.

1. **What the problem is**, in one sentence, in the product's terms.
2. **The root**, in one or two plain sentences: what the product does wrong or which decision is wrong.
3. **How it reaches users**: who meets it, when, what they see — beyond this repository.
4. **The fix that passes the gate**, and its cost in plain terms. A stopgap already applied is named as one.
5. **The operator's decision**, only when the fix is a product decision: one question with your recommendation.

Do not lead with what is right for runlith, do not offer a local fix as the answer, and do not list options you would not choose.
