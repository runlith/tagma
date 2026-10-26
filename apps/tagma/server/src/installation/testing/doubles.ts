import { frozenBuildsLayer as frozenBuildsLayerFn } from '../builds/frozen.js';
import { migrationsFolder as migrationsFolderValue } from '../closure/read.js';
import { openVersion as openVersionFn, swapCurrent as swapCurrentFn } from '../closure/versions.js';
import { writeInstallation as writeInstallationFn } from '../closure/write.js';
import { seedDirectory as seedDirectoryFn } from '../paths.js';
import { successionLayer as successionLayerFn } from '../process/succession.js';
import { machineStoreLayer as machineStoreLayerFn } from '../registry/restore.js';
import { registryExportLayer as registryExportLayerValue } from '../registry/export.js';

export const successionLayer = (...input: Parameters<typeof successionLayerFn>) => successionLayerFn(...input);

export const frozenBuildsLayer = (...input: Parameters<typeof frozenBuildsLayerFn>) => frozenBuildsLayerFn(...input);

export const writeInstallation = (...input: Parameters<typeof writeInstallationFn>) => writeInstallationFn(...input);

export const seedDirectory = (...input: Parameters<typeof seedDirectoryFn>) => seedDirectoryFn(...input);

export const openVersion = (...input: Parameters<typeof openVersionFn>) => openVersionFn(...input);

export const swapCurrent = (...input: Parameters<typeof swapCurrentFn>) => swapCurrentFn(...input);

export const machineStoreLayer = (...input: Parameters<typeof machineStoreLayerFn>) => machineStoreLayerFn(...input);

export const registryExportLayer = () => registryExportLayerValue;

export const migrationsFolder = () => migrationsFolderValue;
