/**
 * File access for folders that only exist at run time: data/models (multi-GB model files), data/audio,
 * and the tools folder. Turbopack traces any fs call whose path it can partly work out, and when that
 * path lands in data/ it opens every file there during `next build` and runs out of memory. Each call
 * here passes a bare, ignore-marked argument, which Turbopack skips.
 */
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";

type Fn = (...args: never[]) => unknown;
function wrap<T extends Fn>(call: (target: unknown, rest: unknown[]) => unknown): T {
  return ((target: unknown, ...rest: unknown[]) => call(target, rest)) as unknown as T;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export const existsSync = wrap<typeof fs.existsSync>((p, r) => fs.existsSync(/*turbopackIgnore: true*/ p as any, ...(r as [])));
export const statSync = wrap<typeof fs.statSync>((p, r) => (fs.statSync as any)(/*turbopackIgnore: true*/ p, ...r));
export const readFileSync = wrap<typeof fs.readFileSync>((p, r) => (fs.readFileSync as any)(/*turbopackIgnore: true*/ p, ...r));
export const writeFileSync = wrap<typeof fs.writeFileSync>((p, r) => (fs.writeFileSync as any)(/*turbopackIgnore: true*/ p, ...r));
export const mkdirSync = wrap<typeof fs.mkdirSync>((p, r) => (fs.mkdirSync as any)(/*turbopackIgnore: true*/ p, ...r));
export const readdirSync = wrap<typeof fs.readdirSync>((p, r) => (fs.readdirSync as any)(/*turbopackIgnore: true*/ p, ...r));
export const renameSync = wrap<typeof fs.renameSync>((p, r) => (fs.renameSync as any)(/*turbopackIgnore: true*/ p, ...r));
export const rmSync = wrap<typeof fs.rmSync>((p, r) => (fs.rmSync as any)(/*turbopackIgnore: true*/ p, ...r));
export const chmodSync = wrap<typeof fs.chmodSync>((p, r) => (fs.chmodSync as any)(/*turbopackIgnore: true*/ p, ...r));
export const openSync = wrap<typeof fs.openSync>((p, r) => (fs.openSync as any)(/*turbopackIgnore: true*/ p, ...r));
export const createWriteStream = wrap<typeof fs.createWriteStream>((p, r) => (fs.createWriteStream as any)(/*turbopackIgnore: true*/ p, ...r));
export const readSync = fs.readSync;
export const closeSync = fs.closeSync;

export const readFile = wrap<typeof fsp.readFile>((p, r) => (fsp.readFile as any)(/*turbopackIgnore: true*/ p, ...r));
export const writeFile = wrap<typeof fsp.writeFile>((p, r) => (fsp.writeFile as any)(/*turbopackIgnore: true*/ p, ...r));
export const mkdir = wrap<typeof fsp.mkdir>((p, r) => (fsp.mkdir as any)(/*turbopackIgnore: true*/ p, ...r));
export const rm = wrap<typeof fsp.rm>((p, r) => (fsp.rm as any)(/*turbopackIgnore: true*/ p, ...r));
export const statfs = wrap<typeof fsp.statfs>((p, r) => (fsp.statfs as any)(/*turbopackIgnore: true*/ p, ...r));
export const mkdtemp = fsp.mkdtemp;
/* eslint-enable @typescript-eslint/no-explicit-any */

/* Programs started at run time (llama-server, ffmpeg, the speech engine). Same reason: their file
   arguments point into data/, which the build must not open. */
import * as cp from "node:child_process";
/* eslint-disable @typescript-eslint/no-explicit-any */
export const spawn = wrap<typeof cp.spawn>((c, r) => (cp.spawn as any)(/*turbopackIgnore: true*/ c, .../*turbopackIgnore: true*/ r));
export const execFile = wrap<typeof cp.execFile>((c, r) => (cp.execFile as any)(/*turbopackIgnore: true*/ c, .../*turbopackIgnore: true*/ r));
/* eslint-enable @typescript-eslint/no-explicit-any */
export type { ChildProcess } from "node:child_process";

import { promisify } from "node:util";
const execFilePromise = promisify(cp.execFile);
/** promisified execFile: resolves { stdout, stderr }. */
export function execFileAsync(command: string, args: readonly string[], options: cp.ExecFileOptions = {}) {
  return execFilePromise(/*turbopackIgnore: true*/ command, /*turbopackIgnore: true*/ args, options);
}
