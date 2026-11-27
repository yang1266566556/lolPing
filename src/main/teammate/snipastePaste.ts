import { execFile, spawn } from 'node:child_process';
import type { Platform } from '../../shared/platform';
import {
  BROWSER_SETTLE_MS, CLIPBOARD_RESTORE_MS, LAUNCH_SETTLE_MS, fingerprintPng, pasteShotOn, snipasteCandidates,
  snipKeyScript, waitForNewImage,
} from '../../shared/teammate/snipaste';

/** The clipboard as it was before F1. Held in memory so it can be put back without writing the new image to a file. */
export interface ClipboardSnap {
  text: string;
  image: Uint8Array | null;
}

export interface SnipastePorts {
  platform: Platform;
  readImage(): Uint8Array | null | Promise<Uint8Array | null>;
  readText(): string | Promise<string>;
  restore(prior: ClipboardSnap): void | Promise<void>;
  isRunning(): Promise<boolean>;
  start(): Promise<boolean>;
  sendKeys(which: 'f1' | 'paste'): Promise<boolean>;
  overlay?(): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  later(ms: number, fn: () => void): void;
  now?(): number;
}

export interface Snipaste {
  /** Global F1, then wait. `text` when there is nothing new to paste. */
  capture(cancelled: () => boolean): Promise<'image' | 'text'>;
  /** After the browser is in front: End, Ctrl+End, Ctrl+V. Never Enter. */
  paste(): Promise<boolean>;
  /** Puts the previous clipboard back after a delay. No-op when F1 did not change the image. */
  release(): void;
}

/**
 * Sends the user's existing Snipaste hotkey and later pastes whatever new image landed on the clipboard.
 * F1 is sent only when Snipaste is already running or was just started, so a missing install does not press F1.
 */
export function createSnipaste(ports: SnipastePorts): Snipaste {
  let prior: ClipboardSnap | null = null;
  let taken = false;
  let released = false;

  const release = (): void => {
    if (released || !taken || !prior) return;
    released = true;
    const snap = prior;
    ports.later(CLIPBOARD_RESTORE_MS, () => {
      void Promise.resolve(ports.restore(snap)).catch((err: unknown) => {
        console.warn('[teammate] clipboard restore failed:', err);
      });
    });
  };

  return {
    async capture(cancelled) {
      if (!pasteShotOn(ports.platform)) return 'text';
      const beforeBytes = copyBytes(await ports.readImage());
      prior = { text: await ports.readText(), image: beforeBytes };
      const before = fingerprintPng(beforeBytes);
      let up = false;
      try {
        up = await ports.isRunning();
        if (!up) {
          const started = await ports.start();
          if (started) {
            await ports.sleep(LAUNCH_SETTLE_MS);
            if (!cancelled()) up = await ports.isRunning();
          }
        }
      } catch {
        up = false;
      }
      if (!up || cancelled()) return 'text';
      let sent = false;
      try {
        sent = await ports.sendKeys('f1');
      } catch {
        sent = false;
      }
      if (!sent || cancelled()) return 'text';
      let waited: 'image' | 'timeout' | 'cancel' = 'timeout';
      try {
        waited = await waitForNewImage({
          before,
          read: async () => fingerprintPng(await ports.readImage()),
          ...(ports.overlay ? { overlay: ports.overlay } : {}),
          sleep: ports.sleep,
          cancelled,
          ...(ports.now ? { now: ports.now } : {}),
        });
      } catch {
        waited = 'timeout';
      }
      if (waited !== 'image') return 'text';
      taken = true;
      return 'image';
    },
    async paste() {
      if (!pasteShotOn(ports.platform)) return false;
      await ports.sleep(BROWSER_SETTLE_MS);
      try {
        return await ports.sendKeys('paste');
      } catch {
        return false;
      }
    },
    release,
  };
}

function copyBytes(bytes: Uint8Array | null): Uint8Array | null {
  if (!bytes || bytes.length === 0) return null;
  return new Uint8Array(bytes);
}

/** The real Windows clipboard and process calls. Tests pass their own ports to `createSnipaste`. */
export function liveSnipaste(opts: {
  platform: Platform;
  readImage(): Uint8Array | null | Promise<Uint8Array | null>;
  readText(): string | Promise<string>;
  restore(prior: ClipboardSnap): void | Promise<void>;
  exists(path: string): boolean;
  env: NodeJS.ProcessEnv;
}): SnipastePorts {
  return {
    platform: opts.platform,
    readImage: opts.readImage,
    readText: opts.readText,
    restore: opts.restore,
    isRunning: snipasteRunning,
    start: () => startSnipaste(opts.env, opts.exists),
    sendKeys: sendSnipKeys,
    overlay: snipasteOverlay,
    sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
    later: (ms, fn) => { setTimeout(fn, ms); },
    now: Date.now,
  };
}

async function snipasteRunning(): Promise<boolean> {
  const out = await execOut('tasklist.exe', ['/FI', 'IMAGENAME eq Snipaste.exe', '/NH']);
  return out !== null && /Snipaste\.exe/i.test(out);
}

async function startSnipaste(env: NodeJS.ProcessEnv, exists: (path: string) => boolean): Promise<boolean> {
  const list = snipasteCandidates({
    localAppData: env.LOCALAPPDATA,
    programFiles: env.ProgramFiles,
    programFilesX86: env['ProgramFiles(x86)'],
  });
  for (const exe of list) {
    if (!exists(exe)) continue;
    try {
      const child = spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      child.on('error', () => undefined);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function sendSnipKeys(which: 'f1' | 'paste'): Promise<boolean> {
  const out = await execOut('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', snipKeyScript(),
  ], { ...process.env, LOLPING_KEY: which });
  return out !== null;
}

async function snipasteOverlay(): Promise<boolean> {
  const out = await execOut('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', OVERLAY_SCRIPT,
  ]);
  return out !== null && out.includes('1');
}

/** Snipaste's capture window has a handle. A miss just means we wait out the timeout instead of guessing Esc. */
const OVERLAY_SCRIPT = [
  "$p = Get-Process -Name Snipaste -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }",
  "if ($p) { '1' } else { '0' }",
].join('\n');

/** The first image on the clipboard, as PNG bytes when `toPng` can decode it, otherwise the raw bytes. */
export async function pngFromClipboardItems(
  items: ReadonlyArray<{ types: readonly string[]; getType(type: string): Promise<unknown> }>,
  toPng: (bytes: Uint8Array) => Uint8Array | null,
): Promise<Uint8Array | null> {
  for (const item of items) {
    const type = item.types.find((name) => name.startsWith('image/'));
    if (!type) continue;
    const bytes = await blobBytes(await item.getType(type));
    if (!bytes || bytes.length === 0) continue;
    return toPng(bytes) ?? bytes;
  }
  return null;
}

/** Puts the previous clipboard back. The Snipaste image is not written to a file to do this. */
export async function writeClipboardSnap<T>(
  prior: ClipboardSnap,
  clip: { clear(): void; write(items: T[]): Promise<void> },
  Item: new (parts: Record<string, string | Blob>) => T,
): Promise<void> {
  const parts: Record<string, string | Blob> = {};
  if (prior.text) parts['text/plain'] = prior.text;
  if (prior.image && prior.image.length > 0) {
    parts['image/png'] = new Blob([new Uint8Array(prior.image)], { type: 'image/png' });
  }
  if (Object.keys(parts).length === 0) {
    clip.clear();
    return;
  }
  await clip.write([new Item(parts)]);
}

function blobBytes(value: unknown): Promise<Uint8Array | null> {
  if (!value || typeof value !== 'object' || !('arrayBuffer' in value)) return Promise.resolve(null);
  const read = value.arrayBuffer;
  if (typeof read !== 'function') return Promise.resolve(null);
  return Promise.resolve()
    .then(() => Reflect.apply(read, value, []) as Promise<ArrayBuffer>)
    .then((buf) => new Uint8Array(buf))
    .catch(() => null);
}

function execOut(file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 8000, ...(env ? { env } : {}) }, (err, stdout) => {
      resolve(err ? null : String(stdout ?? ''));
    });
  });
}
