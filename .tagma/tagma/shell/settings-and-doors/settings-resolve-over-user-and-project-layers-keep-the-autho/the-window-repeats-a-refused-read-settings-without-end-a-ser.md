---
id: 01a15066-7f7b-7499-a814-c81d31ef22de
title: "The window repeats a refused read_settings without end: a server refusal must not trigger a new settings-catalog request"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15068-1fad-7f33-8b9f-f4611d4db8ad",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/settings/SettingsRepo.ts
---
Measurement (one, demo build, 2026-10-18): the player answered `read_settings?project=3` with a `demo-unavailable` refusal (409, not retriable per `retriable` in `lib/wire/refusal.ts`), and in ~30 s the window sent this request 6,443 times. With a real server the same will happen on any standing refusal of the project's settings catalog.

The cause is confirmed through a real `Dictation`, `SettingsRepo` and `Door`: `watch()` subscribes the effect to cache changes, and `load()` starts a new request after every refusal while data is missing. The same loop stands in `Global` and `Calls`; at `TerminalAppearance` loading was untracked and gave no loop, but the observer was not retained either. All four readers take `.data` before the mutation's result is chosen; query owns loading and error; the explicit `load()` in the kit was unchanged. On the operator's instruction this pattern and its cause are recorded in `.agents/skills/frontend/SKILL.md`.

Checked: the new `SettingsRepo.svelte.test.ts` failed before the fix with `expected 2 to be 1` for `demo-unavailable` and `expected 5 to be 4` for `transport`; after the fix the typed `Refusal` stays on the entry, there is exactly 1 request and `RETRIES + 1`. For the bounded red run the transport answers an extra request with a successful catalog. Both touched test files — 13/13; the app's `bun run typecheck` — 0 errors, one pre-existing a11y warning `CastView.svelte:243`. An independent review of the whole delivery, including the frontend skill: openai-oauth/gpt-6.1-sol, xhigh — no remarks.
