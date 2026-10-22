import type { FastifyInstance } from 'fastify';
import {
  createFolderSchema,
  createScriptSchema,
  duplicateScriptSchema,
  idParamSchema,
  prompterSendSchema,
  restoreRevisionSchema,
  revisionParamSchema,
  searchQuerySchema,
  updateFolderSchema,
  updateScriptSchema,
  type Library as LibraryTree,
  type Revision,
  type RevisionSummary,
  type TrashItem,
} from '@onair-desk/shared';
import { requireIdentity, requireUser } from '../auth/identity.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { MAX_FOLDER_DEPTH, canWrite } from '../library.js';
import type { RouteContext } from './context.js';

export function registerLibraryRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { repos, library } = ctx;

  // ---- Lecture (comptes et écran studio) -----------------------------------------

  app.get('/api/library', async (req): Promise<LibraryTree> => {
    const identity = requireIdentity(req);
    return {
      owners: library.owners(identity),
      folders: repos.folders.list(),
      scripts: repos.scripts.listSummaries(),
    };
  });

  app.get('/api/scripts', async (req) => {
    requireIdentity(req);
    const { q } = parse(searchQuerySchema, req.query);
    return repos.scripts.search(q);
  });

  app.get('/api/scripts/:id', async (req) => {
    const identity = requireIdentity(req);
    const { id } = parse(idParamSchema, req.params);
    return library.toScript(library.getLive(id), identity);
  });

  // ---- Scripts ------------------------------------------------------------------

  app.post('/api/scripts', async (req, reply) => {
    const user = requireUser(req);
    const input = parse(createScriptSchema, req.body);
    const script = library.createScript(user, input);
    return reply.code(201).send(library.toScript(script, req.identity!));
  });

  app.patch('/api/scripts/:id', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParamSchema, req.params);
    const input = parse(updateScriptSchema, req.body);
    return library.toScript(library.saveScript(user, id, input), req.identity!);
  });

  app.post('/api/scripts/:id/duplicate', async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParamSchema, req.params);
    const input = parse(duplicateScriptSchema, req.body);
    const source = library.getLive(id);
    const copy = library.createScript(user, {
      ownerId: input.ownerId,
      folderId: input.folderId ?? null,
      title: input.title ?? source.title,
      content: source.content,
      speedWpm: source.speedWpm,
    });
    repos.audit.write({ type: 'user', id: user.id }, 'script.duplicated', {
      from: id,
      to: copy.id,
    });
    return reply.code(201).send(library.toScript(copy, req.identity!));
  });

  app.delete('/api/scripts/:id', async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParamSchema, req.params);
    library.trashScript(user, id);
    repos.audit.write({ type: 'user', id: user.id }, 'script.trashed', { scriptId: id });
    return reply.code(204).send();
  });

  // ---- Historique -----------------------------------------------------------------

  app.get('/api/scripts/:id/revisions', async (req): Promise<RevisionSummary[]> => {
    requireUser(req);
    const { id } = parse(idParamSchema, req.params);
    library.getLive(id);
    return repos.scripts.listRevisions(id);
  });

  app.get('/api/scripts/:id/revisions/:revisionId', async (req): Promise<Revision> => {
    requireUser(req);
    const { id, revisionId } = parse(revisionParamSchema, req.params);
    library.getLive(id);
    const revision = repos.scripts.findRevision(id, revisionId);
    if (!revision) throw notFound();
    return revision;
  });

  app.post('/api/scripts/:id/revisions/:revisionId/restore', async (req) => {
    const user = requireUser(req);
    const { id, revisionId } = parse(revisionParamSchema, req.params);
    const { version } = parse(restoreRevisionSchema, req.body);
    const script = library.restoreRevision(user, id, revisionId, version);
    repos.audit.write({ type: 'user', id: user.id }, 'script.revision_restored', {
      scriptId: id,
      revisionId,
    });
    return library.toScript(script, req.identity!);
  });

  // ---- Corbeille ------------------------------------------------------------------

  app.get('/api/trash', async (req): Promise<TrashItem[]> => {
    const user = requireUser(req);
    return [...repos.scripts.listTrash(), ...repos.rundowns.listTrash()]
      .filter((t) => canWrite(user, t.ownerId))
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  });

  app.post('/api/trash/:id/restore', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParamSchema, req.params);
    const script = library.restoreFromTrash(user, id);
    repos.audit.write({ type: 'user', id: user.id }, 'script.restored', { scriptId: id });
    return library.toScript(script, req.identity!);
  });

  app.delete('/api/trash/:id', async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParamSchema, req.params);
    library.deleteForever(user, id);
    repos.audit.write({ type: 'user', id: user.id }, 'script.deleted', { scriptId: id });
    return reply.code(204).send();
  });

  // ---- Dossiers -------------------------------------------------------------------

  app.post('/api/folders', async (req, reply) => {
    const user = requireUser(req);
    const { ownerId, parentId, name } = parse(createFolderSchema, req.body);
    library.assertWrite(user, ownerId);
    library.assertFolder(parentId, ownerId);
    if (parentId && repos.folders.depth(parentId) >= MAX_FOLDER_DEPTH) throw badRequest('too_deep');
    return reply.code(201).send(repos.folders.create(ownerId, parentId ?? null, name));
  });

  app.patch('/api/folders/:id', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParamSchema, req.params);
    const patch = parse(updateFolderSchema, req.body);
    const folder = repos.folders.findById(id);
    if (!folder) throw notFound();
    library.assertWrite(user, folder.ownerId);
    if (patch.parentId !== undefined && patch.parentId !== null) {
      library.assertFolder(patch.parentId, folder.ownerId);
      if (repos.folders.isSelfOrDescendant(id, patch.parentId)) throw badRequest('folder_cycle');
      if (
        repos.folders.depth(patch.parentId) + repos.folders.subtreeHeight(id) >
        MAX_FOLDER_DEPTH
      ) {
        throw badRequest('too_deep');
      }
    }
    return repos.folders.update(id, patch);
  });

  app.delete('/api/folders/:id', async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParamSchema, req.params);
    const folder = repos.folders.findById(id);
    if (!folder) throw notFound();
    library.assertWrite(user, folder.ownerId);
    if (!repos.folders.isEmpty(id)) throw conflict('folder_not_empty');
    repos.folders.delete(id);
    return reply.code(204).send();
  });

  // ---- Prompteur ------------------------------------------------------------------

  app.get('/api/prompter', async (req) => {
    requireIdentity(req);
    return library.prompterState();
  });

  // Seule écriture permise à un écran kiosk : choisir ce qui est affiché (un script, un
  // élément de conducteur, ou rien). Aucune modification de contenu.
  app.post('/api/prompter', { config: { deviceMayWrite: true } }, async (req) => {
    const identity = requireIdentity(req);
    const input = parse(prompterSendSchema, req.body);
    const state = library.sendToPrompter(identity, input);
    repos.audit.write(
      identity.kind === 'user'
        ? { type: 'user', id: identity.user.id }
        : { type: 'device', id: identity.device.id },
      'prompter.sent',
      input,
    );
    return state;
  });
}
