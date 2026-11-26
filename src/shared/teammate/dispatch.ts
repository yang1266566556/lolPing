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

/** Stable ids for the five prompts offered while the teammate is asking what you need. Not the visible label. */
export const CODEX_PROMPT_IDS = ['page', 'debug', 'explain', 'clearer', 'asked'] as const;
export type CodexPromptId = (typeof CODEX_PROMPT_IDS)[number];

export function isCodexPromptId(v: unknown): v is CodexPromptId {
  return typeof v === 'string' && (CODEX_PROMPT_IDS as readonly string[]).includes(v);
}

/** The chips on the record card. Only while On My Way is waiting for a reply that will open Codex. */
export function waitingPrompts(waiting: boolean): readonly CodexPromptId[] | null {
  return waiting ? CODEX_PROMPT_IDS : null;
}

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

/** Where a signal goes while Open in Codex desktop is on. `ask` waits on the card; chips are only for Codex. */
export type SignalRoute =
  | { to: 'codex'; reply: boolean }
  | { to: 'chatgpt'; reply: boolean }
  | { to: 'save' }
  | { to: 'ask'; for: 'codex' | 'chatgpt' };

/**
 * On My Way opens Codex. Bait is saved locally. Generic waits until the words are a real question, then opens ChatGPT.
 * Every other signal already names its task, so it opens ChatGPT at once. A reply keeps the wait it is answering.
 */
export function signalRoute(input: {
  ping: PingId;
  words: string | null;
  /** The wait this ask continues, when it is on that same thread. */
  waiting: 'codex' | 'chatgpt' | null;
}): SignalRoute {
  if (input.waiting === 'codex') return { to: 'codex', reply: true };
  if (input.waiting === 'chatgpt' && input.ping === 'generic') {
    return isClearRequest(input.words) ? { to: 'chatgpt', reply: true } : { to: 'ask', for: 'chatgpt' };
  }
  if (input.ping === 'omw') {
    return isClearRequest(input.words) ? { to: 'codex', reply: false } : { to: 'ask', for: 'codex' };
  }
  if (input.ping === 'bait') return { to: 'save' };
  if (input.ping === 'generic') {
    return isClearRequest(input.words) ? { to: 'chatgpt', reply: false } : { to: 'ask', for: 'chatgpt' };
  }
  return { to: 'chatgpt', reply: false };
}

/**
 * Ping first, on the Codex path only. Open Codex desktop after the user replies, or when On My Way already carried a
 * clear request. A clear request is acknowledged, then On My Way as the app opens. A reply is On My Way only.
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
  /**
   * The full instruction of a chip the user tapped. It leads the prompt. Absent for a typed reply or another ping,
   * which stay a look at the signal with no task added.
   */
  instruction?: string;
}

/**
 * What Codex's composer is filled with. It points at the saved screen and the ping thread.
 * It does not name a task the user did not say, and it does not tell Codex to answer only with lolPing's tools.
 */
function contextLines(input: DesktopContext): string[] {
  const lines = [
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
  return lines;
}

export function codexDesktopPrompt(input: DesktopContext): string {
  const context = contextLines(input);
  const instruction = input.instruction?.trim() ?? '';
  // A chosen prompt is the task. Anything else stays a look at the signal, with no task added on.
  if (instruction !== '') return [instruction, '', ...context].join('\n');
  return [
    'Look at this signal. Do not invent a task.',
    '',
    ...context,
    '',
    'Continue from what the user said. If they have not said what they want, ask them. Do not invent a task.',
  ].join('\n');
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

/** How long a chatgpt.com link may be. Readable text is cut first, then the selection, so the instruction stays. */
export const CHATGPT_URL_MAX = 12_000;

const CONTROL = /[\u0000-\u001f]/;

const stripControls = (s: string): string => s.replace(/[\u0000-\u001f]/g, '');

/** What ChatGPT's composer is filled with. The page is text, because the website cannot read a local file. */
export interface WebContext {
  /** The signal's task: the user's override, or the built-in instruction for this language. */
  instruction: string;
  /** Words typed with the signal or in the reply box. Left out when there are none. */
  words: string | null;
  /** They are on the website, and cannot ping or edit the screen. */
  framing: string;
  app: string;
  title: string;
  selection: string;
  /** Readable text at the spot. */
  text: string;
  conversation: readonly PingLine[];
  /** The thread so far. Push includes it; other signals pass an empty list. */
  earlier: readonly PingLine[];
}

const clipField = (s: string): string => stripControls(s).trim();

function turnLine(turn: PingLine): string {
  const who = turn.who === 'user' ? 'User' : 'Teammate';
  return `- ${who} (${turn.ping}): ${stripControls(turn.text).replace(/\s+/g, ' ').trim()}`;
}

function webLines(input: WebContext): string[] {
  const lines: string[] = [];
  const add = (label: string, value: string): void => {
    const t = clipField(value);
    if (t) lines.push(`${label}: ${t}`);
  };
  add('App', input.app);
  add('Window title', input.title);
  add('Selected text', input.selection);
  add('Readable text', input.text);
  if (input.earlier.length > 0) {
    lines.push('', 'Earlier conversation:');
    for (const turn of input.earlier) lines.push(turnLine(turn));
  }
  if (input.conversation.length > 0) {
    lines.push('', 'Ping conversation:');
    for (const turn of input.conversation) lines.push(turnLine(turn));
  }
  return lines;
}

/** Instruction, then the user's words, then the framing, then the page. Empty fields are left out. */
export function chatgptPrompt(input: WebContext): string {
  const instruction = clipField(input.instruction);
  const words = input.words === null ? '' : clipField(input.words);
  const parts = [instruction];
  if (words) parts.push(words);
  const framing = clipField(input.framing);
  if (framing) parts.push(framing);
  const context = webLines(input);
  if (context.length > 0) parts.push(context.join('\n'));
  return parts.filter((p) => p !== '').join('\n\n');
}

/** `https://chatgpt.com/?q=...`, with `hints=search` only for Need Vision. The composer is filled in, not sent. */
export function chatgptUrl(prompt: string, search: boolean): string {
  const q = encodeURIComponent(stripControls(prompt));
  return search ? `https://chatgpt.com/?hints=search&q=${q}` : `https://chatgpt.com/?q=${q}`;
}

/**
 * The link for this page. Readable text is shortened first, then the selection, until the URL fits.
 * The instruction is never removed.
 */
export function chatgptLink(input: WebContext & { search: boolean }): { prompt: string; url: string } {
  let selection = input.selection;
  let text = input.text;
  const build = (): { prompt: string; url: string } => {
    const prompt = chatgptPrompt({ ...input, selection, text });
    return { prompt, url: chatgptUrl(prompt, input.search) };
  };
  let link = build();
  const shorten = (s: string): string => {
    const chars = [...s];
    if (chars.length <= 80) return '';
    return `${chars.slice(0, Math.ceil(chars.length * 0.6)).join('')}…`;
  };
  let guard = 0;
  while (link.url.length > CHATGPT_URL_MAX && text !== '' && guard < 40) {
    text = shorten(text);
    link = build();
    guard += 1;
  }
  while (link.url.length > CHATGPT_URL_MAX && selection !== '' && guard < 80) {
    selection = shorten(selection);
    link = build();
    guard += 1;
  }
  return link;
}

/** A chatgpt.com link this app built: only `q`, and `hints=search` when that was the task. */
export function isChatgptUrl(url: string): boolean {
  if (url.length > CHATGPT_URL_MAX || CONTROL.test(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'chatgpt.com') return false;
  if (parsed.pathname !== '/' && parsed.pathname !== '') return false;
  if (parsed.username !== '' || parsed.password !== '' || parsed.hash !== '') return false;
  const q = parsed.searchParams.get('q');
  if (q === null || q.trim() === '') return false;
  const keys = [...parsed.searchParams.keys()];
  const hints = parsed.searchParams.get('hints');
  if (hints === null) return keys.length === 1 && keys[0] === 'q';
  return hints === 'search' && keys.length === 2 && keys.includes('q') && keys.includes('hints');
}

/** A Codex desktop link or a ChatGPT website link this app built. A random https URL is not. */
export function isDispatchUrl(url: string): boolean {
  return isCodexDesktopUrl(url) || isChatgptUrl(url);
}

const SAVED_TITLE_MAX = 80;
const SAVED_SUMMARY_MAX = 280;

function firstLine(s: string, max: number): string {
  const raw = s.split(/\r?\n/).map((row) => stripControls(row).trim()).find((row) => row !== '') ?? '';
  const chars = [...raw];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max).join('')}…`;
}

/**
 * A title for Save for later, with no model: the window title, or the start of the selected or readable text.
 * Empty when none of those has text; the caller uses the signal's own label then.
 */
export function savedSpotTitle(input: { windowTitle: string; selection: string; text: string }): string {
  return firstLine(input.windowTitle, SAVED_TITLE_MAX)
    || firstLine(input.selection, SAVED_TITLE_MAX)
    || firstLine(input.text, SAVED_TITLE_MAX);
}

/** A short summary of the spot: the selection, or the readable text when nothing is selected. */
export function savedSpotSummary(selection: string, text: string): string {
  return firstLine(selection, SAVED_SUMMARY_MAX) || firstLine(text, SAVED_SUMMARY_MAX);
}
