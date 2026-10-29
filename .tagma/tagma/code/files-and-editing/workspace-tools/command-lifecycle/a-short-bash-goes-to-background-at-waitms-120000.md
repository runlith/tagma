---
id: 01a14055-c916-7d7f-b8c0-c50da2994983
title: A short bash goes to background at waitMs 120000
ord: 14
tags: ["reflection"]
fields:
  {
    "actual": "bash answered Moved ... to the background with no stdout; the result arrived as a separate notice. read_command d1c75884-d1de-4395-a9da-4e670acbd382:166 showed ended/exit0, elapsedMs37, CPU36660us, cleanup complete. Disclosing the tool and a separate read were needed; queue time is not measured by this read.",
    "command": "bash({command:\"rg -l 'Effect\\\\.runPromise|Effect\\\\.runSync|ManagedRuntime|\\\\.runPromise\\\\(|\\\\.runSync\\\\(' packages/agent/src --glob '*.{test,itest}.ts'\",description:\"List remaining agent test files with direct runners\",waitMs:120000})",
    "expected": "Return the six paths of the finished search directly in the bash answer, within the stated wait."
  }
---
Filed from project `runlith`.
