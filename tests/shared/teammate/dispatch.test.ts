import { describe, expect, it } from 'vitest';
import {
  absoluteFolder, CHATGPT_URL_MAX, chatgptLink, chatgptPrompt, chatgptUrl, CODEX_PROMPT_IDS, codexDesktopPrompt,
  codexDesktopUrl, desktopPings, dispatchProfile, isChatgptUrl, isClearRequest, isCodexDesktopUrl, isDispatchUrl,
  savedSpotSummary, savedSpotTitle, signalRoute, waitingPrompts,
} from '../../../src/shared/teammate/dispatch';
import type { PingId } from '../../../src/shared/pings';
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

describe('signalRoute', () => {
  const web: PingId[] = [
    'danger', 'push', 'allin', 'assist', 'needvision', 'missing', 'enemyvision', 'visioncleared', 'missingflip',
  ];

  it('sends On My Way to Codex, Bait to history, and the other signals to ChatGPT', () => {
    expect(signalRoute({ ping: 'omw', words: null, waiting: null })).toEqual({ to: 'ask', for: 'codex' });
    expect(signalRoute({ ping: 'omw', words: 'fix the null check', waiting: null })).toEqual({
      to: 'codex', reply: false,
    });
    expect(signalRoute({ ping: 'omw', words: 'hi', waiting: 'codex' })).toEqual({ to: 'codex', reply: true });
    expect(signalRoute({ ping: 'bait', words: null, waiting: null })).toEqual({ to: 'save' });
    expect(signalRoute({ ping: 'generic', words: null, waiting: null })).toEqual({ to: 'ask', for: 'chatgpt' });
    expect(signalRoute({ ping: 'generic', words: 'hi', waiting: 'chatgpt' })).toEqual({ to: 'ask', for: 'chatgpt' });
    expect(signalRoute({ ping: 'generic', words: 'what does this mean', waiting: null })).toEqual({
      to: 'chatgpt', reply: false,
    });
    expect(signalRoute({ ping: 'generic', words: 'what does this mean', waiting: 'chatgpt' })).toEqual({
      to: 'chatgpt', reply: true,
    });
    for (const ping of web) {
      expect(signalRoute({ ping, words: null, waiting: null })).toEqual({ to: 'chatgpt', reply: false });
    }
  });

  it('keeps the Codex chips off while a Generic question is still waiting', () => {
    const generic = signalRoute({ ping: 'generic', words: null, waiting: null });
    const omw = signalRoute({ ping: 'omw', words: null, waiting: null });
    expect(generic).toEqual({ to: 'ask', for: 'chatgpt' });
    expect(omw).toEqual({ to: 'ask', for: 'codex' });
    expect(waitingPrompts(generic.to === 'ask' && generic.for === 'codex')).toBeNull();
    expect(waitingPrompts(omw.to === 'ask' && omw.for === 'codex')).toEqual([...CODEX_PROMPT_IDS]);
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

  it('puts a chosen prompt first, then the page, and keeps the short label in the conversation', () => {
    const prompts = strings('en').teammate.ui.prompts;
    const withChip = codexDesktopPrompt({
      ...scene,
      instruction: prompts.page.body,
      conversation: [
        { who: 'user', ping: 'generic', text: 'Look here' },
        { who: 'teammate', ping: 'generic', text: 'I see it. What do you need?' },
        { who: 'user', ping: 'generic', text: prompts.page.label },
      ],
    });
    expect(withChip.startsWith(prompts.page.body)).toBe(true);
    expect(withChip.indexOf(prompts.page.body)).toBeLessThan(withChip.indexOf(OVERVIEW));
    expect(withChip).toContain(ZOOM);
    expect(withChip).toContain(RECORD);
    expect(withChip).toContain(`User (generic): ${prompts.page.label}`);
    expect(withChip).not.toContain('Look at this signal. Do not invent a task.');
    expect(withChip.toLowerCase()).not.toContain('fix the bug');
  });
});

describe('waiting prompts', () => {
  it('offers the five ids only while Codex is waiting, in both languages', () => {
    expect(waitingPrompts(true)).toEqual([...CODEX_PROMPT_IDS]);
    expect(waitingPrompts(false)).toBeNull();
    const en = strings('en').teammate.ui.prompts;
    const zh = strings('zh-CN').teammate.ui.prompts;
    expect(en.page.label).toBe('What’s on this page');
    expect(en.page.body.startsWith('Look at the screenshots and the spot I marked.')).toBe(true);
    expect(en.debug.label).toBe('Debug this');
    expect(en.debug.body).toContain('Do not invent errors that are not shown.');
    expect(en.explain.label).toBe('Explain this');
    expect(en.explain.body).toContain('Do not turn it into a tutorial.');
    expect(en.clearer.label).toBe('Make this clearer');
    expect(en.clearer.body).toContain('Give the rewritten text first');
    expect(en.asked.label).toBe('Do what I asked');
    expect(en.asked.body).toContain('ask one question first');
    expect(zh.page.label).toBe('看懂这一页');
    expect(zh.page.body).toContain('不要编造屏幕上没有的东西。');
    expect(zh.debug.label).toBe('排查问题');
    expect(zh.debug.body).toContain('不要编造没出现的报错。');
    expect(zh.explain.label).toBe('解释这段');
    expect(zh.explain.body).toContain('不要展开成教程。');
    expect(zh.clearer.label).toBe('改得更好');
    expect(zh.clearer.body).toContain('直接给出改好的文本');
    expect(zh.asked.label).toBe('按我说的做');
    expect(zh.asked.body).toContain('先问一句');
    for (const id of CODEX_PROMPT_IDS) {
      expect(en[id].label).not.toBe(en[id].body);
      expect(zh[id].label).not.toBe(zh[id].body);
    }
  });

  it('opens Codex for a chip or a typed reply, and not for the question itself', () => {
    expect(desktopPings({ words: null, replying: false }).open).toBe(false);
    expect(desktopPings({ words: strings('en').teammate.ui.prompts.page.label, replying: true })).toEqual({
      open: true, pings: [{ id: 'omw', line: 'onIt' }],
    });
    expect(desktopPings({ words: 'look at the null check', replying: true }).open).toBe(true);
  });
});

describe('chatgptPrompt', () => {
  const framing = strings('en').teammate.ui.webFraming;
  const page = {
    instruction: 'Explain what is at the spot.',
    words: 'why is this null',
    framing,
    app: 'Code.exe',
    title: 'app.ts - app',
    selection: 'const x = null',
    text: 'TypeError: x is null',
    conversation: [{ who: 'user' as const, ping: 'missing' as const, text: 'Explain' }],
    earlier: [] as { who: 'user' | 'teammate'; ping: PingId; text: string }[],
  };

  it('puts the instruction first, then the words, the framing, and the page as text', () => {
    const prompt = chatgptPrompt(page);
    expect(prompt.startsWith('Explain what is at the spot.')).toBe(true);
    expect(prompt.indexOf('why is this null')).toBeGreaterThan(0);
    expect(prompt.indexOf('why is this null')).toBeLessThan(prompt.indexOf(framing));
    expect(prompt.indexOf(framing)).toBeLessThan(prompt.indexOf('Selected text: const x = null'));
    expect(prompt).toContain('App: Code.exe');
    expect(prompt).toContain('Window title: app.ts - app');
    expect(prompt).toContain('Readable text: TypeError: x is null');
    expect(prompt).toContain('User (missing): Explain');
    expect(prompt).not.toContain('signal.md');
    expect(prompt).not.toContain('overview.jpg');
    expect(prompt).not.toContain('codex-signals');
  });

  it('uses a custom instruction and leaves empty fields out', () => {
    const custom = '把文字翻译为简体中文';
    const prompt = chatgptPrompt({
      ...page, instruction: custom, words: null, selection: '', text: '', earlier: [],
    });
    expect(prompt.startsWith(custom)).toBe(true);
    expect(prompt).not.toContain('Explain what is at the spot.');
    expect(prompt).not.toContain('Selected text:');
    expect(prompt).not.toContain('Readable text:');
    expect(prompt).not.toContain('Earlier conversation:');
  });

  it('includes the earlier thread only when Push passes one', () => {
    const earlier = [{ who: 'user' as const, ping: 'generic' as const, text: 'start here' }];
    expect(chatgptPrompt({ ...page, earlier })).toContain('Earlier conversation:');
    expect(chatgptPrompt({ ...page, earlier })).toContain('User (generic): start here');
    expect(chatgptPrompt(page)).not.toContain('Earlier conversation:');
  });
});

describe('chatgptUrl', () => {
  it('encodes the prompt so an ampersand cannot cut it, and adds search only for Need Vision', () => {
    const url = chatgptUrl('Find a & b', false);
    expect(url).toBe(`https://chatgpt.com/?q=${encodeURIComponent('Find a & b')}`);
    expect(isChatgptUrl(url)).toBe(true);
    expect(new URL(url).searchParams.get('q')).toBe('Find a & b');
    const search = chatgptUrl('Look up the term', true);
    expect(search.startsWith('https://chatgpt.com/?hints=search&q=')).toBe(true);
    expect(isChatgptUrl(search)).toBe(true);
    expect(isChatgptUrl('https://example.com/?q=hi')).toBe(false);
    expect(isChatgptUrl('https://chat.openai.com/?q=hi')).toBe(false);
    expect(isChatgptUrl('https://chatgpt.com/g/abc?q=hi')).toBe(false);
    expect(isChatgptUrl('https://chatgpt.com/?q=hi&temporary-chat=true')).toBe(false);
    expect(isChatgptUrl('chatgpt://threads/new?prompt=hi')).toBe(false);
    expect(isDispatchUrl(url)).toBe(true);
    expect(isDispatchUrl('https://example.com/?q=hi')).toBe(false);
  });

  it('shortens readable text before the selection, and keeps the instruction', () => {
    const instruction = 'Translate this paragraph.';
    const selection = 'KEEP-SELECTION';
    const link = chatgptLink({
      instruction, words: null, framing: 'Stay on the page.',
      app: 'Code.exe', title: 'app.ts', selection, text: 'T'.repeat(20_000),
      conversation: [], earlier: [], search: false,
    });
    expect(link.url.length).toBeLessThanOrEqual(CHATGPT_URL_MAX);
    expect(link.prompt.startsWith(instruction)).toBe(true);
    expect(link.prompt).toContain(selection);
    expect(link.prompt).not.toContain('T'.repeat(20_000));
    expect(isChatgptUrl(link.url)).toBe(true);
  });
});

describe('savedSpotTitle', () => {
  it('uses the window title, then the selection, then the readable text', () => {
    expect(savedSpotTitle({ windowTitle: 'notes.txt', selection: 'Hello', text: 'page' })).toBe('notes.txt');
    expect(savedSpotTitle({ windowTitle: '  ', selection: 'Hello there', text: 'page' })).toBe('Hello there');
    expect(savedSpotTitle({ windowTitle: '', selection: '', text: 'the first line\nmore' })).toBe('the first line');
    expect(savedSpotSummary('Hello there', 'page')).toBe('Hello there');
    expect(savedSpotSummary('', 'page text')).toBe('page text');
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
