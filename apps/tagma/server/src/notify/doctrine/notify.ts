import type { Section } from '../../platform/contract/wire/section.js';

export const notify: Section = (ctx) => `## Notifying the operator

An app process puts a notification in front of the operator with ${ctx.op('send_notification')}: it lands in
the app's Attention list and as a push on paired devices. With a \`question\` the operator picks one of
its options, or types an answer when it has none, from any device; the outcome — \`answered\` or
\`dismissed\` — is durable and is handed back to the sender until the sender takes it. A notification
without a question is dismissed by the operator.
`;
