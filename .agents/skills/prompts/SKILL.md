---
name: prompts
description: Write or change any text Tagma gives an agent — a system prompt section, a tool or operation description, an agent definition, a built-in skill, a tag or catalog declaration, a refusal's reason and way out, runtime guidance. Load before adding, rewording or removing such text, and before fixing an agent's misbehaviour in its prompt.
---

# Write what Tagma tells an agent

Every sentence Tagma gives an agent is read by every agent of every user it reaches, on every turn: a user on a small subscription who counts each token and one who never counts them, a novice with one notes project and a team running dozens of agents, on any model, in any language and stack. A prompt is a set of universal recommendations for how an agent works. The shorter it is, the better it is followed and the less it costs.

## A norm, never a case

- Write the norm for a whole class of situations; it reads true in any project, for any user and model.
- A misbehaviour seen in one thread is fixed by finding the norm it broke. Where a sentence already states that norm, fix the word that let it be misread and add nothing. Add a sentence only when no norm covers the class.
- No example taken from what happened, no ban on the one reason an agent gave, no list of phrasings to recognize. An example stays only where without it the reader applies the norm wrongly, written as a case of the norm.
- One norm, one place: search the existing text for the subject before writing. A norm stated twice drifts apart.

## Every budget

- A recommendation that spends — agents, model calls, reads, retries, checks — states when the spending pays, in what the user gets for it. Assume neither an unlimited budget nor scarcity: the operator's settings and words set the budget.
- A criterion names whose cost or limit it weighs: the user's tokens, the agent's own context, the operator's time. Left unnamed, it is read as the agent's own convenience.

## Dense

- Keep only the conditions, distinctions and reasons the reader would otherwise get wrong; strike every sentence whose removal changes no behaviour.
- A reason stands only where without it the instruction is applied wrongly.
- Name only what exists: the current mechanism, with no history, removed features or statements of absence.
- No model names, reasoning levels or model-choice policy: the operator's model rows decide.
- No ids, people, repositories or machines: the text reaches every installation.
- State a norm once and plainly, with no capitals or repeated warnings for emphasis: emphasis makes a model apply the norm beyond its condition.
- English, in the product's own terms, one term per concept.

## Words

- Name the subject of each norm — who decides, whose cost, which place. A word the reader can bind two ways is the most common cause of a misread.
- An instruction says what to do; a mechanism says what happens. Keep them apart, and never explain a mechanism the agent cannot act on.

## Where the text lives

- Text belongs to the module whose mechanism it describes. Find a sentence by searching its words and change it there, so text and mechanism change together.
- A change to a mechanism changes its text in the same change.

## Checking a change

- Read the text as the agent receives it: read_agent previews a definition as startup composes it, read_thread_agent reads a thread's frozen prompt.
- Where behaviour is in doubt, give realistic tasks to child agents on more than one model with the changed text and read their threads. Measure only what is in doubt.
- No test pins prompt text.
