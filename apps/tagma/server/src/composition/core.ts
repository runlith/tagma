import { platform } from '../platform/platform.js';
import { projects } from '../projects/projects.js';
import { settings } from '../settings/settings.js';
import { providers } from '../providers/providers.js';
import { threadRecord } from '../thread-record/thread-record.js';
import { workspace } from '../workspace/workspace.js';
import { graph } from '../graph/graph.js';
import { catalogs } from '../catalogs/catalogs.js';
import { installation } from '../installation/installation.js';
import { changeRecord } from '../change-record/change-record.js';
import { checkoutFiles } from '../checkout-files/checkout-files.js';
import { editors } from '../editors/editors.js';
import { commitSteps } from '../commit-steps/commit-steps.js';
import { config } from '../config/config.js';
import { mcp } from '../mcp/mcp.js';
import { plugins } from '../plugins/plugins.js';
import { views } from '../views/views.js';
import { pluginSecrets } from '../plugin-secrets/plugin-secrets.js';
import { artifacts } from '../artifacts/artifacts.js';
import { executions } from '../executions/executions.js';
import { worktrees } from '../worktrees/worktrees.js';
import { landing } from '../landing/landing.js';
import { sandbox } from '../sandbox/sandbox.js';
import { performance } from '../performance/performance.js';
import { activity } from '../activity/activity.js';
import { power } from '../power/power.js';
import { remote } from '../remote/remote.js';
import { notify } from '../notify/notify.js';
import { push } from '../push/push.js';
import { schedule } from '../schedule/schedule.js';
import { speech } from '../speech/speech.js';
import { browser } from '../browser/browser.js';
import { images } from '../images/images.js';
import { navigation } from '../navigation/navigation.js';
import { managedBrowser } from '../managed-browser/managed-browser.js';
import { desktopBrowser } from '../desktop-browser/desktop-browser.js';
import { pageRender } from '../page-render/page-render.js';
import { nativeHarness } from '../native-harness/native-harness.js';
import { threads } from '../threads/threads.js';
import { invocation } from '../invocation/invocation.js';
import { enforcement } from '../enforcement/enforcement.js';
import { externalHarnesses } from '../external-harnesses/external-harnesses.js';
import { cli } from '../cli/cli.js';

export const CORE_MODULES = [
  platform,
  projects,
  settings,
  providers,
  threadRecord,
  workspace,
  graph,
  catalogs,
  installation,
  changeRecord,
  checkoutFiles,
  editors,
  commitSteps,
  config,
  mcp,
  plugins,
  views,
  pluginSecrets,
  artifacts,
  executions,
  worktrees,
  enforcement,
  landing,
  sandbox,
  performance,
  activity,
  power,
  remote,
  speech,
  browser,
  managedBrowser,
  desktopBrowser,
  pageRender,
  threads,
  images,
  navigation,
  nativeHarness,
  externalHarnesses,
  notify,
  push,
  schedule,
  invocation,
  cli,
] as const;
