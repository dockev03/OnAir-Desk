import { Node, mergeAttributes } from '@tiptap/core';
import type { Cue as CueDef } from '@onair-desk/shared';

export interface CueOptions {
  /** Repères de la station (libellé et couleur à jour). */
  cues: () => CueDef[];
}

/**
 * Repère inséré dans le texte ([JINGLE], [PAUSE]…). Nœud atomique : il se sélectionne et
 * s'efface d'un bloc. Le libellé est aussi conservé dans le script, au cas où le repère
 * serait retiré des paramètres.
 */
export const CueNode = Node.create<CueOptions>({
  name: 'cue',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { cues: () => [] };
  },

  addAttributes() {
    return {
      cueId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-cue-id'),
        renderHTML: (attrs) => ({ 'data-cue-id': attrs.cueId }),
      },
      label: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-label') ?? '',
        renderHTML: (attrs) => ({ 'data-label': attrs.label }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-cue-id]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const def = this.options.cues().find((c) => c.id === node.attrs.cueId);
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'cue',
        style: `color: ${def?.color ?? '#B4B2A9'}`,
        contenteditable: 'false',
      }),
      `[${def?.label ?? node.attrs.label}]`,
    ];
  },

  renderText({ node }) {
    return `[${node.attrs.label}]`;
  },
});
