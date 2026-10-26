import type { Tag } from './declaration.js';
import { NO_ACTIONS, type TagActions } from './actions.js';
import type { LawProjection } from './law.js';
import { TagReader } from './reading.js';
import type { UnreadableTag, Vocabulary } from './table.js';
import { VOCABULARY_FORMAT, type VocabularyRevision } from './revision.js';

export class ServedTags extends TagReader {
  readonly tags: readonly Tag[];
  readonly unreadable: readonly UnreadableTag[];
  private readonly byId: ReadonlyMap<string, Tag>;

  constructor(private readonly vocabulary: Vocabulary) {
    super();
    this.tags = vocabulary.tags;
    this.unreadable = vocabulary.unreadable;
    this.byId = new Map(this.tags.map((tag) => [tag.id, tag]));
  }

  tagById(id: string): Tag | null {
    return this.byId.get(id) ?? null;
  }

  nameOf(word: string): string {
    return this.byId.get(word)?.name ?? word;
  }

  fieldNameOf(typeId: string, field: string): string {
    return this.vocabulary.fieldNames[typeId]?.[field] ?? field;
  }

  actionsOf(typeId: string): TagActions {
    return Object.hasOwn(this.vocabulary.actions, typeId) ? this.vocabulary.actions[typeId]! : NO_ACTIONS;
  }

  revision(): VocabularyRevision {
    return this.vocabulary.revision;
  }

  lawProjectionOf(typeId: string): LawProjection | null {
    return Object.hasOwn(this.vocabulary.laws, typeId) ? this.vocabulary.laws[typeId]! : null;
  }
}

export const NO_TAGS = new ServedTags({
  revision: { format: VOCABULARY_FORMAT, revision: '' },
  catalogs: [],
  installed: [],
  findings: [],
  tags: [],
  unreadable: [],
  actions: {},
  fieldNames: {},
  forms: {},
  laws: {},
});
