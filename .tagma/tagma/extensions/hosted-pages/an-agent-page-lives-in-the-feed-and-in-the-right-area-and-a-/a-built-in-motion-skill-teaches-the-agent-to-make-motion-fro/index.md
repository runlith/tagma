---
id: 01a16fd0-c6c1-7e28-ab9d-2a8d82d49afb
title: A built-in motion skill teaches the agent to make motion from user materials, verify frames, and deliver a card and MP4
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/native-harness/skills
---
## What the agent gets

A built-in `motion` skill next to `artifacts` (`apps/tagma/server/src/native-harness/skills/`). It loads when the agent is asked for animation, an intro, an animated chart, or an explainer clip. Its description names these cases so loading fires on the request's meaning.

## Tools

It has no tools of its own. Publication is given by the `artifacts` skill: `motion` instructions, like `showcase`, start with "load `artifacts` too" — a second skill with the same `publish_artifact` would crash the catalog (`mergeToolCatalogs` refuses on a repeated name, and the skill rule excludes an unloaded skill's tools by name). If `artifacts` is off in `skills.disabled`, the skill writes the page file into scratch and names the path, like `showcase`. Frames and the clip come to the agent as `read_artifact_frames` and `export_artifact_video` operations by the `artifacts` capability, not through the skill.

## What the instructions hold

Dense, only what the agent gets wrong without (the dense-prompt rule):
- **Declaration and fragment** verbatim: `tagma-timeline` JSON and the `tagmaTimeline` fragment with readiness, bridge, `getAnimations()`, and switching its own clocks off on the first `seek`. The agent writes only the declaration and the frame function.
- **Contract rules**: fixed-size scene, one theme with explicit colors, fonts and images only `data:`, no `localStorage`, a frame is a function of t; why (the server captures the clip with no network).
- **Rewindable means**: CSS animations (via the fragment), GSAP timeline `paused` + `seek`, Lottie `goToAndStop` — from allowed CDNs.
- **How to build**: storyboards with scenes over time before geometry; easing and pauses; one idea per frame; text held no less than reading time; SVG for signs and letters, Canvas for particles.
- **User materials**: attachments of the message first (the agent gets a file path); else logo, fonts, and colors from searching the project; nothing — ask. Raster is `data:`, vector inline.
- **Verify before delivery**: `read_artifact_frames` on draft path key k, view, fix; then publish; the clip is `export_artifact_video` when asked.

The `artifacts` skill in the same change stops forbidding frame capture for scale pages: the "never open or capture" ban stays for documents.

## Acceptance (performer)

- The thread skill catalog shows `motion`; loading `motion` with `artifacts` never crashes the catalog. Agent skill tools of the whole pool merge when the catalog builds, not on load (`agentSkillTools` in `packages/agent/src/agent/AgentSkill.ts`), so `composition/testing/native-harness/library.itest.ts` proves this: the thread catalog over `builtInSkills` (with `motion`) answers `load_skill` and `publish_artifact`, and the thread skill list matches the pool.
- A run: a Tagma agent in a clean thread gets an attached logo plus "make a 5-second motion intro and give MP4" and returns a card with a player and MP4, using only skills and operations. The run thread is named in the task as the sample.
- [[ea36cd32]] names `motion`.

## Where it stands

The skill is `skills/motion.ts` (commits fe25e5c219, 50ab9869b5): the skill takes the fragment and declaration from `artifacts/contract/wire/fragment.ts` and bounds from `timeline.ts`, not as a copy, so skill text moves with the contract. The run in a clean thread was never done: it is a live check (`tagma:try` with a model and a managed browser for frames and the clip), and the operator banned browser checks in this work ([[c6569513]]).
