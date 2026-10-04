// File-system locations for app resources and user data.

import { app } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Root of the application code (the repository, or app.asar when packaged). */
export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Portable mode keeps settings next to the executable instead of in AppData.
 * It is on for the portable .exe build, or whenever a folder named
 * "YALTI Prompter Data" exists next to YALTI Prompter.exe.
 */
export function configurePortableMode() {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
    || (app.isPackaged && existsSync(join(dirname(process.execPath), 'YALTI Prompter Data')) ? dirname(process.execPath) : null);
  if (!portableDir) return false;
  const dataDir = join(portableDir, 'YALTI Prompter Data');
  mkdirSync(dataDir, { recursive: true });
  app.setPath('userData', dataDir);
  return true;
}

export function resourcesDir() {
  return app.isPackaged ? process.resourcesPath : join(APP_ROOT, 'resources');
}

export const paths = {
  bundledModels: () => join(resourcesDir(), 'models'),
  userModels: () => join(app.getPath('userData'), 'models'),
  licenses: () => (app.isPackaged ? join(process.resourcesPath, 'licenses') : join(APP_ROOT, 'licenses')),
  samples: () => join(APP_ROOT, 'assets', 'samples'),
  icon: (name) => join(APP_ROOT, 'assets', 'icons', name),
  preload: (name) => join(APP_ROOT, 'src', 'preload', name),
  speechWorker: () => join(APP_ROOT, 'src', 'speech', 'worker.cjs'),
  settingsFile: () => join(app.getPath('userData'), 'settings.json'),
  stateFile: () => join(app.getPath('userData'), 'state.json'),
  scratchFile: () => join(app.getPath('userData'), 'scratch-script.md'),
};
