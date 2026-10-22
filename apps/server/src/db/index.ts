import type { Db } from './database.js';
import { AuditRepo } from './audit.js';
import { DeviceRepo } from './devices.js';
import { FolderRepo } from './folders.js';
import { PrompterRepo } from './prompter.js';
import { RundownRepo } from './rundowns.js';
import { ScriptRepo } from './scripts.js';
import { SessionRepo } from './sessions.js';
import { SettingsRepo } from './settings.js';
import { UserRepo } from './users.js';

export interface Repos {
  db: Db;
  users: UserRepo;
  sessions: SessionRepo;
  devices: DeviceRepo;
  settings: SettingsRepo;
  audit: AuditRepo;
  folders: FolderRepo;
  scripts: ScriptRepo;
  prompter: PrompterRepo;
  rundowns: RundownRepo;
}

export function createRepos(db: Db): Repos {
  return {
    db,
    users: new UserRepo(db),
    sessions: new SessionRepo(db),
    devices: new DeviceRepo(db),
    settings: new SettingsRepo(db),
    audit: new AuditRepo(db),
    folders: new FolderRepo(db),
    scripts: new ScriptRepo(db),
    prompter: new PrompterRepo(db),
    rundowns: new RundownRepo(db),
  };
}

export { openDatabase, openMemoryDatabase, type Db } from './database.js';
export { toPublicUser, type User } from './users.js';
export type { ScriptRecord } from './scripts.js';
export type { RundownRecord } from './rundowns.js';
