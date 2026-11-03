import { describe, expect, it } from 'vitest';
import {
  LIVE_CHANGE_HIGHLIGHT_MS,
  LOGBOOK_AFTER_MS,
  LOGBOOK_BEFORE_MS,
  URGENT_EXPAND_MS,
  activeMessage,
  diffRundownItems,
  duplexUpdateSchema,
  liveChangeActive,
  logbookNoteSchema,
  logbookWindow,
  regieMessageSchema,
  regieSettingsSchema,
  regieZoneVisible,
  urgentExpanded,
  type RegieMessage,
  type RegieState,
} from './regie.js';
import { canDirect } from './api.js';
import { createUserSchema, updateUserSchema } from './schemas.js';

const item = (uid: string, extra: Partial<{ title: string; durationSeconds: number }> = {}) => ({
  uid,
  typeId: 'chronique',
  title: extra.title ?? uid,
  durationSeconds: extra.durationSeconds ?? 60,
  notes: '',
  scriptId: null,
  artist: '',
  year: null,
  introSeconds: null,
  tags: [],
  cuttable: false,
});

const message = (over: Partial<RegieMessage> = {}): RegieMessage => ({
  id: 'm1',
  kind: 'message',
  text: 'Accélère',
  urgent: false,
  sentAt: 1000,
  byName: 'Paul',
  expiresAt: 1000 + 5 * 60_000,
  seenAt: null,
  ...over,
});

describe('schémas de la régie', () => {
  it('message : texte brut, borné, priorité obligatoire', () => {
    expect(regieMessageSchema.safeParse({ text: ' Conclus ', urgent: true }).data).toEqual({
      text: 'Conclus',
      urgent: true,
    });
    expect(regieMessageSchema.safeParse({ text: '', urgent: false }).success).toBe(false);
    expect(regieMessageSchema.safeParse({ text: 'x'.repeat(201), urgent: false }).success).toBe(
      false,
    );
    expect(regieMessageSchema.safeParse({ text: 'a\u0007b', urgent: false }).success).toBe(false);
    expect(regieMessageSchema.safeParse({ text: 'ok' }).success).toBe(false);
    expect(regieMessageSchema.safeParse({ text: 'ok', urgent: false, x: 1 }).success).toBe(false);
  });

  it('paramètres : durée de vie bornée, 24 ordres au plus, identifiants uniques', () => {
    const order = (id: string) => ({ id, label: id, urgent: false, active: true });
    const ok = { messageTtlMinutes: 5, kioskSeen: true, orders: [order('a'), order('b')] };
    expect(regieSettingsSchema.safeParse(ok).success).toBe(true);
    expect(regieSettingsSchema.safeParse({ ...ok, messageTtlMinutes: 0 }).success).toBe(false);
    expect(regieSettingsSchema.safeParse({ ...ok, messageTtlMinutes: 31 }).success).toBe(false);
    expect(regieSettingsSchema.safeParse({ ...ok, orders: [order('a'), order('a')] }).success).toBe(
      false,
    );
    const many = Array.from({ length: 25 }, (_, i) => order(`o${i}`));
    expect(regieSettingsSchema.safeParse({ ...ok, orders: many }).success).toBe(false);
  });

  it('duplex : nom ou état, états connus', () => {
    expect(duplexUpdateSchema.safeParse({ state: 'ready' }).success).toBe(true);
    expect(duplexUpdateSchema.safeParse({ state: 'live' }).success).toBe(false);
    expect(duplexUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('note de main courante : 300 caractères, heure facultative', () => {
    expect(logbookNoteSchema.safeParse({ text: 'Coupure son' }).success).toBe(true);
    expect(logbookNoteSchema.safeParse({ text: 'x', at: 1_700_000_000_000 }).success).toBe(true);
    expect(logbookNoteSchema.safeParse({ text: 'x'.repeat(301) }).success).toBe(false);
  });

  it('droit « Réalisateur » : cumulable, admin d’office', () => {
    expect(canDirect({ role: 'admin', isDirector: false })).toBe(true);
    expect(canDirect({ role: 'animateur', isDirector: true })).toBe(true);
    expect(canDirect({ role: 'animateur', isDirector: false })).toBe(false);
    expect(canDirect(null)).toBe(false);
    expect(updateUserSchema.safeParse({ isDirector: true }).success).toBe(true);
    const base = {
      username: 'paul',
      displayName: 'Paul',
      role: 'animateur',
      password: 'x'.repeat(12),
    };
    expect(createUserSchema.safeParse({ ...base, isDirector: true }).success).toBe(true);
  });
});

describe('affichage des messages', () => {
  it('message actif jusqu’à son expiration', () => {
    const regie: RegieState = { message: message(), duplex: [] };
    expect(activeMessage(regie, 2000)).not.toBeNull();
    expect(activeMessage(regie, 1000 + 5 * 60_000)).toBeNull();
    expect(activeMessage(undefined, 0)).toBeNull();
  });

  it('urgent : agrandi 5 secondes seulement', () => {
    const m = message({ urgent: true });
    expect(urgentExpanded(m, 1000)).toBe(true);
    expect(urgentExpanded(m, 1000 + URGENT_EXPAND_MS)).toBe(false);
    expect(urgentExpanded(message(), 1000)).toBe(false);
    expect(urgentExpanded(null, 1000)).toBe(false);
  });

  it('zone régie : réservée, ou affichée quand il y a quelque chose', () => {
    const empty: RegieState = { message: null, duplex: [] };
    expect(regieZoneVisible(true, empty, 0)).toBe(true);
    expect(regieZoneVisible(false, empty, 0)).toBe(false);
    expect(regieZoneVisible(false, { message: message(), duplex: [] }, 2000)).toBe(true);
    expect(regieZoneVisible(false, { message: message(), duplex: [] }, 10 * 60_000)).toBe(false);
    const line = { id: 'd1', name: 'Moulins', state: 'ready' as const, changedAt: 0 };
    expect(regieZoneVisible(false, { message: null, duplex: [line] }, 0)).toBe(true);
    expect(regieZoneVisible(false, empty, 0, true)).toBe(true);
  });
});

describe('conducteur modifié en direct', () => {
  const abcd = [item('a'), item('b'), item('c'), item('d')];

  it('rien de changé : null', () => {
    expect(
      diffRundownItems(
        abcd,
        abcd.map((i) => ({ ...i })),
      ),
    ).toBeNull();
  });

  it('ajout, suppression, modification', () => {
    const after = [item('a'), item('b', { durationSeconds: 90 }), item('d'), item('e')];
    expect(diffRundownItems(abcd, after)).toEqual({
      added: ['e'],
      changed: ['b'],
      moved: [],
      removed: 1,
    });
  });

  it('déplacement : seul l’élément déplacé est signalé', () => {
    const after = [item('a'), item('c'), item('d'), item('b')];
    expect(diffRundownItems(abcd, after)).toEqual({
      added: [],
      changed: [],
      moved: ['b'],
      removed: 0,
    });
  });

  it('soulignement : 10 secondes, sur le conducteur affiché seulement', () => {
    const change = {
      rundownId: 3,
      at: 1000,
      byName: 'Paul',
      added: ['e'],
      changed: [],
      moved: [],
      removed: 0,
    };
    expect(liveChangeActive(change, 3, 1000)).toBe(true);
    expect(liveChangeActive(change, 3, 1000 + LIVE_CHANGE_HIGHLIGHT_MS)).toBe(false);
    expect(liveChangeActive(change, 4, 1000)).toBe(false);
    expect(liveChangeActive(null, 3, 1000)).toBe(false);
  });
});

describe('main courante', () => {
  it('fenêtre : début − 15 min → fin + 30 min', () => {
    expect(logbookWindow({ start: 1_000_000_000, end: 1_003_600_000 })).toEqual({
      from: 1_000_000_000 - LOGBOOK_BEFORE_MS,
      to: 1_003_600_000 + LOGBOOK_AFTER_MS,
    });
  });
});
