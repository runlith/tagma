import { Service } from '@runlith/layer/key';
import type { OperationAnswer, OperationInput } from '@tagma/server/composition/catalog';
import type { HttpOperationId } from '@tagma/server/composition/catalog';
import type { Effect } from 'effect';
import { GraphRung, type GraphAim } from './GraphRung.js';
import { type ApiClient, type AskOptions, Door } from '$lib/wire/Door.js';

export type GraphLens = { readonly project: string; readonly branch?: string };

export class GraphDoor extends Service<GraphDoor>()('GraphDoor', { tier: 'graph' }) {
  static *make() {
    return new GraphDoor(yield* Door, yield* GraphRung.Current);
  }

  constructor(
    private readonly door: Door,
    readonly aim: GraphAim,
  ) {
    super();
  }

  ask<A, E>(call: (api: ApiClient) => Effect.Effect<A, E>, options?: AskOptions): Promise<A> {
    return this.door.ask(call, options);
  }

  perform<Id extends HttpOperationId>(id: Id, input: OperationInput<Id>, options?: AskOptions): Promise<OperationAnswer<Id>> {
    return this.door.perform(id, input, this.lens(), options);
  }

  performIn<Id extends HttpOperationId>(
    projectId: number,
    id: Id,
    input: OperationInput<Id>,
    options?: AskOptions,
  ): Promise<OperationAnswer<Id>> {
    return this.door.perform(id, input, projectId === this.aim.projectId ? this.lens() : { project: String(projectId) }, options);
  }

  performThere<Id extends HttpOperationId>(
    lens: GraphLens,
    id: Id,
    input: OperationInput<Id>,
    options?: AskOptions,
  ): Promise<OperationAnswer<Id>> {
    return this.door.perform(id, input, lens, options);
  }

  performAt<Id extends HttpOperationId>(
    id: Id,
    input: OperationInput<Id>,
    scope: string | undefined,
    options?: AskOptions,
  ): Promise<OperationAnswer<Id>> {
    return this.door.perform(id, input, { ...this.lens(), scope }, options);
  }

  lens(): GraphLens {
    return {
      project: String(this.aim.projectId),
      branch: this.aim.branch ?? undefined,
    };
  }
}
