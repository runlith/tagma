---
id: 01a160c4-c0d7-7a70-a62d-eecf1151b625
title: "Tagma's law and a linter with a hook: what repeats in half an hour, what is worse and what is not"
ord: 22
---
Comparing what law-lab showed about Tagma's law with what assembles without Tagma: a linter with suppressions ([[4ce8617e]]), a pre-commit hook or a Claude Code hook, nested `CLAUDE.md`. Where the comparison is a conclusion rather than a run, it says so. Compared are the [[88b4c33c]] and [[58074d0c]] capabilities.

## Repeats in half an hour

- **Gate at commit.** Any hook (husky, lint-staged, a Claude Code hook) refuses a commit with a new violation.
- **Switch-on in a dirty project, debt, refusal only for the new.** ESLint 9.24+ and oxlint: `--suppress-all`, a counter by file and rule, like Tagma's debt. The ESLint-with-debt case does not set Tagma apart in this sense.
- **A rule in words next to code.** Nested `CLAUDE.md` in Claude Code loads by folder — a partial analogue of `code` delivery.

## Repeats worse

- **Debt leaves on its own.** In ESLint a fixed suppression fails the run until a manual `--prune-suppressions`; in Tagma the entry is dropped by the re-measure after commit.
- **Debt has an owner.** Every entry hangs on a task in the graph; in ESLint it is a line in JSON.
- **One mechanism for everything.** Imports, loads, size, own programs and any linter carry debt, refusals, strictnesses and the Rules screen identically; without Tagma each tool has its own or none.
- **History and screen.** Refusals with place and time, debt growth and shrinkage, "slipped through" are recorded and visible to the operator; a hook prints to the terminal and forgets.
- **Strictness switches without code.** Text only / Warns / Blocks on the screen, debt carried across — one decision.

## Not repeated with simple means

- **Refusal only for one's own lines in a shared checkout.** An agent's commit is judged by its lines, others' unfinished lines land marked and are recorded under their author; a hook judges the whole index. The value is in the process, not the code: with one agent or an end-of-work "sync all" commit there is no difference; with parallel agents the refusal reaches the line's author, the second agent neither fixes another's unfinished work nor bypasses the check with `--no-verify`, history stays by task. Weak as the main selling argument (a conclusion, not checked with a two-agent run).
- **Text and check are one rule.** The agent receives the norm when reading its zone's code, before the violation, and the gate judges the same law; in `CLAUDE.md` text and check live apart and diverge.
- **Refusal as a reply to the agent.** Place, norm, `fix` and two executable ways out — fix or record into debt on a new task with a ready call; a hook returns linter output. How an agent acts on a refusal is still unchecked ([[deeaa110]]: the agent never reached the refusal).

## A project's own norm

Run [[99fcd7c2]]: the norm "every domain module has its own test", which no linter has, became a check through `defineProgram` and got the same debt, gate, refusal and screen. But on a single rule that repeats too: an agent writes a hook script with its own exclusion list in minutes, and in Tagma the program code is also written by an agent, not a person. The distinction can only be at scale — every homemade script has its own format of exclusions, refusal and history, while in Tagma all rules share one; no single-rule case shows that.

## Agent behaviour on a plain task

Runs [[a7366c31]] and [[4f7ddd18]]: one agent, one model, one task, seven norms — in Tagma's law and in `CLAUDE.md` + pre-commit hook. The decisions matched almost word for word, 0 refusals in both. Prevention comes from the norms' text in context, and `CLAUDE.md` gives it just as well; in agent behaviour on such a task Tagma does not win.

## What it means for selling

Debt and gate on their own are not the distinction. The distinction is the law as one whole over all checks, with owners, history and a screen, delivered to the agent before the violation and judging the agent by its lines. The selling case must show that, not a linter switch-on.
