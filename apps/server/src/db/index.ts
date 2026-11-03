import type { Db } from './database.js';
import { AuditRepo } from './audit.js';
import { ConnectorTokenRepo } from './connector-tokens.js';
import { DeviceRepo } from './devices.js';
import { FolderRepo } from './folders.js';
import { LogoRepo } from './logo.js';
import { OnAirRepo } from './onair.js';
import { PrompterRepo } from './prompter.js';
import { RegieRepo } from './regie.js';
import { RundownRepo } from './rundowns.js';
import { ScriptRepo } from './scripts.js';
import { SessionRepo } from './sessions.js';
import { SettingsRepo } from './settings.js';
import { StudioRepo } from './studios.js';
import { TemplateRepo } from './templates.js';
import { UserRepo } from './users.js';
import { WeatherCacheRepo } from './weather-cache.js';

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
  templates: TemplateRepo;
  logo: LogoRepo;
  studios: StudioRepo;
  connectorTokens: ConnectorTokenRepo;
  onAir: OnAirRepo;
  weatherCache: WeatherCacheRepo;
  regie: RegieRepo;
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
    templates: new TemplateRepo(db),
    logo: new LogoRepo(db),
    studios: new StudioRepo(db),
    connectorTokens: new ConnectorTokenRepo(db),
    onAir: new OnAirRepo(db),
    weatherCache: new WeatherCacheRepo(db),
    regie: new RegieRepo(db),
  };
}

export { openDatabase, openMemoryDatabase, type Db } from './database.js';
export { toPublicUser, type User } from './users.js';
export type { ScriptRecord } from './scripts.js';
export type { RundownRecord } from './rundowns.js';
export type { TemplateRecord } from './templates.js';
export { DEFAULT_STUDIO_ID } from './studios.js';
