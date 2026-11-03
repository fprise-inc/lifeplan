// 上の帯に出す札と通知を決める（画面の部品から切り離した決まり。テストで確かめる）。
// 通知はお知らせの一覧（ベル。0087）の「世帯」「事務所」の種類に入る。
// ふだんは何も出さない。出すのは:
//   札（急ぎ）: 保存に失敗した・閲覧だけで保存しない・ほかの人が開いていて自動保存を止めている・この世帯をAIと共有中
//   通知（行動を求める）: 本体が返す保存先と同期の通知（復元キーの保管・復元キーで加わった人／PC・参加の申請・衝突の写し など）と、ほかの人が開いていること
// 一覧の入れ物（お知らせの一覧。0087）に入れるときの種類（世帯・事務所）・急ぎ具合・見出しも、ここで決める（文と開く画面は前のまま）
import type { StorageNotice } from "../../engine/host.ts";
import type { NoticeUrgency } from "../notices/center.ts";
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
  household?: readonly { id: string; kind: string; count?: number; plans?: number }[];
}

export type AlertKind = "saveError" | "readOnly" | "paused" | "aiSharing";
/** 通知を押したときに開く画面 */
export type NoticeTarget = "recovery" | "restore" | "storage" | "office" | "households" | "presence" | "family" | "work" | "living" | "input" | "plans";

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
  /** お知らせの一覧の種類（世帯の知らせは世帯、保存先・復元キー・事務所の共有・編集中は事務所） */
  category: "household" | "office";
  /** 急ぎ具合（本体の通知の level: alert＝重大・warn＝ふつう・info＝参考。ほかはふつう） */
  urgency: NoticeUrgency;
  /** 何があったか（一覧の見出し。文は text のまま） */
  title: string;
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

const ACTION: Record<NoticeTarget, string> = { recovery: "復元キー", restore: "復元キー", storage: "保存先", office: "事務所の共有", households: "世帯の一覧", presence: "編集を始める", family: "介護・親の項目", work: "働き方と収入", living: "基本生活費", input: "入力", plans: "プランの一覧" };

/** 開いたときの知らせの文（0035 の8） */
export function householdNoticeText(n: { kind: string; count?: number; plans?: number; amount?: number; estimates?: number }): { text: string; target: NoticeTarget; title: string } | null {
  if (n.kind === "outsideFamily")
    return { target: "family", title: "親・祖父母を世帯の外の家族にしました", text: "親・祖父母を世帯の外の家族（家計が別）にしました。年金などは世帯の収入に入らないので、結果が前と変わります。家計を1つにする期間は介護・親の項目で入れられます" };
  // 給与からの推定のままの標準報酬月額を空欄にした（0.38 の変換の段。0047 の追記 2026-10-29 の2）
  if (n.kind === "smrBlank") {
    const where = [(n.count ?? 0) > 0 ? `働き方の期間 ${n.count}件` : "", (n.plans ?? 0) > 0 ? `プランの変更 ${n.plans}件` : ""].filter((x) => x !== "").join("と");
    return { target: "work", title: "推定の標準報酬月額を空欄にしました", text: `給与から推定して書いていた標準報酬月額（${where}）を空欄にしました。空欄のときは、給与から毎年9月に決め直して計算するので、昇給が保険料と厚生年金の額に入ります（結果が前と変わることがあります）。入れた額はそのままです` };
  }
  // 人の属性（性別・学歴）で推定の数字を分けない（0.58 の変換の段。0117）
  if (n.kind === "neutralEstimates") {
    const fixed = [(n.count ?? 0) > 0 ? `${n.count}か所` : "", (n.plans ?? 0) > 0 ? `プランの変更 ${n.plans}件` : ""].filter((x) => x !== "").join("と");
    const parts = [
      "年収・賞与・パートの時給・退職一時金の目安と統計の年齢カーブを、性別・学歴で分けない全体の統計で出すようにしました。",
      fixed !== "" ? `性別・学歴で分けた年齢カーブと退職金の学歴（${fixed}）は、全体の表に直しました。` : "",
      (n.estimates ?? 0) > 0 ? `推定のままの年収・賞与・退職一時金（${n.estimates}件）は、次に入力を直したときに新しい目安で入れ直します。` : "",
      "結果が前と変わることがあります。入れた額はそのままです",
    ];
    return { target: "work", title: "推定を性別・学歴で分けないようにしました", text: parts.join("") };
  }
  // 基本生活費の「わからない」を推定にした（0.43 の変換の段。0100）
  if (n.kind === "livingUnknown") {
    const where = [(n.count ?? 0) > 0 ? `${n.count}か所` : "", (n.plans ?? 0) > 0 ? `プランの変更 ${n.plans}件` : ""].filter((x) => x !== "").join("と");
    return {
      target: "living",
      title: "基本生活費の「わからない」を推定にしました",
      text: `基本生活費の入力項目では「わからない」を使わなくなったので、「わからない」にしていた値（${where}）を推定にしました。代わりに使っていた額のまま推定の印を付けたので、結果は変わりません（統計の平均を代わりにしていた所は、今の統計の平均で計算します）`,
    };
  }
  // 「わからない」を「書類で確かめる」にし、書類で確かめる欄だけに残した（0.44 の変換の段。0041 の追記 2026-10-31）
  if (n.kind === "unknownEstimated") {
    const where = [(n.count ?? 0) > 0 ? `${n.count}か所` : "", (n.plans ?? 0) > 0 ? `プランの変更 ${n.plans}件` : ""].filter((x) => x !== "").join("と");
    return {
      target: "input",
      title: "「わからない」にしていた値を推定にしました",
      text: `「わからない」は「書類で確かめる」になり、書類で確かめる欄（住民税・退職金と企業年金の見込み額・年金の加入月数・今の住宅ローン・手術の額・今の自動車ローン）だけに残しました。ほかの欄で「わからない」にしていた値（${where}）は推定にしました。代わりに使っていた額のまま推定の印を付けたので、結果は変わりません（統計の平均を代わりにしていた所は、今の統計の平均で計算します）`,
    };
  }
  // これから買う車のローンの「書類で確かめる」を推定にした（読むときの直し。0041 の追記 2026-11-01）
  if (n.kind === "carLoanEstimated") {
    const where = [(n.count ?? 0) > 0 ? `${n.count}か所` : "", (n.plans ?? 0) > 0 ? `プランの変更 ${n.plans}件` : ""].filter((x) => x !== "").join("と");
    return { target: "input", title: "これから買う車のローンの「書類待ち」を推定にしました", text: `返済予定表で確かめるのは今返している自動車ローンだけにしたので、これから買う車のローンの条件（${where}）を推定にしました。値はそのままで、結果は変わりません` };
  }
  // 基本生活費の内訳から仕送りをなくした（読むときの知らせ。値は変えない。0106）
  if (n.kind === "livingAllowance") {
    const amount = n.amount !== undefined && n.amount > 0 ? `（月${(Math.round(n.amount / 1000) / 10).toLocaleString("ja-JP")}万円）` : "";
    return {
      target: "living",
      title: "基本生活費の内訳の「仕送り」を移してください",
      text: `基本生活費の内訳から「仕送り」をなくしました。前に入れていた仕送り${amount}は「仕送り（前の内訳）」として、そのまま計算に使っています（結果は変わりません）。子の在学中の仕送りは子ども・教育、親への仕送りは介護・親の入力項目に移し、内訳の欄を空にしてください`,
    };
  }
  // 「＋ 項目を追加」のペットをやめた（読むときの知らせ。行は変えない。0106 の追記）
  if (n.kind === "petTemplate")
    return {
      target: "living",
      title: "ペットの費用の入れ先をまとめました",
      text: `「＋ 項目を追加」のペット（えさ・医療・保険）をやめ、えさ・用品・ペット保険は毎月の生活費の「趣味・娯楽」、動物病院の費用は基本生活費の「年1回・数年に1回の支出」の「ペットの病気・けが」で入れるようにしました。前に足したペットの行${(n.count ?? 0) > 1 ? `（${n.count}件）` : ""}は、額を変えずにそのまま計算に使っています（結果は変わりません）。趣味・娯楽の目安にもえさ・用品が入っているので、重ねて数えていないか確かめてください`,
    };
  // 互換モード（移行元の数え方）の元の取り込みの記録が世帯に無いので、ファイナンシアの数え方に戻した（読むときの直し。0113 の8）
  if (n.kind === "compatibilityDropped")
    return {
      target: "plans",
      title: "移行元の数え方をやめました",
      text: "移行元の数え方に寄せた照合用の計算（互換モード）の元になった取り込みの記録が、この世帯にありませんでした。照合用の計算をやめ、ファイナンシアの数え方で計算しています（結果が前と変わることがあります）。比べ直すときは、取り込みの記録の照合から開いてください",
    };
  if (n.kind === "unresolvedDiffs") return { target: "plans", title: "読み替えられなかったプランの変更があります", text: `古い形式のプランの変更のうち ${n.count ?? 0}件を読み替えられませんでした。プランの一覧の「要確認」で確かめてください` };
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

/** 本体の通知の見出し（何があったか） */
export function storageNoticeTitle(n: StorageNotice): string {
  const personal = n.scope === "personal";
  switch (n.kind) {
    case "needsRecovery":
      return "事務所の鍵が見つかりません";
    case "recoveryNotKept":
      return "復元キーをまだ保管していません";
    case "unavailable":
      return personal ? "同期フォルダを使えません" : "共有フォルダを使えません";
    case "closed":
      return personal ? "同期フォルダを使えなくなりました" : "事務所の共有が終わりました";
    case "removed":
      return personal ? "このPCが同期フォルダから外されました" : "事務所の共有から外されました";
    case "pending":
      return "参加の承認を待っています";
    case "recoveryJoin":
      return personal ? "復元キーで PC が加わりました" : "復元キーで加わった人がいます";
    case "joinRequest":
      return "参加の申請があります";
    case "localHouseholds":
      return "まだ移していない世帯があります";
    case "syncCopies":
      return "衝突の写しがある世帯があります";
    default:
      return "保存先の通知";
  }
}

const LEVEL: Record<StorageNotice["level"], NoticeUrgency> = { alert: "critical", warn: "normal", info: "info" };

export function barNotices(i: BarInputs): NoticeSpec[] {
  const out: NoticeSpec[] = [];
  i.storage.forEach((n, k) => {
    const target = noticeTarget(n);
    // その通知を扱う画面を開いている間は出さない
    if ((target === "recovery" || target === "restore") && i.showing.recovery) return;
    if (target === "office" && i.showing.office) return;
    if (target === "storage" && i.showing.storage) return;
    out.push({ id: `${n.kind}:${k}`, target, text: storageNoticeText(n), action: ACTION[target], category: "office", urgency: LEVEL[n.level] ?? "normal", title: storageNoticeTitle(n) });
  });
  if (i.opened && i.stored && i.presence !== null) out.push({ id: "presence", target: "presence", text: i.presence, action: ACTION.presence, category: "office", urgency: "normal", title: "ほかの人がこの世帯を開いています" });
  for (const n of i.opened ? (i.household ?? []) : []) {
    const t = householdNoticeText(n);
    if (t !== null) out.push({ id: `household:${n.id}`, target: t.target, text: t.text, action: ACTION[t.target], category: "household", urgency: "normal", title: t.title });
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
