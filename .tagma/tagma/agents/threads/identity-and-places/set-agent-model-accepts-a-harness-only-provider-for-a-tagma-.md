---
id: 01a10524-47f6-7498-b27c-0b3ba0eeeed4
title: set_agent_model accepts a harness-only provider for a tagma agent, and the next run dies in resolveModelCall
ord: 10
tags: ["reflection"]
fields:
  {
    "actual": "The move was accepted. Every continued run then failed at once with InvalidRequest \"Unknown model provider claude-code — this catalog registers: openai-oauth, …\". It cost four failed runs and a second move back. The tool's provider enum lists claude-code and codex next to the native providers, with no hint that they are harness-only.",
    "command": "set_agent_model {threadId: <tagma agent>, provider: \"claude-code\", model: \"claude-opus-5-5\"} then continue_agent, on four tagma-agent children after a StreamStalled",
    "expected": "set_agent_model refuses a provider that the tagma agent's model catalog cannot resolve (claude-code serves only harness agents), naming the providers this agent can run on"
  }
---
Filed from project `runlith`.