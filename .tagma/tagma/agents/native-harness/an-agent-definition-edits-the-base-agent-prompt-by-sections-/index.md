---
id: 01a14688-9ec2-7207-a19e-51e825ea1840
title: "An agent definition edits the base agent prompt by sections: replacement, removal, insertion, and pinpoint edit with a loud stale-edit refusal"
ord: 15
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/agents/declared/files.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/agents/prompt.ts
---
## What the user gets

A file agent definition takes the base agent prompt (for example `tagma`) as is and changes it by sections: replaces a section whole, removes it, inserts its own section at the chosen place, or edits pinpoint — an exact passage to new text. A file edit takes effect on the next thread and on the `read_agent` preview with no server restart: files are read at every type resolution, as now. This serves A/B experiments over agent behavior and users assembling their own agents.

## Format

The `sections` key in frontmatter is a list of edits applied in order to the assembled prompt document:

```yaml
---
extends: tagma
sections:
  - drop: keep-warm
  - replace: answering
    text: |
      ## Answering
      …
  - add: my-section
    after: commits          # or before: <id>
    text: |
      ## My Section
      …
  - edit: graph-writing
    find: "never the operator's authorization.\n"
    with: "never the operator's authorization. A norm …\n"
---
```

- A section id is what `read_agent` prints in `prompt.sections[].id` (`preamble` for identity, `graph-writing`, `commits`, …). Doctrine-document sections are addressable; the file body addition (`overlay`) and the core collaboration source (`collaboration-source`) are appended after the edits and are not addressed by edits.
- `find` is searched exactly, with line breaks, as the text stands in preview; the passage must occur in the section exactly once.
- A definition body with `extends` may be empty: then the prompt is inherited with no addition. A standalone definition's body is still its identity and required.
- Each record is exactly one shape; an extra or missing key rejects the file at parse time (the library `rejected` list, `save_agent` refusal).

## Where failure is loud

An edit whose section is missing from that prompt, whose `find` is not found or found more than once (overlapping occurrences count), or whose `add` repeats a standing id is an `agent-invalid` refusal with the edit number, reason, and the sections standing at that moment. `read_agent` answers it; the thread's first run fails with it (the parent receives it as the run diagnosis) and `refresh_thread_instructions` refuses with it. There is no silent skip. Checking happens at assembly, not at file parse: section text depends on the project (settings, checkout facts, capabilities), and only assembly sees whether the passage exists. Hence the price: a personal definition that edits or removes a conditional section (for example `commit-steps`) refuses in a project without that section — dropping a missing section is also a refusal, because it catches a renamed id too.

## Mechanism

- `@runlith/agent` (`thread/agents/AgentProfile.ts`): the `SectionEdit` type and schema, the `AgentProfile.sections` field. The profile is the definition snapshot at thread birth, so edits live in it and survive restart as part of the thread row.
- threads (`contract/wire/agentLibrary.ts`): `sections` in frontmatter and in `AgentFile`, strict list parsing.
- native-harness: `declared/files.ts` parses, `declared/agentFiles.ts` carries into the profile, `agents/prompt.ts` applies the edits to the assembled document (`editedPrompt`), `effectiveAgent.agentPrompt` assembles base and edits, `composeAgent` and `library.preview` are the two consumers of one path.
- One current shape: the profile `prompt`/`instructions` do not change, no new modes.

## Acceptance

The performer proves:
- a test over `editedPrompt`: every shape changes the document as stated; a missing section, an unfound and an ambiguous passage, a repeated `add` are a typed refusal;
- a library test: previewing a file with `extends: tagma` and edits shows the changed section, a stale `find` shows an `agent-invalid` refusal; a file edit is visible to the next preview with no restart;
- `bun run typecheck` of the affected packages;
- a live check on its own instance (`tagma:try`): preview and spawn of an agent with an edit.

The operator verifies: the `~/.tagma-dev/agents/tagma-normrule.md` agent after one restart of its own server (the mechanism is server code).
