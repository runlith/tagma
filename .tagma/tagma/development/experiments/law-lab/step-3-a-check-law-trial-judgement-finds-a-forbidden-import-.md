---
id: 01a15653-a6a0-7f9b-978d-5f88be3f8cf7
title: Step 3 · A check_law trial judgement finds a forbidden import in an edit in a fraction of a second and records nothing
ord: 17
tags: ["experiment"]
fields:
  {
    "status": "done",
    "verdict": "confirmed"
  }
edges:
  - kind: validates
    to: 01a14c14-a11c-7ce8-9d84-6337de2c63cd
---
## Hypothesis

A `check_law` trial judgement with the built-in `loads` check ("`packages/domain` files do not load React, `@law-lab/ui` and `web`") finds nothing on a clean HEAD, finds a seeded import in an uncommitted edit, names the file, line and import, and records nothing.

## Setup

- law-lab at `95142140` (same code as `12cfb2a`; only graph commits moved), rule [[18ad9402]] without a check. Tagma is runlith at `887c1efb58`.
- The researcher thread assembles the check in the agent role: reads the catalogue `read_inspections` and sets `loads` with params `base: ""`, `from: ["packages/domain"]`, `refuses: ["react", "react/*", "react-dom", "react-dom/*", "@law-lab/ui", "web"]`, `allows: []`, `reads: "runtime"`, `conditions: []`, `files: {extensions: [".ts", ".tsx"], exclude: []}`.
- Violation — a new uncommitted file `packages/domain/src/summary.ts`, first line `import { formatCents } from "@law-lab/ui";`.

## Observation

- The `read_inspections` catalogue over 8 built-in checks — about 25 thousand characters of constraints and parameter schemas; `loads` has seven required parameters.
- `check_law` from the runlith thread refused `reach-empty` ("the region of 18ad9402 draws no code"), although the rule has a source: the operation has no `project` parameter, and the rule's reach is read from the caller's graph ([[7769efcd]]). Workaround — `tagma op check_law` with the working directory in law-lab; the CLI picked up this session's uncommitted lines.
- HEAD (`over: all`): 0 violations, judgement 316 ms, the whole CLI call 1.6 s.
- Edit (`over: change`): one violation — fingerprint `packages/domain/src/summary.ts -> @law-lab/ui`, file, line 1, specifier and chain `["@law-lab/ui"]`; judgement 292 ms; `refuses: false`, because the check is not switched on.
- After both calls `read_enforcement`: "1 rules, 0 enforced", no debt — nothing recorded.

## Conclusion

Confirmed: the trial judgement is exact, fast and safe — finds exactly the seeded import and changes nothing. The reply is JSON for the agent: what and where, without why it is a violation or how to remove it (those ways out live only in the check catalogue).

**What the user had to know or do on their own:** that the check exists at all and which of the eight fits; seven parameters from a 25-thousand-character catalogue — only an agent can do that; from another project's thread the judgement does not work without a workaround.
