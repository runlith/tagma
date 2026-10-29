---
id: 01a13faf-d8e8-71a6-8e11-3fd2f120333f
title: OpenAI overload (server_is_overloaded) is classified as UnknownProvider, not retryable, and drops the run
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "The run dropped with type UnknownProvider, HTTP 200, not retryable; the parent had to continue_agent by hand. The report also suggests set_agent_model for a not retryable error, even though the same call would later succeed on the same provider.",
    "command": "refl-landing run on openai-oauth/gpt-6.1-sol: OpenAIResponses.stream",
    "expected": "server_is_overloaded is a transient provider failure: the step retries with backoff, the run continues"
  }
---
Filed from project `runlith`.

Thread 01a13f64-c078-735f-9b04-6fb63dea71fe, run 01a13f93-d98c-70d7-9939-ac5c85e359c5, entry transcript:error:01a13f93-d98c-70d7-9939-ac5c85e359c5. The error arrived in the response stream over HTTP 200, so the OpenAI adapter's classifier most likely never sees the overload code in it.
