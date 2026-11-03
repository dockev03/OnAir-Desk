import type { FastifyInstance } from 'fastify';
import {
  canDirect,
  idParamSchema,
  logbookWindow,
  rehearsalStartSchema,
  type RehearsalSummary,
  type RundownReportView,
  type RunState,
} from '@onair-desk/shared';
import { requireIdentity, requireUser } from '../auth/identity.js';
import { DEFAULT_STUDIO_ID } from '../db/index.js';
import { canWrite } from '../library.js';
import { notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import type { RouteContext } from './context.js';

/**
 * Suivi du temps (voir docs/plan-etape-11.md) : répétition (comptes et écran studio, si les
 * paramètres l'autorisent), clôture d'une émission, bilan et durées mesurées en répétition.
 */
export function registerRunRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { repos, runs, rundowns } = ctx;

  // ---- Répétition : seule nouvelle écriture permise à l'écran studio (décision 16) ---

  app.post('/api/rehearsal', { config: { deviceMayWrite: true } }, async (req, reply) => {
    const identity = requireIdentity(req);
    const { rundownId } = parse(rehearsalStartSchema, req.body);
    const run: RunState = runs.startRehearsal(identity, rundownId);
    return reply.code(201).send(run);
  });

  app.delete('/api/rehearsal', { config: { deviceMayWrite: true } }, async (req, reply) => {
    runs.stopRehearsal(requireIdentity(req));
    return reply.code(204).send();
  });

  // ---- Clôture d'une émission ---------------------------------------------------------

  app.post('/api/runs/:id/close', async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParamSchema, req.params);
    runs.closeRun(user, id);
    return reply.code(204).send();
  });

  // ---- Bilan et répétitions -------------------------------------------------------------

  app.get('/api/rundowns/:id/report', async (req): Promise<RundownReportView> => {
    const user = requireUser(req);
    const { id } = parse(idParamSchema, req.params);
    const rundown = repos.rundowns.findById(id);
    if (!rundown) throw notFound();
    const found = runs.report(id);
    const logbook = found
      ? repos.audit.logbook(
          repos.runs.findById(found.runId)?.studioId ?? DEFAULT_STUDIO_ID,
          id,
          ...windowOf(found.report),
        )
      : [];
    return {
      rundown: {
        id: rundown.id,
        title: rundown.title,
        airDate: rundown.airDate,
        startTime: rundown.startTime,
        endTime: rundown.endTime,
      },
      report: found?.report ?? null,
      active: found?.active ?? false,
      canClose: !!found?.active && (canDirect(user) || canWrite(user, rundown.ownerId)),
      logbook,
    };
  });

  app.get('/api/rundowns/:id/rehearsals', async (req): Promise<RehearsalSummary[]> => {
    requireUser(req);
    const { id } = parse(idParamSchema, req.params);
    rundowns.getLive(id);
    return runs.rehearsals(id);
  });
}

/** Main courante du bilan : fenêtre de l'émission (étape 10), étendue au déroulé réel. */
function windowOf(report: {
  plannedStart: number;
  plannedEnd: number;
  startedAt: number;
  actualEnd: number | null;
  endedAt: number | null;
}): [number, number] {
  const start = Math.min(report.plannedStart, report.startedAt);
  const end = Math.max(report.plannedEnd, report.actualEnd ?? 0, report.endedAt ?? 0);
  const { from, to } = logbookWindow({ start, end });
  return [from, to];
}
