import { settings } from '../settings/contract/wire/module.js';
import { providers } from '../providers/contract/wire/module.js';
import { workspace } from '../workspace/contract/wire/module.js';
import { graph } from '../graph/contract/wire/module.js';
import { installation } from '../installation/contract/wire/module.js';
import { changeRecord } from '../change-record/contract/wire/module.js';
import { checkoutFiles } from '../checkout-files/contract/wire/module.js';
import { editors } from '../editors/contract/wire/module.js';
import { config } from '../config/contract/wire/module.js';
import { mcp } from '../mcp/contract/wire/module.js';
import { plugins } from '../plugins/contract/wire/module.js';
import { views } from '../views/contract/wire/module.js';
import { secrets } from '../secrets/contract/wire/module.js';
import { artifacts } from '../artifacts/contract/wire/module.js';
import { executions } from '../executions/contract/wire/module.js';
import { worktrees } from '../worktrees/contract/wire/module.js';
import { enforcement } from '../enforcement/contract/wire/module.js';
import { landing } from '../landing/contract/wire/module.js';
import { sandbox } from '../sandbox/contract/wire/module.js';
import { performance } from '../performance/contract/wire/module.js';
import { activity } from '../activity/contract/wire/module.js';
import { remote } from '../remote/contract/wire/module.js';
import { speech } from '../speech/contract/wire/module.js';
import { browser } from '../browser/contract/wire/module.js';
import { threads } from '../threads/contract/wire/module.js';
import { images } from '../images/contract/wire/module.js';
import { navigation } from '../navigation/contract/wire/module.js';
import { nativeHarness } from '../native-harness/contract/wire/module.js';
import { externalHarnesses } from '../external-harnesses/contract/wire/module.js';
import { notify } from '../notify/contract/wire/module.js';
import { push } from '../push/contract/wire/module.js';
import { schedule } from '../schedule/contract/wire/module.js';
import { invocation } from '../invocation/contract/wire/module.js';

export const CORE_CATALOG: readonly [
  typeof settings,
  typeof providers,
  typeof workspace,
  typeof graph,
  typeof installation,
  typeof changeRecord,
  typeof checkoutFiles,
  typeof editors,
  typeof config,
  typeof mcp,
  typeof plugins,
  typeof views,
  typeof secrets,
  typeof artifacts,
  typeof executions,
  typeof worktrees,
  typeof enforcement,
  typeof landing,
  typeof sandbox,
  typeof performance,
  typeof activity,
  typeof remote,
  typeof speech,
  typeof browser,
  typeof threads,
  typeof images,
  typeof navigation,
  typeof nativeHarness,
  typeof externalHarnesses,
  typeof notify,
  typeof push,
  typeof schedule,
  typeof invocation,
] = [
  settings,
  providers,
  workspace,
  graph,
  installation,
  changeRecord,
  checkoutFiles,
  editors,
  config,
  mcp,
  plugins,
  views,
  secrets,
  artifacts,
  executions,
  worktrees,
  enforcement,
  landing,
  sandbox,
  performance,
  activity,
  remote,
  speech,
  browser,
  threads,
  images,
  navigation,
  nativeHarness,
  externalHarnesses,
  notify,
  push,
  schedule,
  invocation,
] as const;
