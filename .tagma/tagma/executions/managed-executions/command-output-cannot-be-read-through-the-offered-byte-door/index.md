---
id: 01a0c4eb-6321-786a-a7b4-92ae78b567fd
title: Command output cannot be read through the offered byte door
ord: 73
tags: ["reflection"]
fields:
  {
    "actual": "Refused terminal-unknown although wait_command reports stdout durableThrough=784 and record available. No command-byte read operation is offered.",
    "command": "read_terminal_bytes execution=b68d7889-3a95-4e78-889c-eb4538d0fad8 incarnation=20 stream=stdout offset=0",
    "expected": "Read stdout of the completed background bash command; read_command and wait_command both confirm the command and retained stdout."
  }
---
Filed from project `runlith`.