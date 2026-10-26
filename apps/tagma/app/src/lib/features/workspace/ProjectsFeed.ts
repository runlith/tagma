import { Failure } from '@runlith/layer/Failure';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { Workspace } from './Selection.svelte.js';

export class ProjectsFeed extends Service<ProjectsFeed>()('ProjectsFeed', { tier: 'app', eager: true }) {
  static *make() {
    return new ProjectsFeed(yield* Live, yield* Workspace, yield* Scope, yield* Failure);
  }

  constructor(live: LiveConnection, workspace: Workspace, scope: Scope, failure: Failure) {
    super();
    const held = live.hold(
      (client) => client['projects.subscribe']({}),
      () => void workspace.refreshProjects().catch((error: unknown) => failure.report(error)),
      (reason) => {
        if (reason.kind === 'subscription') failure.report(new Error(reason.message));
      },
    );
    scope.defer(() => held.unsubscribe());
  }
}
