---
id: 01a0c83d-a829-7d4b-bfbb-6824de36c9fd
title: Overlays and popups
ord: 37
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/testing.ts",
        "role": "testing"
      },
      {
        "at": "src/collection.svelte.ts",
        "for": [
          "57643bc7"
        ]
      },
      {
        "at": "src/dialog-handle-context.svelte.ts",
        "for": [
          "3724cd7a",
          "96400e93"
        ]
      },
      {
        "at": "src/dialog/index.ts",
        "for": [
          "57643bc7"
        ]
      },
      {
        "at": "src/DialogHost.svelte",
        "for": [
          "7b63e87f"
        ]
      },
      {
        "at": "src/DialogRegistry.svelte.ts",
        "for": [
          "78f56704",
          "7b63e87f",
          "9e843257"
        ]
      },
      {
        "at": "src/float.svelte.ts",
        "for": [
          "3724cd7a",
          "57643bc7"
        ]
      },
      {
        "at": "src/LauncherHost.svelte",
        "for": [
          "7b63e87f"
        ]
      },
      {
        "at": "src/Launchers.svelte.ts",
        "for": [
          "7b63e87f"
        ]
      },
      {
        "at": "src/layer.svelte.ts",
        "for": [
          "57643bc7"
        ]
      },
      {
        "at": "src/layers.ts",
        "for": [
          "3724cd7a"
        ]
      },
      {
        "at": "src/menu.svelte.ts",
        "for": [
          "3724cd7a",
          "57643bc7"
        ]
      },
      {
        "at": "src/Overlay.svelte.ts",
        "for": [
          "78f56704",
          "3724cd7a",
          "7b63e87f",
          "1c9696ea",
          "a8449383",
          "c89f382f",
          "96400e93"
        ]
      },
      {
        "at": "src/OverlayLayers.svelte.ts",
        "for": [
          "a8639e52",
          "3724cd7a",
          "96400e93"
        ]
      },
      {
        "at": "src/place.ts",
        "for": [
          "3724cd7a",
          "57643bc7",
          "96400e93"
        ]
      },
      {
        "at": "src/popover.svelte.ts",
        "for": [
          "3724cd7a",
          "4f0a6d9b",
          "57643bc7"
        ]
      },
      {
        "at": "src/Portal.svelte",
        "for": [
          "57643bc7"
        ]
      },
      {
        "at": "src/select.svelte.ts",
        "for": [
          "57643bc7"
        ]
      },
      {
        "at": "src/tooltip.svelte.ts",
        "for": [
          "2dc811be",
          "57643bc7",
          "1c787f5f",
          "96400e93",
          "75634f54"
        ]
      }
    ],
    "id": "@runlith/primitives",
    "kind": "kit"
  }
edges:
  - kind: imports
    to: 01a0c6fd-caf6-71b7-ae07-f6ae0e2f2094
  - kind: imports
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: imports
    to: 01a0c704-a612-7c4c-9f81-5089acc2829b
sources:
  - kind: dir
    ref: packages/primitives
---
Everything rising above the page must stand in one order and close one way, or a tooltip goes under a dialog and Escape closes the wrong layer. The kit owns that whole. The overlay queue behind the `Overlay` door decides which dialog or launcher to show now. The layer stack, one per document, owns depth, closing, anchor placement, focus, and outward projection. Collection navigation and menu, popover, select, tooltip, and dialog behavior are state classes and attachments, with no decoration classes. The look of those components, their texts, notifications, and where the hosts mount are the app's business (`apps/tagma/app/src/lib/shared/ui`).
