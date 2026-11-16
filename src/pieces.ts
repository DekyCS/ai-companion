// Where real pieces live: one folder (on the server's volume), an index plus one file per piece.
// Pieces are kept out of Khina's state, which is saved every few minutes and should stay small.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PieceDraft } from './mind/making.ts';
import type { PieceRef } from './state.ts';

export interface StoredPiece extends PieceRef {
  text: string;
  notes: { p: string; d: number }[];
  tempo: number;
}

export class PieceStore {
  private readonly dir: string;
  private index: PieceRef[];

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    const p = join(dir, 'index.json');
    try {
      this.index = existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as PieceRef[]) : [];
    } catch {
      this.index = [];
    }
  }

  list(): PieceRef[] {
    return [...this.index];
  }

  save(d: PieceDraft, t: number): PieceRef {
    const id = `${t.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const ref: PieceRef = { id, form: d.form, title: d.title, t, about: d.about };
    const body: StoredPiece = { ...ref, text: d.text, notes: d.notes, tempo: d.tempo };
    writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(body));
    if (d.form === 'picture') writeFileSync(join(this.dir, `${id}.svg`), d.svg);
    if (d.form === 'toy') writeFileSync(join(this.dir, `${id}.html`), d.html);
    this.index.push(ref);
    const tmp = join(this.dir, 'index.json.tmp');
    writeFileSync(tmp, JSON.stringify(this.index));
    renameSync(tmp, join(this.dir, 'index.json'));
    return ref;
  }

  /** A stored file by name, only if it is one of ours: "<id>.json", "<id>.svg" or "<id>.html". */
  file(name: string): { path: string; type: 'json' | 'svg' | 'html' } | null {
    const m = /^([a-z0-9]+-[a-z0-9]+)\.(json|svg|html)$/.exec(name);
    if (!m || !this.index.some((p) => p.id === m[1])) return null;
    const path = join(this.dir, name);
    return existsSync(path) ? { path, type: m[2] as 'json' | 'svg' | 'html' } : null;
  }
}
