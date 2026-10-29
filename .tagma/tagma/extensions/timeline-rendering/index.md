---
id: 01a1700a-01ee-7877-a187-0c4a8f8c2801
title: Timeline rendering
ord: 31
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "page-render.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "layer.ts",
        "for": [
          "13182a9f",
          "ac637dff"
        ]
      }
    ],
    "id": "page-render",
    "order": [
      [
        "stage.ts"
      ],
      [
        "encoder.ts",
        "render.ts"
      ],
      [
        "mux.ts"
      ],
      [
        "mux.worker.ts",
        "film.ts",
        "clips.ts"
      ],
      [
        "layer.ts"
      ],
      [
        "page-render.ts"
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bf00-7c53-8428-280109c9ec78
  - kind: imports
    to: 01a14828-1f15-7e60-8663-f3c1496f9eb4
  - kind: imports
    to: 01a14828-bfa9-7e91-992b-e05c97a922df
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
  - kind: imports-tests
    to: 01a14828-bfac-7563-abdb-860cac637dff
sources:
  - kind: dir
    ref: apps/tagma/server/src/page-render
---
The server shoots a motion page's frames and clip in the browser, while the `artifacts` module knows no browser: it declares a timeline rendering port, and this module fills it over the `browser` module's hosts. It takes an unlisted shooting target of the needed size from a connected host, serves the page into it under the same CSP as the shelf, waits for evidence that the page is ready, and shoots frame k after `seek`. It encodes the clip with WebCodecs in a neighboring target of the same browser and assembles the MP4 in its own worker, filling the `Film` port, and the `browser` module's `Clips` port that writes page recordings. What to shoot and where to put frames is decided by `artifacts`; which browser and where it runs is the host adapter's.
