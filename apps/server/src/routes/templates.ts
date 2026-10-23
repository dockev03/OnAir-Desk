import type { FastifyInstance } from 'fastify';
import {
  createFromTemplateSchema,
  createTemplateSchema,
  duplicateTemplateSchema,
  idParamSchema,
  reapplyTemplateSchema,
  saveAsTemplateSchema,
  updateTemplateSchema,
  type CreateFromTemplateResult,
  type Template,
  type TemplateSummary,
} from '@onair-desk/shared';
import { requireIdentity, requireUser } from '../auth/identity.js';
import { parse } from '../lib/validate.js';
import type { RouteContext } from './context.js';

export function registerTemplateRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { repos, rundowns, templates } = ctx;

  // ---- Lecture --------------------------------------------------------------------

  app.get('/api/templates', async (req): Promise<TemplateSummary[]> => {
    requireIdentity(req);
    return templates.list();
  });

  app.get('/api/templates/:id', async (req): Promise<Template> => {
    const identity = requireIdentity(req);
    const { id } = parse(idParamSchema, req.params);
    return templates.toTemplate(templates.getLive(id), identity);
  });

  // ---- Écriture -------------------------------------------------------------------

  app.post('/api/templates', async (req, reply) => {
    const user = requireUser(req);
    const input = parse(createTemplateSchema, req.body);
    const template = templates.create(user, input);
    return reply.code(201).send(templates.toTemplate(template, req.identity!));
  });

  app.patch('/api/templates/:id', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParamSchema, req.params);
    const input = parse(updateTemplateSchema, req.body);
    return templates.toTemplate(templates.save(user, id, input), req.identity!);
  });

  app.post('/api/templates/:id/duplicate', async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParamSchema, req.params);
    const input = parse(duplicateTemplateSchema, req.body);
    const copy = templates.duplicate(user, id, input);
    repos.audit.write({ type: 'user', id: user.id }, 'template.duplicated', {
      from: id,
      to: copy.id,
    });
    return reply.code(201).send(templates.toTemplate(copy, req.identity!));
  });

  app.post('/api/templates/:id/create-rundowns', async (req): Promise<CreateFromTemplateResult> => {
    const user = requireUser(req);
    const { id } = parse(idParamSchema, req.params);
    const period = parse(createFromTemplateSchema, req.body);
    const result = templates.createRundowns(user, id, period);
    if (result.created.length > 0) {
      repos.audit.write({ type: 'user', id: user.id }, 'rundown.created_from_template', {
        templateId: id,
        rundownIds: result.created.map((c) => c.rundownId),
      });
    }
    return result;
  });

  app.delete('/api/templates/:id', async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParamSchema, req.params);
    templates.trash(user, id);
    repos.audit.write({ type: 'user', id: user.id }, 'template.trashed', { templateId: id });
    return reply.code(204).send();
  });

  // ---- Depuis un conducteur ----------------------------------------------------------

  app.post('/api/rundowns/:id/save-as-template', async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParamSchema, req.params);
    const input = parse(saveAsTemplateSchema, req.body);
    const template = templates.fromRundown(user, id, input);
    repos.audit.write({ type: 'user', id: user.id }, 'template.created_from_rundown', {
      rundownId: id,
      templateId: template.id,
    });
    return reply.code(201).send(templates.toTemplate(template, req.identity!));
  });

  app.post('/api/rundowns/:id/reapply-template', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParamSchema, req.params);
    const { version } = parse(reapplyTemplateSchema, req.body);
    const rundown = rundowns.reapplyTemplate(user, id, version);
    repos.audit.write({ type: 'user', id: user.id }, 'rundown.template_reapplied', {
      rundownId: id,
      templateId: rundown.templateId,
    });
    return rundowns.toRundown(rundown, req.identity!);
  });

  // ---- Corbeille (la liste commune est dans les routes de la bibliothèque) ---------

  app.post('/api/trash/templates/:id/restore', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParamSchema, req.params);
    const template = templates.restore(user, id);
    repos.audit.write({ type: 'user', id: user.id }, 'template.restored', { templateId: id });
    return templates.toTemplate(template, req.identity!);
  });

  app.delete('/api/trash/templates/:id', async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParamSchema, req.params);
    templates.deleteForever(user, id);
    repos.audit.write({ type: 'user', id: user.id }, 'template.deleted', { templateId: id });
    return reply.code(204).send();
  });
}
