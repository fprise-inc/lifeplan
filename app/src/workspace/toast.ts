// 画面の下の知らせ（toast）の種類と、出し方の決まり（0023 の追記 2026-11-10 の2）。
// ok   ＝ したことの知らせ（保存しました・ピンを外しました など）。先頭に ✓ を付ける（app.css の .toast.on:not(.warn)::before）
// warn ＝ まだ保存していない・保存しないことの注意。✓ を付けず、注意の色（帯の注意の札と同じ --est の色）で、長めに出す
// 種類は文字列から推し量らず、知らせを作るところで決める

export type ToastTone = "ok" | "warn";

export interface Toast {
  text: string;
  tone: ToastTone;
}

export const okToast = (text: string): Toast => ({ text, tone: "ok" });
export const warnToast = (text: string): Toast => ({ text, tone: "warn" });

/** 出しておく長さ（ミリ秒）。注意の知らせは文が長いので長めに出す */
export function toastMs(t: Toast): number {
  return t.tone === "warn" ? 6000 : 2600;
}

/** 知らせの入れ物の class（出していないときは "toast"） */
export function toastClass(t: Toast | null): string {
  if (t === null) return "toast";
  return t.tone === "warn" ? "toast on warn" : "toast on";
}
