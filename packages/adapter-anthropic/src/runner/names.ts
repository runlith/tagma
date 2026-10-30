export const TAGMA_SERVER = 'tagma';

export const SERVED = `mcp__${TAGMA_SERVER}__`;

export const servedName = (name: string): string => `${SERVED}${name}`;

export class Names {
  private held: ReadonlySet<string> = new Set();
  private readonly foreign: readonly string[];

  constructor(servers: readonly string[]) {
    this.foreign = servers.map((server) => `mcp__${server}__`);
  }

  get aliases(): Record<string, string> {
    return Object.fromEntries([...this.held].map((name) => [name, servedName(name)]));
  }

  holds(names: readonly string[]): boolean {
    const owned = this.owned(names);
    return owned.length === this.held.size && owned.every((name) => this.held.has(name));
  }

  hold(names: readonly string[]): void {
    this.held = new Set(this.owned(names));
  }

  routed(wire: string): boolean {
    return wire.startsWith(SERVED) || this.held.has(wire);
  }

  private owned(names: readonly string[]): readonly string[] {
    return names.filter((name) => !this.foreign.some((prefix) => name.startsWith(prefix)));
  }
}
