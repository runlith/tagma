import { handle } from '@runlith/utils/printed';
import { Schema } from 'effect';
import { SPOKEN_LENGTH, spokenId } from '../../../platform/contract/wire/ids.js';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';

export const BlockName = Schema.String.annotate(handle());
export const BlockIdentity = Schema.String.check(Schema.isPattern(/^[0-9a-f]{32}$/u)).annotate({
  description: 'The block’s full identity, scoped to its graph copy.',
});
export const blockReferenceSchema = Schema.Struct({ name: BlockName, identity: BlockIdentity });
export type BlockReference = typeof blockReferenceSchema.Type;

export function blockIdentity(uuid: string): string {
  return uuid.replaceAll('-', '').toLowerCase();
}

const BLOCK_REF_SOURCE = String.raw`\[\[((?:[1-9][0-9]*/)?[0-9a-fA-F]{${SPOKEN_LENGTH},32})(?:\|([^\]\n]+))?\]\]`;
export const BLOCK_REF = new RegExp(BLOCK_REF_SOURCE, 'g');
export const BLOCK_REF_INLINE = new RegExp(`^${BLOCK_REF_SOURCE}`);

export const DEAD_REF = /\[\[dead:([0-9a-f]{8,32}|L-\d+)(?:\|([^\]\n]+))?\]\]/g;

export const BLOCK_NAME = new RegExp(`^[0-9a-fA-F]{${SPOKEN_LENGTH},32}$`, 'u');
export function isBlockName(value: string): boolean {
  return BLOCK_NAME.test(value);
}

export function blockName(uuid: string): string {
  return spokenId(uuid);
}

export const BLOCK_ADDRESS = new RegExp(`^(?:[1-9][0-9]*/)?[0-9a-fA-F]{${SPOKEN_LENGTH},32}$`, 'u');

export type BlockAddress = { readonly projectId: number | null; readonly name: string };

export function blockAddress(value: string): BlockAddress {
  const cut = value.indexOf('/');
  if (cut < 0) return { projectId: null, name: value };
  const project = value.slice(0, cut);
  return { projectId: /^[1-9][0-9]*$/u.test(project) ? Number(project) : Number.NaN, name: value.slice(cut + 1) };
}

export function addressed(projectId: number, name: string): string {
  return `${projectId}/${name}`;
}

const CANDIDATE_TAIL = 12;

const IDENTITY_LENGTH = 32;

export function tailOf(uuid: string, length: number): string {
  return uuid.replaceAll('-', '').slice(-length);
}

export function distinctLength(uuids: readonly string[]): number {
  const unique = [...new Set(uuids.map((uuid) => tailOf(uuid, IDENTITY_LENGTH)))];
  let length = CANDIDATE_TAIL;
  while (length < IDENTITY_LENGTH && new Set(unique.map((one) => one.slice(-length))).size < unique.length) length++;
  return length;
}

export function distinctTails(uuids: readonly string[]): readonly string[] {
  const length = distinctLength(uuids);
  return uuids.map((uuid) => tailOf(uuid, length));
}

const NO_NAMES: readonly string[] = [];

type Requested = { readonly name: string; readonly projectId: number | null };

export class TitleNames {
  private readonly requested = new Map<string, Requested[]>();
  private readonly suffixes = new Set<string>();
  private readonly lengths: readonly number[];
  readonly tails: readonly string[];

  constructor(names: readonly string[]) {
    for (const name of new Set(names)) {
      const address = blockAddress(name);
      const needle = address.name.toLowerCase().replaceAll('-', '');
      if (
        Number.isNaN(address.projectId) ||
        needle.length < SPOKEN_LENGTH ||
        needle.length > IDENTITY_LENGTH ||
        !/^[0-9a-f]+$/u.test(needle)
      )
        continue;
      const aliases = this.requested.get(needle) ?? [];
      aliases.push({ name, projectId: address.projectId });
      this.requested.set(needle, aliases);
      this.suffixes.add(needle.slice(-SPOKEN_LENGTH));
    }
    this.lengths = [...new Set([...this.requested.keys()].map((name) => name.length))];
    this.tails = [...this.suffixes];
  }

  matches(uuid: string, projectId: number): readonly string[] {
    const compact = uuid.replaceAll('-', '');
    if (!this.suffixes.has(compact.slice(-SPOKEN_LENGTH))) return NO_NAMES;
    return this.lengths.flatMap((length) =>
      (this.requested.get(compact.slice(-length)) ?? []).flatMap((one) =>
        one.projectId === null || one.projectId === projectId ? [one.name] : [],
      ),
    );
  }
}

export function blockRefTargets(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(BLOCK_REF)) if (!match[1]!.includes('/')) names.add(match[1]!.toLowerCase());
  return [...names];
}

export function addressedRefsRefusal(body: string): GateRefusal<'body-address'> | null {
  const found = new Map<string, string>();
  for (const [written, target, label] of body.matchAll(BLOCK_REF)) {
    if (!target!.includes('/')) continue;
    found.set(written, `[[${blockAddress(target!).name}${label === undefined ? '' : `|${label}`}]]`);
  }
  if (found.size === 0) return null;
  return new GateRefusal(
    'body-address',
    `${[...found.keys()].join(', ')} ${found.size === 1 ? 'names its project' : 'name their projects'} by this machine's id, and a stored body keeps the bare name every machine resolves`,
    [`write ${[...found.values()].join(', ')} instead: a bare name in a body reaches the block in any project`],
  );
}
