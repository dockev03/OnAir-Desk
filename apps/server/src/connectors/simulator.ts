import type { Track } from '@onair-desk/shared';
import type { AutomationConnector, ConnectorContext } from './types.js';

/** Playlist fictive (titres et artistes inventés) : durée, intro et outro en secondes. */
export const SIMULATOR_PLAYLIST = [
  { title: 'Matin clair', artist: 'Les Ondes Courtes', duration: 214, intro: 12, outro: 8 },
  { title: 'Route nationale', artist: 'Camille Ferrand', duration: 187, intro: 9, outro: 5 },
  { title: 'Néon sur la ville', artist: 'Orchestre Pixel', duration: 242, intro: 18, outro: 10 },
  { title: 'Allier en été', artist: 'Jeanne Vidal', duration: 198, intro: 7, outro: 6 },
  { title: 'Fréquence libre', artist: 'Studio 7', duration: 263, intro: 15, outro: 12 },
  { title: 'La dernière marche', artist: 'Hugo Marchal', duration: 171, intro: 0, outro: 4 },
  { title: 'Pluie de juin', artist: 'Les Ondes Courtes', duration: 226, intro: 11, outro: 9 },
  { title: 'Signal horaire', artist: 'Duo Méridien', duration: 155, intro: 6, outro: 3 },
  { title: 'Bleu volcan', artist: 'Ana Ribeiro', duration: 248, intro: 20, outro: 7 },
  { title: 'Les quais', artist: 'Camille Ferrand', duration: 203, intro: 10, outro: 6 },
  { title: 'Antenne ouverte', artist: 'Orchestre Pixel', duration: 270, intro: 14, outro: 11 },
  { title: 'Retour au studio', artist: 'Jeanne Vidal', duration: 192, intro: 8, outro: 5 },
] as const;

/**
 * Faux connecteur : joue la playlist en boucle, à vitesse réelle ou accélérée (durées
 * divisées). Sert à développer et tester sans RadioDJ ni AzuraCast, aux démonstrations, et
 * de modèle pour écrire un vrai connecteur.
 */
export class SimulatorConnector implements AutomationConnector {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private index = 0;

  constructor(private readonly speed: number) {}

  start(ctx: ConnectorContext): void {
    this.index = 0;
    this.play(ctx, ctx.now());
  }

  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private track(index: number, startedAt: number | null): Track {
    const t = SIMULATOR_PLAYLIST[index % SIMULATOR_PLAYLIST.length]!;
    const ms = (seconds: number) => Math.round((seconds * 1000) / this.speed);
    return {
      title: t.title,
      artist: t.artist,
      durationMs: ms(t.duration),
      startedAt,
      introMs: t.intro > 0 ? ms(t.intro) : null,
      outroMs: ms(t.outro),
    };
  }

  /** Les titres s'enchaînent à partir de l'heure de fin théorique : aucune dérive. */
  private play(ctx: ConnectorContext, startedAt: number): void {
    const current = this.track(this.index, startedAt);
    ctx.update({ nowPlaying: current, next: this.track(this.index + 1, null) });
    const end = startedAt + current.durationMs;
    this.timer = setTimeout(
      () => {
        this.index = (this.index + 1) % SIMULATOR_PLAYLIST.length;
        this.play(ctx, end);
      },
      Math.max(0, end - ctx.now()),
    );
  }
}
