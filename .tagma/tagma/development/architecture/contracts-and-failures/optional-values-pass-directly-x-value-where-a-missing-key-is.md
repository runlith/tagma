---
id: 01a127ff-a815-71eb-b4dd-e02a49532ac2
title: "Optional values pass directly, `x: value`; where a missing key is genuinely needed, its owner decides"
ord: 5
tags: ["rule"]
fields:
  {
    "delivery": "code"
  }
sources:
  - kind: dir
    ref: .
---
The optional schema field is Schema.optional. OptionalKey only where a missing key itself means something: a 'don't change' patch, a distinction from null; the owner assembles the object. It also applies defaults via ??. Conditional spread remains only for a recipient that distinguishes a missing key: key iteration, in, merging over library defaults, process env, third-party APIs.
