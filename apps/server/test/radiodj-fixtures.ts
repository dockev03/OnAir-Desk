import type { HistoryRow, LibraryRow, RadiodjReader } from '../src/connectors/radiodj/reader.js';

// Repères relevés sur une vraie base RadioDJ (voir docs/cadrage-radiodj.md).
export const SUMMERTIME = {
  artist: 'Adamé;Lili Poli',
  title: 'Summertime',
  duration: 163.98907,
  cueTimes:
    '&sta=0.33172335600907&int=4.36934240362812&out=161.413764172336&xta=164.320793650794&end=164.615238095238&fin=0&fou=0.294444444444423',
};
export const SANS_INTRO = {
  artist: 'Alien;Carla De Coignac',
  title: 'Un Peu Plus Près Du Bonheur',
  duration: 138.42045,
  cueTimes:
    '&sta=0.869342403628118&xta=138.132426303855&end=139.289795918367&fin=0&fou=1.15736961451248',
};

/** Fausse base RadioDJ : on y écrit l'historique et la file comme le ferait RadioDJ. */
export class FakeReader implements RadiodjReader {
  history: HistoryRow[] = [];
  queue: (typeof SUMMERTIME)[] = [];
  failWith: Error | null = null;
  closed = false;
  reads = 0;

  private check() {
    this.reads++;
    if (this.failWith) throw this.failWith;
  }
  async current() {
    this.check();
    const rows = this.history.filter((h) => h.songType !== 2 && h.songType !== 3);
    return rows.at(-1) ?? null;
  }
  async next() {
    this.check();
    return this.queue[0] ?? null;
  }
  async countSongs() {
    this.check();
    return 49;
  }
  library: LibraryRow[] = [];
  searches: { query: string; limit: number }[] = [];
  async searchSongs(query: string, limit: number) {
    this.check();
    this.searches.push({ query, limit });
    return this.library.slice(0, limit);
  }
  async close() {
    this.closed = true;
  }

  play(song: typeof SUMMERTIME, datePlayed: string, songType = 0) {
    const id = this.history.length + 1;
    this.history.push({ ...song, id, trackId: id * 10, datePlayed, songType });
  }
}
