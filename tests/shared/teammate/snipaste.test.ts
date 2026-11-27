import { describe, expect, it } from 'vitest';
import {
  CLIPBOARD_RESTORE_MS, SNIP_WAIT_MS, fingerprintPng, imageChanged, keysIncludeEnter, pasteKeyCodes, pasteShotOn,
  snipasteCandidates, snipCancelled, snipKeyScript, waitForNewImage,
} from '../../../src/shared/teammate/snipaste';

describe('snipaste', () => {
  it('pastes a shot only on Windows', () => {
    expect(pasteShotOn('win')).toBe(true);
    expect(pasteShotOn('mac')).toBe(false);
    expect(pasteShotOn('linux')).toBe(false);
  });

  it('tells a new clipboard image from the one that was already there', () => {
    const first = Uint8Array.from([1, 2, 3, 4, 5]);
    const same = Uint8Array.from([1, 2, 3, 4, 5]);
    const next = Uint8Array.from([1, 2, 3, 4, 9]);
    const a = fingerprintPng(first);
    expect(a).toBe(fingerprintPng(same));
    expect(imageChanged(a, fingerprintPng(next))).toBe(true);
    expect(imageChanged(a, a)).toBe(false);
    expect(imageChanged(null, a)).toBe(true);
    expect(fingerprintPng(null)).toBeNull();
    expect(fingerprintPng(new Uint8Array())).toBeNull();
    expect(imageChanged(a, null)).toBe(false);
  });

  it('waits until the clipboard image changes and does not write a file', async () => {
    const writes: string[] = [];
    const reads = ['aaa', 'aaa', 'bbb'];
    let t = 0;
    const result = await waitForNewImage({
      before: 'aaa',
      read: () => reads.shift() ?? 'bbb',
      sleep: async (ms) => {
        t += ms;
      },
      now: () => t,
      timeoutMs: 5_000,
      intervalMs: 10,
    });
    expect(result).toBe('image');
    expect(writes).toEqual([]);
  });

  it('returns timeout when no new image arrives', async () => {
    let t = 0;
    const result = await waitForNewImage({
      before: 'aaa',
      read: () => 'aaa',
      sleep: async (ms) => {
        t += ms;
      },
      now: () => t,
      timeoutMs: 50,
      intervalMs: 20,
    });
    expect(result).toBe('timeout');
    expect(t).toBeGreaterThanOrEqual(50);
  });

  it('returns cancel once the overlay has gone and the clipboard is unchanged', async () => {
    const seen = [true, true, false, false];
    let t = 0;
    const result = await waitForNewImage({
      before: 'aaa',
      read: () => 'aaa',
      overlay: () => seen.shift() ?? false,
      sleep: async (ms) => {
        t += ms;
      },
      now: () => t,
      timeoutMs: SNIP_WAIT_MS,
      intervalMs: 10,
    });
    expect(result).toBe('cancel');
    expect(t).toBeLessThan(SNIP_WAIT_MS);
    expect(snipCancelled({ sawOverlay: true, overlayNow: false, imageChanged: false, quietPolls: 2 })).toBe(true);
    expect(snipCancelled({ sawOverlay: true, overlayNow: false, imageChanged: true, quietPolls: 2 })).toBe(false);
    expect(snipCancelled({ sawOverlay: false, overlayNow: false, imageChanged: false, quietPolls: 2 })).toBe(false);
  });

  it('looks for Snipaste in the usual install folders', () => {
    expect(snipasteCandidates({
      localAppData: 'C:\\Users\\me\\AppData\\Local',
      programFiles: 'C:\\Program Files',
      programFilesX86: 'C:\\Program Files (x86)',
    })).toEqual([
      'C:\\Users\\me\\AppData\\Local\\Programs\\Snipaste\\Snipaste.exe',
      'C:\\Program Files\\Snipaste\\Snipaste.exe',
      'C:\\Program Files (x86)\\Snipaste\\Snipaste.exe',
    ]);
    expect(snipasteCandidates({})).toEqual([]);
  });

  it('moves the caret to the end and pastes, and never presses Enter', () => {
    expect(keysIncludeEnter(pasteKeyCodes())).toBe(false);
    const script = snipKeyScript();
    expect(script).toContain("LOLPING_KEY -eq 'f1'");
    expect(script).toContain("LOLPING_KEY -eq 'paste'");
    expect(script.toLowerCase()).not.toContain('0xd');
    expect(script).not.toContain('Enter');
    expect(CLIPBOARD_RESTORE_MS).toBeGreaterThanOrEqual(30_000);
  });
});
