// @vitest-environment jsdom
import type { AgentCatalog } from '@tagma/server/threads/contract/wire/agentLibrary';
import { Layer } from '@runlith/layer/Layer';
import { stubMutation } from '@runlith/query/testing';
import { flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import { mountShell, type TestApp } from '$lib/app/testing.js';
import AgentLibrary from './AgentLibrary.svelte';
import { AgentLibraryRepo } from './AgentLibraryRepo.js';

let app: TestApp | undefined;

afterEach(async () => {
  if (app) await app.unmount();
  app = undefined;
});

const catalog: AgentCatalog = { definitions: [], rejected: [], floors: { project: '.agents', personal: '~/.agents' }, capabilities: [] };

const question = (): HTMLElement | null =>
  [...document.querySelectorAll<HTMLElement>('[data-runlith-dialog-content][data-state="open"]')].find((node) =>
    node.textContent?.includes('Discard this draft?'),
  ) ?? null;

function escape(): void {
  (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  flushSync();
}

test('Escape on an unsaved draft asks before closing, and asks again from anywhere in the library after that question was dismissed', async () => {
  app = mountShell(
    Layer.mergeAll(
      Layer.of(AgentLibraryRepo, {
        list: stubMutation(async () => catalog),
        preview: stubMutation(async () => undefined),
        thread: stubMutation(async () => undefined),
        save: stubMutation(),
      } as never),
    ),
  );
  app.draw();
  app.dialogs.open(AgentLibrary as never, { projectId: 1 });
  const create = await vi.waitFor(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.trim() === 'New agent');
    if (button === undefined || button.disabled) throw new Error('The library offers no new agent yet.');
    return button;
  });
  create.click();
  flushSync();
  const name = await vi.waitFor(() => document.querySelector<HTMLInputElement>('input[placeholder="code-reviewer"]')!);
  name.focus();
  name.value = 'reviewer';
  name.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();

  escape();
  await vi.waitFor(() => expect(question()).not.toBeNull());
  escape();
  await vi.waitFor(() => expect(question()).toBeNull());
  expect(app.dialogs.stack[0]?.open).toBe(true);

  name.closest<HTMLElement>('[data-runlith-dialog-content]')!.focus();
  escape();
  await vi.waitFor(() => expect(question()).not.toBeNull());
});
