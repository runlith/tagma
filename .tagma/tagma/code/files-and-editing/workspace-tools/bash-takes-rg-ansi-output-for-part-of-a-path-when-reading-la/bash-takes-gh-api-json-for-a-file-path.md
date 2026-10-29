---
id: 01a12c0f-6300-7863-87a8-17e595254d0c
title: bash takes gh api JSON for a file path
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "After successful JSON answers, the tool again appended \"the files this command printed could not be told apart\" plus a FileSystem.stat over the start of the JSON issue body, including its Markdown. This is a repeated misclassification of stdout as a path.",
    "command": "bash(command=\"gh api repos/stablyai/orca/issues/21583 --jq '{url:.html_url,title,created_at,state,user:.user.login,association:.author_association,body}' && gh api repos/stablyai/orca/issues/21583/comments --jq 'map({url:.html_url,created_at,user:.user.login,association:.author_association,body})' && gh api repos/stablyai/orca/pulls/27318 --jq '{url:.html_url,title,created_at,state,merged_at,user:.user.login,body}'\")",
    "expected": "A gh api JSON answer reads as HTTP output, not a file name."
  }
---
Filed from project `runlith`.
