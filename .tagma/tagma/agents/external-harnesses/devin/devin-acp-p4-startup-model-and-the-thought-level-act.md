---
id: 01a108dc-1b0b-7ffb-8957-4c61a9546793
title: "Devin ACP P4: startup --model and the thought_level act"
ord: 5
tags: ["research"]
fields:
  {
    "source": {
      "name": "devin acp 3000.11.3, probes of 2026-10-04: --model sonnet, set_config_option thought_level medium/low; frames probes/devin/s4model.jsonl, s4thought.jsonl, s4thought2.jsonl",
      "ref": "scratch 01a10407-8719-764b-9fac-8b1d83b24de9/probes/devin/"
    }
  }
---
# Devin ACP P4: startup --model and the thought_level act

Live probe of `devin acp` 3000.11.3, 2026-10-04. Raw frames: `probes/devin/s4model.jsonl`, `s4thought.jsonl`, `s4thought2.jsonl`.

## Measured

**Startup `--model` works.** `devin acp --model sonnet`: a new session starts with `model.currentValue = claude-sonnet-5-medium` (fuzzy match by family). Side effect: with that model the default `thought_level` is `low`, while with `swe-2-high` it defaults to `high` — the step default depends on the model. The `DEVIN_MODEL` equivalent from `--help` was not checked.

**`thought_level` via `set_config_option` acts and shows in turn marks.** Allowed values depend on the model: for SWE-2 `low` is rejected with `-32602 "Invalid value 'low' for config option 'thought_level'"` (tuple `medium|high|max`). Setting `medium` is accepted; the next turn: `turn_stats.responseDimensions` — model `SWE-2 Medium`, `agent_stopped.stats.modelLabel` — `SWE-2 Medium` (on default `high` both are `SWE-2 High`). The mark suffix repeats the option value one to one.

**`session/set_mode` works** (checked in passing for ask/smart/accept-edits): answer `{}`, dispatch of `config_option_update` + `current_mode_update`.

## Conclusion for the profile

The session model is set by startup `--model`/`DEVIN_MODEL` and changed via `set_config_option model` strictly to values from `configOptions` (a foreign one is `-32602`). `thought_level` is a separate axis with the same rule; its effect is proven by the model mark in `turn_stats`/`agent_stopped`, with no separate field in the prompt answer.
