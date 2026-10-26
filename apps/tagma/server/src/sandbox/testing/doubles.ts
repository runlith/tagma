import { makeDockerGuests } from '../engine/docker/backend.js';
import { installationMark as installationMarkFn } from '../engine/docker/backend.js';
import {
  guestRunCommand as guestRunCommandFn,
  INSTALLATION_LABEL as installationLabelValue,
  KIND_LABEL as kindLabelValue,
  SUBJECT_LABEL as subjectLabelValue,
} from '../engine/docker/container.js';
import { buildGuestImage as buildGuestImageFn, dockerSaid as dockerSaidFn } from '../engine/docker/image.js';
import { GUEST_TREE as guestTreeValue } from '../engine/docker/layout.js';
import { makeDockerPreparation } from '../engine/docker/preparation.js';
import {
  afterAll as suiteAfterAll,
  beforeAll as suiteBeforeAll,
  test as suiteTest,
  dockerAnswers as suiteDockerAnswers,
  describe as suiteDescribe,
} from '../engine/docker/suite.js';
import { dockerGuestWorld as dockerGuestWorldFn } from '../engine/docker/world.js';
import { guestImports as guestImportsFn } from '../guests/imports.js';
import { liveGuests as liveGuestsFn } from '../guests/live.js';
import { makeSandboxes } from '../guests/lease.js';
import { makeSandboxStore } from '../store/sandboxes.js';
import { sandbox as sandboxTable } from '../store/tables.js';
import { makePreparedTreeStore } from '../store/preparedTrees.js';
import { archiveBytes as archiveBytesFn, unpackArchive as unpackArchiveFn } from '../trees/archive.js';
import { makePreparedTrees } from '../trees/preparedTrees.js';

export const preparedTreeStore = () => makePreparedTreeStore;

export const sandboxStore = () => makeSandboxStore;

export const dockerGuests = (...input: Parameters<typeof makeDockerGuests>) => makeDockerGuests(...input);

export const dockerPreparation = (...input: Parameters<typeof makeDockerPreparation>) => makeDockerPreparation(...input);

export const preparedTreesService = (...input: Parameters<typeof makePreparedTrees>) => makePreparedTrees(...input);

export const sandboxServices = (...input: Parameters<typeof makeSandboxes>) => makeSandboxes(...input);

export const installationMark = (...input: Parameters<typeof installationMarkFn>) => installationMarkFn(...input);

export const dockerGuestWorld = (...input: Parameters<typeof dockerGuestWorldFn>) => dockerGuestWorldFn(...input);

export const guestRunCommand = (...input: Parameters<typeof guestRunCommandFn>) => guestRunCommandFn(...input);

export const dockerSaid = (...input: Parameters<typeof dockerSaidFn>) => dockerSaidFn(...input);

export const buildGuestImage = (...input: Parameters<typeof buildGuestImageFn>) => buildGuestImageFn(...input);

export const guestImports = (...input: Parameters<typeof guestImportsFn>) => guestImportsFn(...input);

export const liveGuests = (...input: Parameters<typeof liveGuestsFn>) => liveGuestsFn(...input);

export const archiveBytes = (...input: Parameters<typeof archiveBytesFn>) => archiveBytesFn(...input);

export const unpackArchive = (...input: Parameters<typeof unpackArchiveFn>) => unpackArchiveFn(...input);

export const dockerAnswers = () => suiteDockerAnswers;

export const dockerSuite = (...input: Parameters<typeof suiteDescribe>) => suiteDescribe(...input);

export const test = (...input: Parameters<typeof suiteTest>) => suiteTest(...input);

export const beforeAll = (...input: Parameters<typeof suiteBeforeAll>) => suiteBeforeAll(...input);

export const afterAll = (...input: Parameters<typeof suiteAfterAll>) => suiteAfterAll(...input);

export const GUEST_TREE = () => guestTreeValue;

export const KIND_LABEL = () => kindLabelValue;

export const INSTALLATION_LABEL = () => installationLabelValue;

export const SUBJECT_LABEL = () => subjectLabelValue;

export const sandbox = () => sandboxTable;
