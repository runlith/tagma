---
id: 01a175fa-9f3f-7833-88a2-6c7f407417bb
title: read_output loses finished output after reading a running command
ord: 13
tags: ["reflection"]
fields:
  {
    "actual": "Returned ended, exit 0, and \"(its output is no longer kept on this host)\": the test's final stdout lost after the previous running for 34 s read.",
    "command": "read_output({execution:\"f9c12fe7-6a60-49b9-b9d2-50dbab806ea8\",incarnation:167,wait:60,tail:65})",
    "expected": "Return the remaining output and the outcome of the command launched via bash and still running at the previous read."
  }
---
Filed from project `runlith`.

The command launched x64 Bun under Rosetta: process.arch = x64, then the testbed with runner.itest.ts and install.itest.ts. The first read_output showed five install.itest.ts passes and "1 workers left", but runner.itest.ts was still working. The next read_output waited for the end, named exit 0, but kept no final stdout. No need to rerun the launch for the lost output: the exit code is known.
