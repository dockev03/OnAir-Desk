import type { FastifyInstance } from 'fastify';
import {
  duplexCreateSchema,
  duplexUpdateSchema,
  logbookNoteSchema,
  logbookQuerySchema,
  logbookWindow,
  regieIdParamSchema,
  regieMessageSchema,
  regieSeenSchema,
  rundownSchedule,
  showWindow,
  type LogbookView,
} from '@onair-desk/shared';
import { requireDirector, requireIdentity, studioOf } from '../auth/identity.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import type { RouteContext } from './context.js';

/**
 * Régie (voir docs/plan-etape-10.md) : toutes les routes d'envoi exigent un compte admin ou
 * « Réalisateur » (contrôle côté serveur, décision 3) ; le WebSocket reste en lecture. Seule
 * exception : l'accusé « Vu » de l'écran studio, s'il est autorisé (décision 9).
 */
export function registerRegieRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { repos, regie } = ctx;

  // ---- Messages, ordres rapides, liners ----------------------------------------------

  app.post('/api/regie/message', async (req) => {
    const user = requireDirector(req);
    const input = parse(regieMessageSchema, req.body);
    return regie.send(studioOf(req.identity!), user, { kind: 'message', ...input });
  });

  app.delete('/api/regie/message', async (req, reply) => {
    const user = requireDirector(req);
    regie.clear(studioOf(req.identity!), user);
    return reply.code(204).send();
  });

  app.post('/api/regie/order/:id', async (req) => {
    const user = requireDirector(req);
    const { id } = parse(regieIdParamSchema, req.params);
    const order = repos.settings.get().regie.orders.find((o) => o.id === id && o.active);
    if (!order) throw notFound();
    return regie.send(studioOf(req.identity!), user, {
      kind: 'order',
      text: order.label,
      urgent: order.urgent,
      ref: order.id,
    });
  });

  app.post('/api/regie/liner/:id', async (req) => {
    const user = requireDirector(req);
    const { id } = parse(regieIdParamSchema, req.params);
    const liner = repos.settings.get().liners.items.find((l) => l.id === id && l.active);
    if (!liner) throw notFound();
    return regie.send(studioOf(req.identity!), user, {
      kind: 'liner',
      text: liner.text,
      urgent: false,
      ref: liner.id,
    });
  });

  // ---- Accusé « Vu » : écran studio seulement, si les paramètres l'autorisent ----------

  app.post('/api/studio/regie/seen', { config: { deviceMayWrite: true } }, async (req) => {
    const identity = requireIdentity(req);
    if (identity.kind !== 'device') throw forbidden();
    if (!repos.settings.get().regie.kioskSeen) throw forbidden('regie_seen_disabled');
    const { id } = parse(regieSeenSchema, req.body);
    return regie.seen(identity.device.studioId, identity.device.id, id);
  });

  // ---- Duplex ------------------------------------------------------------------------

  app.post('/api/regie/duplex', async (req, reply) => {
    const user = requireDirector(req);
    const { name } = parse(duplexCreateSchema, req.body);
    return reply.code(201).send(regie.addDuplex(studioOf(req.identity!), user, name));
  });

  app.patch('/api/regie/duplex/:id', async (req) => {
    const user = requireDirector(req);
    const { id } = parse(regieIdParamSchema, req.params);
    const patch = parse(duplexUpdateSchema, req.body);
    return regie.updateDuplex(studioOf(req.identity!), user, id, patch);
  });

  app.delete('/api/regie/duplex/:id', async (req, reply) => {
    const user = requireDirector(req);
    const { id } = parse(regieIdParamSchema, req.params);
    regie.removeDuplex(studioOf(req.identity!), user, id);
    return reply.code(204).send();
  });

  app.delete('/api/regie/duplex', async (req, reply) => {
    const user = requireDirector(req);
    regie.clearDuplex(studioOf(req.identity!), user);
    return reply.code(204).send();
  });

  // ---- Main courante -----------------------------------------------------------------

  app.post('/api/regie/logbook', async (req, reply) => {
    const user = requireDirector(req);
    const input = parse(logbookNoteSchema, req.body);
    const studioId = studioOf(req.identity!);
    const rundownId = repos.prompter.get(studioId).rundownId;
    return reply.code(201).send(regie.addNote(studioId, user, input, rundownId));
  });

  app.get('/api/regie/logbook', async (req): Promise<LogbookView> => {
    requireDirector(req);
    const { rundownId } = parse(logbookQuerySchema, req.query);
    const rundown = repos.rundowns.findById(rundownId);
    if (!rundown) throw notFound();
    const total = rundownSchedule(rundown.startTime, rundown.items).total;
    const show = showWindow(
      { airDate: rundown.airDate, startTime: rundown.startTime, totalSeconds: total },
      repos.settings.get().timezone,
    );
    if (!show) throw badRequest();
    const { from, to } = logbookWindow(show);
    return {
      rundown: {
        id: rundown.id,
        title: rundown.title,
        airDate: rundown.airDate,
        startTime: rundown.startTime,
      },
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      entries: repos.audit.logbook(studioOf(req.identity!), rundownId, from, to),
    };
  });
}
