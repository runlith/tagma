---
id: 01a13fb0-507a-7e5c-b9ae-2e2187336e08
title: OpenAI overload (server_is_overloaded) is classified as UnknownProvider, not retryable, and drops the run
ord: 2
tags: ["reflection"]
fields:
  {
    "actual": "The resumed run dropped with the same server_is_overloaded almost immediately, without a single retry; the thread had to be moved to claude-opus-5-5.",
    "command": "continue_agent refl-worktrees on openai-oauth/gpt-6.1-sol after the first drop",
    "expected": "the step retries with backoff until the overload clears"
  }
---
Filed from project `runlith`.

Run 01a13fb0-0644-7654-b487-d5b70ca2b04f.
