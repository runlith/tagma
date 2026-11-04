---
id: 01a1a889-599f-7b9d-88cf-16e9758900dc
title: A built-in reader definition answers one question with read tools, graph first, without the project's law in its prompt
ord: 1
tags: ["spec"]
fields:
  {
    "status": "open"
  }
---
**Today's floor (measured with `read_agent` in the tagma checkout, 2026-11-04).** A definition without `extends`, capabilities `[files, shell]`, tools `read, grep, glob, ls`, every inherited section dropped, composes 28.5k characters at start: 0.3k its own prompt, 9.3k tool schemas, 18.7k project `prompt` law that no definition can drop. Adding `graph` raises it to 76k: vocabulary 17.4k, map 7.5k and the graph-writing sections. The full Tagma agent composes 132.5k. Reading files also delivers the code rules sourced to them — one read of a server file brought about 10k characters of rules.

**Instruction audience `reader`.** Beside `graph` and `executor` (`InstructionSet.audience`, chosen by `instructionAudience` in `native-harness/agents/effectiveAgent.ts`), a third audience carries no `prompt` law, no vocabulary and no map, and on reads delivers `#explanation` notes but not code rules. Reason: law binds work — writing, committing, testing — and a reader changes nothing; the caller, which carries the law, acts on the answer. Explanations are what a reader answers from. A definition selects the audience; it is not inferred from tools.

**Built-in definition `reader`.** Capabilities `files`, `shell`, `graph`; tools `read`, `grep`, `glob`, `ls`, `read_owners`, `search_blocks`, `read_block`, `read_zone`, `answer`; every inherited section dropped; audience `reader`; no model of its own (the call picks). Its body, about a thousand characters, says:
- answer the one question asked and stop as soon as it is answered: a digest, not a survey of the area;
- graph first — `read_owners` for a named path, `search_blocks` for words, `read_block` for what they return; the code when no block owns the place or the block does not answer;
- read the lines that answer, never whole files or areas;
- cite every claim as `path:line` or a block name, and say what was not found;
- answer in the question's language, and end only with `answer`.

**Acceptance.**
- `read_agent` of `reader` in this checkout composes under 20k characters at start, its own prompt under 1.5k, with no law, vocabulary or map.
- Its tool catalog is exactly the tools above plus the conversation tools every definition keeps.
- A read by a `reader` thread delivers the explanation notes over that file and none of its code rules.
