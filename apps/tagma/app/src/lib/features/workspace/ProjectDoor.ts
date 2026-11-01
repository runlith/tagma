import { Service } from '@runlith/layer/key';
import type { Effect } from 'effect';
import type { HttpOperationId, OperationAnswer, OperationInput } from '$lib/wire/operation.js';
import { type ApiClient, Door } from '$lib/wire/Door.js';
import { ProjectRung, type ProjectAim } from './ProjectRung.js';

export type ProjectLens = { readonly project: string };

export class ProjectDoor extends Service<ProjectDoor>()('ProjectDoor', { tier: 'project' }) {
  static *make() {
    return new ProjectDoor(yield* Door, yield* ProjectRung.Current);
  }

  constructor(
    private readonly door: Door,
    readonly aim: ProjectAim,
  ) {
    super();
  }

  ask<A, E>(call: (api: ApiClient) => Effect.Effect<A, E>, options?: { readonly signal?: AbortSignal }): Promise<A> {
    return this.door.ask(call, options);
  }

  perform<Id extends HttpOperationId>(
    id: Id,
    input: OperationInput<Id>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<OperationAnswer<Id>> {
    return this.door.perform(id, input, this.lens(), options);
  }

  lens(): ProjectLens {
    return { project: String(this.aim.projectId) };
  }
}
