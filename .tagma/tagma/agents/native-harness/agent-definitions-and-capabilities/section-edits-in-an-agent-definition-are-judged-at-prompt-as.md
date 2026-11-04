---
id: 01a1469e-35ac-7306-b96e-049f79e579a1
title: "Section edits in an agent definition are judged at prompt assembly: a stale edit is an agent-invalid refusal, never a silent skip"
ord: 3
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a14688-9ec2-7207-a19e-51e825ea1840
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/agents/declared/files.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/agents/prompt.ts
---
`sections` in an agent file's frontmatter (`drop`, `replace`, `add` with `before`/`after`, `edit` with `find`/`with`) apply in order to the assembled doctrine document of the base agent; ids are what `read_agent` prints in `prompt.sections`. File parsing checks only each edit's shape (strictly: an extra key is a refusal), because section text depends on the project — settings, checkout facts, capabilities — and only assembly sees whether the section and passage exist.

A `tools` name no held capability can offer is refused at the same assembly and in the same three places (how, in [[c7432228]]).

So one `agent-invalid` refusal meets in three places: the `read_agent` preview, the thread's first run (the `instructions` port is synchronous and throws it, the core returns it as the run diagnosis), and `refresh_thread_instructions`. Without this, an edit whose passage doctrine rewrote would silently yield the base prompt under the variant's name — exactly what breaks A/B comparison.

Edits enter the thread's stored profile: a file edit takes effect on the next thread and preview, and an existing thread adopts the current profile through refresh for the next run. If the definition no longer composes, refresh refuses and keeps the old profile and prompt; the running run holds the open instructions. Dropping a missing section is also a refusal: it catches a renamed id too; the price is a personal definition touching a conditional section (`commit-steps`) refusing in a project without it.
