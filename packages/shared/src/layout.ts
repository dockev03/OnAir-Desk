import { z } from 'zod';

/**
 * Dispositions toutes prêtes de l'écran studio (voir docs/plan-etape-8.md, décision 13) :
 * figées dans le code, choisies par émission. Pas de réglage bloc par bloc.
 */
export const LAYOUTS = ['solo', 'regie', 'interview'] as const;
export type Layout = (typeof LAYOUTS)[number];
export const layoutSchema = z.enum(LAYOUTS);

/** Ce que chaque disposition change à l'écran. */
export interface LayoutBlocks {
  /** Bandeau réduit : heure, temps restant ; ni titre à venir, ni barre de progression. */
  compactHeader: boolean;
  /** Zone fixe réservée aux messages de la régie, sous le bandeau. */
  regieZone: boolean;
  /** Barre latérale réduite d'office (le bouton « Réduire » reste utilisable). */
  collapseSidebar: boolean;
  /** Bande des cartes de liners en bas de la zone principale. */
  liners: boolean;
}

export const LAYOUT_BLOCKS: Record<Layout, LayoutBlocks> = {
  solo: { compactHeader: false, regieZone: false, collapseSidebar: false, liners: true },
  regie: { compactHeader: false, regieZone: true, collapseSidebar: false, liners: true },
  interview: { compactHeader: true, regieZone: false, collapseSidebar: true, liners: false },
};

/** Disposition d'une émission : la sienne si elle en a une, sinon celle des paramètres. */
export function effectiveLayout(own: Layout | null | undefined, fallback: Layout): Layout {
  return own ?? fallback;
}
