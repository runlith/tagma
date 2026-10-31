---
id: 01a0c6fd-caf6-71b7-ae07-f6ae0e2f2094
title: Error boundary
ord: 34
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/error-boundary-config.svelte.ts",
        "for": [
          "de36c9fd",
          "7b63e87f",
          "59cc3c49"
        ]
      },
      {
        "at": "src/ErrorBoundary.svelte",
        "for": [
          "cb732496",
          "de36c9fd",
          "3724cd7a",
          "7b63e87f",
          "59cc3c49"
        ]
      },
      {
        "at": "src/policy.ts",
        "for": [
          "de36c9fd"
        ]
      },
      {
        "at": "src/reporter.ts",
        "for": [
          "de36c9fd",
          "7b63e87f"
        ]
      },
      {
        "at": "src/ThrowError.svelte",
        "role": "testing"
      },
      {
        "at": "src/types.ts",
        "for": [
          "cb732496",
          "de36c9fd",
          "3724cd7a",
          "1c9696ea"
        ]
      }
    ],
    "id": "@runlith/error-boundary",
    "kind": "kit"
  }
sources:
  - kind: dir
    ref: packages/error-boundary
---
A failure in one part of the interface must not take down the rest: in Svelte async mode an effect that throws without a boundary stops all effects of its root for good. The package is a Svelte boundary the host wraps around every independent part — dialog, launcher, chat feed row, shell area: it catches the fallen child component, reports it through the reporter, and renders a fallback with a bounded retry count. It passes a SvelteKit redirect and an HTTP error upward without a report, while for an error handed in from outside the fallback retries without limit. Where reports go, what the fallback shows, and how many retries are allowed is decided by the config the host places in the context above the boundaries; without it the report goes to the console and the fallback is the default block.
