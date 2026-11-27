import type { Platform } from '../platform';

/** How long to wait for Snipaste to put a new image on the clipboard. */
export const SNIP_WAIT_MS = 60_000;
/** The browser needs a moment to take the foreground before the paste keys. */
export const BROWSER_SETTLE_MS = 900;
/** After a launch, Snipaste needs a moment before it will hear F1. */
export const LAUNCH_SETTLE_MS = 800;
/**
 * The previous clipboard comes back only after the paste has had time to land, and after the user has had time to
 * press Ctrl+V themselves. The Snipaste image is never written to a file in order to do this.
 */
export const CLIPBOARD_RESTORE_MS = 90_000;
/** Overlay-gone readings in a row before Esc counts. One flicker must not skip the shot. */
const QUIET_POLLS = 2;

const VK = { f1: 0x70, end: 0x23, control: 0x11, v: 0x56, enter: 0x0d } as const;

/** Windows only. macOS keeps the text link, and the Linux teammate stays off. */
export function pasteShotOn(platform: Platform): boolean {
  return platform === 'win';
}

/** A short token for a PNG in memory. Empty means there is no image. */
export function fingerprintPng(bytes: Uint8Array | null | undefined): string | null {
  if (!bytes || bytes.length === 0) return null;
  let hash = 2166136261;
  const step = Math.max(1, Math.floor(bytes.length / 64));
  for (let i = 0; i < bytes.length; i += step) {
    hash ^= bytes[i] ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `${bytes.length.toString(16)}:${(hash >>> 0).toString(16)}`;
}

/** A new image replaced whatever was on the clipboard. Clearing it does not count. */
export function imageChanged(before: string | null, after: string | null): boolean {
  return after !== null && after !== before;
}

/**
 * Esc closes Snipaste's overlay and leaves the clipboard alone. The overlay has to have been seen, then gone for
 * more than one poll, so a probe that blinks does not skip a capture that is still on screen.
 */
export function snipCancelled(input: {
  sawOverlay: boolean; overlayNow: boolean; imageChanged: boolean; quietPolls: number;
}): boolean {
  return input.sawOverlay && !input.overlayNow && !input.imageChanged && input.quietPolls >= QUIET_POLLS;
}

export type SnipWait = 'image' | 'timeout' | 'cancel';

/** Polls until a different image is on the clipboard, the capture is cancelled, or the wait runs out. */
export async function waitForNewImage(opts: {
  before: string | null;
  read: () => string | null | Promise<string | null>;
  overlay?: () => Promise<boolean> | boolean;
  sleep: (ms: number) => Promise<void>;
  cancelled?: () => boolean;
  timeoutMs?: number;
  intervalMs?: number;
  now?: () => number;
}): Promise<SnipWait> {
  const timeoutMs = opts.timeoutMs ?? SNIP_WAIT_MS;
  const intervalMs = opts.intervalMs ?? 250;
  const now = opts.now ?? Date.now;
  const start = now();
  let saw = false;
  let quiet = 0;
  let last = start;
  let stuck = 0;
  for (;;) {
    if (imageChanged(opts.before, await opts.read())) return 'image';
    if (opts.cancelled?.()) return 'cancel';
    if (opts.overlay) {
      let up: boolean | null = null;
      try {
        up = await opts.overlay();
      } catch {
        up = null;
      }
      if (imageChanged(opts.before, await opts.read())) return 'image';
      if (up === true) {
        saw = true;
        quiet = 0;
      } else if (up === false && snipCancelled({
        sawOverlay: saw, overlayNow: false, imageChanged: false, quietPolls: quiet + 1,
      })) {
        return 'cancel';
      } else if (up === false && saw) {
        quiet += 1;
      }
    }
    if (now() - start >= timeoutMs) {
      return imageChanged(opts.before, await opts.read()) ? 'image' : 'timeout';
    }
    await opts.sleep(intervalMs);
    const t = now();
    // A clock that does not move must not spin forever.
    if (t === last) {
      stuck += 1;
      if (stuck > 5) return imageChanged(opts.before, await opts.read()) ? 'image' : 'timeout';
    } else {
      stuck = 0;
    }
    last = t;
  }
}

/** Where Snipaste is usually installed. No setting: these are the only places we look. */
export function snipasteCandidates(roots: {
  localAppData?: string | undefined;
  programFiles?: string | undefined;
  programFilesX86?: string | undefined;
}): string[] {
  const out: string[] = [];
  const local = trimSlash(roots.localAppData);
  const programs = trimSlash(roots.programFiles);
  const x86 = trimSlash(roots.programFilesX86);
  if (local) out.push(`${local}\\Programs\\Snipaste\\Snipaste.exe`);
  if (programs) out.push(`${programs}\\Snipaste\\Snipaste.exe`);
  if (x86) out.push(`${x86}\\Snipaste\\Snipaste.exe`);
  return out;
}

function trimSlash(path: string | undefined): string {
  return path?.replace(/[\\/]+$/, '') ?? '';
}

/**
 * Constant PowerShell. The mode arrives as the env var LOLPING_KEY (`f1` or `paste`). Paste moves the caret to the
 * end first, so a selected prompt is not replaced, then Ctrl+V. Enter is not in the script.
 */
export function snipKeyScript(): string {
  const f1 = hex(VK.f1);
  const end = hex(VK.end);
  const ctrl = hex(VK.control);
  const v = hex(VK.v);
  return [
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class LolPingKey {',
    '  [DllImport("user32.dll")]',
    '  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);',
    '}',
    '"@',
    '$up = 2',
    'function Tap([byte]$k) {',
    '  [LolPingKey]::keybd_event($k, 0, 0, [UIntPtr]::Zero)',
    '  Start-Sleep -Milliseconds 30',
    '  [LolPingKey]::keybd_event($k, 0, $up, [UIntPtr]::Zero)',
    '}',
    'function Down([byte]$k) { [LolPingKey]::keybd_event($k, 0, 0, [UIntPtr]::Zero) }',
    'function Up([byte]$k) { [LolPingKey]::keybd_event($k, 0, $up, [UIntPtr]::Zero) }',
    `if ($env:LOLPING_KEY -eq 'f1') { Tap ${f1} }`,
    `elseif ($env:LOLPING_KEY -eq 'paste') {`,
    `  Tap ${end}`,
    `  Down ${ctrl}`,
    `  Tap ${end}`,
    `  Up ${ctrl}`,
    '  Start-Sleep -Milliseconds 40',
    `  Down ${ctrl}`,
    `  Tap ${v}`,
    `  Up ${ctrl}`,
    '}',
  ].join('\n');
}

/** The virtual keys a paste uses. Enter is not one of them. */
export function pasteKeyCodes(): readonly number[] {
  return [VK.end, VK.control, VK.end, VK.control, VK.v];
}

export function keysIncludeEnter(codes: readonly number[]): boolean {
  return codes.includes(VK.enter);
}

function hex(vk: number): string {
  return `0x${vk.toString(16)}`;
}
