---
name: sentry
description: Investigate errors in Sentry through its MCP server — find the issue behind an error, read its events, stack traces and traces, and trace it to the code and release that caused it; triage issues when asked. Use when a task names Sentry, a Sentry issue or URL, or asks why something fails in production or what errors a release brought.
---

# Working in Sentry

Sentry's remote MCP server acts as the person who signed in to it, across the organizations that account belongs to. Reading is free. A triage change — resolving, ignoring or assigning an issue — changes it for the whole team, so make it only when asked.

## How Sentry is shaped

- An **organization** holds **projects**, each named by a slug. Most calls need both, so find them first when the task does not give them.
- An **issue** groups the **events** of one error or problem. It has a short id such as `BACKEND-1A2`, a URL, a status (unresolved, resolved, ignored), counts of events and affected users, and the first and last time it was seen.
- An **event** is one occurrence: its stack trace, breadcrumbs, tags, request context, release and environment.
- A **trace** follows one request across services as spans, and links to the errors raised inside it.
- A **release** names a deployed version. An issue's first release tells you when it began.

## Investigating an error

1. Find the issue: by the short id or URL the person gave, or by searching unresolved issues in the right project and environment.
2. Read the issue's details: what fails, how often, since when, in which release and environment, for how many users.
3. Read a recent event's stack trace and find its frames in the code you have. Read that code before naming a cause.
4. Check what changed: the release the issue first appeared in, and the commits or deploys around that time.
5. When the error lies on a request path, read the trace to see what came before it and which service it began in.
6. Where the organization has Sentry's own root-cause analysis, ask for it on hard issues. It can take minutes, and its answer is a lead to check, not a finding.

## Searching

- Issue and event searches take Sentry's query syntax, for example `is:unresolved level:error environment:production firstSeen:-24h`. Narrow by project and environment before reading many results.
- Sort by frequency or by affected users to find what matters most, rather than reading in arrival order.

## Writing and triage

- Resolve, ignore, assign or otherwise change an issue only when the person asked for that change, and name the issues first.
- Do not resolve an issue because a fix was written. Resolve it when the person decides the fix is released, or mark it resolved in the next release when they ask for that.

## Reporting

- Cite each issue by its short id and URL.
- Keep the evidence — counts, the stack trace, the release — apart from your hypothesis about the cause, and say how sure you are.
- Events can carry personal data: user emails, IP addresses, request bodies. Never copy it into code, commits, tickets or public text.

## When the tools are missing

Sentry tools missing from what you are offered do not by themselves mean the server is signed out: the client may load tools only on request, or the server may be switched off, still connecting or failing. Look the tools up first where the client offers a tool search. When the server reports that it needs a sign-in, or a call answers that authorization is required, ask the person to sign in to it. Otherwise tell them the state the client reports for the server. Never ask them for a token in the conversation.
