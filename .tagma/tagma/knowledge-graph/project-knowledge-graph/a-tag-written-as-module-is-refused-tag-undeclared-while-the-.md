---
id: 01a18480-a89e-7cf2-92d7-9f2005de0731
title: A tag written as `#module` is refused tag-undeclared while the refusal lists `#module` as declared
ord: 244
tags: ["reflection"]
fields:
  {
    "actual": "refused[tag-undeclared] \"this project declares no ##rule\", unblock: \"the tags this project declares: #tag, …, #rule, …\" — 5 refusals in 5 GPT Terra threads of experiment 364dab23, each costing a resubmission",
    "command": "create_block tags:[\"#rule\"] parentId:\"bb2fff6b\" in project hono (and apply_batch create with tags [\"#module\"] / [\"#explanation\"])",
    "expected": "The tag word `#rule`, the spelling every instruction, read_tags line and refusal gives a tag, names the declared tag rule and the block is born"
  }
edges:
  - kind: discovered-from
    to: 01a1844a-f044-78b6-bc37-d796364dab23
---
Filed from project `tagma`.

Measured over all 18 threads of project hono (id 43): 5 `tag-undeclared` refusals, every one a `#`-prefixed tag word (`##module` twice, `##explanation` twice, `##rule` once); each agent recovered alone by dropping the `#`. The refusal is produced in `resolveTags` (`apps/tagma/server/src/graph/blocks/birth.ts`), which prints the declared tags as `#name` while `table.tagById` takes only the bare id, so the way out it names is the spelling it just refused. Prompts render tag declarations as `#module [project:N]`, which is where the models take the spelling from.