---
id: 01a12889-c950-77d9-8c83-8e7d8b2c2da3
title: bash did not show a finished test's kept stderr after HostRefused
ord: 3
tags: ["reflection"]
fields:
  {
    "actual": "bash answered `(no output)`, exit1 and `stdout stopped answering: HostRefused`. read_commands confirmed the ending; read_command_bytes read stdout28 and stderr3835 bytes with no gap, with all 4 pass / 2 fail results.",
    "command": "bash: bun test --max-concurrency=1 ./src/composition/testing/tempo.itest.ts, lifeMs=60000, waitMs=60000",
    "expected": "A finished test returns its kept stdout/stderr and exit status."
  }
---
Filed from project `runlith`.

Run 4c42550c-fbb1-4272-87b9-e055c94509c3, incarnation158. No test repeat was needed for the output: the kept bytes read through a separate door. Current investigation recovered the original bash and byte-read records: the HostRefused subtype is absent. The public bash regression in the related task reproduces a separate contributing defect: a failed stdout reader cancels the healthy stderr reader. Preserving that stderr does not establish or repair the original host-subscription refusal.
