---
id: 01a10bb6-f943-7483-9b2e-29edc5ab447d
title: Holding the global hotkey belongs to the Tagma window or the pill from press to release, and is swallowed only while no Tagma window is focused
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/desktop/src/Dictation.ts
  - kind: file
    ref: packages/desktop-input/native/desktop-input/Sources/desktop-input/EventTap.swift
---
Holding the global hotkey belongs to the Tagma window or the pill from press to release. The `desktop-input` tap is active: the global-hotkey chord (default `⌥ Space`) never reaches the active app while no Tagma window is focused, otherwise holding would type non-breaking spaces into it with auto-repeat. While a Tagma window is focused, main lifts the swallowing and the window's own key handling hears the same key. Main decides the hold's owner once, at its start: a focused Tagma window or an unready pill means a local hold, and its release is not passed to the pill; otherwise it is global until its release. The helper does not start a hold from auto-repeat, so a focus change mid-press never births a second dictation, and a binding change mid-press takes effect after release.

Main arms the tap from the global set the window publishes: the one global with `hold: true` (`dictation.hold`) goes to `Dictation` as a host chord, and `keyCodes.ts` turns it into the helper's binding. The answer the person sees for that chord comes from Dictation's state — untrusted is `needs-accessibility`, unavailable carries its reason, otherwise `held`.

Swallowing and the global hold turn on only with Accessibility trust and once the pill has confirmed it is listening (`ready`); otherwise the press passes through to the app. `Esc` during the pill is not swallowed: main hands it to the pill as cancellation, and the active app receives it too.