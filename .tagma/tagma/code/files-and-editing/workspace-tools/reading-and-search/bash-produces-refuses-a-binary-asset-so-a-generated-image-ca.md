---
id: 01a10e90-e5df-75be-81ac-d86529fd9261
title: bash produces refuses a binary asset, so a generated image cannot land as session work
ord: 7
tags: ["reflection"]
fields:
  {
    "actual": "Refused before running: \"…/coin.png could not be read as present or missing: it holds bytes that are not text. Nothing was run.\" Re-running without produces worked, but the answer says the written files are \"recorded against nobody, so submit_work lands none of it\" — the .webp the Svelte code imports has no landing road through the change record.",
    "command": "bash with produces: [\"<app>/src/lib/features/<feature>/assets\"] around `pnpm … image cli optimize … coin.png` (writes coin.webp)",
    "expected": "The command runs and the produced WebP (and the deleted PNG) are recorded as this session's work, so submit_work can land the asset with the markup that imports it."
  }
---
Any Figma-to-WebP asset step in that project hits this: the skill pipeline (download PNG → optimize CLI → keep only .webp) always produces binary files. A first dry-run with produces on the directory already printed "not read, nothing recorded: holds bytes that are not text" for the PNG, then the real run was refused outright. Cost: one refused call plus an asset the session cannot land without `whole` or a manual commit.