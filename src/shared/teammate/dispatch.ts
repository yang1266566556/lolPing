import type { PingId } from '../pings';
import { codexMcpArgs, type AgentPresetId, type AgentRunSpec } from './agents';
import type { AgentProfile, DispatchMode, DispatchSettings, Profile, TeammateSettings } from './settings';

/** What an agent profile uses when it was built before dispatch existed. A copy, so a caller can change it. */
export function dispatchOf(p: Pick<AgentProfile, 'dispatch'>): DispatchSettings {
  return p.dispatch ? { ...p.dispatch } : { on: false, mode: 'interactive' };
}

/** Codex today. Another preset adds a branch in `dispatchArgv` and a section on its profile card. */
export function presetCanDispatch(preset: AgentPresetId | 'custom'): boolean {
  return preset === 'codex';
}

/** The first profile that can take a dispatch and has it turned on. */
export function dispatchProfile(profiles: readonly Profile[]): AgentProfile | null {
  for (const p of profiles) {
    if (p.kind === 'agent' && presetCanDispatch(p.preset) && dispatchOf(p).on) return p;
  }
  return null;
}

/** The ask wheel shows Dispatch while a profile has it on and the intent itself is not switched off. */
export function showDispatch(s: Pick<TeammateSettings, 'profiles' | 'intents'>): boolean {
  if (s.intents.dispatch?.enabled === false) return false;
  return dispatchProfile(s.profiles) !== null;
}

/**
 * The ask wheel's slices. Dispatch takes the last slice while it is on, unless the user already placed it.
 * The ping wheel is left as it is: Dispatch is not a room ping.
 */
export function askWheelIds(wheel: readonly PingId[], dispatchOn: boolean): PingId[] {
  if (!dispatchOn || wheel.includes('dispatch')) return [...wheel];
  if (wheel.length === 0) return ['dispatch'];
  return [...wheel.slice(0, -1), 'dispatch'];
}

const TEXT_MAX = 4000;
const CONTROL = /[\u0000-\u001f\u007f]/g;

const cut = (s: string): string => {
  const t = s.trim();
  return [...t].length <= TEXT_MAX ? t : `${[...t].slice(0, TEXT_MAX).join('')}…`;
};

/** Joins a file name onto a directory without assuming which slash the path uses. */
function joinPath(dir: string, name: string): string {
  if (dir.endsWith('/') || dir.endsWith('\\')) return dir + name;
  return `${dir}${dir.includes('\\') ? '\\' : '/'}${name}`;
}

export interface DispatchTaskInput {
  askDir: string;
  folder: string;
  words: string | null;
  app: string;
  title: string;
  selection: string;
  /** Readable text at the spot, already gathered. */
  text: string;
  images: { overview: string; zooms: string[] };
  instructions: string;
}

/**
 * task.md: a task to do, the context lolPing gathered, and the folder to work in.
 * Image names are files that sit in `askDir` next to this file.
 */
export function dispatchTask(input: DispatchTaskInput): string {
  const words = input.words?.trim()
    ? input.words.trim()
    : 'The user pinged the thing in the context below and wants it done.';
  const lines = [
    '# Task',
    '',
    'This is a task to do, not a question to answer with words only. Do the work.',
    `Work in ${input.folder}.`,
    '',
    '## What the user asked',
    words,
    '',
    '## Context',
    `App: ${input.app}`,
    `Window title: ${input.title}`,
  ];
  const selection = cut(input.selection);
  const text = cut(input.text);
  if (selection) lines.push('', 'Selected text:', selection);
  if (text) lines.push('', 'Readable text:', text);
  lines.push('', `Overview image: ${joinPath(input.askDir, input.images.overview)}`);
  input.images.zooms.forEach((name, i) => {
    lines.push(`Zoom ${i + 1}: ${joinPath(input.askDir, name)}`);
  });
  lines.push('', `These files are in ${input.askDir}.`);
  const instructions = input.instructions.trim();
  if (instructions) lines.push('', '## The user\'s standing instructions', instructions);
  lines.push(
    '',
    'Do the task in the working folder. When you are done, you may use the lolping tools to tell the user.',
    '',
  );
  return lines.join('\n');
}

/**
 * The first prompt Codex receives. One line, with no control characters, so a terminal can type it.
 * It points at task.md. It does not tell Codex to answer only with lolPing's tools.
 */
export function dispatchPrompt(askDir: string, folder: string): string {
  const line = `This is a task to do. Read task.md in ${askDir}, look at the images and text it names, and do the task. `
    + `Work in ${folder}.`;
  return line.replace(CONTROL, ' ');
}

/**
 * Argv for a Codex dispatch. Interactive is `codex` itself, so a terminal opens on the task.
 * Background is `codex exec --json` with the same task prompt, not the headless "answer only" prompt.
 * Both keep the lolPing bridge attached.
 */
export function codexDispatchArgv(
  mode: DispatchMode, bridge: AgentRunSpec['bridge'], askDir: string, folder: string,
): string[] {
  const mcp = ['--skip-git-repo-check', ...codexMcpArgs(bridge)];
  const prompt = dispatchPrompt(askDir, folder);
  return mode === 'background' ? ['exec', '--json', ...mcp, prompt] : [...mcp, prompt];
}

/** Argv for a dispatch, or null when this preset has none yet. */
export function dispatchArgv(
  preset: AgentPresetId | 'custom', mode: DispatchMode, bridge: AgentRunSpec['bridge'], askDir: string, folder: string,
): string[] | null {
  if (preset !== 'codex') return null;
  return codexDispatchArgv(mode, bridge, askDir, folder);
}

function textOf(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function textsOf(v: unknown): string | null {
  if (!Array.isArray(v)) return null;
  const parts: string[] = [];
  for (const part of v) {
    if (typeof part === 'string') parts.push(part);
    else if (typeof part === 'object' && part !== null && !Array.isArray(part)) {
      const t = textOf((part as Record<string, unknown>).text);
      if (t) parts.push(t);
    }
  }
  const joined = parts.join('');
  return joined.trim() === '' ? null : joined;
}

function itemText(item: unknown): string | null {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
  const o = item as Record<string, unknown>;
  if (o.type !== 'agent_message') return null;
  return textOf(o.text) ?? textOf(o.message) ?? textsOf(o.content);
}

/** One Codex `--json` line's assistant text, if this line is that message. */
function messageOn(line: string): string | null {
  const text = line.trim();
  if (!text.startsWith('{')) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  if (o.type === 'item.completed' || o.type === 'item.started') return itemText(o.item);
  if (o.type === 'agent_message') return textOf(o.text) ?? textOf(o.message) ?? textsOf(o.content);
  if (o.type === 'message' && o.role === 'assistant') return textOf(o.text) ?? textsOf(o.content);
  return null;
}

/** The last assistant message in a `codex exec --json` transcript, or null when there isn't one. */
export function codexFinalMessage(output: string): string | null {
  let last: string | null = null;
  for (const line of output.split('\n')) {
    const text = messageOn(line);
    if (text !== null) last = text.trim();
  }
  return last;
}
