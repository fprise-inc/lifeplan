// エラーの記録（0234）。画面と本体で起きたエラーを、この PC のアプリのデータにだけ残す（本体の errlog.rs。どこにも送らない）。
// - 画面から本体へ渡すのは、種類・画面（タブの名前）・操作（決まった言葉か命令の名前）・エラーの文だけ。本体が文を削ってから残す
//   （日本語など ASCII の外の文字・引用符の中・ファイルの場所・数字を含む語を伏せる）。世帯の中身を渡す口は作らない
// - 記録する所: 画面の想定外のエラー（window の error・unhandledrejection。main.tsx）・本体の命令の失敗（engine/host.ts の invoke）・
//   計算できなかったとき（App.tsx。エラーの符号だけ）。本体が想定外に止まったときは本体が自分で残す
// - 本体がまだ用意できていないとき（起動の途中）は、少しだけ覚えておいて、用意できたら渡す

/** 画面が送れる種類（本体が止まったとき〔panic〕は本体だけが残す） */
export type ErrorKind = "screen" | "command" | "calc";

/** 画面（上のタブの名前。起動の途中は「起動」） */
export type ErrorPlace = "起動" | "入力" | "結果" | "資産と負債" | "収益不動産" | "万一のとき" | "提案書";

/** 操作（決まった言葉。本体の命令の失敗は命令の名前を添える〔commandAction〕） */
export type ErrorAction = "計算" | "数字の根拠" | "画面の処理" | `${string}（${string}）`;

export interface ErrorRecord {
  kind: ErrorKind;
  action: ErrorAction;
  message: string;
}

/** 本体が返す1件（日時は ISO の UTC） */
export interface ErrorLogEntry {
  firstAt: string;
  lastAt: string;
  count: number;
  appVersion: string;
  os: string;
  kind: string;
  kindLabel: string;
  place: string;
  action: string;
  message: string;
  line: string;
  source?: string;
}

/** 本体が返す記録（text は写す文。AI が読んだ回数と最後の日時を添える） */
export interface ErrorLogView {
  entries: ErrorLogEntry[];
  max: number;
  aiReads: { count: number; lastAt: string | null };
  text: string;
}

export const EMPTY_ERROR_LOG: ErrorLogView = { entries: [], max: 100, aiReads: { count: 0, lastAt: null }, text: "" };

/** 本体の命令の、画面に出す操作の名前（無い命令は命令の名前だけ） */
const COMMAND_LABELS: Record<string, string> = {
  compute: "計算",
  evidence: "数字の根拠",
  store_save: "世帯の保存",
  store_open: "世帯を開く",
  store_create: "世帯を作る",
  store_list: "世帯の一覧",
  store_open_previous: "前の世代で開く",
  proposal_render: "提案書を作る",
  proposal_save: "提案書の保存",
  takeaway_save: "持ち帰り用のレポートの保存",
  hearing_save: "ヒアリングシートの保存",
  hearing_open: "ヒアリングシートを開く",
  hearing_web_call: "Web のヒアリング",
  statement_open: "明細を開く",
  feedback_form_open: "フォームを開く",
};

/** 本体の命令の操作の名前（例「世帯の保存（store_save）」） */
export function commandAction(cmd: string): ErrorAction {
  return `${COMMAND_LABELS[cmd] ?? "本体の命令"}（${cmd}）`;
}

/** 記録しない命令（記録そのものの命令。失敗を記録しようとして繰り返さない） */
export const UNLOGGED_COMMANDS: ReadonlySet<string> = new Set(["error_log_add", "error_log_get", "error_log_clear", "error_log_copy"]);

/** 投げられた物から、エラーの文（本体が削る前の形。長さだけ切る） */
export function messageOf(e: unknown): string {
  let s: string;
  if (typeof e === "string") s = e;
  else if (e instanceof Error) s = `${e.name}: ${e.message}`;
  else if (e !== null && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") s = (e as { message: string }).message;
  else s = String(e);
  return s.slice(0, 2000);
}

/** window の error の知らせのうち、見分けに使う所（ErrorEvent の形） */
export interface WindowErrorLike {
  message?: string | undefined;
  filename?: string | undefined;
  lineno?: number | undefined;
  error?: unknown;
}

/** ブラウザが出す害のない ResizeObserver の知らせ（文がこのとおりのものだけ。前の「Uncaught 」と後ろの「.」は読み飛ばす） */
const RESIZE_OBSERVER = ["ResizeObserver loop completed with undelivered notifications", "ResizeObserver loop limit exceeded"];
/** 拡張機能・WebView の内部の出どころ（ファイナンシアの画面のコードではない） */
const FOREIGN_SOURCES = ["chrome-extension://", "moz-extension://", "safari-extension://", "safari-web-extension://", "webkit-masked-url://"];

const isResizeObserver = (m: string): boolean => RESIZE_OBSERVER.includes(m.trim().replace(/^Uncaught\s+/, "").replace(/^Error:\s*/, "").replace(/\.$/, ""));
/** 操作を取り消しただけの知らせ（名前が AbortError のもの） */
const isAbort = (e: unknown): boolean => e !== null && typeof e === "object" && "name" in e && (e as { name: unknown }).name === "AbortError";

/**
 * window の error で、残さない決まった形の知らせか（0234 の追記）: ResizeObserver の知らせ・出どころの分からない「Script error.」
 * （filename が空で行が0）・拡張機能や WebView の内部から来たもの・AbortError。ほかは残す（除きすぎて本当のエラーを落とさない）
 */
export function isHarmlessWindowError(e: WindowErrorLike): boolean {
  const message = e.message ?? "";
  const filename = e.filename ?? "";
  if (isResizeObserver(message) || (e.error instanceof Error && isResizeObserver(e.error.message))) return true;
  if (message.trim() === "Script error." && filename === "" && (e.lineno ?? 0) === 0) return true;
  if (FOREIGN_SOURCES.some((p) => filename.startsWith(p))) return true;
  return isAbort(e.error);
}

/** unhandledrejection で、残さない決まった形の知らせか（AbortError と ResizeObserver の知らせだけ） */
export function isHarmlessRejection(reason: unknown): boolean {
  if (isAbort(reason)) return true;
  if (typeof reason === "string") return isResizeObserver(reason);
  return reason instanceof Error && isResizeObserver(reason.message);
}

type Sink = (r: ErrorRecord & { place: ErrorPlace }) => Promise<unknown>;

let sink: Sink | null = null;
let place: ErrorPlace = "起動";
/** 本体が用意できる前のエラー（20件まで） */
const waiting: (ErrorRecord & { place: ErrorPlace })[] = [];
const MAX_WAITING = 20;

/** 今の画面（App がタブを変えたときに入れる） */
export function setErrorPlace(p: ErrorPlace): void {
  place = p;
}

/** 本体に渡す所（本体が用意できたら入れる。null で外す）。待っていたエラーを渡す */
export function setErrorSink(s: Sink | null): void {
  sink = s;
  if (s === null) return;
  for (const r of waiting.splice(0)) void s(r).catch(() => undefined);
}

/** エラーを記録する（失敗しても画面は止めない） */
export function recordError(r: ErrorRecord): void {
  const full = { ...r, place };
  if (sink === null) {
    if (waiting.length < MAX_WAITING) waiting.push(full);
    return;
  }
  void sink(full).catch(() => undefined);
}

/** 試験用: 覚えていることを捨てる */
export function resetErrorLogForTest(): void {
  sink = null;
  place = "起動";
  waiting.splice(0);
}

/** 上のタブの id から画面の名前 */
export const PLACE_OF_TAB: Record<string, ErrorPlace> = { input: "入力", main: "結果", balance: "資産と負債", rental: "収益不動産", contingency: "万一のとき", report: "提案書" };

/** この PC の時差（分。UTC より進んでいれば正） */
export const utcOffsetMinutes = (d: Date = new Date()): number => -d.getTimezoneOffset();
