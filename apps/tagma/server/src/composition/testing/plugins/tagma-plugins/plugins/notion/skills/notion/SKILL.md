---
name: notion
description: Work in Notion through its MCP server — search the workspace, read pages and databases, create and edit pages, fill database rows and comment. Use when a task names Notion, a Notion URL, or asks to find, write up or update docs, notes, specs or tracked records kept there.
---

# Working in Notion

Notion's remote MCP server acts as the person who signed in to it, within the pages that sign-in was granted. Every edit appears under their name and changes what their team reads, so write only what they asked for.

## How Notion is shaped

- **Pages** nest inside pages, inside **teamspaces**. A page has properties and a body of blocks. The server reads and writes the body as Notion-flavoured Markdown.
- A **database** holds one or more **data sources**. Each data source has a schema of named, typed properties — title, text, select, multi-select, status, date, person, relation and others. Each row is a page with those properties.
- **Views** filter and sort a database. **Comments** sit on a page or on one block, and carry discussions.
- Pages, databases and data sources are addressed by URL or by id. A `collection://` id names a data source.

## Find, then read

- Search with short, specific words: a title, a name, a distinctive term. Then fetch the pages that matter before you rely on them, because a search hit shows only part of a page.
- Before writing to a database, fetch its data source and read the schema. Property names must match exactly, a select or status value must be one of its options, and a relation needs the id of the page it points to.
- A page too long to return in one read comes back truncated. Fetch the parts it names before you treat the page as complete.
- When several pages could be the one meant, show them and ask. Never write to a guess.

## Write without losing anything

- Unless the person asked for this exact change, say first which page you will create or change and how, and wait for their word.
- Create a page under the parent it belongs to: a page, or a data source for a database row. Set the row's properties by the schema you read.
- To edit a page, fetch it first and change only the passage the task concerns. Keep blocks, mentions and file references you were not asked to touch. After a write, check the answer for warnings. If an edit found nothing to match, fetch the page again before retrying.
- Prefer a comment for questions and review notes. Rewrite a page's content only when asked.
- Moving pages to the trash needs the person's explicit confirmation, every time.
- File and image links in answers are signed and expire. Fetch again for fresh ones, and never paste them into lasting text.

## Limits

- Calls count against Notion's rate limits. Read what the task needs, and avoid bursts of parallel calls.
- Some tools depend on the workspace's plan or on what an administrator allowed. When one is refused for that reason, tell the person instead of working around it.

## When the tools are missing

Notion tools missing from what you are offered do not by themselves mean the server is signed out: the client may load tools only on request, or the server may be switched off, still connecting or failing. Look the tools up first where the client offers a tool search. When the server reports that it needs a sign-in, or a call answers that authorization is required, ask the person to sign in to it. Otherwise tell them the state the client reports for the server. Never ask them for a token in the conversation.
