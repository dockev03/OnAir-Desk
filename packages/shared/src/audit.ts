import { z } from 'zod';
import { airDateSchema } from './rundown.js';

/**
 * Journal d'audit commun : chaque action a une catégorie fixe, qui sert aux filtres et à la
 * main courante de l'émission (catégories « régie » et « antenne »).
 */
export const AUDIT_CATEGORIES = ['securite', 'contenu', 'antenne', 'regie', 'systeme'] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

/** Toutes les actions journalisées et leur catégorie. Une action absente ne compile pas. */
export const AUDIT_ACTIONS = {
  'auth.login': 'securite',
  'auth.login_failed': 'securite',
  'auth.password_changed': 'securite',
  'setup.completed': 'securite',
  'setup.bad_code': 'securite',
  'user.created': 'securite',
  'user.updated': 'securite',
  'user.deleted': 'securite',
  'device.created': 'securite',
  'device.paired': 'securite',
  'device.pair_failed': 'securite',
  'device.regenerated': 'securite',
  'device.revoked': 'securite',
  'device.deleted': 'securite',
  'settings.updated': 'systeme',
  'logo.updated': 'systeme',
  'logo.removed': 'systeme',
  'script.duplicated': 'contenu',
  'script.trashed': 'contenu',
  'script.restored': 'contenu',
  'script.deleted': 'contenu',
  'script.revision_restored': 'contenu',
  'rundown.duplicated': 'contenu',
  'rundown.trashed': 'contenu',
  'rundown.restored': 'contenu',
  'rundown.deleted': 'contenu',
  'rundown.created_from_template': 'contenu',
  'rundown.template_reapplied': 'contenu',
  'template.created_from_rundown': 'contenu',
  'template.duplicated': 'contenu',
  'template.trashed': 'contenu',
  'template.restored': 'contenu',
  'template.deleted': 'contenu',
  'prompter.sent': 'antenne',
  'automation.source_changed': 'antenne',
  'automation.error': 'antenne',
  'automation.recovered': 'antenne',
  'automation.switched': 'antenne',
  'onair.changed': 'antenne',
  'weather.error': 'systeme',
  'weather.recovered': 'systeme',
  'connector.token_generated': 'securite',
  'regie.message_sent': 'regie',
  'regie.message_cleared': 'regie',
  'regie.order_sent': 'regie',
  'regie.message_seen': 'regie',
  'duplex.changed': 'regie',
  'rundown.live_edited': 'regie',
  'logbook.note': 'regie',
} as const satisfies Record<string, AuditCategory>;
export type AuditAction = keyof typeof AUDIT_ACTIONS;

/** Durée de conservation du journal. */
export const AUDIT_RETENTION_DAYS = 365;
export const AUDIT_PAGE_SIZE = 50;

export interface AuditEntry {
  id: number;
  at: string;
  category: AuditCategory;
  action: string;
  actorType: 'user' | 'device' | 'system' | 'anonymous';
  actorId: number | null;
  /** Nom au moment de l'action (lisible même si le compte a été supprimé depuis). */
  actorName: string | null;
  studioId: number | null;
  details: Record<string, unknown> | null;
}

export interface AuditPage {
  entries: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export const auditQuerySchema = z
  .object({
    category: z.enum(AUDIT_CATEGORIES).optional(),
    actorId: z.coerce.number().int().positive().optional(),
    /** Période, dates incluses (AAAA-MM-JJ, en UTC). */
    from: airDateSchema.optional(),
    to: airDateSchema.optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
  })
  .strict();
export type AuditQuery = z.output<typeof auditQuerySchema>;
