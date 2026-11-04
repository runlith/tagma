import type { SectionEdit } from '@runlith/agent/thread/agents/AgentProfile';
import { Result } from 'effect';
import type { PromptDocument, PromptSection } from '../../threads/contract/wire/agentLibrary.js';
import { GateRefusal, type Unblock } from '../../platform/contract/wire/refusal.js';
import type { SectionCatalog } from '../../platform/contract/service/sections.js';
import { contributions, SECTIONS } from '../../threads/doctrine/registry.js';
import { renderSections, type SectionRender } from '../../threads/doctrine/render.js';
import { type SectionId, sectionPath } from '../../threads/doctrine/registry.js';

export type PromptInput = {
  readonly agentId: string;
  readonly identity: string;
  readonly sections: ReadonlySet<SectionId>;
  readonly render: SectionRender;
};

const STALE_EDIT_WAYS: Unblock = [
  'Correct the definition’s sections against the ids and text read_agent prints for its base agent under prompt.sections.',
  'Refresh the thread’s instructions after correcting its definition; its next run adopts the corrected edits.',
];

const RENDERED_LIMIT = 64;
const rendered = new WeakMap<SectionCatalog, Map<string, PromptDocument>>();
const own = contributions(Object.values(SECTIONS));

const titleOf = (id: string, text: string): string => (id === 'preamble' ? 'Identity' : (/^#{1,6}\s+(.+)$/m.exec(text)?.[1] ?? id));

const documentOf = (sections: readonly PromptSection[]): PromptDocument => ({
  text: sections.map((section) => section.text).join('\n\n'),
  sections,
});

export function promptDocument(input: PromptInput): PromptDocument {
  const catalog = input.render.contributed ?? own;
  const { prompt, base } = catalog.assemblies;
  const ids = prompt.filter((id) => input.sections.has(id) || base.includes(id));
  const cached = rendered.get(catalog) ?? new Map<string, PromptDocument>();
  rendered.set(catalog, cached);
  const { contributed: _contributed, ...render } = input.render;
  const key = JSON.stringify([input.agentId, input.identity, ids, render]);
  const held = cached.get(key);
  if (held !== undefined) return held;
  const document = documentOf(
    ids.flatMap((id) =>
      renderSections([id], { ...input.render, contributed: catalog, identity: input.identity }).map((text) => ({
        id,
        title: titleOf(id, text),
        source: sectionPath(id, catalog),
        text: text.trimEnd(),
      })),
    ),
  );
  if (cached.size >= RENDERED_LIMIT) {
    const oldest = cached.keys().next().value;
    if (oldest !== undefined) cached.delete(oldest);
  }
  cached.set(key, document);
  return document;
}

export function assemblePrompt(input: PromptInput): string {
  return promptDocument(input).text;
}

export function editedPrompt(
  document: PromptDocument,
  edits: readonly SectionEdit[],
  origin: string,
): Result.Result<PromptDocument, GateRefusal<'agent-invalid'>> {
  if (edits.length === 0) return Result.succeed(document);
  const sections = [...document.sections];
  for (const [index, edit] of edits.entries()) {
    const refused = (reason: string) =>
      Result.fail(
        new GateRefusal(
          'agent-invalid',
          `sections[${index}] of ${origin}: ${reason}; this prompt's sections here are ${sections.map((section) => section.id).join(', ')}`,
          STALE_EDIT_WAYS,
        ),
      );
    const at = (id: string): number => sections.findIndex((section) => section.id === id);
    const absent = (id: string) => refused(`${id} is not a section of this prompt`);
    if ('add' in edit) {
      if (at(edit.add) !== -1) return refused(`${edit.add} already stands in this prompt`);
      const anchor = 'before' in edit ? edit.before : edit.after;
      const position = at(anchor);
      if (position === -1) return absent(anchor);
      const text = edit.text.trimEnd();
      sections.splice('before' in edit ? position : position + 1, 0, {
        id: edit.add,
        title: titleOf(edit.add, text),
        source: origin,
        text,
      });
      continue;
    }
    if ('keep' in edit) {
      const missing = edit.keep.find((id) => at(id) === -1);
      if (missing !== undefined) return absent(missing);
      sections.splice(0, sections.length, ...sections.filter((section) => edit.keep.includes(section.id)));
      continue;
    }
    const id = 'drop' in edit ? edit.drop : 'replace' in edit ? edit.replace : edit.edit;
    const position = at(id);
    if (position === -1) return absent(id);
    const section = sections[position]!;
    if ('drop' in edit) {
      sections.splice(position, 1);
      continue;
    }
    if ('replace' in edit) {
      const text = edit.text.trimEnd();
      sections[position] = { id, title: titleOf(id, text), source: origin, text };
      continue;
    }
    const start = section.text.indexOf(edit.find);
    if (start === -1) return refused(`the passage ${JSON.stringify(edit.find)} is not in ${id}`);
    if (section.text.indexOf(edit.find, start + 1) !== -1)
      return refused(`the passage ${JSON.stringify(edit.find)} stands more than once in ${id}; lengthen it until it is unique`);
    const text = (section.text.slice(0, start) + edit.with + section.text.slice(start + edit.find.length)).trimEnd();
    const editor = ` · edited by ${origin}`;
    const source = section.source.endsWith(editor) ? section.source : `${section.source}${editor}`;
    sections[position] = { ...section, title: titleOf(id, text), source, text };
  }
  return Result.succeed(documentOf(sections));
}
