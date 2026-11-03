import { AUDIT_ACTIONS, type AuditAction, type AuditEntry } from '@onair-desk/shared';
import { t, type MessageKey } from './i18n/index.svelte.js';

/** Libellé lisible d'une action du journal (le code technique si elle est inconnue). */
export function actionLabel(action: string): string {
  return action in AUDIT_ACTIONS
    ? t(`audit.action.${action as AuditAction}` as MessageKey)
    : action;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * Résumé lisible d'une entrée de la main courante : texte du message ou de la note, ligne de
 * duplex et son état, éléments modifiés… Les autres détails restent bruts.
 */
export function entrySummary(e: AuditEntry): string {
  const d = e.details ?? {};
  switch (e.action) {
    case 'regie.message_sent':
    case 'regie.order_sent':
    case 'regie.message_cleared':
    case 'regie.message_seen':
    case 'logbook.note':
      return `${d.urgent ? `${t('regie.urgent')} · ` : ''}${str(d.text)}`;
    case 'duplex.changed': {
      const state = str(d.state);
      return [str(d.name), state ? t(`regie.duplexState.${state}` as MessageKey) : '']
        .filter(Boolean)
        .join(' · ');
    }
    case 'rundown.live_edited': {
      const list = (k: string) => (Array.isArray(d[k]) ? (d[k] as string[]) : []);
      return [
        ...list('added').map((x) => `+ ${x}`),
        ...list('changed').map((x) => `~ ${x}`),
        ...list('moved').map((x) => `↕ ${x}`),
        ...(typeof d.removed === 'number' && d.removed > 0
          ? [t('studio.removedCount', { n: d.removed })]
          : []),
      ].join(' · ');
    }
    case 'run.started':
    case 'run.closed':
    case 'rehearsal.started':
    case 'rehearsal.stopped':
      return str(d.title);
    case 'onair.changed':
      return d.state === 'on' ? t('onair.stateOn') : t('onair.stateOff');
    default:
      return Object.entries(d)
        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
        .join(' · ');
  }
}

/** Heure d'une entrée : celle de la note corrigée, sinon celle de l'enregistrement. */
export const entryTime = (e: AuditEntry): number =>
  typeof e.details?.noteAt === 'number' ? e.details.noteAt : Date.parse(e.at);
