import { edgeKindOf, edgeTargetsOf, type FieldType, type Gate, type Tag } from '../contract/wire/tags/declaration.js';
import type { TagReading } from '../contract/wire/tags/reading.js';
import { statusWords, tagLabel } from '../contract/wire/tags/roles.js';
import { lifecycleOf } from '../contract/wire/tags/lifecycle.js';
import { moveOwners, type TagMove } from '../contract/wire/tags/actions.js';
import { SOURCE_KINDS } from '../contract/wire/sources.js';
import { fieldForm } from '../vocabulary/declarationRules.js';

function fieldWording(table: TagReading, type: FieldType, written: boolean): string {
  if (typeof type === 'string') return type === 'session' ? 'session id' : type;
  if (type.type === 'enum') return type.values.join(' | ');
  if (type.type === 'schema') return written ? type.name : `${type.name}: ${fieldForm(type.name)}`;
  const named = type.tag === undefined ? 'block' : `#${table.nameOf(type.tag)}`;
  return type.many === true ? `names of ${named}` : `name of ${named}`;
}

function gateWording(table: TagReading, gate: Gate): string {
  switch (gate.gate) {
    case 'transition':
      return `transition ${gate.field}: ${gate.from} → ${gate.to}`;
    case 'required':
      return `required ${gate.field}`;
    case 'open-children':
      return `no open child of #${table.nameOf(gate.tag)}`;
    case 'source-required':
      return `a source of kind: ${gate.kinds.join(' | ')}`;
  }
}

function headLines(table: TagReading, tag: Tag, mark: string): string[] {
  const offers = new Map(table.actionsOf(tag.id).offers.map(({ contract, ops }) => [contract as string, ops]));
  const contracts = Object.keys(tag.contracts ?? {}).map((contract) => {
    const ops = offers.get(contract);
    offers.delete(contract);
    return ops === undefined ? contract : `${contract} (${ops.join(', ')})`;
  });
  return [
    `${tagLabel(tag)}${mark}${contracts.length === 0 ? '' : ` — binds ${contracts.join(', ')}`}`,
    ...[...offers].map(([contract, ops]) => `${contract}: ${ops.join(', ')}`),
  ];
}

type StatusWording = { readonly line: string; readonly field: string; readonly covers: boolean };

function statusWording(table: TagReading, tag: Tag): StatusWording | null {
  const lifecycle = lifecycleOf(tag);
  if (lifecycle === null) return null;
  const { field, initial } = lifecycle;
  const actions = table.actionsOf(tag.id);
  const words = statusWords(tag);
  const said = new Set([initial]);
  const transitions = tag.gates.flatMap((gate) => (gate.gate === 'transition' && gate.field === field ? [gate] : []));
  const rank = (word: string) => (word === initial ? words.length : words.indexOf(word));
  const allowed = (move: TagMove) =>
    transitions
      .filter((gate) => gate.to === move.to && (move.from === undefined || move.from.includes(gate.from)))
      .map((gate) => gate.from);
  const fromOf = (move: TagMove) => (transitions.length === 0 ? move.from : allowed(move));
  const owned = actions.moves
    .filter((move) => move.field === field && fromOf(move)?.length !== 0)
    .sort((one, other) => rank(one.to) - rank(other.to))
    .map((move) => {
      const from = fromOf(move);
      for (const word of [move.to, ...(from ?? [])]) said.add(word);
      const named = from === undefined ? ' from any' : from.length === 1 && from[0] === initial ? '' : ` from ${from.join(' | ')}`;
      return `${move.to}${named} (${move.op})${move.says === undefined ? '' : ` — ${move.says}`}`;
    });
  const others = transitions.flatMap((gate) => {
    if (moveOwners(actions, field, gate.from, gate.to).length > 0) return [];
    said.add(gate.from).add(gate.to);
    return [`${gate.from} → ${gate.to}`];
  });
  const moves = others.length === 0 ? owned : [...owned, `other moves: update_block (${others.join(', ')})`];
  const name = table.fieldNameOf(tag.id, field);
  return {
    line: moves.length === 0 ? `${name} ${initial}` : `${name} ${initial} → ${moves.join(' · ')}`,
    field,
    covers: words.length > 0 && words.every((word) => said.has(word)),
  };
}

function fieldLines(table: TagReading, tag: Tag, shown: readonly (readonly [string, FieldType])[]): string[] {
  const writers = new Map(table.actionsOf(tag.id).slots.map(({ field, ops }) => [field, ops]));
  const required = new Set(tag.gates.flatMap((gate) => (gate.gate === 'required' ? [gate.field] : [])));
  const fields = shown.map(([field, type]) => {
    const ops = writers.get(field);
    const notes = [fieldWording(table, type, ops !== undefined), ...(required.has(field) ? ['required'] : [])];
    if (writers.delete(field) && ops !== undefined) notes.push(`set by ${ops.join(', ')}`);
    return `${table.fieldNameOf(tag.id, field)} (${notes.join(', ')})`;
  });
  return [
    ...[...writers].map(([field, ops]) => `${table.fieldNameOf(tag.id, field)} (set by ${ops.join(', ')})`),
    ...(fields.length === 0 ? [] : [`fields: ${fields.join(', ')}`]),
  ];
}

export function tagPromptOf(table: TagReading, tag: Tag): string {
  const status = statusWording(table, tag);
  return status === null ? tag.prompt : `${status.line}\n${tag.prompt}`;
}

export function tagText(table: TagReading, tag: Tag, mark: string = ''): string {
  const status = statusWording(table, tag);
  const shown = Object.entries(tag.fields).filter(([field]) => !(status?.covers === true && field === status.field));
  const lines = [...headLines(table, tag, mark), ...(status === null ? [] : [status.line]), tag.prompt, ...fieldLines(table, tag, shown)];
  const gates = tag.gates.filter((gate) =>
    gate.gate === 'required'
      ? !shown.some(([field]) => field === gate.field)
      : !(gate.gate === 'transition' && gate.field === status?.field),
  );
  if (gates.length > 0) lines.push(`gates: ${gates.map((gate) => gateWording(table, gate)).join(', ')}`);
  const shape: string[] = [];
  if (tag.edges.length > 0) {
    const edges = tag.edges.map((declared) => {
      const targets = edgeTargetsOf(declared);
      return targets === null
        ? edgeKindOf(declared)
        : `${edgeKindOf(declared)} → ${targets.map((target) => `#${table.nameOf(target)}`).join(' | ')}`;
    });
    shape.push(`edges: ${edges.join(', ')}`);
  }
  if (tag.sources !== undefined && tag.sources.length > 0) {
    const any = SOURCE_KINDS.every((kind) => tag.sources?.includes(kind));
    shape.push(`sources: ${any ? 'any' : tag.sources.join(', ')}`);
  }
  shape.push(`body: ${tag.body.shape}${tag.body.cap === undefined ? '' : `, maximum ${tag.body.cap} UTF-16 code units`}`);
  lines.push(shape.join(' · '));
  return lines.join('\n');
}

export function vocabularyText(table: TagReading, catalogs: readonly string[]): string {
  const lines = [
    `This project declares ${table.tags.length} tag${table.tags.length === 1 ? '' : 's'}${
      catalogs.length === 0 ? ', with no catalog switched on' : `, catalogs on: ${catalogs.join(', ')}`
    }.`,
  ];
  for (const tag of table.tags) {
    lines.push('', tagText(table, tag));
  }
  if (table.unreadable.length > 0) {
    lines.push('', 'A `#tag` node standing here could not be read as a declaration:');
    for (const unreadable of table.unreadable) lines.push(`  ${unreadable.name}: ${unreadable.reason}`);
  }
  return lines.join('\n');
}
