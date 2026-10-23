import type { FastifyInstance } from 'fastify';
import { createUserSchema, idParamSchema, updateUserSchema } from '@onair-desk/shared';
import { requireAdmin } from '../auth/identity.js';
import { hashPassword } from '../auth/passwords.js';
import { conflict, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { toPublicUser } from '../db/index.js';
import type { RouteContext } from './context.js';

export function registerUserRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { repos, hub } = ctx;

  app.get('/api/users', async (req) => {
    requireAdmin(req);
    return repos.users.list().map(toPublicUser);
  });

  app.post('/api/users', async (req, reply) => {
    const admin = requireAdmin(req);
    const input = parse(createUserSchema, req.body);
    if (repos.users.findByUsername(input.username)) throw conflict('username_taken');
    const user = repos.users.create({
      username: input.username,
      displayName: input.displayName,
      role: input.role,
      locale: input.locale ?? repos.settings.get().locale,
      passwordHash: await hashPassword(input.password),
    });
    repos.audit.write({ type: 'user', id: admin.id }, 'user.created', {
      userId: user.id,
      role: user.role,
    });
    return reply.code(201).send(toPublicUser(user));
  });

  app.patch('/api/users/:id', async (req) => {
    const admin = requireAdmin(req);
    const { id } = parse(idParamSchema, req.params);
    const patch = parse(updateUserSchema, req.body);
    const target = repos.users.findById(id);
    if (!target) throw notFound();

    const losesAdmin =
      target.role === 'admin' &&
      target.isActive &&
      ((patch.role !== undefined && patch.role !== 'admin') || patch.isActive === false);
    if (losesAdmin) {
      if (target.id === admin.id) throw conflict('cannot_demote_self');
      if (repos.users.countActiveAdmins() <= 1) throw conflict('last_admin');
    }

    const { password, ...rest } = patch;
    const updated = repos.users.update(id, {
      ...rest,
      ...(password ? { passwordHash: await hashPassword(password) } : {}),
    })!;

    // Mot de passe réinitialisé ou compte désactivé : toutes ses sessions sont fermées.
    if (password || patch.isActive === false) {
      repos.sessions.deleteForUser(id);
      hub.disconnectUser(id);
    }
    repos.audit.write({ type: 'user', id: admin.id }, 'user.updated', {
      userId: id,
      fields: Object.keys(patch),
    });
    return toPublicUser(updated);
  });

  app.delete('/api/users/:id', async (req, reply) => {
    const admin = requireAdmin(req);
    const { id } = parse(idParamSchema, req.params);
    const target = repos.users.findById(id);
    if (!target) throw notFound();
    if (target.id === admin.id) throw conflict('cannot_delete_self');
    if (target.role === 'admin' && target.isActive && repos.users.countActiveAdmins() <= 1) {
      throw conflict('last_admin');
    }
    // Son contenu (scripts, conducteurs, modèles) serait perdu : désactiver le compte à la place.
    if (repos.users.hasContent(id)) throw conflict('user_has_content');
    hub.disconnectUser(id);
    repos.users.delete(id);
    repos.audit.write({ type: 'user', id: admin.id }, 'user.deleted', {
      userId: id,
      username: target.username,
    });
    return reply.code(204).send();
  });
}
