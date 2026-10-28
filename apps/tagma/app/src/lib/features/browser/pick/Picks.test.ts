// @vitest-environment jsdom
import { PageId } from '@tagma/server/browser/contract/wire/ids';
import type { Picked } from '@tagma/server/browser/contract/wire/pick';
import { threadDocumentTitle } from '@runlith/agent/transcript/attachments';
import { it } from '@runlith/effect-test/vitest';
import { mountRepo } from '@runlith/query/testing';
import { QueryClient } from '@tanstack/query-core';
import { Effect } from 'effect';
import { expect } from 'vitest';
import { testDoor } from '$lib/wire/testing.js';
import { testShelf } from '$lib/features/threads/native/testing.js';
import { ThreadDraft } from '$lib/features/threads/Draft.svelte.js';
import { ThreadsRepo } from '$lib/features/threads/Repo.js';
import { CallPieces } from '$lib/features/threads/native/CallPieces.js';
import { ThreadUploads } from '$lib/features/threads/native/ThreadUploads.js';
import { Picks } from './Picks.js';

const PICKED: Picked = {
  page: PageId.make('01a149e7-page'),
  url: 'https://example.com/form',
  ref: 'e12',
  role: 'button',
  name: 'Send',
  tag: 'button',
  selector: 'form > button.send',
  text: 'Send',
  html: '<button class="send">Send</button>',
  attributes: { class: 'send' },
  styles: { color: 'rgb(0, 0, 0)' },
  rect: { x: 10, y: 20, width: 80, height: 24 },
  picture: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
};

it.live('a picked element sends a titled Markdown document and its picture through the thread attachment door', () =>
  Effect.gen(function* () {
    const uploaded: { mediaType: string; bytes: Uint8Array }[] = [];
    const threadId = '01a149e7-thread';
    const door = testDoor(async (input, init) => {
      expect(new URL(String(input)).pathname).toBe(`/api/threads/${threadId}/attachments`);
      const mediaType = new Headers(init?.headers).get('content-type')!;
      if (!(init?.body instanceof Uint8Array)) throw new Error('the upload body is not bytes');
      uploaded.push({ mediaType, bytes: init.body });
      const id = `00000000-0000-7000-8000-000000000001.${mediaType === 'text/markdown' ? 'md' : 'png'}`;
      const text = JSON.stringify({ id, mediaType, url: `/api/threads/${threadId}/attachments/${id}` });
      const bytes = new TextEncoder().encode(text);
      const buffer = new ArrayBuffer(bytes.length);
      new Uint8Array(buffer).set(bytes);
      return Object.assign(new Response(text, { status: 201, headers: { 'content-type': 'application/json' } }), {
        arrayBuffer: async () => buffer,
      });
    });
    const mounted = mountRepo(ThreadsRepo, { door, queryClient: new QueryClient() });
    yield* Effect.addFinalizer(() => Effect.promise(mounted.unmount));
    const draft = new ThreadDraft(testShelf(), new ThreadUploads(mounted.repo, door, 5), new CallPieces(mounted.repo, 5));
    draft.useKey(`thread:${threadId}`);
    const picks = new Picks({
      host: { stageDocument: (document) => draft.stageDocument(document), attach: (files) => draft.attach(files) },
    });

    expect(yield* Effect.promise(() => picks.stage(PICKED))).toBeNull();
    draft.setText('Change this element');
    const composed = yield* draft.compose(threadId, draft.current);
    if (composed.status === 'failed') return yield* Effect.die(JSON.stringify(composed));
    expect(composed).toMatchObject({
      status: 'composed',
      attachments: [{ id: expect.stringMatching(/\.md$/) }, { id: expect.stringMatching(/\.png$/) }],
    });
    expect(uploaded.map((attachment) => attachment.mediaType)).toEqual(['text/markdown', 'image/png']);
    const document = new TextDecoder().decode(uploaded[0]!.bytes);
    expect(threadDocumentTitle(document)).toBe(draft.documents[0]?.title);
    expect(document).toBe(draft.documents[0]?.text);
  }),
);
