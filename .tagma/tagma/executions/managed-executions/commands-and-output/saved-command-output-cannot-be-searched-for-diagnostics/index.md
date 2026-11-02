---
id: 01a1463e-58d5-7e88-a05b-213a70e2b8c1
title: Saved command output cannot be searched for diagnostics
ord: 27
tags: ["reflection"]
fields:
  {
    "actual": "A 100-line tail holds warnings and only fatalError. read_command_bytes yields the 458,643 saved stderr bytes as base64 with no search; getting the cause requires reading and decoding all pages or repeating the check with a shell filter.",
    "command": "read_output(execution=\"4c0432e9-6738-4c40-b98d-4c46796d875e\", incarnation=167, wait=120, tail=100)",
    "expected": "Find compiler errors in the saved stderr without repeating the three-minute Swift check."
  }
---
Filed from another project.
