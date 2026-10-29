---
id: 01a0c3d0-8e5f-7688-9e8c-88e6517bd60e
title: A live tool world retains a ripgrep path removed from the installation
ord: 5
tags: ["reflection"]
fields:
  {
    "actual": "executionSpawner.spawn refused HostUnavailable: SpawnFailed — pipes: spawn: Error: ENOENT: no such file or directory, posix_spawn '~/.tagma/install/20260921T111507125Z/tools/rg'.",
    "command": "grep(pattern=\"export function agentToolOutputText|export const agentToolOutputText\", path=\"/opt/workspaces/runlith/packages/agent/src/agent/ToolOutput.ts\")",
    "expected": "Read the declared tool source using the running world's ripgrep executable."
  }
---
Filed from project `runlith`.