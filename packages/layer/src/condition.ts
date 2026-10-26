import { Clock } from './clock.js';
import type { AnyKey, KeyClass, Tier } from './key.js';

declare const ReaderTag: unique symbol;

export interface GraphUse {
  get<Self>(key: KeyClass<string, Self>): Self;
}

export interface Reader<N extends string = string, Reads extends AnyKey = never> {
  readonly tier: Tier;
  read(graph: GraphUse): boolean;
  readonly [ReaderTag]?: { readonly name: N; readonly reads: Reads };
}

export type Condition = (() => boolean) | Reader<string, AnyKey>;

export interface Fact extends Reader {
  readonly name: string;
  readonly current: boolean;
  readonly holdsUntilMs: number | undefined;
  and(other: Fact): Fact;
}

const named = new WeakMap<Fact, string>();

function make(read: () => boolean, holdsUntilMs: () => number | undefined): Fact {
  const fact: Fact = {
    tier: 'app',
    read: () => read(),
    get name() {
      return named.get(fact) ?? '';
    },
    get current() {
      return read();
    },
    get holdsUntilMs() {
      return holdsUntilMs();
    },
    and: (other) =>
      make(
        () => read() && other.current,
        () => earliest(holdsUntilMs(), other.holdsUntilMs),
      ),
  };

  return fact;
}

function earliest(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.min(left, right);
}

function of(read: () => boolean): Fact {
  return make(read, () => undefined);
}

function latch(read: () => boolean, holdMs: number): Fact {
  let holdsUntilMs: number | undefined;
  let wasTrue = false;

  const current = (): boolean => {
    if (read()) {
      wasTrue = true;
      holdsUntilMs = undefined;
      return true;
    }

    if (wasTrue) {
      wasTrue = false;
      holdsUntilMs = Clock.now() + holdMs;
    }

    if (holdsUntilMs === undefined) return false;
    if (Clock.now() < holdsUntilMs) return true;

    holdsUntilMs = undefined;
    return false;
  };

  return make(current, () => {
    current();
    return holdsUntilMs;
  });
}

export function isFact(value: unknown): value is Fact {
  return typeof value === 'object' && value !== null && 'current' in value && 'holdsUntilMs' in value && 'read' in value;
}

export function nameFacts(owner: string, instance: object): void {
  for (const field of Object.getOwnPropertyNames(instance)) {
    const value = Object.getOwnPropertyDescriptor(instance, field)?.value;
    if (!isFact(value) || named.has(value)) continue;
    named.set(value, `${owner}.${field}`);
  }
}

export const Condition = { of, latch } as const;
