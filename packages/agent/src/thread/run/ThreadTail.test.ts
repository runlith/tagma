import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { Message, type Message as MessageType } from '@runlith/llm/schema/messages';
import { ThreadAttachments } from '../ThreadPorts';
import { threadTail } from './ThreadTail';
const said = (message: MessageType): string =>
  message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
const unused = () => Effect.die('This tail only hydrates attachments.');
const attachments = ThreadAttachments.of({
  hydrate: (_threadId, messages) =>
    Effect.succeed(
      messages.map((message) =>
        message.role === 'user' && said(message).startsWith('ref:') ? Message.user(`bytes(${said(message).slice(4)})`) : message,
      ),
    ),
  keep: unused,
  resolve: unused,
  addressed: unused,
  sizes: unused,
});
const call = (id: string) => Message.assistant([{ type: 'tool-call' as const, id, name: 'read', input: { path: 'a.ts' } }]);
const result = (id: string) => Message.tool({ id, name: 'read', result: { ok: true } });
it.effect(
  'a tail cut inside a tool exchange never opens on a result whose call was dropped',
  Effect.fnUntraced(function* () {
    const history = [Message.user('read it'), call('c1'), result('c1'), Message.assistant('done')];
    const tail = yield* threadTail({ threadId: 't', history, room: 40, attachments });
    const roles = (tail ?? []).map((message) => message.role);
    const orphan = (tail ?? []).some(
      (message, index) => message.role === 'tool' && !(tail ?? []).slice(0, index).some((earlier) => earlier.role === 'assistant'),
    );
    expect(orphan).toBe(false);
    expect(roles.length).toBeGreaterThan(0);
  }),
);
it.effect(
  'the tail answers the hydrated form, not the stored one',
  Effect.fnUntraced(function* () {
    const history = [Message.user('ref:photo'), Message.assistant('two')];
    const tail = yield* threadTail({ threadId: 't', history, room: 1000, attachments });
    expect((tail ?? []).map(said)).toEqual(['bytes(photo)', 'two']);
  }),
);
it.effect(
  'a budget too small for even the newest exchange answers nothing',
  Effect.fnUntraced(function* () {
    const tail = yield* threadTail({
      threadId: 't',
      history: [Message.user('a very long first message'), Message.assistant('and a long answer')],
      room: 0,
      attachments,
    });
    expect(tail).toBeNull();
  }),
);
