import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createSnipaste, pngFromClipboardItems, writeClipboardSnap, type ClipboardSnap,
} from '../../../src/main/teammate/snipastePaste';
import { CLIPBOARD_RESTORE_MS, LAUNCH_SETTLE_MS } from '../../../src/shared/teammate/snipaste';

const old = Uint8Array.from([1, 2, 3, 4]);
const shot = Uint8Array.from([9, 9, 9, 9, 9]);

describe('createSnipaste', () => {
  it('sends F1, then paste, and restores the previous clipboard from memory', async () => {
    const order: string[] = [];
    const restored: ClipboardSnap[] = [];
    const sample = Uint8Array.from(old);
    let phase: 'old' | 'shot' = 'old';
    let laterMs = 0;
    const laterBox: { fn: (() => void) | null } = { fn: null };
    let t = 0;
    const snip = createSnipaste({
      platform: 'win',
      readImage: () => (phase === 'old' ? sample : shot),
      readText: () => 'note',
      restore: (snap) => {
        restored.push({ text: snap.text, image: snap.image ? new Uint8Array(snap.image) : null });
      },
      isRunning: async () => true,
      start: async () => {
        order.push('start');
        return false;
      },
      sendKeys: async (which) => {
        order.push(which);
        if (which === 'f1') phase = 'shot';
        return true;
      },
      sleep: async (ms) => {
        t += ms;
      },
      later: (ms, fn) => {
        laterMs = ms;
        laterBox.fn = fn;
      },
      now: () => t,
    });
    expect(await snip.capture(() => false)).toBe('image');
    sample[0] = 7;
    expect(await snip.paste()).toBe(true);
    snip.release();
    expect(order).toEqual(['f1', 'paste']);
    expect(restored).toEqual([]);
    expect(laterMs).toBe(CLIPBOARD_RESTORE_MS);
    laterBox.fn?.();
    expect(restored).toEqual([{ text: 'note', image: Uint8Array.from([1, 2, 3, 4]) }]);
    expect(restored[0]?.image).not.toEqual(shot);
  });

  it('starts Snipaste when it is not running, then sends F1', async () => {
    let running = false;
    const order: string[] = [];
    let phase: 'old' | 'shot' = 'old';
    let t = 0;
    const snip = createSnipaste({
      platform: 'win',
      readImage: () => (phase === 'old' ? old : shot),
      readText: () => '',
      restore: () => undefined,
      isRunning: async () => running,
      start: async () => {
        order.push('start');
        running = true;
        return true;
      },
      sendKeys: async (which) => {
        order.push(which);
        if (which === 'f1') phase = 'shot';
        return true;
      },
      sleep: async (ms) => {
        order.push(`sleep:${ms}`);
        t += ms;
      },
      later: () => undefined,
      now: () => t,
    });
    expect(await snip.capture(() => false)).toBe('image');
    expect(order[0]).toBe('start');
    expect(order).toContain(`sleep:${LAUNCH_SETTLE_MS}`);
    expect(order).toContain('f1');
  });

  it('falls back to text when the wait times out or the overlay is cancelled', async () => {
    let t = 0;
    const keys: string[] = [];
    const timed = createSnipaste({
      platform: 'win',
      readImage: () => old,
      readText: () => 'keep',
      restore: () => {
        keys.push('restore');
      },
      isRunning: async () => true,
      start: async () => false,
      sendKeys: async (which) => {
        keys.push(which);
        return true;
      },
      sleep: async (ms) => {
        t += ms;
      },
      later: () => undefined,
      now: () => t,
    });
    expect(await timed.capture(() => false)).toBe('text');
    timed.release();
    expect(keys).toEqual(['f1']);

    const seen = [true, false, false];
    const cancelled = createSnipaste({
      platform: 'win',
      readImage: () => old,
      readText: () => '',
      restore: () => undefined,
      isRunning: async () => true,
      start: async () => false,
      sendKeys: async () => true,
      overlay: async () => seen.shift() ?? false,
      sleep: async () => undefined,
      later: () => undefined,
      now: () => 0,
    });
    expect(await cancelled.capture(() => false)).toBe('text');
  });

  it('does not send F1 when Snipaste cannot be started', async () => {
    const keys: string[] = [];
    const snip = createSnipaste({
      platform: 'win',
      readImage: () => null,
      readText: () => '',
      restore: () => undefined,
      isRunning: async () => false,
      start: async () => false,
      sendKeys: async (which) => {
        keys.push(which);
        return true;
      },
      sleep: async () => undefined,
      later: () => undefined,
    });
    expect(await snip.capture(() => false)).toBe('text');
    expect(keys).toEqual([]);
  });

  it('skips the shot off Windows', async () => {
    const keys: string[] = [];
    const snip = createSnipaste({
      platform: 'mac',
      readImage: () => shot,
      readText: () => '',
      restore: () => undefined,
      isRunning: async () => true,
      start: async () => true,
      sendKeys: async (which) => {
        keys.push(which);
        return true;
      },
      sleep: async () => undefined,
      later: () => undefined,
    });
    expect(await snip.capture(() => false)).toBe('text');
    expect(await snip.paste()).toBe(false);
    expect(keys).toEqual([]);
  });

  it('reads a clipboard image from memory and writes the old one back without a path', async () => {
    const png = Uint8Array.from([1, 2, 3, 4]);
    const got = await pngFromClipboardItems([
      { types: ['text/plain'], getType: async () => 'hello' },
      {
        types: ['image/png'],
        getType: async () => ({ arrayBuffer: async () => png.buffer }),
      },
    ], (bytes) => bytes);
    expect(got).toEqual(png);
    const written: Array<Record<string, unknown>> = [];
    let cleared = 0;
    await writeClipboardSnap({ text: 'note', image: png }, {
      clear: () => {
        cleared += 1;
      },
      write: async (items) => {
        written.push(...items.map((item) => item.parts));
      },
    }, class Item {
      constructor(readonly parts: Record<string, string | Blob>) {}
    });
    expect(cleared).toBe(0);
    expect(written[0]?.['text/plain']).toBe('note');
    expect(written[0]?.['image/png']).toBeInstanceOf(Blob);
    await writeClipboardSnap({ text: '', image: null }, {
      clear: () => {
        cleared += 1;
      },
      write: async () => undefined,
    }, class Item {
      constructor(readonly parts: Record<string, string | Blob>) {}
    });
    expect(cleared).toBe(1);
  });

  it('does not write the capture to a file', () => {
    const main = readFileSync('src/main/teammate/snipastePaste.ts', 'utf8');
    const shared = readFileSync('src/shared/teammate/snipaste.ts', 'utf8');
    expect(main).not.toMatch(/writeFile|appendFile|createWriteStream/);
    expect(shared).not.toMatch(/writeFile|appendFile|createWriteStream/);
    expect(main).not.toContain('Downloads');
  });
});
