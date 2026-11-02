---
id: 01a0c0d5-c713-75bd-b78b-0583adeeb4ba
title: Git
ord: 13
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/entries.ts",
        "for": [
          "edf810fe",
          "7a70e34e",
          "06405a5f",
          "d962023e",
          "6cc306ce",
          "00ddf0e5",
          "90491249",
          "7abcb9a1",
          "c6922284",
          "9543a701",
          "13182a9f",
          "5565be05",
          "9f0b5fe1"
        ]
      },
      {
        "at": "src/Git.ts",
        "for": [
          "edf810fe",
          "7a70e34e",
          "06405a5f",
          "d962023e",
          "6cc306ce",
          "00ddf0e5",
          "90491249",
          "7abcb9a1",
          "c6922284",
          "9543a701",
          "13182a9f",
          "5565be05",
          "73985c29",
          "a1c2b760",
          "9f0b5fe1",
          "2043c3ca",
          "8fda30d8",
          "e9aa47fc"
        ]
      },
      {
        "at": "src/history.ts",
        "for": [
          "edf810fe",
          "7a70e34e",
          "06405a5f",
          "d962023e",
          "6cc306ce",
          "00ddf0e5",
          "90491249",
          "7abcb9a1",
          "c6922284",
          "9543a701",
          "13182a9f",
          "5565be05"
        ]
      },
      {
        "at": "src/merge.ts",
        "for": [
          "edf810fe",
          "7a70e34e",
          "06405a5f",
          "d962023e",
          "6cc306ce",
          "00ddf0e5",
          "90491249",
          "7abcb9a1",
          "c6922284",
          "9543a701",
          "13182a9f",
          "5565be05"
        ]
      },
      {
        "at": "src/porcelain.ts",
        "for": [
          "edf810fe",
          "7a70e34e",
          "06405a5f",
          "d962023e",
          "6cc306ce",
          "00ddf0e5",
          "90491249",
          "7abcb9a1",
          "c6922284",
          "9543a701",
          "13182a9f",
          "5565be05"
        ]
      },
      {
        "at": "src/repository.ts",
        "for": [
          "edf810fe",
          "7a70e34e",
          "06405a5f",
          "d962023e",
          "6cc306ce",
          "00ddf0e5",
          "90491249",
          "7abcb9a1",
          "c6922284",
          "9543a701",
          "13182a9f",
          "5565be05",
          "2043c3ca",
          "a1c2b760",
          "8fda30d8"
        ]
      },
      {
        "at": "src/stage.ts",
        "for": [
          "edf810fe",
          "7a70e34e",
          "06405a5f",
          "d962023e",
          "6cc306ce",
          "00ddf0e5",
          "90491249",
          "7abcb9a1",
          "c6922284",
          "9543a701",
          "13182a9f",
          "5565be05"
        ]
      },
      {
        "at": "src/status.ts",
        "for": [
          "edf810fe",
          "7a70e34e",
          "06405a5f",
          "d962023e",
          "6cc306ce",
          "00ddf0e5",
          "90491249",
          "7abcb9a1",
          "c6922284",
          "9543a701",
          "13182a9f",
          "5565be05",
          "2043c3ca"
        ]
      },
      {
        "at": "src/trees.ts",
        "for": [
          "7abcb9a1"
        ]
      },
      {
        "at": "src/vocabulary.ts"
      },
      {
        "at": "src/worktree.ts",
        "for": [
          "edf810fe",
          "7a70e34e",
          "06405a5f",
          "d962023e",
          "6cc306ce",
          "00ddf0e5",
          "90491249",
          "7abcb9a1",
          "c6922284",
          "9543a701",
          "13182a9f",
          "5565be05"
        ]
      },
      {
        "at": "src/working.ts",
        "for": [
          "00ddf0e5",
          "5565be05",
          "9f0b5fe1"
        ]
      },
      {
        "at": "src/treePaths.ts",
        "for": [
          "a1c2b760",
          "8fda30d8",
          "7abcb9a1",
          "00ddf0e5"
        ]
      },
      {
        "at": "src/apart.ts",
        "for": [
          "d962023e",
          "7abcb9a1",
          "c6922284"
        ]
      },
      {
        "at": "src/disk.ts",
        "for": [
          "5565be05"
        ]
      },
      {
        "at": "src/testing/fixture.ts",
        "role": "testing"
      },
      {
        "at": "src/clone.ts",
        "for": [
          "e9aa47fc",
          "d6fd5286"
        ]
      }
    ],
    "id": "@runlith/git",
    "kind": "kit"
  }
sources:
  - kind: dir
    ref: packages/git
---
Everything Runlith does with a checkout — project placement, worktree status and diff, a checkout for the agent's work, committing a session's work, measuring changed files — goes through the git process, and this package is the only door to it; HEAD and index records needed at every command step it reads straight from the git-directory files, and a shape it does not read (reftable, split and sparse index) it hands to the git process. It starts commands and holds batched object-read sessions through the passed spawner, reads history, status, branches and trees, acts on the index, remote, worktrees and merges, and answers in git's own words, separating them from its own failures. Which repository, whose checkout, who may act and what an outcome means, callers decide.
