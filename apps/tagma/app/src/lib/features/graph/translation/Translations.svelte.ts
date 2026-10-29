import { Failure } from '@runlith/layer/Failure';
import { Platform } from '@runlith/layer/Platform';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { SvelteMap } from 'svelte/reactivity';
import { GraphFeed } from '$lib/features/graph/Feed.js';
import { GraphRung, type GraphAim } from '$lib/features/workspace/GraphRung.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { type Refusal, refusalOf } from '$lib/wire/refusal.js';
import { systemLanguage } from './languages.js';
import { TranslationsRepo } from './Repo.js';

type Repo = ReturnType<typeof TranslationsRepo.use>;

export type TranslateAsk = { readonly model?: string | undefined; readonly again?: boolean | undefined };

export type Entry = { readonly language: string; readonly standing: boolean };

const idOf = (block: string, language: string): string => `${block}\n${language}`;

export class Translations extends Service<Translations>()('Translations', { tier: 'graph' }) {
  static *make() {
    return new Translations(
      yield* TranslationsRepo,
      yield* Live,
      yield* GraphFeed,
      yield* GraphRung.Current,
      yield* Platform,
      yield* Failure,
      yield* Scope,
    );
  }

  private readonly refused = new SvelteMap<string, Refusal>();

  constructor(
    private readonly repo: Repo,
    live: LiveConnection,
    feed: GraphFeed,
    aim: GraphAim,
    private readonly platform: Platform,
    failure: Failure,
    scope: Scope,
  ) {
    super();
    const held = live.hold(
      (client) => client['translations.changes']({ projectId: aim.projectId }),
      (frame) => this.moved(frame.block),
      (reason) => {
        if (reason.kind === 'subscription') failure.report(new Error(reason.message));
      },
    );
    scope.defer(() => held.unsubscribe());
    scope.defer(
      feed.frames((frame) => {
        if (frame.type === 'change') for (const row of frame.blocks) this.moved(row.name);
      }),
    );
  }

  languageOf(preferred: string | null): string {
    return preferred ?? systemLanguage(this.platform.languages);
  }

  entry(block: string): Entry | undefined {
    const read = this.repo.read.key({ block }).data;
    if (read === undefined) return undefined;
    const language = this.languageOf(read.preferred);
    return { language, standing: read.languages.some((one) => one.language === language) };
  }

  refusal(block: string, language: string): Refusal | undefined {
    return this.refused.get(idOf(block, language));
  }

  async press(block: string): Promise<string> {
    const read = await this.repo.read.key({ block }).loadOrThrow();
    const language = this.languageOf(read?.preferred ?? null);
    if (read?.languages.some((one) => one.language === language) !== true) await this.translate(block, language);
    return language;
  }

  async translate(block: string, language: string, ask: TranslateAsk = {}): Promise<void> {
    const id = idOf(block, language);
    this.refused.delete(id);
    try {
      await this.repo.translate.run({ block, language, model: ask.model, again: ask.again }, { throwOnError: true });
    } catch (error: unknown) {
      this.refused.set(id, refusalOf(error));
    }
    this.moved(block);
  }

  async stop(block: string, language: string): Promise<void> {
    await this.repo.stop.run({ block, language }, { throwOnError: true });
    this.moved(block);
  }

  private moved(block: string): void {
    void this.repo.read.where((key) => key.block === block).invalidate();
  }
}
