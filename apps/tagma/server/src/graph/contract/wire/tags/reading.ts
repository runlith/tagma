import type { Tag } from './declaration.js';
import type { ContractId } from './behaviour.js';
import type { TagActions } from './actions.js';
import type { LawProjection } from './law.js';
import type { UnreadableTag } from './table.js';
import type { VocabularyRevision } from './revision.js';
import { HOLDER, HOLDER_SLOT } from './holder.js';
import { LIFECYCLE, lifecycleOf } from './lifecycle.js';
import { type StatusPhase, type Tagged, statusesAt, statusWords, tagLabel } from './roles.js';

export interface TagReading {
  readonly tags: readonly Tag[];
  readonly unreadable: readonly UnreadableTag[];
  tagById(id: string): Tag | null;
  nameOf(word: string): string;
  fieldNameOf(typeId: string, field: string): string;
  actionsOf(typeId: string): TagActions;
  revision(): VocabularyRevision;
  lawProjectionOf(typeId: string): LawProjection | null;
  tagsOf(node: { readonly tags: readonly string[] }): Tag[];
  tagOf(node: { readonly tags: readonly string[] }): Tag | null;
  bindingTag(node: { readonly tags: readonly string[] }, contract: ContractId): Tag | null;
  supports(node: { readonly tags: readonly string[] }, contract: ContractId): boolean;
  standsAt(node: Tagged, contract: ContractId, phase: StatusPhase): boolean;
  isTerminal(node: Tagged): boolean;
  statusOf(node: Tagged): string | null;
  holderOf(node: Tagged): number | null;
  statuses(): readonly string[];
  declaredTags(): string[];
  statusLine(): string;
  lawProjection(node: { readonly tags: readonly string[] }): LawProjection | null;
}

export abstract class TagReader implements TagReading {
  abstract readonly tags: readonly Tag[];
  abstract readonly unreadable: readonly UnreadableTag[];
  abstract tagById(id: string): Tag | null;
  abstract nameOf(word: string): string;
  abstract fieldNameOf(typeId: string, field: string): string;
  abstract actionsOf(typeId: string): TagActions;
  abstract revision(): VocabularyRevision;
  abstract lawProjectionOf(typeId: string): LawProjection | null;

  private readonly phases = new Map<string, ReadonlySet<string>>();

  tagsOf(node: { readonly tags: readonly string[] }): Tag[] {
    return node.tags.flatMap((id) => {
      const tag = this.tagById(id);
      return tag === null ? [] : [tag];
    });
  }

  tagOf(node: { readonly tags: readonly string[] }): Tag | null {
    for (const id of node.tags) {
      const tag = this.tagById(id);
      if (tag !== null) return tag;
    }
    return null;
  }

  bindingTag(node: { readonly tags: readonly string[] }, contract: ContractId): Tag | null {
    for (const id of node.tags) {
      const tag = this.tagById(id);
      if (tag?.contracts?.[contract] !== undefined) return tag;
    }
    return null;
  }

  supports(node: { readonly tags: readonly string[] }, contract: ContractId): boolean {
    return this.bindingTag(node, contract) !== null;
  }

  protected wordsOf(typeId: string, phase: StatusPhase): ReadonlySet<string> {
    const key = `${typeId}\u0000${phase}`;
    let words = this.phases.get(key);
    if (words === undefined) {
      const tag = this.tagById(typeId);
      words = new Set(tag === null ? [] : statusesAt(tag, phase));
      this.phases.set(key, words);
    }
    return words;
  }

  standsAt(node: Tagged, contract: ContractId, phase: StatusPhase): boolean {
    if (!this.supports(node, contract)) return false;
    const tag = this.bindingTag(node, LIFECYCLE);
    const status = this.statusOf(node);
    return tag !== null && status !== null && this.wordsOf(tag.id, phase).has(status);
  }

  isTerminal(node: Tagged): boolean {
    return this.standsAt(node, LIFECYCLE, 'terminal');
  }

  statusOf(node: Tagged): string | null {
    const tag = this.bindingTag(node, LIFECYCLE);
    const field = tag === null ? undefined : lifecycleOf(tag)?.field;
    const raw = field === undefined ? undefined : node.fields[field];
    return typeof raw === 'string' ? raw : null;
  }

  holderOf(node: Tagged): number | null {
    const field = this.bindingTag(node, HOLDER)?.contracts?.[HOLDER]?.slots[HOLDER_SLOT];
    const raw = field === undefined ? undefined : node.fields[field];
    return typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : null;
  }

  statuses(): readonly string[] {
    return [...new Set(this.tags.flatMap((tag) => statusWords(tag)))];
  }

  declaredTags(): string[] {
    return this.tags.map((tag) => tag.id);
  }

  statusLine(): string {
    return this.tags
      .flatMap((tag) => {
        const words = statusWords(tag);
        return words.length === 0 ? [] : [`${tagLabel(tag)} ${words.join(' | ')}`];
      })
      .join(', ');
  }

  lawProjection(node: { readonly tags: readonly string[] }): LawProjection | null {
    for (const id of node.tags) {
      const projection = this.lawProjectionOf(id);
      if (projection !== null) return projection;
    }
    return null;
  }
}
