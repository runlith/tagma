import type { Section, SectionContext } from '../../platform/contract/wire/section.js';

const when = (ctx: SectionContext) => {
  if (!ctx.autoCommit) return 'Commit only when the one who gave you the work asks; until then your report names the files you changed.';
  const landing = `Commit your ready work before your run ends, one ${ctx.op('submit_work')} per checkout holding your lines (\`multiple-checkouts\` names them; \`left\` names what remains). Follow a refusal's available exit; report the refusal and held paths only when no exit is available.`;
  return ctx.sharedCheckout
    ? `${landing} A parent commits what a stopped child of its own left uncommitted, with \`taking\`, under the child's authorship. Pass \`tasks\` naming only the held tasks whose work this commit carries, including tasks of holders in \`taking\`; pass \`[]\` for unrelated work. The commit's Task trailers and the answer attribute only those tasks. Omitting \`tasks\` leaves them unattributed and names this session’s held tasks separately in the answer. Whoever lands a child's lines decides that child's tasks too, finishing each this commit completes.`
    : landing;
};

const what = (ctx: SectionContext) =>
  ctx.sharedCheckout
    ? `Other writers share this tree: ${ctx.op('submit_work')} slices independent lines even when adjacent and carries dependent peer lines with their authors. \`taking\` may include an idle peer without extra consent; a running peer's full handover raises \`still-running\`, and the operator's lines need the operator's word. \`whole\` names files or directories to carry intact; to commit everything, pass \`paths: ["."]\` with \`whole: ["."]\`.`
    : `${ctx.op('submit_work')} takes every change in this tree.`;

export const commits: Section = (ctx) => `## Commits

${when(ctx)}

Land the lines you wrote with ${ctx.op('submit_work')}, which runs the project's commit steps a bare \`git commit\` skips. An act on existing commits — undo, pick, merge, restore a version — uses git under the authority rule. ${what(ctx)}

A ${ctx.op('submit_work')} refusal caused by a defect in Tagma itself never stops the work: keep working and land later, or with a plain \`git commit\` of your own paths; never hold finished work for it or wait on a restart, a fix or the operator.

- Before delivery, read the diff for correctness, unintended changes and secrets, and run the checks the project requires. Reuse applicable evidence; a broader or repeated check, build, e2e or independent review needs a new change, a failure or a concrete unresolved risk. Fix failures your change caused, report unrelated ones without expanding the task, and report a necessary check that cannot run within the limits as the unproved part.
- A subject is concise, in the repository's style; \`body\` says in one to three sentences what changed in behaviour and why, and a micro-edit may omit it. Rewriting another's commits, push, force-push, Git configuration and skipped hooks need the operator's word.
`;
