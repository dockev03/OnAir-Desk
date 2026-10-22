import type { FastifyInstance } from 'fastify';
import {
  createRundownSchema,
  duplicateRundownSchema,
  idParamSchema,
  updateRundownSchema,
  type Rundown,
  type RundownList,
} from '@onair-desk/shared';
import { requireIdentity, requireUser } from '../auth/identity.js';
import { parse } from '../lib/validate.js';
import type { RouteContext } from './context.js';

export function registerRundownRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { repos, rundowns } = ctx;

  // ---- Lecture (comptes et écran studio) -----------------------------------------

  app.get('/api/rundowns', async (req): Promise<RundownList> => {
    requireIdentity(req);
    return rundowns.list();
  });

  app.get('/api/rundowns/:id', async (req): Promise<Rundown> => {
    const identity = requireIdentity(req);
    const { id } = parse(idParamSchema, req.params);
    return rundowns.toRundown(rundowns.getLive(id), identity);
  });

  // ---- Écriture -------------------------------------------------------------------

  app.post('/api/rundowns', async (req, reply) => {
    const user = requireUser(req);
    const input = parse(createRundownSchema, req.body);
    const rundown = rundowns.create(user, input);
    return reply.code(201).send(rundowns.toRundown(rundown, req.identity!));
  });

  app.patch('/api/rundowns/:id', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParamSchema, req.params);
    const input = parse(updateRundownSchema, req.body);
    return rundowns.toRundown(rundowns.save(user, id, input), req.identity!);
  });

  app.post('/api/rundowns/:id/duplicate', async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParamSchema, req.params);
    const input = parse(duplicateRundownSchema, req.body);
    const copy = rundowns.duplicate(user, id, input);
    repos.audit.write({ type: 'user', id: user.id }, 'rundown.duplicated', {
      from: id,
      to: copy.id,
    });
    return reply.code(201).send(rundowns.toRundown(copy, req.identity!));
  });

  app.delete('/api/rundowns/:id', async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParamSchema, req.params);
    rundowns.trash(user, id);
    repos.audit.write({ type: 'user', id: user.id }, 'rundown.trashed', { rundownId: id });
    return reply.code(204).send();
  });

  // ---- Corbeille (la liste commune est dans les routes de la bibliothèque) ---------

  app.post('/api/trash/rundowns/:id/restore', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParamSchema, req.params);
    const rundown = rundowns.restore(user, id);
    repos.audit.write({ type: 'user', id: user.id }, 'rundown.restored', { rundownId: id });
    return rundowns.toRundown(rundown, req.identity!);
  });

  app.delete('/api/trash/rundowns/:id', async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParamSchema, req.params);
    rundowns.deleteForever(user, id);
    repos.audit.write({ type: 'user', id: user.id }, 'rundown.deleted', { rundownId: id });
    return reply.code(204).send();
  });
}
