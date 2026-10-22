import { describe, expect, it } from 'vitest';
import {
  MAX_CONTENT_BYTES,
  countWords,
  cueSeconds,
  cuesSchema,
  docToText,
  formatDuration,
  parseCueSeconds,
  readingSeconds,
  sanitizeDoc,
  scriptDocSchema,
  type ScriptDoc,
} from './content.js';

const doc: ScriptDoc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'La matinale' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'cue', attrs: { cueId: 'jingle', label: 'JINGLE' } },
        { type: 'text', text: 'Bonjour à toutes et à tous, il est ' },
        {
          type: 'text',
          text: '7 heures',
          marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#FAC775' } }],
        },
        { type: 'hardBreak' },
        {
          type: 'text',
          text: "l'invité",
          marks: [{ type: 'highlight', attrs: { color: '#3C3489' } }],
        },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Météo' }] }],
        },
      ],
    },
  ],
};

describe('scriptDocSchema', () => {
  it('accepte un document conforme', () => {
    expect(scriptDocSchema.safeParse(doc).success).toBe(true);
  });

  it('refuse un bloc inconnu, un lien ou une image', () => {
    for (const bad of [
      { type: 'doc', content: [{ type: 'codeBlock', content: [] }] },
      { type: 'doc', content: [{ type: 'image', attrs: { src: 'x' } }] },
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'x',
                marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
              },
            ],
          },
        ],
      },
    ]) {
      expect(scriptDocSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('refuse un attribut non prévu et une couleur hors palette', () => {
    const extra = { type: 'doc', content: [{ type: 'paragraph', attrs: { style: 'x' } }] };
    const color = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'x', marks: [{ type: 'textStyle', attrs: { color: 'red' } }] },
          ],
        },
      ],
    };
    expect(scriptDocSchema.safeParse(extra).success).toBe(false);
    expect(scriptDocSchema.safeParse(color).success).toBe(false);
  });

  it('refuse un contenu trop gros ou trop profond', () => {
    const big = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: Array.from({ length: 20 }, () => ({
            type: 'text',
            text: 'x'.repeat(MAX_CONTENT_BYTES / 15),
          })),
        },
      ],
    };
    let deep: unknown = { type: 'paragraph' };
    for (let i = 0; i < 10; i++)
      deep = { type: 'bulletList', content: [{ type: 'listItem', content: [deep] }] };
    expect(scriptDocSchema.safeParse(big).success).toBe(false);
    expect(scriptDocSchema.safeParse({ type: 'doc', content: [deep] }).success).toBe(false);
  });
});

describe('sanitizeDoc', () => {
  it('ramène un collage quelconque dans la liste blanche', () => {
    const pasted = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: 'left' },
          content: [
            {
              type: 'text',
              text: 'rouge',
              marks: [{ type: 'textStyle', attrs: { color: 'rgb(255,0,0)', fontFamily: 'Arial' } }],
            },
            {
              type: 'text',
              text: 'jaune',
              marks: [
                { type: 'textStyle', attrs: { color: '#fac775' } },
                { type: 'link', attrs: { href: 'x' } },
              ],
            },
          ],
        },
        {
          type: 'blockquote',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'cité' }] }],
        },
        { type: 'image', attrs: { src: 'x' } },
        {
          type: 'orderedList',
          attrs: { start: 1, type: null },
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'a' }] },
              ],
            },
          ],
        },
      ],
    };
    const clean = sanitizeDoc(pasted);
    expect(scriptDocSchema.safeParse(clean).success).toBe(true);
    expect(clean.content[0]).toEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'rouge' },
        {
          type: 'text',
          text: 'jaune',
          marks: [{ type: 'textStyle', attrs: { color: '#FAC775' } }],
        },
      ],
    });
    expect(docToText(clean)).toContain('cité');
  });

  it("produit toujours un document valide, même à partir de n'importe quoi", () => {
    for (const junk of [null, 42, 'texte', {}, { content: 'x' }]) {
      expect(scriptDocSchema.safeParse(sanitizeDoc(junk)).success).toBe(true);
    }
  });
});

describe('texte et durée', () => {
  it('extrait le texte sans les repères et compte les mots', () => {
    const text = docToText(doc);
    expect(text).not.toContain('JINGLE');
    expect(text).toContain('Bonjour à toutes');
    expect(countWords(text)).toBe(14);
  });

  it('ignore la ponctuation isolée', () => {
    expect(countWords('Bonjour — à tous !')).toBe(3);
  });

  it('calcule la durée de lecture', () => {
    expect(readingSeconds(150, 150)).toBe(60);
    expect(formatDuration(86)).toBe('1:26');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
});

describe('cuesSchema', () => {
  it('refuse deux repères de même identifiant', () => {
    const c = { id: 'a', label: 'A', color: '#FAC775' };
    expect(cuesSchema.safeParse([c, c]).success).toBe(false);
  });
});

describe('durée des repères', () => {
  const withCues = (attrs: unknown[]): unknown => ({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: attrs.map((a) => ({ type: 'cue', attrs: a })),
      },
    ],
  });

  it('accepte une durée entière, refuse le reste', () => {
    const ok = withCues([{ cueId: 'jingle', label: 'JINGLE', seconds: 12 }]);
    expect(scriptDocSchema.safeParse(ok).success).toBe(true);
    for (const seconds of [0, -1, 1.5, 3601, '12', null]) {
      const bad = withCues([{ cueId: 'jingle', label: 'JINGLE', seconds }]);
      expect(scriptDocSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('le nettoyage garde une durée valide et retire une durée invalide', () => {
    const out = sanitizeDoc(
      withCues([
        { cueId: 'jingle', label: 'JINGLE', seconds: 12 },
        { cueId: 'son', label: 'SON', seconds: null },
        { cueId: 'pause', label: 'PAUSE', seconds: 99999 },
      ]),
    );
    expect(scriptDocSchema.safeParse(out).success).toBe(true);
    const cues = out.content[0]!.type === 'paragraph' ? out.content[0]!.content : [];
    expect(cues?.map((c) => (c.type === 'cue' ? c.attrs.seconds : 'x'))).toEqual([
      12,
      undefined,
      undefined,
    ]);
  });

  it('additionne les durées, y compris dans les listes', () => {
    const d = sanitizeDoc({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'cue', attrs: { cueId: 'a', label: 'A', seconds: 12 } }],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'cue', attrs: { cueId: 'b', label: 'B', seconds: 30 } }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(cueSeconds(d)).toBe(42);
    expect(cueSeconds(doc)).toBe(0);
  });

  it('lit une durée saisie en secondes ou en minutes:secondes', () => {
    expect(parseCueSeconds('')).toBeNull();
    expect(parseCueSeconds(' 12 ')).toBe(12);
    expect(parseCueSeconds('1:30')).toBe(90);
    expect(parseCueSeconds('0:05')).toBe(5);
    expect(parseCueSeconds('3600')).toBe(3600);
    for (const bad of ['0', '3601', '1:75', '1:5', '1:5:0', 'abc', '-3', '1.5', '61:00']) {
      expect(parseCueSeconds(bad)).toBeUndefined();
    }
  });
});
