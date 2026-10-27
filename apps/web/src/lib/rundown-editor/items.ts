import { formatDuration, type RundownItem, type RundownItemInput } from '@onair-desk/shared';
import { t } from '../i18n/index.svelte.js';

/** Élément en cours d'édition : durée, intro et année sont saisies en texte. */
export type EditItem = RundownItem & {
  durationText: string;
  durationInvalid: boolean;
  introText: string;
  introInvalid: boolean;
  yearText: string;
  yearInvalid: boolean;
};

export const toEdit = (i: RundownItem): EditItem => ({
  ...i,
  durationText: i.durationSeconds === null ? '' : formatDuration(i.durationSeconds),
  durationInvalid: false,
  introText: i.introSeconds === null ? '' : formatDuration(i.introSeconds),
  introInvalid: false,
  yearText: i.year === null ? '' : String(i.year),
  yearInvalid: false,
});

export const toInput = (i: EditItem): RundownItemInput => ({
  uid: i.uid,
  typeId: i.typeId,
  title: i.title.trim() || t('rundowns.newItemTitle'),
  durationSeconds: i.durationSeconds,
  notes: i.notes,
  scriptId: i.scriptId,
  artist: i.artist.trim(),
  year: i.year,
  introSeconds: i.introSeconds,
  tags: i.tags,
  cuttable: i.cuttable,
});

/** Année saisie : vide → null ; AAAA plausible → nombre ; sinon undefined (invalide). */
export function parseYear(input: string): number | null | undefined {
  const v = input.trim();
  if (v === '') return null;
  if (!/^\d{4}$/.test(v)) return undefined;
  const year = Number(v);
  return year >= 1000 && year <= 2999 ? year : undefined;
}

/** L'élément a des informations de détail (la ligne « Détails » s'ouvre d'office). */
export const hasDetails = (i: RundownItem): boolean =>
  i.artist.trim() !== '' ||
  i.year !== null ||
  i.introSeconds !== null ||
  i.tags.length > 0 ||
  i.cuttable;
