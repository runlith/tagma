---
id: 01a13fb0-06df-7540-81f3-fac63814b06e
title: OpenAI overload (server_is_overloaded) is classified as UnknownProvider, not retryable, and drops the run
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "The run dropped as UnknownProvider, HTTP 200, not retryable, 16 s after the same refl-landing drop; manual continue_agent again.",
    "command": "refl-worktrees run on openai-oauth/gpt-6.1-sol: OpenAIResponses.stream",
    "expected": "a transient overload retries with backoff"
  }
---
Filed from project `runlith`.

Thread 01a13f64-c07c-7062-af51-359fd50818af, run 01a13f93-d980-7e8d-89bb-bc4fb9e07703.
