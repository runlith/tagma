---
id: 01a12395-9b58-78c0-9bc7-fede932122c8
title: "Plugins, stage 3: the schedule and notify points — a plugin's schedule and notifications through their owners"
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12395-c3c5-763e-8ec3-0b0e9e3b0f71",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
---
The owners are ready: schedule ([[5ab2fae5]], the `Ticks.deliver` port, currently a stub in `composition/ticks.ts`) and notify ([[4c312ffd]], the `Outcomes` port, currently a stub in `composition/outcomes.ts`). The manifest's `schedule` point declares the plugin's schedules (name, period, tool); a tick is the process's tool call with caller `tagma {reason}`; enabling and disabling the plugin declare and drop its schedules. The `notify` point lets the plugin `send_notification`; the answer's outcome is delivered by calling the plugin's tool. The stubs are replaced with owner dispatch. Points are declared through `PluginPoints.declare`, `plugins` is untouched.

Done when an integration test with a test plugin shows: a scheduled tick calls the tool with caller `tagma`; disabling the plugin drops the schedule; the plugin's notification reaches “Attention”, and the operator's answer reaches the plugin's tool exactly once.
