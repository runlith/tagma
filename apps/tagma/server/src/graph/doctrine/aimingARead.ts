import type { Section } from '../../platform/contract/wire/section.js';

export const aimingARead: Section = () => `## Aiming a Read

An aim selects the subject of one read. The thread keeps its home while the read
uses the selected project's graph and law.

- **A thread defaults to its home project.** An operator call selects a project
  explicitly or resolves it from its working directory.
- **A scope aims at any subtree from anywhere.** The block names its own project,
  so naming a scope selects that project too, whatever directory the call was
  made from. A read without a block subject uses the named \`project\` or the call's
  project; its scope and filters decide how much it reads.
- **\`project\` names a registered project by name or id.** \`global\` selects the
  shared graph; \`tagma\` the running server's source project. An alias shared with
  a registered name refuses \`ambiguous-project\`; use the id. An explicit project
  conflicting with a block subject refuses \`place-mismatch\`; name its project.
- **Other projects reach the global graph by naming it**: its work, decisions,
  notes and findings stay in its own frontier, skeleton and stale queue until a read asks for them.
- **There is nothing to declare about who you are.** The conversation behind a
  call is captured by the transport itself and IS the signature: nothing to copy
  means nothing to copy wrong. A call with no harness behind it is the operator's
  own hand, and the graph records it as that. A session is NAMED by the address
  it is resumed with, in the journal, in a refusal and in every read.
`;
