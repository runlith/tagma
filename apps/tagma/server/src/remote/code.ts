import { randomBytes } from 'node:crypto';
import { digestOf } from './credential.js';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const LENGTH = 8;

export const mintCode = (): string => {
  const drawn = [...randomBytes(LENGTH)].map((byte) => CROCKFORD[byte & 31]).join('');
  return `${drawn.slice(0, LENGTH / 2)}-${drawn.slice(LENGTH / 2)}`;
};

export const codeDigest = (typed: string): string =>
  digestOf(typed.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1'));

export class Misses {
  private readonly at: number[] = [];

  constructor(
    private readonly budget: number,
    private readonly windowMs: number,
  ) {}

  spent(now: number): boolean {
    while (this.at.length > 0 && this.at[0]! <= now - this.windowMs) this.at.shift();
    return this.at.length >= this.budget;
  }

  missed(now: number): void {
    this.at.push(now);
  }
}
