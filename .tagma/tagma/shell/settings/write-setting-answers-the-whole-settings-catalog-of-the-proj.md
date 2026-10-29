---
id: 01a16155-4875-7a90-9098-4142cd1186f8
title: write_setting answers the whole settings catalog of the project instead of the key it wrote
ord: 12
tags: ["reflection"]
fields:
  {
    "actual": "About 30,000 characters: every section and key of the project's settings with descriptions and schemas; the written key is one line in it. Same on `rules.global.enabled` minutes before.",
    "command": "write_setting {project: \"law-lab-plain\", key: \"threads.harnessProfile\", value: {\"claude-code\": {\"plain\": true}}}",
    "expected": "The written key's new effective value and the project, as the tool description promises (\"Returns its new effective value and the project written\")."
  }
---
Filed from project `runlith`.