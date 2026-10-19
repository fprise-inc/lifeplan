// 上の帯に出す札と通知を決める（画面の部品から切り離した決まり。テストで確かめる）。
// ふだんは何も出さない。出すのは:
//   札（急ぎ）: 保存に失敗した・閲覧だけで保存しない・ほかの人が開いていて自動保存を止めている・この世帯をAIと共有中
//   通知（行動を求める）: 復元キーの保管・ほかの人が開いている・復元キーで加わった人
import type { SaveState } from "../store/autosave.ts";

export interface BarInputs {
  /** 世帯を開いている */
  opened: boolean;
  /** 開いているのが保存した世帯 */
  stored: boolean;
  save: SaveState;
  /** ほかの人が開いているので、自動保存を止めている */
  paused: boolean;
  /** この世帯をAIと共有中 */
  aiSharing: boolean;
  /** 復元キーを保管していない（事務所で共有しているときは事務所の復元キー） */
  recoveryDue: null | "own" | "office";
  /** 復元キーで加わった人の表示名（まだ見ていない通知） */
  joined: readonly string[];
  /** 開いている人の文（ほかの人が開いていないときは null） */
  presence: string | null;
  /** 保存の失敗の文（失敗の符号 → 文） */
  message: (code: string) => string;
}

export type AlertKind = "saveError" | "readOnly" | "paused" | "aiSharing";
export type NoticeKind = "recovery" | "presence" | "joined";

export interface AlertSpec {
  kind: AlertKind;
  text: string;
  /** 帯が狭いときの短い文 */
  short: string;
  title: string;
  tone: "err" | "warn" | "ai";
}

export interface NoticeSpec {
  kind: NoticeKind;
  text: string;
  action: string;
}

export function barAlerts(i: BarInputs): AlertSpec[] {
  const out: AlertSpec[] = [];
  if (i.opened && i.stored) {
    if (i.paused) out.push({ kind: "paused", text: "自動保存を止めています", short: "保存停止中", title: "ほかの人がこの世帯を開いているため、「編集を始める」を押すまでこの画面の変更は保存しません", tone: "warn" });
    else if (i.save.kind === "error" && i.save.code === "E_STORE_READ_ONLY") out.push({ kind: "readOnly", text: "閲覧だけ（保存しません）", short: "閲覧だけ", title: i.message(i.save.code), tone: "warn" });
    else if (i.save.kind === "error") out.push({ kind: "saveError", text: "保存できませんでした", short: "保存の失敗", title: i.message(i.save.code), tone: "err" });
  }
  if (i.opened && i.aiSharing) out.push({ kind: "aiSharing", text: "AIと共有中", short: "AI共有", title: "この世帯をAIに渡しています（縮約版・期限つき）。押すと、同意と共有の画面を開きます", tone: "ai" });
  return out;
}

export function barNotices(i: BarInputs): NoticeSpec[] {
  const out: NoticeSpec[] = [];
  if (i.recoveryDue !== null) out.push({ kind: "recovery", text: i.recoveryDue === "office" ? "事務所の復元キーを保管してください" : "復元キーを保管してください", action: "復元キー" });
  if (i.opened && i.stored && i.presence !== null) out.push({ kind: "presence", text: i.presence, action: "編集を始める" });
  if (i.joined.length > 0) out.push({ kind: "joined", text: `復元キーで${i.joined.map((n) => `${n}さん`).join("・")}が加わりました`, action: "事務所の共有" });
  return out;
}

/** 世帯の選択のメニューに出す保存の状態の文 */
export function saveText(stored: boolean, st: SaveState, message: (code: string) => string, paused = false): { text: string; cls: string } {
  if (!stored) return { text: "保存していません（見本・新しい世帯は、「この世帯を保存」で保存できます）", cls: "unsaved" };
  if (paused) return { text: "ほかの人が開いているため、編集を始めるまで保存しません", cls: "unsaved" };
  if (st.kind === "pending" || st.kind === "saving") return { text: "保存しています…", cls: "" };
  if (st.kind === "error") return { text: message(st.code), cls: "err" };
  if (st.kind === "saved") {
    const d = new Date(st.at);
    return { text: Number.isNaN(d.getTime()) ? "自動で保存しています（保存済み）" : `自動で保存しています（${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} に保存）`, cls: "" };
  }
  return { text: "自動で保存しています", cls: "" };
}
