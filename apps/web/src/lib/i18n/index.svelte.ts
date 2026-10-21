import type { Locale } from '@onair-desk/shared';
import { en } from './en.js';
import { fr, type MessageKey } from './fr.js';

const dictionaries: Record<Locale, Record<MessageKey, string>> = { fr, en };

function browserLocale(): Locale {
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('fr')
    ? 'fr'
    : 'en';
}

let current = $state<Locale>(browserLocale());

export const i18n = {
  get locale(): Locale {
    return current;
  },
  set(locale: Locale) {
    current = locale;
    if (typeof document !== 'undefined') document.documentElement.lang = locale;
  },
};

/** Texte traduit ; les {paramètres} sont remplacés. Réactif : relu quand la langue change. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  let s = dictionaries[current][key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Message d'erreur affichable à partir d'un code renvoyé par l'API. */
export function errorMessage(code: string): string {
  const key = `error.${code}` as MessageKey;
  return key in fr ? t(key) : t('error.generic');
}

export type { MessageKey };
