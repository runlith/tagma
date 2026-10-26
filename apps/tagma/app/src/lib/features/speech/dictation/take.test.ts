import type { Heard } from '@tagma/server/speech/contract/wire/listening';
import { PromptHandle, type PromptEditor } from '@runlith/chat-ui/PromptHandle.svelte';
import { expect, test } from 'vitest';
import { FieldTarget } from './field.js';
import { Take } from './take.js';

class Draft implements PromptEditor {
  constructor(
    public text: string,
    private at: number,
  ) {}

  selection() {
    return { text: this.text, from: this.at, to: this.at };
  }

  write(from: number, to: number, text: string, caret: 'preserve' | 'end' = 'preserve') {
    this.text = this.text.slice(0, from) + text + this.text.slice(to);
    if (caret === 'end') this.at = from + text.length;
    else if (this.at > to) this.at += text.length - (to - from);
    else if (this.at > from) this.at = from;
    return this.selection();
  }

  caret(offset: number): void {
    this.at = offset;
  }

  focus(): void {}
}

const said = (seq: number, revision: number, text: string, hypothesis = '', closed = false): Heard => ({
  kind: 'utterance',
  track: 'mic',
  segment: 1,
  seq,
  revision,
  closed,
  text,
  hypothesis,
  from: null,
  to: null,
  speaker: null,
});
const phase = (value: 'finished' | 'ended'): Heard => ({
  kind: 'track',
  track: 'mic',
  phase: value,
  queuedMs: null,
  retryInMs: null,
  reason: null,
});

function dictate(text: string, caret: number) {
  const drafts = new Map([
    ['A', new Draft(text, caret)],
    ['B', new Draft('thread B', 8)],
  ]);
  let open = 'A';
  const handle = new PromptHandle();
  const detach = handle.attach(drafts.get('A')!);
  let sent = 0;
  const take = new Take(
    new FieldTarget(
      handle,
      () => open,
      () => (sent += 1),
    ),
  );
  expect(take.open()).toBe(true);
  return {
    take,
    handle,
    detach,
    caret: () => drafts.get(open)!.selection().to,
    place: (offset: number) => drafts.get(open)!.caret(offset),
    draft: (key: string) => drafts.get(key)!.text,
    sent: () => sent,
    type(from: number, to: number, text: string) {
      drafts.get(open)!.write(from, to, text);
      handle.edited({ from, to, text });
    },
    switchTo(key: string) {
      open = key;
      handle.attach(drafts.get(key)!);
    },
  };
}

test('the dictated region follows replacing revisions and lands late utterances in their order', async () => {
  const { take, handle, draft, sent } = dictate('Fix', 3);
  take.hear(said(2, 1, 'sat', '', true));
  take.hear(said(1, 1, 'the cat', 'on'));
  expect(draft('A')).toBe('Fix the cat sat');
  expect(handle.ghost?.text).toBe(' on');
  take.hear(said(1, 2, 'the bat', ''));
  take.hear(said(1, 1, 'the cat', 'on'));
  take.hear(said(1, 3, 'the bat', '', true));
  take.hear(phase('finished'));
  expect(draft('A')).toBe('Fix the bat sat');
  const settled = await take.settle('end', true);
  expect(settled).toMatchObject({ confirmed: true, unplaced: '', lost: [] });
  expect(draft('A')).toBe('Fix the bat sat');
  expect(handle.ghost).toBeNull();
  expect(sent()).toBe(1);
});

test('an unconfirmed end inserts what was heard, names the loss and never sends', async () => {
  const { take, draft, sent } = dictate('', 0);
  take.hear(said(1, 1, 'one', 'two three'));
  take.hear(said(1, 2, 'one', '', true));
  take.hear({ kind: 'gap', track: 'mic', from: 0, to: 1, cause: 'unconfirmed-tail', message: 'The tail was not confirmed.' });
  take.hear(phase('ended'));
  const settled = await take.settle('end', true);
  expect(draft('A')).toBe('one two three');
  expect(settled?.lost.length).toBeGreaterThan(0);
  expect(sent()).toBe(0);
});

test('the deadline inserts the confirmed text and the hypothesis and may send; a failure keeps the text and never sends', async () => {
  const late = dictate('', 0);
  late.take.hear(said(1, 1, 'one', 'two'));
  await late.take.settle('deadline', true);
  expect(late.sent()).toBe(1);
  expect(late.draft('A')).toBe('one two');

  const broken = dictate('', 0);
  broken.take.hear(said(1, 1, 'one', 'two'));
  await broken.take.settle('failed', true);
  expect(broken.draft('A')).toBe('one two');
  expect(broken.sent()).toBe(0);
});

test('a cancelled take removes only its own region, tracked through edits around it', () => {
  const { take, handle, draft, type } = dictate('keep me', 4);
  take.hear(said(1, 1, 'gone', 'soon'));
  expect(draft('A')).toBe('keep gone me');
  type(0, 0, 'I ');
  type(14, 14, '!');
  expect(take.cancel()).toBe(true);
  expect(draft('A')).toBe('I keep me!');
  expect(handle.ghost).toBeNull();
  expect(handle.alert).toBe(false);
});

test('the caret follows the end of the dictated text unless the user placed it elsewhere', async () => {
  const followed = dictate('Fix it', 3);
  followed.take.hear(said(1, 1, 'the bug', 'in'));
  expect(followed.draft('A')).toBe('Fix the bug it');
  expect(followed.caret()).toBe(11);
  followed.take.hear(said(1, 2, 'the bug in parser', '', true));
  followed.take.hear(phase('finished'));
  await followed.take.settle('end', false);
  expect(followed.caret()).toBe(21);

  const moved = dictate('Fix it', 3);
  moved.take.hear(said(1, 1, 'the bug', ''));
  moved.place(0);
  moved.take.hear(said(1, 2, 'the bug in parser', '', true));
  moved.take.hear(phase('finished'));
  await moved.take.settle('end', false);
  expect(moved.draft('A')).toBe('Fix the bug in parser it');
  expect(moved.caret()).toBe(0);
});

test('a hand edit inside the region ends its ownership: nothing more is written and Esc keeps every other copy', async () => {
  const { take, draft, type } = dictate('say echo', 3);
  take.hear(said(1, 1, 'echo', ''));
  expect(draft('A')).toBe('say echo echo');
  type(3, 8, '');
  expect(draft('A')).toBe('say echo');
  take.hear(said(1, 2, 'echo twice', ''));
  expect(draft('A')).toBe('say echo');
  expect(take.cancel()).toBe(false);
  expect(draft('A')).toBe('say echo');
});

test('a field detached before anything was placed leaves the whole text unplaced and does not send', async () => {
  const { take, detach, sent } = dictate('', 0);
  detach();
  take.hear(said(1, 1, 'done', '', true));
  take.hear(phase('finished'));
  expect(await take.settle('end', true)).toMatchObject({ unplaced: 'done' });
  expect(sent()).toBe(0);
});

test('a field sent before the dictation finished leaves unplaced only the words that came after, despite revised earlier words', async () => {
  const whole = dictate('', 0);
  whole.take.hear(said(1, 1, 'ship it', '', true));
  whole.type(0, 7, '');
  whole.take.hear(phase('finished'));
  expect(await whole.take.settle('end', false)).toMatchObject({ unplaced: '' });

  const tail = dictate('', 0);
  tail.take.hear(said(1, 1, 'the cat sat', ''));
  tail.type(0, 11, '');
  tail.take.hear(said(1, 2, 'The bat sat today', '', true));
  tail.take.hear(phase('finished'));
  expect(await tail.take.settle('end', false)).toMatchObject({ unplaced: 'today' });
});

test('a recorded loss stops the deadline from sending and is reported', async () => {
  const { take, draft, sent } = dictate('', 0);
  take.hear(said(1, 1, 'one', 'two'));
  take.hear({ kind: 'gap', track: 'mic', from: 0, to: 1, cause: 'recognition-failed', message: 'One turn failed.' });
  const settled = await take.settle('deadline', true);
  expect(draft('A')).toBe('one two');
  expect(settled).toMatchObject({ lost: ['One turn failed.'] });
  expect(sent()).toBe(0);
});

test('a draft switch mid-take writes nothing into the new draft and never sends', async () => {
  const { take, draft, sent, switchTo } = dictate('', 0);
  take.hear(said(1, 1, 'for A', ''));
  switchTo('B');
  take.hear(said(1, 2, 'for A and more', 'still', true));
  take.hear(phase('finished'));
  const settled = await take.settle('end', true);
  expect(draft('B')).toBe('thread B');
  expect(draft('A')).toBe('for A');
  expect(settled).toMatchObject({ unplaced: 'and more' });
  expect(sent()).toBe(0);
});
