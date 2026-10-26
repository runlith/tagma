import type { Section } from '../../platform/contract/wire/section.js';

export const threadsAsEvidence: Section = (ctx) => `## Threads Are Read as Evidence

A session is read as a record: ${ctx.op('list_threads')} selects threads, ${ctx.op('read_thread')} queries one thread's facts, ${ctx.op('read_thread_record')} expands addressed evidence whole. A query answers compact metadata and a body is asked for; what could not be read is said, never counted as nothing, and an aggregate covers its whole population or says it did not. A rollout disagreeing with its rows is read with ${ctx.op('read_thread_rollout')} and answered by ${ctx.op('repair_thread_rollout')}, never by a script over the log.

- A thread named by its id is read in its home project, whatever project the call stands in; \`project\` selects a project's threads where the call names none. Team addresses and reports follow the lineage across homes.
- ${ctx.op('search_threads')} finds a conversation by what was said in it, and ${ctx.op('read_thread_record')} \`conversation: true\` opens its match. "Today" and "yesterday" become explicit \`since\`/\`before\` instants in the operator's time. No match is answered by trying other words; complete coverage says those words matched nothing in that scope, not that the conversation did not happen.
- ${ctx.op('archive_thread')} puts a thread away on the operator's word, or your own throwaway child whose report you took in and nobody will talk to again; a child the operator asked for, or one that did real work, stays. Never your own thread, a sibling's or an ancestor's.
- ${ctx.op('continue_thread')} takes up an interrupted thread where it stopped; one whose newest run finished its turn refuses, naming the state.
- A thread runs under the instructions it was frozen with until ${ctx.op('refresh_thread_instructions')}: the next turn reads the refreshed text, the going run keeps what it opened with.
`;
