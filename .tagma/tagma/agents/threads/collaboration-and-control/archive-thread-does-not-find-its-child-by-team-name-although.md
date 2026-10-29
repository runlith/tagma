---
id: 01a14a5c-1d3c-7ada-a6c1-5ba985e424dc
title: archive_thread does not find its child by team name, although other doors accept it
ord: 13
tags: ["reflection"]
fields:
  {
    "actual": "refused: not-found \"Thread not found: review-cookies-sol\"; the same call passed by full thread id. Cost — four extra calls.",
    "command": "archive_thread {threadId: \"review-cookies-sol\"} — a child of this thread, created by spawn_agent with name: \"review-cookies-sol\"",
    "expected": "The thread is archived just as by id: set_agent_model and continue_agent accept the same name"
  }
---
Filed from project `runlith`.
