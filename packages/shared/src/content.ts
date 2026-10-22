import { z } from 'zod';

/**
 * Contenu d'un script : document TipTap (JSON), limité à une liste blanche stricte de
 * blocs, de marques et d'attributs. Jamais de HTML : l'écran studio construit l'affichage
 * élément par élément.
 */

/** Couleurs de texte autorisées (lisibles sur fond sombre). */
export const TEXT_COLORS = [
  '#FAC775',
  '#F09595',
  '#85B7EB',
  '#5DCAA5',
  '#C9A8F5',
  '#B4B2A9',
] as const;
/** Couleurs de surlignage autorisées (texte clair par-dessus). */
export const HIGHLIGHT_COLORS = ['#3C3489', '#085041', '#633806', '#712B13', '#0C447C'] as const;

export const MAX_CONTENT_BYTES = 200_000;
export const MAX_CONTENT_DEPTH = 8;
export const MAX_CUES = 20;
/** Durée maximale d'un élément attaché à un repère (jingle, son…), en secondes. */
export const MAX_CUE_SECONDS = 3600;

export type TextColor = (typeof TEXT_COLORS)[number];
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export const markSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bold') }).strict(),
  z.object({ type: z.literal('italic') }).strict(),
  z.object({ type: z.literal('underline') }).strict(),
  z
    .object({
      type: z.literal('textStyle'),
      attrs: z.object({ color: z.enum(TEXT_COLORS) }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal('highlight'),
      attrs: z.object({ color: z.enum(HIGHLIGHT_COLORS) }).strict(),
    })
    .strict(),
]);
export type Mark = z.infer<typeof markSchema>;

const cueIdSchema = z.string().regex(/^[a-z0-9-]{1,32}$/);

export const inlineSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('text'),
      text: z.string().min(1).max(20_000),
      marks: z.array(markSchema).max(5).optional(),
    })
    .strict(),
  z.object({ type: z.literal('hardBreak') }).strict(),
  z
    .object({
      type: z.literal('cue'),
      attrs: z
        .object({
          cueId: cueIdSchema,
          label: z.string().max(40),
          /** Durée de l'élément : le défilement automatique s'arrête pendant ce temps. */
          seconds: z.number().int().min(1).max(MAX_CUE_SECONDS).optional(),
        })
        .strict(),
    })
    .strict(),
]);
export type Inline = z.infer<typeof inlineSchema>;

export interface Paragraph {
  type: 'paragraph';
  content?: Inline[];
}
export interface Heading {
  type: 'heading';
  attrs: { level: 2 | 3 };
  content?: Inline[];
}
export interface ListItem {
  type: 'listItem';
  content: (Paragraph | BulletList | OrderedList)[];
}
export interface BulletList {
  type: 'bulletList';
  content: ListItem[];
}
export interface OrderedList {
  type: 'orderedList';
  attrs?: { start: number };
  content: ListItem[];
}
export type Block = Paragraph | Heading | BulletList | OrderedList;
export interface ScriptDoc {
  type: 'doc';
  content: Block[];
}

const paragraphSchema: z.ZodType<Paragraph> = z
  .object({ type: z.literal('paragraph'), content: z.array(inlineSchema).max(5000).optional() })
  .strict();
const headingSchema: z.ZodType<Heading> = z
  .object({
    type: z.literal('heading'),
    attrs: z.object({ level: z.union([z.literal(2), z.literal(3)]) }).strict(),
    content: z.array(inlineSchema).max(5000).optional(),
  })
  .strict();
const listItemSchema: z.ZodType<ListItem> = z.lazy(() =>
  z
    .object({
      type: z.literal('listItem'),
      content: z
        .array(z.union([paragraphSchema, bulletListSchema, orderedListSchema]))
        .min(1)
        .max(100),
    })
    .strict(),
);
const bulletListSchema: z.ZodType<BulletList> = z.lazy(() =>
  z
    .object({ type: z.literal('bulletList'), content: z.array(listItemSchema).min(1).max(500) })
    .strict(),
);
const orderedListSchema: z.ZodType<OrderedList> = z.lazy(() =>
  z
    .object({
      type: z.literal('orderedList'),
      attrs: z
        .object({ start: z.number().int().min(0).max(9999) })
        .strict()
        .optional(),
      content: z.array(listItemSchema).min(1).max(500),
    })
    .strict(),
);
const blockSchema: z.ZodType<Block> = z.union([
  paragraphSchema,
  headingSchema,
  bulletListSchema,
  orderedListSchema,
]);

const docShape = z
  .object({ type: z.literal('doc'), content: z.array(blockSchema).max(5000) })
  .strict();

function depth(node: unknown, d = 0): number {
  if (d > MAX_CONTENT_DEPTH) return d;
  const content = (node as { content?: unknown })?.content;
  if (!Array.isArray(content)) return d;
  return Math.max(d, ...content.map((c) => depth(c, d + 1)));
}

/** Schéma complet : taille, profondeur, puis liste blanche. */
export const scriptDocSchema: z.ZodType<ScriptDoc> = z
  .unknown()
  .superRefine((v, ctx) => {
    let size: number;
    try {
      size = new TextEncoder().encode(JSON.stringify(v)).length;
    } catch {
      size = Infinity;
    }
    if (size > MAX_CONTENT_BYTES) ctx.addIssue({ code: 'custom', message: 'content_too_large' });
    else if (depth(v) > MAX_CONTENT_DEPTH) {
      ctx.addIssue({ code: 'custom', message: 'content_too_deep' });
    }
  })
  .pipe(docShape) as unknown as z.ZodType<ScriptDoc>;

export const emptyDoc = (): ScriptDoc => ({ type: 'doc', content: [{ type: 'paragraph' }] });

// ---------------------------------------------------------------------------
// Nettoyage côté éditeur : ramène un document TipTap quelconque (collage depuis Word,
// attributs par défaut ajoutés par l'éditeur…) dans la liste blanche avant envoi.

type Loose = {
  type?: unknown;
  text?: unknown;
  attrs?: Record<string, unknown>;
  marks?: unknown[];
  content?: unknown[];
};

const isCueSeconds = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_CUE_SECONDS;

function sanitizeMarks(marks: unknown[] | undefined): Mark[] | undefined {
  if (!marks) return undefined;
  const out: Mark[] = [];
  for (const raw of marks as Loose[]) {
    const color = raw.attrs?.color;
    switch (raw.type) {
      case 'bold':
      case 'italic':
      case 'underline':
        out.push({ type: raw.type });
        break;
      case 'textStyle':
        if (
          typeof color === 'string' &&
          (TEXT_COLORS as readonly string[]).includes(color.toUpperCase())
        ) {
          out.push({ type: 'textStyle', attrs: { color: color.toUpperCase() as TextColor } });
        }
        break;
      case 'highlight':
        if (
          typeof color === 'string' &&
          (HIGHLIGHT_COLORS as readonly string[]).includes(color.toUpperCase())
        ) {
          out.push({ type: 'highlight', attrs: { color: color.toUpperCase() as HighlightColor } });
        }
        break;
    }
  }
  return out.length > 0 ? out : undefined;
}

function sanitizeInline(nodes: unknown[] | undefined): Inline[] | undefined {
  if (!nodes) return undefined;
  const out: Inline[] = [];
  for (const n of nodes as Loose[]) {
    if (n.type === 'text' && typeof n.text === 'string' && n.text.length > 0) {
      const marks = sanitizeMarks(n.marks);
      out.push(marks ? { type: 'text', text: n.text, marks } : { type: 'text', text: n.text });
    } else if (n.type === 'hardBreak') {
      out.push({ type: 'hardBreak' });
    } else if (n.type === 'cue' && typeof n.attrs?.cueId === 'string') {
      const seconds = n.attrs.seconds;
      const label = String(n.attrs.label ?? '').slice(0, 40);
      out.push({
        type: 'cue',
        attrs: isCueSeconds(seconds)
          ? { cueId: n.attrs.cueId, label, seconds }
          : { cueId: n.attrs.cueId, label },
      });
    }
  }
  return out.length > 0 ? out : undefined;
}

function sanitizeListItems(nodes: unknown[] | undefined): ListItem[] {
  const items: ListItem[] = [];
  for (const n of (nodes ?? []) as Loose[]) {
    if (n.type !== 'listItem') continue;
    const content = sanitizeBlocks(n.content).flatMap((b): ListItem['content'] =>
      b.type === 'heading'
        ? [{ type: 'paragraph', ...(b.content ? { content: b.content } : {}) }]
        : [b],
    );
    items.push({
      type: 'listItem',
      content: content.length > 0 ? content : [{ type: 'paragraph' }],
    });
  }
  return items;
}

function sanitizeBlocks(nodes: unknown[] | undefined): Block[] {
  const out: Block[] = [];
  for (const n of (nodes ?? []) as Loose[]) {
    const inline = sanitizeInline(n.content);
    switch (n.type) {
      case 'paragraph':
        out.push(inline ? { type: 'paragraph', content: inline } : { type: 'paragraph' });
        break;
      case 'heading': {
        const level = n.attrs?.level === 3 ? 3 : 2;
        out.push(
          inline
            ? { type: 'heading', attrs: { level }, content: inline }
            : { type: 'heading', attrs: { level } },
        );
        break;
      }
      case 'bulletList':
      case 'orderedList': {
        const items = sanitizeListItems(n.content);
        if (items.length === 0) break;
        if (n.type === 'bulletList') out.push({ type: 'bulletList', content: items });
        else {
          const start = Number(n.attrs?.start ?? 1);
          out.push({
            type: 'orderedList',
            attrs: { start: Number.isInteger(start) && start >= 0 && start <= 9999 ? start : 1 },
            content: items,
          });
        }
        break;
      }
      default:
        // Bloc non pris en charge (citation, code…) : on garde son texte dans un paragraphe.
        if (Array.isArray(n.content)) out.push(...sanitizeBlocks(n.content));
    }
  }
  return out;
}

/** Document nettoyé, conforme au schéma (hors limites de taille). */
export function sanitizeDoc(doc: unknown): ScriptDoc {
  const blocks = sanitizeBlocks((doc as Loose)?.content);
  return { type: 'doc', content: blocks.length > 0 ? blocks : [{ type: 'paragraph' }] };
}

// ---------------------------------------------------------------------------
// Texte brut, mots et durée de lecture.

function collectText(nodes: unknown[] | undefined, parts: string[]): void {
  for (const n of (nodes ?? []) as Loose[]) {
    if (n.type === 'text' && typeof n.text === 'string') parts.push(n.text);
    else if (n.type === 'hardBreak') parts.push('\n');
    else if (Array.isArray(n.content)) {
      collectText(n.content, parts);
      parts.push('\n');
    }
  }
}

/** Texte à lire (sans les repères), pour la recherche et le comptage des mots. */
export function docToText(doc: ScriptDoc): string {
  const parts: string[] = [];
  collectText(doc.content, parts);
  return parts
    .join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Durée cumulée des éléments attachés aux repères (jingles, sons…), en secondes. */
export function cueSeconds(doc: ScriptDoc): number {
  let total = 0;
  const walk = (nodes: unknown[] | undefined) => {
    for (const n of (nodes ?? []) as Loose[]) {
      const seconds = n.attrs?.seconds;
      if (n.type === 'cue' && isCueSeconds(seconds)) total += seconds;
      else if (Array.isArray(n.content)) walk(n.content);
    }
  };
  walk(doc.content);
  return total;
}

/**
 * Lecture d'une durée saisie : « 12 » (secondes) ou « 1:30 » (minutes:secondes).
 * Vide → null (pas de durée) ; invalide ou hors limites → undefined.
 */
export function parseCueSeconds(input: string): number | null | undefined {
  const v = input.trim();
  if (v === '') return null;
  const m = /^(?:(\d{1,2}):)?(\d{1,4})$/.exec(v);
  if (!m) return undefined;
  // Après « : », toujours deux chiffres (« 1:5 » est ambigu).
  if (m[1] !== undefined && (m[2]!.length !== 2 || Number(m[2]) > 59)) return undefined;
  const total = Number(m[1] ?? 0) * 60 + Number(m[2]);
  return isCueSeconds(total) ? total : undefined;
}

/** Durée de lecture estimée, en secondes. */
export const readingSeconds = (words: number, wpm: number): number =>
  wpm > 0 ? Math.round((words / wpm) * 60) : 0;

/** Durée au format m:ss (ou h:mm:ss au-delà d'une heure). */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

// ---------------------------------------------------------------------------
// Repères (paramétrables par l'admin).

export const cueSchema = z
  .object({
    id: cueIdSchema,
    label: z.string().trim().min(1).max(40),
    color: z.enum(TEXT_COLORS),
  })
  .strict();
export type Cue = z.infer<typeof cueSchema>;

export const cuesSchema = z
  .array(cueSchema)
  .max(MAX_CUES)
  .refine((cues) => new Set(cues.map((c) => c.id)).size === cues.length, 'duplicate_cue');

export const DEFAULT_CUES: Cue[] = [
  { id: 'jingle', label: 'JINGLE', color: '#B4B2A9' },
  { id: 'pause', label: 'PAUSE', color: '#F09595' },
  { id: 'lancer-titre', label: 'LANCER TITRE', color: '#5DCAA5' },
  { id: 'pub', label: 'PUB', color: '#FAC775' },
  { id: 'son', label: 'SON', color: '#85B7EB' },
  { id: 'meteo', label: 'MÉTÉO', color: '#C9A8F5' },
];
