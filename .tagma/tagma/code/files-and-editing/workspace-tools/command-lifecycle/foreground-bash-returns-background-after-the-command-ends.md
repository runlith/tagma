---
id: 01a14652-48dc-7196-8d84-c42b8fd6b50c
title: Foreground bash returns background after the command ends
ord: 15
tags: ["reflection"]
fields:
  {
    "actual": "The call returned “Moved ... to the background” with no stdout. An extra read_command showed the native process succeeding in 77 ms with EOF on all streams; the completion notice arrived only after that extra check, about 7.8 s after admission. The source became readable after one extra call.",
    "command": "bash({command:\"git -C external/vercel-ai-sdk ls-tree -r --name-only 8a5233b packages/google/src | rg -v '(/(__fixtures__|realtime|speech-translation)/|\\\\.test\\\\.ts$|google-batch\\\\.ts$)'\", description:\"Audit Google source inventory excluding explicit exclusions\"})",
    "expected": "With a foreground wait of 120000 ms, return the finished command's stdout and exit status in one call."
  }
---
Filed from another project.

Execution 00899e9d-0069-433f-9369-3b5b3a22a676:167. read_command: admittedAt 1792181113792, native end 1792181113869, readAt 1792181121560; waitMs 120000, no command rules, retention retained, cleanup complete.
