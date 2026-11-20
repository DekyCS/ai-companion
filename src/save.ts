// Khina's life on disk: the live server's save (--persist) and the spend ledger. Written so a crash or
// a full disk never leaves half a file, backed up about once a real hour, and read back so that a save
// that can't be read is never quietly replaced by a new life. The volume keeps her life; starting her
// over without a word would be the worst way for anything here to fail.

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Completed, State } from './state.ts';

/** A save as the live server keeps it. */
export interface Saved {
  version: 1;
  seed: number;
  /** Real time (ms) at game minute 0, when the clock follows the wall clock. */
  epochMs: number | null;
  /** Khina minutes per real minute when epochMs was set. */
  rate?: number;
  s: State;
  rngState: number;
  log: Completed[];
}

/** How often the save is copied to <save>.bak before it is replaced: about once a real hour. */
export const BACKUP_EVERY_MS = 3_600_000;

export const backupPath = (path: string) => `${path}.bak`;

/**
 * Writes the whole text or nothing: into a file of its own first, then renamed over the old one, so a
 * crash mid-write leaves the old file whole. The process id keeps two runs sharing a file (the spend
 * ledger) from renaming each other's half-written copy; fsync makes sure the bytes are on disk before
 * the rename is, or a power cut could still leave an empty file under the real name.
 */
export function writeFileAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  // If this fails, the copy was never ours (something else is in the way): nothing to tidy.
  const fd = openSync(tmp, 'w');
  try {
    try {
      writeFileSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (err) {
    // A full disk would otherwise leave a half-written copy lying next to the save at every try.
    try {
      unlinkSync(tmp);
    } catch {
      // Already gone.
    }
    throw err;
  }
  syncDir(dirname(path));
}

/** The rename is on disk only once the folder is: without this a power cut just after could bring back the old file. */
function syncDir(dir: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(dir, 'r');
    fsyncSync(fd);
  } catch {
    // Some systems can't fsync a folder; the file itself is already safe.
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * The save in a file's text, or why it can't be used. The reason never quotes the file: it holds
 * visitors' unread notes, which are private, and the reason goes to the server log.
 */
export function parseSave(text: string): Saved | string {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return text.length === 0 ? 'the file is empty' : `not valid JSON (${text.length} bytes; cut off or damaged)`;
  }
  if (typeof j !== 'object' || j === null) return 'not a save';
  const x = j as Partial<Saved>;
  // A save from a newer build is not ours to overwrite: rolling back must not start her over.
  if (x.version !== 1) return `a version ${String(x.version)} save (this build reads version 1)`;
  if (typeof x.s !== 'object' || x.s === null || !Array.isArray(x.log)) return 'parts of the save are missing';
  return x as Saved;
}

function readOne(path: string): Saved | string {
  if (!existsSync(path)) return 'missing';
  try {
    return parseSave(readFileSync(path, 'utf8'));
  } catch (err) {
    return `could not be read (${(err as NodeJS.ErrnoException).code ?? 'error'})`;
  }
}

export type Loaded =
  /** No save and no backup: a new life. */
  | { from: 'none' }
  /** `trouble` says what was wrong with the save when the backup had to stand in. */
  | { from: 'save' | 'backup'; saved: Saved; path: string; trouble?: string }
  /** A save is there, but neither it nor its backup can be read: stop, never start over. */
  | { from: 'unreadable'; why: string };

/** A save written by a newer build (a higher version number): read whole, just not by this build. */
function fromNewerBuild(path: string): boolean {
  try {
    const v = (JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown } | null)?.version;
    return typeof v === 'number' && v > 1;
  } catch {
    return false;
  }
}

/** Reads the save at `path`, or its backup when the save is missing or can't be read. */
export function loadSave(path: string): Loaded {
  const bak = backupPath(path);
  if (!existsSync(path) && !existsSync(bak)) return { from: 'none' };
  const main = readOne(path);
  if (typeof main !== 'string') return { from: 'save', saved: main, path };
  const trouble = `${path}: ${main}`;
  // After a rollback the backup may be an older build's, readable here: starting from it would write over
  // the newer save at the first save. Stop instead, whatever the backup holds.
  if (fromNewerBuild(path)) return { from: 'unreadable', why: `${trouble}; a newer build's save is never replaced from the backup` };
  const backup = readOne(bak);
  if (typeof backup !== 'string') return { from: 'backup', saved: backup, path: bak, trouble };
  return { from: 'unreadable', why: `${trouble}; ${bak}: ${backup}` };
}

/** Is the backup an hour old or more (or missing), with a save there to copy? */
export function backupDue(path: string, now = Date.now()): boolean {
  if (!existsSync(path)) return false;
  const bak = backupPath(path);
  return !existsSync(bak) || now - statSync(bak).mtimeMs >= BACKUP_EVERY_MS;
}

/**
 * Copies the save to <save>.bak, only if it reads as a save: after starting from the backup because
 * the save was broken, copying the broken save over it would lose the one good copy.
 */
export function backupSave(path: string): boolean {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return false;
  }
  if (typeof parseSave(text) === 'string') return false;
  writeFileAtomic(backupPath(path), text);
  return true;
}

/** Saves her life: first, about once a real hour, the save as it stands goes to <save>.bak. */
export function writeSave(path: string, data: Saved, now = Date.now()): void {
  if (backupDue(path, now)) backupSave(path);
  writeFileAtomic(path, JSON.stringify(data));
}
