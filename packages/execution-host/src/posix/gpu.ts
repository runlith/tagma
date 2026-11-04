import type { ProcessGpu } from '../UsageReader';

export type GpuClient = {
  readonly pid: number;
  readonly birth: string;
  readonly client: string;
  readonly gpu: ProcessGpu;
};

export type GpuRead =
  | { readonly _tag: 'Read'; readonly clients: ReadonlyArray<GpuClient> }
  | { readonly _tag: 'Unavailable'; readonly reason: string };

type Held = { readonly birth: string; readonly micros: number; readonly clients: ReadonlyMap<string, number> };

export class Gpu {
  private held = new Map<number, Held>();

  read(read: GpuRead): ReadonlyMap<number, GpuClient> {
    if (read._tag === 'Unavailable') {
      this.held.clear();
      return new Map();
    }
    const grouped = new Map<number, GpuClient[]>();
    for (const client of read.clients) {
      const clients = grouped.get(client.pid);
      if (clients === undefined) grouped.set(client.pid, [client]);
      else clients.push(client);
    }
    const next = new Map<number, Held>();
    const measured = new Map<number, GpuClient>();
    for (const [pid, clients] of grouped) {
      const first = clients[0]!;
      const previous = this.held.get(pid);
      const same = previous?.birth === first.birth ? previous : undefined;
      let micros = same?.micros ?? 0;
      const counters = new Map<string, number>();
      let unavailable: string | undefined;
      for (const client of clients) {
        if (client.birth !== first.birth) {
          unavailable = 'the GPU clients do not share one kernel process witness';
          break;
        }
        if (client.gpu._tag === 'Unavailable') {
          unavailable = client.gpu.reason;
          break;
        }
        const earlier = same?.clients.get(client.client);
        micros += earlier === undefined ? client.gpu.micros : Math.max(0, client.gpu.micros - earlier);
        counters.set(client.client, client.gpu.micros);
      }
      if (unavailable !== undefined) {
        measured.set(pid, { ...first, gpu: { _tag: 'Unavailable', reason: unavailable } });
        continue;
      }
      next.set(pid, { birth: first.birth, micros, clients: counters });
      measured.set(pid, { ...first, gpu: { _tag: 'Measured', micros } });
    }
    this.held = next;
    return measured;
  }
}
