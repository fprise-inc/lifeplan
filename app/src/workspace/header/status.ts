// 上の帯に出す札と通知を決める（画面の部品から切り離した決まり。テストで確かめる）。
// ふだんは何も出さない。出すのは:
//   札（急ぎ）: 保存に失敗した・閲覧だけで保存しない・ほかの人が開いていて自動保存を止めている・この世帯をAIと共有中
//   通知（行動を求める）: 本体が返す保存先と同期の通知（復元キーの保管・復元キーで加わった人／PC・参加の申請・衝突の写し など）と、ほかの人が開いていること
import type { StorageNotice } from "../../engine/host.ts";
import type { SaveState } from "../store/autosave.ts";
import { storageNoticeText } from "../store/storage.ts";

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
  /** 本体が返す保存先と同期の通知 */
  storage: readonly StorageNotice[];
  /** いま開いている画面（その画面で扱う通知は出さない） */
  showing: { recovery: boolean; office: boolean; storage: boolean };
  /** 開いている人の文（ほかの人が開いていないときは null） */
  presence: string | null;
  /** 保存の失敗の文（失敗の符号 → 文） */
  message: (code: string) => string;
  /** 開いている世帯の開いたときの知らせ（0035 の8） */
  household?: readonly { id: string; kind: string; count?: number }[];
}

export type AlertKind = "saveError" | "readOnly" | "paused" | "aiSharing";
/** 通知を押したときに開く画面 */
export type NoticeTarget = "recovery" | "restore" | "storage" | "office" | "households" | "presence" | "family" | "plans";

export interface AlertSpec {
  kind: AlertKind;
  text: string;
  /** 帯が狭いときの短い文 */
  short: string;
  title: string;
  tone: "err" | "warn" | "ai";
}

export interface NoticeSpec {
  /** 一覧の中で重ならない名前 */
  id: string;
  target: NoticeTarget;
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

const ACTION: Record<NoticeTarget, string> = { recovery: "復元キー", restore: "復元キー", storage: "保存先", office: "事務所の共有", households: "世帯の一覧", presence: "編集を始める", family: "家族のカード", plans: "プランの一覧" };

/** 開いたときの知らせの文（0035 の8） */
export function householdNoticeText(n: { kind: string; count?: number }): { text: string; target: NoticeTarget } | null {
  if (n.kind === "outsideFamily")
    return { target: "family", text: "親・祖父母を世帯の外の家族（家計が別）にしました。年金などは世帯の収入に入らないので、結果が前と変わります。家計を1つにする期間は家族のカードで入れられます" };
  if (n.kind === "unresolvedDiffs") return { target: "plans", text: `古い形式のプランの変更のうち ${n.count ?? 0}件を読み替えられませんでした。プランの一覧の「要確認」で確かめてください` };
  return null;
}

/** 本体の通知を押したときに開く画面（1人で複数の PC の同期フォルダの通知は保存先、事務所での共有の通知は事務所の共有） */
export function noticeTarget(n: StorageNotice): NoticeTarget {
  if (n.kind === "needsRecovery") return "restore";
  if (n.kind === "recoveryNotKept") return "recovery";
  if (n.kind === "syncCopies") return "households";
  if (n.kind === "localHouseholds" || n.scope !== "office") return "storage";
  return "office";
}

export function barNotices(i: BarInputs): NoticeSpec[] {
  const out: NoticeSpec[] = [];
  i.storage.forEach((n, k) => {
    const target = noticeTarget(n);
    // その通知を扱う画面を開いている間は出さない
    if ((target === "recovery" || target === "restore") && i.showing.recovery) return;
    if (target === "office" && i.showing.office) return;
    if (target === "storage" && i.showing.storage) return;
    out.push({ id: `${n.kind}:${k}`, target, text: storageNoticeText(n), action: ACTION[target] });
  });
  if (i.opened && i.stored && i.presence !== null) out.push({ id: "presence", target: "presence", text: i.presence, action: ACTION.presence });
  for (const n of i.opened ? (i.household ?? []) : []) {
    const t = householdNoticeText(n);
    if (t !== null) out.push({ id: `household:${n.id}`, target: t.target, text: t.text, action: ACTION[t.target] });
  }
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
