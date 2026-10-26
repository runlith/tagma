export class ChatDraftShelf<TSlot> {
  private readonly slots = new Map<string, TSlot>();

  constructor(private readonly make: (key: string) => TSlot) {}

  at(key: string): TSlot {
    const existing = this.slots.get(key);
    if (existing !== undefined) return existing;
    const slot = this.make(key);
    this.slots.set(key, slot);
    return slot;
  }

  rename(from: string, to: string): void {
    if (from === to) return;
    const slot = this.slots.get(from);
    if (slot === undefined) return;
    this.slots.delete(from);
    this.slots.set(to, slot);
  }

  forget(key: string): void {
    this.slots.delete(key);
  }
}
