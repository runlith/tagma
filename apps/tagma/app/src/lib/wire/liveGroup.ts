import { RpcGroup } from 'effect/rpc';
import { NEXT_FEED } from '@tagma/server/installation/contract/wire/next';
import { rpcOf, type RpcOfFeed } from '@tagma/server/platform/contract/wire/live';
import { GRAPH_FEED, GRAPH_RECOVERY_FEED, GRAPH_REMOTE_FEED, GRAPH_WORK_FEED } from '@tagma/server/graph/contract/wire/feed';
import { CHECKOUT_FEED } from '@tagma/server/workspace/contract/wire/checkout';
import { WORKTREES_FEED } from '@tagma/server/worktrees/contract/wire/feed';
import { SPACE_SCAN_FEED } from '@tagma/server/worktrees/contract/wire/space';
import { HOLDINGS_FEED } from '@tagma/server/change-record/contract/wire/holdings';
import { TREE_FEED } from '@tagma/server/checkout-files/contract/wire/directory';
import { DOCUMENT_FEED, LOOSE_DOCUMENT_FEED } from '@tagma/server/checkout-files/contract/wire/document';
import { SCRATCH_FEED } from '@tagma/server/checkout-files/contract/wire/scratch';
import { SEARCH_FEED } from '@tagma/server/checkout-files/contract/wire/search';
import { THREAD_CHANGES_FEED } from '@tagma/server/change-record/contract/wire/threadChanges';
import { PAGE_FEED, THREAD_PAGES_FEED } from '@tagma/server/artifacts/contract/wire/feed';
import { CALLS_FEED } from '@tagma/server/native-harness/contract/wire/calls';
import { MCP_FEEDS } from '@tagma/server/mcp/contract/wire/feeds';
import { CONNECTORS_FEED } from '@tagma/server/connectors/contract/wire/rows';
import { VIEW_FEEDS } from '@tagma/server/views/contract/wire/feeds';
import { THREAD_NATIVE_FEEDS } from '@tagma/server/native-harness/contract/wire/threadFeeds';
import { ACCOUNTS_FEED } from '@tagma/server/providers/contract/wire/accounts';
import { CATALOG_FEED } from '@tagma/server/providers/contract/wire/catalog';
import { PROJECTS_FEED } from '@tagma/server/projects/contract/wire/feed';
import { AWAKE_FEED, PACE_FEED } from '@tagma/server/power/contract/wire/power';
import { THREAD_FEEDS } from '@tagma/server/threads/contract/wire/feeds';
import { EXECUTION_FEEDS } from '@tagma/server/executions/contract/wire/feeds';
import { SPEECH_FEEDS } from '@tagma/server/speech/contract/wire/feeds';
import { NOTIFY_FEEDS } from '@tagma/server/notify/contract/wire/notification';
import { ACTIVITY_FEEDS } from '@tagma/server/activity/contract/wire/faults';
import { BROWSER_FEEDS } from '@tagma/server/browser/contract/wire/feeds';
import { ATTACH_FEED } from '@tagma/server/desktop-browser/contract/wire/channel';
import { TRANSLATION_FEED } from '@tagma/server/translations/contract/wire/feed';

const USED = [
  NEXT_FEED,
  GRAPH_FEED,
  GRAPH_WORK_FEED,
  GRAPH_RECOVERY_FEED,
  GRAPH_REMOTE_FEED,
  CHECKOUT_FEED,
  WORKTREES_FEED,
  SPACE_SCAN_FEED,
  THREAD_CHANGES_FEED,
  HOLDINGS_FEED,
  TREE_FEED,
  SEARCH_FEED,
  DOCUMENT_FEED,
  LOOSE_DOCUMENT_FEED,
  SCRATCH_FEED,
  THREAD_PAGES_FEED,
  PAGE_FEED,
  CALLS_FEED,
  ...MCP_FEEDS,
  CONNECTORS_FEED,
  ...VIEW_FEEDS,
  ...THREAD_NATIVE_FEEDS,
  ACCOUNTS_FEED,
  CATALOG_FEED,
  PROJECTS_FEED,
  AWAKE_FEED,
  PACE_FEED,
  ...THREAD_FEEDS,
  ...EXECUTION_FEEDS,
  ...SPEECH_FEEDS,
  ...NOTIFY_FEEDS,
  ...ACTIVITY_FEEDS,
  ...BROWSER_FEEDS,
  ATTACH_FEED,
  TRANSLATION_FEED,
] as const;

export type UsedRpcs = RpcOfFeed<(typeof USED)[number]>;

export const LiveRpc: RpcGroup.RpcGroup<UsedRpcs> = RpcGroup.make(...USED.map(rpcOf));
