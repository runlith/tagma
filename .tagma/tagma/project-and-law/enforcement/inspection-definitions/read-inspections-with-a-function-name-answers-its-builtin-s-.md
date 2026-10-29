---
id: 01a1614f-cef9-7243-95ea-77b32838f20e
title: read_inspections with a function name answers its builtin's params, not the function's own signature
ord: 8
tags: ["reflection"]
fields:
  {
    "actual": "It printed `params of { builtin: 'size', params }: { base?, files?, thresholds: [...] }`; a config written from it (`Files.maxLines({ thresholds: [...] })`) refused config-invalid \"Expected number at thresholds[0].lines\".",
    "command": "read_inspections {project: \"law-lab\", name: \"Files.maxLines\"}",
    "expected": "The signature of `Files.maxLines` as tagma.config.ts calls it: `maxLines(lines: number, { by?, files?, base? })`."
  }
---
Filed from project `runlith`.

The public function in `packages/tagma/src/rules/rules.ts:81` takes the ceiling positionally and `by` for extra thresholds, building `thresholds: [{ glob: '**', lines }, ...by]`; the description the door returns is the builtin's decode schema. `Imports.modules` and `Code.noReexports` happen to take the params object as is, so only wrappers that reshape are misdescribed. One wasted config round; the skill says "Describe no builtin from memory: read_inspections with name answers its signature", so an agent trusts this answer.