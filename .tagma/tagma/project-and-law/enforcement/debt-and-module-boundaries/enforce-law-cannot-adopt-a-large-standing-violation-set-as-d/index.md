---
id: 01a13b77-4529-732b-99ed-2fe273ee6a06
title: "enforce_law cannot adopt a large standing violation set as debt: owners is an inline per-fingerprint map with no bulk owner or file input"
ord: 10
tags: ["reflection"]
fields:
  {
    "actual": "The write landed at once with every violation recorded as escaped (no prepare stage shown); making them debt needs `absorb` + `owners` listing each ~130-character fingerprint inline — about 190k tokens for the 5689-entry rule — so the large rules were left escaped instead of owned debt.",
    "command": "enforce_law {blockId: \"373e29e4\", strictness: \"gate\", inspection: runlith-law effect-style …} on a rule whose first measure finds 83 violations; sibling rules find 1496, 1864 and 5689",
    "expected": "One act adopts every violation the first measure finds as debt owned by one named task (e.g. an `ownAll: <task>` or an owners file), so a style rule over an existing codebase starts at gate with honest, owned debt."
  }
---
Filed from project `runlith`.

Rules: 8fcfef49, df923180, bc8f1e15, 373e29e4, 01ba3d55, d270a238 (effect-style check, 9566 standing sites in total). The intended owner of all of them is one migration task (449dfe0d). Long payloads are meant to ride as files, but enforce_law takes no file and no bulk owner.