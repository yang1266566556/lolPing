import type { PingId } from '../pings';
import type { AgentPresetId } from './agents';
import type { AgentProfile, DispatchSettings, Profile, TeammateSettings } from './settings';

/** What an agent profile uses when it was built before this switch existed. */
export function dispatchOf(p: Pick<AgentProfile, 'dispatch'>): DispatchSettings {
  return { on: p.dispatch?.on === true };
}

/** Codex today. Another preset adds a branch in the opener and a section on its profile card. */
export function presetCanDispatch(preset: AgentPresetId | 'custom'): boolean {
  return preset === 'codex';
}

/** The first profile that can open Codex desktop and has the switch on. */
export function dispatchProfile(profiles: readonly Profile[]): AgentProfile | null {
  for (const p of profiles) {
    if (p.kind === 'agent' && presetCanDispatch(p.preset) && dispatchOf(p).on) return p;
  }
  return null;
}

/** The desktop handoff is on: the main ask pings first, then opens Codex. */
export function showDispatch(s: Pick<TeammateSettings, 'profiles'>): boolean {
  return dispatchProfile(s.profiles) !== null;
}

/** One line of the signal thread: who pinged, which ping, and the words that went with it. */
export interface PingLine {
  who: 'user' | 'teammate';
  ping: PingId;
  text: string;
}

/** The teammate's own lines. The wording lives in i18n; this only picks which one. */
export type DesktopLine = 'seeIt' | 'gotIt' | 'onIt';

export interface DesktopPing {
  id: 'generic' | 'omw';
  line: DesktopLine;
}

const VAGUE = new Set([
  '?', '??', '???', '？', '？？', 'hi', 'hello', 'hey', 'ok', 'okay', 'k',
  '嗯', '啊', '哦', '这个', '看', '看看', '看一下', 'help', '帮我', '你好',
]);

/**
 * The user already said what they want. A bare ping, a greeting, or a single short word is not a request:
 * the teammate asks instead of inventing one.
 */
export function isClearRequest(words: string | null | undefined): boolean {
  if (words == null) return false;
  const t = words.trim();
  if (t === '' || VAGUE.has(t.toLowerCase())) return false;
  if (/^[\s?？!！.。,，]+$/.test(t)) return false;
  const parts = t.split(/\s+/).filter((s) => s !== '');
  if (parts.length >= 2) return true;
  return [...t].length >= 4;
}

/**
 * Ping first. Open Codex desktop only after the user replies, or when the first signal already carried a clear request.
 * A clear request is acknowledged, then On My Way as the app opens. A reply is On My Way only: they were already asked.
 */
export function desktopPings(input: { words: string | null; replying: boolean }): { open: boolean; pings: DesktopPing[] } {
  if (input.replying) return { open: true, pings: [{ id: 'omw', line: 'onIt' }] };
  if (isClearRequest(input.words)) {
    return { open: true, pings: [{ id: 'generic', line: 'gotIt' }, { id: 'omw', line: 'onIt' }] };
  }
  return { open: false, pings: [{ id: 'generic', line: 'seeIt' }] };
}

/** An absolute directory Codex can be pointed at. A relative path is left out of the link. */
export function absoluteFolder(path: string): string | null {
  const t = path.trim();
  if (/^[A-Za-z]:[\\/]/.test(t)) return t;
  if (t.startsWith('/') && !t.startsWith('//')) return t;
  return null;
}

const TEXT_MAX = 2000;

const cut = (s: string): string => {
  const t = s.trim();
  return [...t].length <= TEXT_MAX ? t : `${[...t].slice(0, TEXT_MAX).join('')}…`;
};

export interface DesktopContext {
  /** Absolute path of the full-display screenshot. */
  overviewPath: string;
  /** Absolute paths of the crops around the signal. */
  zoomPaths: readonly string[];
  /** Absolute path of the saved record, which holds the same conversation. */
  recordPath: string;
  app: string;
  title: string;
  selection: string;
  /** Readable text at the spot. */
  text: string;
  /** The profile's working folder. Included in the link only when it is absolute. */
  folder: string;
  conversation: readonly PingLine[];
}

/**
 * What Codex's composer is filled with. It points at the saved screen and the ping thread.
 * It does not name a task the user did not say, and it does not tell Codex to answer only with lolPing's tools.
 */
export function codexDesktopPrompt(input: DesktopContext): string {
  const lines = [
    'Look at this signal. Do not invent a task.',
    '',
    `Read the record: ${input.recordPath}`,
    `Screen: ${input.overviewPath}`,
  ];
  input.zoomPaths.forEach((p, i) => lines.push(`Closer crop ${i + 1}: ${p}`));
  lines.push(`App: ${input.app}`, `Window title: ${input.title}`);
  const selection = cut(input.selection);
  const text = cut(input.text);
  if (selection) lines.push(`Selected text: ${selection}`);
  if (text) lines.push(`Readable text: ${text}`);
  const folder = absoluteFolder(input.folder);
  if (folder) lines.push(`Working folder: ${folder}`);
  lines.push('', 'Ping conversation:');
  if (input.conversation.length === 0) lines.push('- (none yet)');
  for (const turn of input.conversation) {
    const who = turn.who === 'user' ? 'User' : 'Teammate';
    lines.push(`- ${who} (${turn.ping}): ${turn.text.replace(/\s+/g, ' ').trim()}`);
  }
  lines.push(
    '',
    'Continue from what the user said. If they have not said what they want, ask them. Do not invent a task.',
  );
  return lines.join('\n');
}

/**
 * Official Codex desktop link. It prefills the composer and does not send.
 * `path` is omitted unless the working folder is an absolute directory.
 */
export function codexDesktopUrl(prompt: string, folder: string | null): string {
  const params = [`prompt=${encodeURIComponent(prompt)}`];
  const path = folder === null ? null : absoluteFolder(folder);
  if (path) params.push(`path=${encodeURIComponent(path)}`);
  return `codex://threads/new?${params.join('&')}`;
}

/** A link this app built. Anything else is not opened. */
export function isCodexDesktopUrl(url: string): boolean {
  return url.startsWith('codex://threads/new?prompt=') && url.length <= 20_000 && !/[\u0000-\u001f]/.test(url);
}
