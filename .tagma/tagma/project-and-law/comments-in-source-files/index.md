---
id: 01a0c703-263a-7a49-8a3d-0bfdc70821a1
title: Comments in source files
ord: 39
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/classify.ts",
        "for": [
          "edf810fe",
          "7a70e34e",
          "b824564e",
          "f92da92b",
          "9e75d459",
          "06405a5f",
          "d962023e",
          "71f4b029",
          "6cc306ce",
          "00ddf0e5",
          "d12dd963",
          "f3b6b585",
          "09c9ec78",
          "90491249",
          "7abcb9a1",
          "9bb175ec",
          "c6922284",
          "9543a701",
          "73985c29",
          "1a45453a",
          "ab05dfec",
          "287a4906",
          "be68a750",
          "13182a9f",
          "5565be05"
        ]
      },
      {
        "at": "src/index.ts",
        "for": [
          "edf810fe",
          "7a70e34e",
          "b824564e",
          "f92da92b",
          "9e75d459",
          "06405a5f",
          "d962023e",
          "71f4b029",
          "6cc306ce",
          "00ddf0e5",
          "d12dd963",
          "f3b6b585",
          "09c9ec78",
          "90491249",
          "7abcb9a1",
          "9bb175ec",
          "c6922284",
          "9543a701",
          "73985c29",
          "1a45453a",
          "ab05dfec",
          "287a4906",
          "be68a750",
          "13182a9f",
          "5565be05",
          "520698f4"
        ]
      },
      {
        "at": "src/language.ts",
        "for": [
          "edf810fe",
          "7a70e34e",
          "b824564e",
          "f92da92b",
          "9e75d459",
          "06405a5f",
          "d962023e",
          "71f4b029",
          "6cc306ce",
          "00ddf0e5",
          "d12dd963",
          "f3b6b585",
          "09c9ec78",
          "90491249",
          "7abcb9a1",
          "9bb175ec",
          "c6922284",
          "9543a701",
          "73985c29",
          "1a45453a",
          "ab05dfec",
          "287a4906",
          "be68a750",
          "13182a9f",
          "5565be05"
        ]
      },
      {
        "at": "src/languages/index.ts"
      }
    ],
    "id": "@runlith/source-comments",
    "kind": "kit"
  }
sources:
  - kind: dir
    ref: packages/source-comments
---
Runlith keeps code in the checkout free of prose: writing tools strip the prose a change adds, and a tree walk strips what already stands. They all need one answer — which text ranges are comments and which of them are prose, a tool directive or a deliberately marked comment — and the package gives it once for all, so two readers of one file never disagree. It takes a path and text, and answers with ranges of their kinds or the reason it could not read. Which files to read, what to do with the stripped text and whether the ban applies at all is the callers' decision.
