---
id: 01a16491-cfe0-70aa-9e91-80b0571311f8
title: A test of a defect fix or of an operation the app calls goes through the same door as the real caller; a defect test fails on the report's scenario before the fix
ord: 11
tags: ["rule"]
fields:
  {
    "delivery": "prompt"
  }
---
The call goes through the same tool or the same door, the caller stands where the report stands (thread home, project, cwd, checkout), and preconditions match: what's made before versus after. The reviewer checks the test against the defect report, not just the code against the test.
