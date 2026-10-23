import { formatDuration, type RundownItem, type RundownItemInput } from '@onair-desk/shared';
import { t } from '../i18n/index.svelte.js';

/** Élément en cours d'édition : la durée est saisie en texte (m:ss). */
export type EditItem = RundownItem & { durationText: string; durationInvalid: boolean };

export const toEdit = (i: RundownItem): EditItem => ({
  ...i,
  durationText: i.durationSeconds === null ? '' : formatDuration(i.durationSeconds),
  durationInvalid: false,
});

export const toInput = (i: EditItem): RundownItemInput => ({
  uid: i.uid,
  typeId: i.typeId,
  title: i.title.trim() || t('rundowns.newItemTitle'),
  durationSeconds: i.durationSeconds,
  notes: i.notes,
  scriptId: i.scriptId,
});
