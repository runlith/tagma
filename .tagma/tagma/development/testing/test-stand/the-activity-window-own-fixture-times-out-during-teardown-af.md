---
id: 01a188a5-13ca-7b6e-90ca-0f165186ea95
title: The activity-window own fixture times out during teardown after both tests pass
ord: 28
tags: ["reflection"]
fields:
  {
    "actual": "Both tests passed with all 28 assertions, then an unnamed beforeEach/afterEach hook hit the 180000 ms hang guard; one dangling process was killed, and the file failed after 192.12 s with 109.7 s world CPU.",
    "command": "testbed bun test --no-isolate --randomize --seed=3 ./src/composition/testing/native-harness/activityWindow.itest.ts",
    "expected": "The file closes its own door world and exits after its two test bodies pass."
  }
---
Filed from project `tagma`.

Seeds 1 and 2 completed green. The third process was bun test pid 56704; while teardown stood, its only remaining child was the testbed reaper shell pid 56734. Execution bddd051e-dd51-4d34-8fb4-f43d85c6a7f2:167 retains the whole run.