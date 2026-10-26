import type { Outline } from '@runlith/code-facts/js';
import { matchesGlob } from 'node:path';
import type { Unjudged, Violation } from '../../../core/verdict';
import type { names } from './declaration';

export type NameParams = typeof names.params.Type;

export type Seat = {
  readonly path: string;
  readonly local: string;
  readonly module: string;
  readonly home: string | undefined;
};

export type Reading = {
  readonly params: NameParams;
  readonly seat: (path: string) => Seat;
  readonly facts: (path: string) => Outline;
  readonly listed: () => readonly string[] | undefined;
  readonly declaring: (name: string) => readonly string[];
  readonly keying: (id: string) => readonly string[];
  readonly found: Violation[];
  readonly unjudged: Unjudged[];
};

export const covered = (globs: readonly string[], local: string): boolean => globs.some((glob) => matchesGlob(local, glob));

export type Signal = {
  readonly rule: string;
  readonly key: string;
  readonly path: string;
  readonly line: number;
  readonly message: string;
  readonly fix: string;
  readonly value?: number;
};

export const report = (reading: Reading, signal: Signal): void => {
  reading.found.push({
    fingerprint: `${signal.rule} ${signal.key}`,
    file: signal.path,
    line: signal.line,
    message: `${signal.rule}: ${signal.message}`,
    fix: signal.fix,
    value: signal.value,
  });
};
