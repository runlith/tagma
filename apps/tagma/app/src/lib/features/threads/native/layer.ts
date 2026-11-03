import { Layer } from '@runlith/layer/Layer';
import type { Component } from 'svelte';
import { WireEntryKinds } from '$lib/wire/WireEntryKinds.js';
import connectFeed from '../birth/connect.feed.svelte';
import signedOutComposer from '../birth/signedOut.composer.svelte';
import * as transportKinds from '../external/transport.kinds.svelte';
import * as externalRecords from '../external/productRecords.js';
import stripComposer from '../place/strip.composer.svelte';
import * as worktreeRecords from '../worktrees/productRecords.js';
import worktreesFeed from '../worktrees/worktrees.feed.svelte';
import bashFeed from './bash.feed.svelte';
import browserToolsFeed from './browserTools.feed.svelte';
import callsFeed from './calls.feed.svelte';
import * as agentCommands from './commands/agent.commands.js';
import * as approverCommands from './commands/approver.commands.js';
import * as approvesCommands from './commands/approves.commands.js';
import * as compactCommands from './commands/compact.commands.js';
import * as delegationCommands from './commands/delegation.commands.js';
import * as modeCommands from './commands/mode.commands.js';
import * as modelCommands from './commands/model.commands.js';
import * as newThreadCommands from './commands/newThread.commands.js';
import * as recapCommands from './commands/recap.commands.js';
import * as refreshInstructionsCommands from './commands/refreshInstructions.commands.js';
import commitsFeed from './commits.feed.svelte';
import compactionFeed from './compaction.feed.svelte';
import * as compositionKinds from './composition.kinds.js';
import compositionFeed from './composition.feed.svelte';
import {
  type ComposerPart,
  ComposerParts,
  type ComposerPartDeclaration,
  type FeedPart,
  FeedParts,
  type FeedPartDeclaration,
  ThreadCommands,
  ThreadKinds,
  ThreadTools,
} from './contribution.js';
import contextComposer from './context.composer.svelte';
import * as contextKinds from './context.kinds.svelte';
import dictationComposer from './dictation.composer.svelte';
import draftComposer from './draft.composer.svelte';
import failuresFeed from './failures.feed.svelte';
import graphToolsFeed from './graphTools.feed.svelte';
import imagesFeed from './images.feed.svelte';
import leadComposer from './lead.composer.svelte';
import mcpAppsFeed from './mcpApps.feed.svelte';
import modeComposer from './mode.composer.svelte';
import modelComposer from './model.composer.svelte';
import pagesFeed from './pages.feed.svelte';
import pinsFeed from './pins.feed.svelte';
import pluginsFeed from './plugins.feed.svelte';
import * as nativeRecords from './productRecords.js';
import quotaFeed from './quota.feed.svelte';
import recapFeed from './recap.feed.svelte';
import { ProductRecords } from './records.js';
import rewindComposer from './rewind.composer.svelte';
import skillsComposer from './skills.composer.svelte';
import * as startKinds from './start.kinds.svelte';
import tagmaAppViewsFeed from './tagmaAppViews.feed.svelte';
import teamComposer from './team.composer.svelte';
import * as threadTools from './threadTools.tools.js';

const composer = (name: string, component: Component<ComposerPart>): ComposerPartDeclaration => ({
  id: `${name}.composer`,
  payload: { component },
});

const feed = (name: string, component: Component<FeedPart>): FeedPartDeclaration => ({ id: `${name}.feed`, payload: { component } });

export const ThreadContributions = Layer.mergeAll(
  ThreadCommands,
  ThreadTools,
  ThreadKinds,
  ComposerParts,
  FeedParts,
  ProductRecords,
  ThreadCommands.contribute('agent', ...agentCommands.commands),
  ThreadCommands.contribute('approver', ...approverCommands.commands),
  ThreadCommands.contribute('approves', ...approvesCommands.commands),
  ThreadCommands.contribute('compact', ...compactCommands.commands),
  ThreadCommands.contribute('delegation', ...delegationCommands.commands),
  ThreadCommands.contribute('mode', ...modeCommands.commands),
  ThreadCommands.contribute('model', ...modelCommands.commands),
  ThreadCommands.contribute('newThread', ...newThreadCommands.commands),
  ThreadCommands.contribute('recap', ...recapCommands.commands),
  ThreadCommands.contribute('refreshInstructions', ...refreshInstructionsCommands.commands),
  ThreadTools.contribute('threadTools', ...threadTools.tools),
  ThreadKinds.contribute('composition', ...compositionKinds.kinds),
  ThreadKinds.contribute('context', ...contextKinds.kinds),
  ThreadKinds.contribute('start', ...startKinds.kinds),
  ThreadKinds.contribute('transport', ...transportKinds.kinds),
  ComposerParts.contribute(
    'native',
    composer('context', contextComposer),
    composer('dictation', dictationComposer),
    composer('draft', draftComposer),
    composer('lead', leadComposer),
    composer('mode', modeComposer),
    composer('model', modelComposer),
    composer('rewind', rewindComposer),
    composer('skills', skillsComposer),
    composer('team', teamComposer),
  ),
  ComposerParts.contribute('place', composer('strip', stripComposer)),
  ComposerParts.contribute('birth', composer('signedOut', signedOutComposer)),
  FeedParts.contribute(
    'native',
    feed('bash', bashFeed),
    feed('browserTools', browserToolsFeed),
    feed('calls', callsFeed),
    feed('commits', commitsFeed),
    feed('compaction', compactionFeed),
    feed('composition', compositionFeed),
    feed('failures', failuresFeed),
    feed('graphTools', graphToolsFeed),
    feed('images', imagesFeed),
    feed('mcpApps', mcpAppsFeed),
    feed('pages', pagesFeed),
    feed('pins', pinsFeed),
    feed('plugins', pluginsFeed),
    feed('quota', quotaFeed),
    feed('recap', recapFeed),
    feed('tagmaAppViews', tagmaAppViewsFeed),
  ),
  FeedParts.contribute('birth', feed('connect', connectFeed)),
  FeedParts.contribute('worktrees', feed('worktrees', worktreesFeed)),
  ProductRecords.contribute('native', ...nativeRecords.productRecords),
  ProductRecords.contribute('external', ...externalRecords.productRecords),
  ProductRecords.contribute('worktrees', ...worktreeRecords.productRecords),
  WireEntryKinds.contribute('native', ...nativeRecords.entryKinds),
  WireEntryKinds.contribute('external', ...externalRecords.entryKinds),
  WireEntryKinds.contribute('worktrees', ...worktreeRecords.entryKinds),
);
