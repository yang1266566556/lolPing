import { describe, expect, it } from 'vitest';
import { terminalArgv } from '../../../src/main/teammate/agents/openInTerminal';
import { agentPrompt } from '../../../src/shared/teammate/agents';
import {
  askWheelIds, codexDispatchArgv, codexFinalMessage, dispatchArgv, dispatchProfile, dispatchPrompt, dispatchTask, showDispatch,
} from '../../../src/shared/teammate/dispatch';
import { normalizeTeammate, type AgentProfile } from '../../../src/shared/teammate/settings';
import { normalizeSettings, overlaySettings } from '../../../src/shared/settings';
import { DEFAULT_WHEEL } from '../../../src/shared/pings';

const BRIDGE = {
  command: 'C:\\Program Files\\lolPing\\lolPing.exe',
  args: ['bridge.js'],
  env: { LOLPING_PIPE: '\\\\.\\pipe\\lolping-ab', LOLPING_ASK: 'ask-1' },
};
const ASK_DIR = 'C:\\Users\\me\\AppData\\Local\\Temp\\lolping-teammate\\ask-1';
const FOLDER = 'D:\\work\\app';

const codex = (over: Partial<AgentProfile> = {}): AgentProfile => ({
  id: 'cx', kind: 'agent', name: 'Codex', tagColor: 3, tagColorCustom: null, preset: 'codex', command: 'codex',
  customArgs: [], folder: { kind: 'fixed', path: FOLDER }, timeoutS: 300,
  dispatch: { on: true, mode: 'interactive' }, ...over,
});

describe('dispatchTask', () => {
  const task = dispatchTask({
    askDir: ASK_DIR, folder: FOLDER, words: 'Fix the null check', app: 'Code.exe', title: 'app.ts - app',
    selection: 'const x = null', text: 'TypeError: x is null',
    images: { overview: 'overview.jpg', zooms: ['zoom-1.jpg'] }, instructions: 'Be brief.',
  });

  it('says the task is to do, names the context, and names the folder to work in', () => {
    expect(task).toContain('This is a task to do');
    expect(task).toContain(`Work in ${FOLDER}.`);
    expect(task).toContain('Fix the null check');
    expect(task).toContain('App: Code.exe');
    expect(task).toContain('Window title: app.ts - app');
    expect(task).toContain('const x = null');
    expect(task).toContain('TypeError: x is null');
    expect(task).toContain(`${ASK_DIR}\\overview.jpg`);
    expect(task).toContain(`${ASK_DIR}\\zoom-1.jpg`);
    expect(task).toContain('Be brief.');
    expect(task).not.toContain('answer only');
  });

  it('still describes the ping when the user typed no words', () => {
    const bare = dispatchTask({
      askDir: '/tmp/ask', folder: '/work', words: '  ', app: 'Firefox', title: 'Issue',
      selection: '', text: '', images: { overview: 'overview.jpg', zooms: [] }, instructions: '',
    });
    expect(bare).toContain('The user pinged the thing');
    expect(bare).toContain('/tmp/ask/overview.jpg');
    expect(bare).not.toContain('Selected text');
  });
});

describe('codex dispatch argv', () => {
  const interactive = codexDispatchArgv('interactive', BRIDGE, ASK_DIR, FOLDER);
  const background = codexDispatchArgv('background', BRIDGE, ASK_DIR, FOLDER);

  it('opens interactive codex on the task, with the bridge attached', () => {
    expect(interactive[0]).not.toBe('exec');
    expect(interactive).toContain('--skip-git-repo-check');
    expect(interactive).toContain(`mcp_servers.lolping.command=${JSON.stringify(BRIDGE.command)}`);
    expect(interactive.at(-1)).toBe(dispatchPrompt(ASK_DIR, FOLDER));
    expect(interactive.at(-1)).toContain('This is a task to do');
    expect(interactive.at(-1)).not.toContain('answer only');
    expect(interactive.at(-1)).not.toContain(agentPrompt(ASK_DIR));
  });

  it('runs codex exec in the background with the task prompt, not the answer-only prompt', () => {
    expect(background.slice(0, 2)).toEqual(['exec', '--json']);
    expect(background).toContain('--skip-git-repo-check');
    expect(background.filter((a) => a.startsWith('-c')).length).toBeGreaterThanOrEqual(3);
    expect(background.at(-1)).toBe(dispatchPrompt(ASK_DIR, FOLDER));
    expect(background.at(-1)).not.toContain('answer only');
    expect(background.at(-1)).not.toContain('\n');
  });

  it('builds an interactive argv the Windows terminal line can carry', () => {
    const line = terminalArgv('win', FOLDER, 'codex.cmd', interactive);
    expect(line.verbatim).toBe(true);
    expect(line.args.join(' ')).toContain('codex.cmd');
  });

  it('has no dispatch argv for a preset that is not Codex', () => {
    expect(dispatchArgv('claude', 'interactive', BRIDGE, ASK_DIR, FOLDER)).toBeNull();
    expect(dispatchArgv('custom', 'background', BRIDGE, ASK_DIR, FOLDER)).toBeNull();
  });
});

describe('dispatch settings', () => {
  const win = { platform: 'win' as const, trigger: 'alt' as const, emoteTrigger: 'ctrl' as const };

  it('keeps dispatch off unless the saved profile turned it on', () => {
    const off = normalizeTeammate({ profiles: [{ ...codex(), dispatch: undefined }] }, win);
    expect(off.profiles[0]).toMatchObject({ dispatch: { on: false, mode: 'interactive' } });
    const on = normalizeTeammate({ profiles: [codex({ dispatch: { on: true, mode: 'background' } })] }, win);
    expect(on.profiles[0]).toMatchObject({ dispatch: { on: true, mode: 'background' } });
    expect(dispatchProfile(on.profiles)?.id).toBe('cx');
    expect(dispatchProfile(off.profiles)).toBeNull();
  });

  it('puts Dispatch on the last ask slice and leaves the ping wheel alone', () => {
    const s = normalizeSettings({
      features: { teammate: true },
      teammate: { profiles: [codex()] },
    });
    expect(s.wheel).toEqual([...DEFAULT_WHEEL]);
    expect(showDispatch(s.teammate)).toBe(true);
    const ask = overlaySettings(s).ask;
    expect(ask.wheel.slice(0, -1)).toEqual(DEFAULT_WHEEL.slice(0, -1));
    expect(ask.wheel.at(-1)).toBe('dispatch');
    expect(ask.labels.dispatch).toBe('Dispatch');
    expect(overlaySettings(s, 'zh-CN').ask.labels.dispatch).toBe('派发');
  });

  it('drops Dispatch from a saved ping wheel and click ping', () => {
    const wheel = ['dispatch', ...DEFAULT_WHEEL.slice(1)];
    const s = normalizeSettings({ wheel, clickPingId: 'dispatch' });
    expect(s.wheel).not.toContain('dispatch');
    expect(new Set(s.wheel).size).toBe(8);
    expect(s.clickPingId).toBe('generic');
  });

  it('hides the slice when the intent is switched off', () => {
    const ids = askWheelIds(DEFAULT_WHEEL, false);
    expect(ids).toEqual([...DEFAULT_WHEEL]);
    expect(askWheelIds(DEFAULT_WHEEL, true).at(-1)).toBe('dispatch');
  });
});

describe('codexFinalMessage', () => {
  it('keeps the last assistant message and ignores other events', () => {
    const out = [
      '{"type":"thread.started","thread_id":"thr_1"}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"Looking."}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"Fixed the null check."}}',
      '{"type":"turn.completed","usage":{}}',
    ].join('\n');
    expect(codexFinalMessage(out)).toBe('Fixed the null check.');
  });

  it('reads a message event and returns null when Codex only failed', () => {
    const out = '{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Done."}]}';
    expect(codexFinalMessage(out)).toBe('Done.');
    expect(codexFinalMessage('{"type":"turn.failed","error":{"message":"quota"}}')).toBeNull();
  });
});
