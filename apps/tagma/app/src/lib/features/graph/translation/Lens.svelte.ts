import type { LanguageStanding, ProjectedPart, Projection } from '@tagma/server/translations/contract/wire/projection';
import type { Refusal } from '$lib/wire/refusal.js';
import type { TranslationsRepo } from './Repo.js';
import type { TranslateAsk, Translations } from './Translations.svelte.js';

export type Segment = { readonly key: number; readonly kind: 'shown' | 'pending' | 'changed'; readonly text: string };

export type Phase = 'translating' | 'failed' | 'stopped' | 'outdated' | 'current';

export type Standing = 'translating' | 'failed' | 'outdated' | 'current';

const kindOf = (part: ProjectedPart): Segment['kind'] => (part.state === 'translated' || part.state === 'kept' ? 'shown' : part.state);

export function segmentsOf(parts: readonly ProjectedPart[]): readonly Segment[] {
  const segments: { key: number; kind: Segment['kind']; texts: string[] }[] = [];
  parts.forEach((part, index) => {
    if (part.kind === 'title') return;
    const kind = kindOf(part);
    const text = part.state === 'translated' ? (part.text ?? part.source) : part.source;
    const last = segments.at(-1);
    if (last?.kind === kind) last.texts.push(text);
    else segments.push({ key: index, kind, texts: [text] });
  });
  return segments.map(({ key, kind, texts }) => ({ key, kind, text: texts.join('\n\n') }));
}

export function phaseOf(projection: Projection): Phase {
  if (projection.state === 'translating') return 'translating';
  if (projection.state === 'failed') return 'failed';
  if (projection.changed === 0) return 'current';
  return projection.state === 'stopped' ? 'stopped' : 'outdated';
}

export const standingOf = (one: LanguageStanding): Standing =>
  one.state === 'translating' ? 'translating' : one.state === 'failed' ? 'failed' : one.changed > 0 ? 'outdated' : 'current';

export class TranslationLens {
  constructor(
    private readonly translations: Translations,
    private readonly repo: TranslationsRepo,
    private readonly block: () => string | null,
    readonly language: () => string | null,
    private readonly show: (language: string | null) => void,
  ) {}

  private get query() {
    const block = this.block();
    const language = this.language();
    return block === null || language === null ? undefined : this.repo.read.key({ block, language });
  }

  get active(): boolean {
    return this.language() !== null;
  }

  get read() {
    return this.query?.data;
  }

  get failure(): unknown {
    return this.query?.error ?? null;
  }

  get projection(): Projection | null {
    return this.read?.projection ?? null;
  }

  get languages(): readonly LanguageStanding[] {
    return this.read?.languages ?? [];
  }

  get refusal(): Refusal | undefined {
    const block = this.block();
    const language = this.language();
    return block === null || language === null ? undefined : this.translations.refusal(block, language);
  }

  get settled(): boolean {
    return this.read !== undefined || this.failure !== null || this.refusal !== undefined;
  }

  get absent(): boolean {
    const block = this.block();
    const language = this.language();
    if (block === null || language === null || this.translations.isStarting(block, language)) return false;
    return this.read !== undefined && this.query?.isFetching !== true && this.projection === null && this.refusal === undefined;
  }

  get phase(): Phase | null {
    return this.projection === null ? null : phaseOf(this.projection);
  }

  get title(): ProjectedPart | undefined {
    return this.projection?.parts.find((part) => part.kind === 'title');
  }

  get segments(): readonly Segment[] {
    return this.projection === null ? [] : segmentsOf(this.projection.parts);
  }

  titleOf(name: string): string | undefined {
    return this.projection?.titles.find((one) => one.name === name)?.title;
  }

  update(ask: TranslateAsk = {}): Promise<void> {
    const block = this.block();
    const language = this.language();
    return block === null || language === null ? Promise.resolve() : this.translations.translate(block, language, ask);
  }

  stop(): Promise<void> {
    const block = this.block();
    const language = this.language();
    return block === null || language === null ? Promise.resolve() : this.translations.stop(block, language);
  }

  choose(language: string): Promise<void> {
    const block = this.block();
    if (block === null) return Promise.resolve();
    const started = this.languages.some((one) => one.language === language)
      ? Promise.resolve()
      : this.translations.translate(block, language);
    this.show(language);
    return started;
  }

  reread(): void {
    void this.query?.refresh();
  }

  leave(): void {
    this.show(null);
  }
}
