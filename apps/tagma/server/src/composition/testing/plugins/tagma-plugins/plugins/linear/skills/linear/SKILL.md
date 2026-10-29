---
name: linear
description: Work in Linear through its MCP server — find issues, projects, cycles and documents, create and update them, and comment. Use when a task names Linear, an issue identifier such as ENG-123, or asks to file, triage, plan or report on tracked work.
---

# Working in Linear

Linear's remote MCP server acts as the person who signed in to it, in the one workspace they chose at sign-in. Everything you write appears under their name, so every change is one they would make themselves.

## How Linear is shaped

- A **workspace** holds **teams**. Each team has a key, and its issues are numbered under it: `ENG-123` is issue 123 of the team with key `ENG`.
- Each team has its own **workflow states**, grouped as triage, backlog, unstarted, started, completed and canceled. Names such as "In Review" differ between teams, so read a team's states before setting one.
- **Projects** gather issues across teams toward one outcome and may have milestones. **Initiatives** gather projects.
- **Cycles** are a team's time-boxed iterations.
- **Labels** belong to a team or to the whole workspace. **Priority** runs from 1 (urgent) to 4 (low), and 0 means none. **Estimates** follow the team's scale.
- **Documents** hold longer text, attached to a project or standing alone. **Comments** carry the discussion on an issue.

## Read before you act

- Resolve every name to the record it means before using it: the team, the user, the state, the label, the project. Look each one up with the server's tools and never guess an id or a state name.
- An identifier such as `ENG-123` or a Linear URL names one issue exactly. A title or a phrase may match several, or none.
- When a match is unclear, show the candidates and ask. Never pick one silently, and never invent an issue, a dependency or an owner that the data does not show.
- Before creating an issue, search for one that already covers it. Linking to an existing issue beats filing a duplicate.

## Write the way the team works

- Unless the person asked for this exact change, say first what you will create or change — the team, the title, the state, the assignee — and wait for their word. List a bulk change in full before running any of it.
- A new issue needs its team. Write a title that names the outcome and a Markdown description with the context, what is known and what counts as done. Set priority, labels, estimate, project or cycle only when the person gave them or the team's practice is plain from its other issues.
- Assign or delegate an issue only to someone the person named.
- Move an issue only to one of its team's own states.
- Record progress, findings and questions as comments, and keep the description as the current statement of the work. Rewrite a description only when asked.
- Mention issues by their identifier in comments and documents, so Linear links them.

## Reporting

- Cite each issue by its identifier, and its URL when you have one.
- Keep what the data says apart from what you infer: an issue's state is a fact, while "probably blocked" is a guess and must read as one.
- For a status or a standup, read the issues it covers within the period asked: what moved, what is blocked and why, and what is new.

## When the tools are missing

Linear tools missing from what you are offered do not by themselves mean the server is signed out: the client may load tools only on request, or the server may be switched off, still connecting or failing. Look the tools up first where the client offers a tool search. When the server reports that it needs a sign-in, or a call answers that authorization is required, ask the person to sign in to it. Otherwise tell them the state the client reports for the server. Never ask them for a token in the conversation.
