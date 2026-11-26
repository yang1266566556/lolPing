import { describe, expect, it } from 'vitest';
import {
  absoluteFolder, codexDesktopPrompt, codexDesktopUrl, desktopPings, dispatchProfile, isClearRequest, isCodexDesktopUrl,
} from '../../../src/shared/teammate/dispatch';
import { normalizeTeammate, type AgentProfile } from '../../../src/shared/teammate/settings';
import { strings } from '../../../src/shared/i18n';

const OVERVIEW = 'C:\\Users\\me\\AppData\\Roaming\\lolPing\\codex-signals\\ask-1\\overview.jpg';
const ZOOM = 'C:\\Users\\me\\AppData\\Roaming\\lolPing\\codex-signals\\ask-1\\zoom-1.jpg';
const RECORD = 'C:\\Users\\me\\AppData\\Roaming\\lolPing\\codex-signals\\ask-1\\signal.md';
const FOLDER = 'D:\\work\\app';

const codex = (over: Partial<AgentProfile> = {}): AgentProfile => ({
  id: 'cx', kind: 'agent', name: 'Codex', tagColor: 3, tagColorCustom: null, preset: 'codex', command: 'codex',
  customArgs: [], folder: { kind: 'fixed', path: FOLDER }, timeoutS: 300,
  dispatch: { on: true }, ...over,
});

const scene = {
  overviewPath: OVERVIEW,
  zoomPaths: [ZOOM],
  recordPath: RECORD,
  app: 'Code.exe',
  title: 'app.ts - app',
  selection: 'const x = null',
  text: 'TypeError: x is null',
  folder: FOLDER,
  conversation: [
    { who: 'user' as const, ping: 'generic' as const, text: '看一下这个空指针' },
    { who: 'teammate' as const, ping: 'generic' as const, text: '收到。' },
    { who: 'teammate' as const, ping: 'omw' as const, text: '出发了。' },
  ],
};

describe('isClearRequest', () => {
  it('treats a bare ping, a greeting, or a short word as not a request', () => {
    expect(isClearRequest(null)).toBe(false);
    expect(isClearRequest('')).toBe(false);
    expect(isClearRequest('  ')).toBe(false);
    expect(isClearRequest('hi')).toBe(false);
    expect(isClearRequest('？')).toBe(false);
    expect(isClearRequest('看看')).toBe(false);
  });

  it('treats two words, or one longer phrase, as a request the user already made', () => {
    expect(isClearRequest('fix it')).toBe(true);
    expect(isClearRequest('修一下空指针')).toBe(true);
  });
});

describe('desktopPings', () => {
  it('pings a question and does not open Codex when the first signal has no request', () => {
    expect(desktopPings({ words: null, replying: false })).toEqual({
      open: false, pings: [{ id: 'generic', line: 'seeIt' }],
    });
    expect(desktopPings({ words: 'hi', replying: false }).open).toBe(false);
  });

  it('acknowledges a clear request and then opens Codex', () => {
    expect(desktopPings({ words: 'Fix the null check', replying: false })).toEqual({
      open: true,
      pings: [{ id: 'generic', line: 'gotIt' }, { id: 'omw', line: 'onIt' }],
    });
  });

  it('opens Codex on a reply without asking again', () => {
    expect(desktopPings({ words: null, replying: true })).toEqual({
      open: true, pings: [{ id: 'omw', line: 'onIt' }],
    });
  });
});

describe('codexDesktopPrompt', () => {
  const prompt = codexDesktopPrompt(scene);

  it('points at the saved screen, the crop, the window, and the ping conversation', () => {
    expect(prompt).toContain(OVERVIEW);
    expect(prompt).toContain(ZOOM);
    expect(prompt).toContain(RECORD);
    expect(prompt).toContain('Window title: app.ts - app');
    expect(prompt).toContain('const x = null');
    expect(prompt).toContain('看一下这个空指针');
    expect(prompt).toContain('收到。');
    expect(prompt).toContain('Do not invent a task.');
  });

  it('does not invent a task or tell Codex to answer only with lolPing tools', () => {
    expect(prompt).not.toContain('answer only');
    expect(prompt.toLowerCase()).not.toContain('fix the bug');
    expect(prompt).not.toContain('This is a task to do');
  });
});

describe('codexDesktopUrl', () => {
  it('encodes the prompt and an absolute working folder', () => {
    const url = codexDesktopUrl('Look at C:\\shot.jpg\nand ask.', FOLDER);
    expect(url.startsWith('codex://threads/new?prompt=')).toBe(true);
    expect(url).toContain(encodeURIComponent('Look at C:\\shot.jpg\nand ask.'));
    expect(url).toContain(`path=${encodeURIComponent(FOLDER)}`);
    expect(url).not.toContain(' ');
    expect(isCodexDesktopUrl(url)).toBe(true);
  });

  it('leaves a relative folder out of the link', () => {
    expect(absoluteFolder('work/app')).toBeNull();
    expect(codexDesktopUrl('Look.', 'work/app')).not.toContain('path=');
    expect(absoluteFolder('/Users/me/app')).toBe('/Users/me/app');
  });
});

describe('dispatch settings', () => {
  const win = { platform: 'win', trigger: 'alt', emoteTrigger: 'ctrl' } as const;

  it('maps an old mode onto the desktop switch and leaves it off by default', () => {
    const on = normalizeTeammate({
      profiles: [{ ...codex(), dispatch: { on: true, mode: 'background' } }],
    }, win);
    expect(on.profiles[0]).toMatchObject({ dispatch: { on: true } });
    expect(dispatchProfile(on.profiles)?.id).toBe('cx');
    const off = normalizeTeammate({ profiles: [{ ...codex(), dispatch: undefined }] }, win);
    expect(off.profiles[0]).toMatchObject({ dispatch: { on: false } });
    expect(dispatchProfile(off.profiles)).toBeNull();
  });

  it('uses the question line in the current language', () => {
    expect(strings('en').teammate.ui.seeIt).toBe('I see it. What do you need?');
    expect(strings('zh-CN').teammate.ui.seeIt).toBe('看到了，要我干什么？');
  });
});
