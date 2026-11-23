// AI接続口の画面の側の決まり（0014・0015）: 言葉・状態の見せ方・AIからの候補をプランにする変換。
// - 画面は本体から「同意とAIの記録」（AiHouseholdView）と状態（AiStatus）を受け取って見せるだけ。記録を書くのは本体
// - AIが書いた題名・説明・理由は、信用しない文章として文字のまま出す（HTML にしない。0016）
// - 候補の変更は、主画面の「動かす項目」（plans/items.ts）に対応するものだけをプランにする。対応しないものは取り込まない
import type { AiCandidate, AiConsentMethod, AiHouseholdView, AiShareRecord, AiStatus, AiUse } from "../../engine/host.ts";
import type { WorkingHousehold } from "../input/household.ts";
import type { Catalog } from "../plans/items.ts";
import { headLetter, savePlan, suggestName, type Values } from "../plans/plans.ts";
import { fromBody } from "../store/body.ts";
import { sameJson } from "../undo/reopen.ts";
import { listDateTime, proseDateTime } from "../../dates.ts";

/** 本体の失敗の符号 → FP に見せる文 */
export const AI_MESSAGES: Record<string, string> = {
  E_AI_OFF: "AI との接続がオフです。事務所の設定（世帯の一覧の「AI との接続」）でオンにしてください",
  E_AI_ENDPOINT: "AI との接続の受け口を開けませんでした。アプリを起動し直してください",
  E_AI_NO_CONSENT: "外部AIへの提供の同意が記録されていない世帯は、AIに渡せません",
  E_AI_NOT_SAVED: "保存していない世帯（見本）は、AIに渡せません。世帯を保存してから使ってください",
  E_AI_ALREADY_SHARED: "この世帯はもう共有中です",
  E_AI_NOTES_NOT_ALLOWED: "この世帯は、メモと面談の履歴を AI に渡せません。前の版の説明で同意した世帯は、今の説明で同意を記録し直すと渡せます。同意の記録が無い世帯は、事務所の設定で「面談の記録やメモを AI で扱うことも、事務所のプライバシーポリシーに書いている」を確かめると渡せます",
  E_AI_SHARE_LIMIT: "AIに渡せるのは、共有中の世帯と合わせて50件までです。共有中の世帯を取り消してから渡してください",
  E_AI_OPEN_BY_OTHERS: "ほかの人（ほかのPC）がこの世帯を開いている間は、AIに渡せません（AIに渡した記録を書くと、相手の保存が分岐になるため）。閉じてから渡してください",
  E_AI_DURATION: "期限の選び方が違います",
  E_AI_DESTINATION: "使うAIのアプリの名前を入れてください（60文字まで）",
  E_AI_CONSENT_DATE: "日付の書き方が違います",
  E_AI_CONSENT_DATE_FUTURE: "未来の日付は記録できません",
  E_AI_CONSENT_METHOD: "同意の取り方を選んでください",
  E_AI_CONSENT_FP_CONFIRM: "説明して同意（撤回）を確かめたことの確認に印を付けてください",
  E_AI_CONSENT_ALREADY: "すでに同意が記録されています",
  E_AI_CONSENT_NOT_GIVEN: "同意が記録されていないので、撤回は記録できません",
  E_AI_CANDIDATE_DECIDED: "この候補はもう判断済みです",
  E_AI_CANDIDATE_UNKNOWN: "この候補は見つかりません",
  E_AI_CANDIDATE_PLAN: "プランを保存できませんでした",
  E_AI_CANDIDATE_BODY: "候補の中身と作ろうとした世帯が合いません。候補を開き直してください",
  E_AI_KIND: "架空の世帯かお客さまの世帯かを選んでください",
  E_AI_PERSIST: "記録を世帯ファイルに書けませんでした。もう一度試してください",
  E_AI_RECORDS: "同意とAIの記録が書き換えられていたため、保存を止めました",
  E_AI_CONNECTOR_MISSING: "AI と接続する道具の実行ファイルが見つかりません",
  E_AI_DEV_BROWSER: "開発用のブラウザでは AI との接続を使えません（アプリで確かめてください）",
  E_STORE_NOT_OPEN: "世帯を開き直してください",
};

export const aiMessage = (code: string): string => AI_MESSAGES[code] ?? `AI との接続の処理に失敗しました（${code}）`;
export const codeOf = (e: unknown): string => (typeof e === "string" ? e : e instanceof Error ? e.message : "E_AI");

export const METHODS: { value: AiConsentMethod; label: string }[] = [
  { value: "paper", label: "紙の書面" },
  { value: "inPerson", label: "面談で口頭" },
  { value: "email", label: "メール" },
  { value: "hearingSheet", label: "ヒアリングシートの同意欄" },
  { value: "other", label: "その他" },
];
export const methodLabel = (m: string): string => METHODS.find((x) => x.value === m)?.label ?? m;

/**
 * 同意を記録するときの取り方の選択肢。今の説明で取り直すとき（`renew`）は「ヒアリングシートの同意欄」を出さない
 * （シートの同意欄の文は書類に触れないので、取り直しにならない。本体も断る。0172）
 */
export const consentMethods = (renew: boolean): { value: AiConsentMethod; label: string }[] => (renew ? METHODS.filter((m) => m.value !== "hearingSheet") : METHODS);

/** その取り方で記録した同意が、書類を AI に渡すことを含むか（シートの同意欄は含まない。今の説明を見せた同意だけ含む。0172） */
export const consentCoversDocuments = (method: AiConsentMethod): boolean => method !== "hearingSheet";

export const DECISION_LABELS: Record<string, string> = { given: "同意した", refused: "同意しなかった", withdrawn: "撤回した" };

export const END_REASONS: Record<string, string> = {
  revoked: "取り消し",
  expired: "期限切れ",
  appClosed: "アプリの終了",
  consentWithdrawn: "同意の撤回",
};

/** 残り時間（例: 残り58分・残り1時間12分） */
export function remainingText(sec: number): string {
  const m = Math.max(0, Math.ceil(sec / 60));
  if (m < 60) return `残り${m}分`;
  return `残り${Math.floor(m / 60)}時間${m % 60 > 0 ? `${m % 60}分` : ""}`;
}

export const durationText = (min: number): string => (min < 60 ? `${min}分` : `${min / 60}時間`);

/** 一覧の日時（ISO 8601 → 2026/10/19 14:03。端末の時刻で。書き方は dates.ts の1か所で決める） */
export const dateTimeText = (iso: string | null | undefined): string => (iso == null ? "—" : listDateTime(iso));

/** 文の中の日時（ISO 8601 → 2026年10月19日 14:03。端末の時刻で） */
export const dateTimeProse = (iso: string | null | undefined): string => (iso == null ? "—" : proseDateTime(iso));

/** 今日（端末の日付。YYYY-MM-DD） */
export function todayText(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** 入力項目IDの短い名前。知らない ID はそのまま */
export { itemName } from "../plans/candidates.ts";

/**
 * この世帯を AI に渡せるか・その理由（0226）。判定は本体（ai_share::ai_use）の1か所で、画面は本体が返した `aiUse` を見せるだけ。
 * 本体が返さないとき（古い版・テストの代わり）だけ、同意の状態と架空の印から読む（事務所の設定は見ない＝渡せない側）
 */
export function aiUseOf(view: AiHouseholdView): AiUse {
  if (view.aiUse !== undefined) return view.aiUse;
  if (view.consentState === "given") return "consent";
  if (view.fictional === true) return "fictional";
  if (view.consentState === "refused" || view.consentState === "withdrawn") return view.consentState;
  return "none";
}

/** 書類（お名前・番号を伏せたもの）を AI に渡せるか・その理由（0157・0226。本体の ai_documents_use。返さない本体は同意の状態だけで読む） */
export function aiDocumentsUseOf(view: AiHouseholdView): AiUse {
  if (view.aiDocumentsUse !== undefined) return view.aiDocumentsUse;
  const u = aiUseOf(view);
  return u === "consent" && view.consentDocuments !== true ? "consentWithoutDocuments" : u;
}

/** メモと面談の履歴を AI に渡せるか・その理由（0249。本体の ai_notes_use。返さない本体は渡せない側） */
export const aiNotesUseOf = (view: AiHouseholdView): AiUse => view.aiNotesUse ?? "none";

/** メモと面談の履歴を渡せないときの文（0249。理由ごと） */
export const NOTES_BLOCKED_TEXT: Record<string, string> = {
  consentWithoutNotes: "この世帯の同意は、前の版の説明かヒアリングシートの同意欄でいただいたもので、面談の記録やメモを AI に渡すことは含まれていません（前の版の説明では「FPのメモは渡しません」とお伝えしています）。メモと面談の履歴を AI に渡すには、お客さまに今の説明を見せて、同意を記録し直してください。",
  none: "同意の記録が無いため、メモと面談の履歴は渡せません。今の説明で同意を記録するか、事務所の設定で「面談の記録やメモを AI で扱うことも、事務所のプライバシーポリシーに書いている」を確かめると渡せます。",
  refused: "お客さまが外部AIへの提供に「同意しない」と答えたため、メモと面談の履歴は渡せません。",
  withdrawn: "お客さまが同意を撤回したため、メモと面談の履歴は渡せません。",
};

/** 伏せる言葉の欄の文字を言葉の並びに（「、」・読点・空白・改行で区切る。保存しない） */
export function maskWords(text: string): string[] {
  return [...new Set(text.split(/[、,，\s]+/u).map((w) => w.trim()).filter((w) => w !== ""))].slice(0, 50);
}

/** その理由で AI に渡せるか */
export const aiUseAllowed = (u: AiUse): boolean => u === "consent" || u === "officePolicy" || u === "fictional";

/** 世帯の「AIとの共有」の状態（カード・上の帯の印） */
export type ShareState = "off" | "unsaved" | "none" | "refused" | "withdrawn" | "given" | "office" | "fictional" | "sharing";

export function shareState(status: AiStatus | null, view: AiHouseholdView | null): ShareState {
  if (view !== null && view.share !== null) return "sharing";
  if (status === null || !status.enabled) return "off";
  if (view === null || !view.saved) return "unsaved";
  const u = aiUseOf(view);
  if (u === "consent") return "given";
  // 架空の世帯（AIの候補から架空として作った世帯）は、同意の記録が無くても渡せる
  if (u === "fictional") return "fictional";
  // 同意の答えが無く、事務所のプライバシーポリシーを FP が確かめている（0226）
  if (u === "officePolicy") return "office";
  if (u === "refused") return "refused";
  if (u === "withdrawn") return "withdrawn";
  return "none";
}

export const SHARE_STATE_TEXT: Record<ShareState, { short: string; long: string }> = {
  off: { short: "AI: 使わない", long: "AI との接続はオフです（事務所の設定）。この世帯はAIに渡りません" },
  unsaved: { short: "AI: 共有しない", long: "保存していない世帯はAIに渡せません" },
  none: { short: "AI: 共有しない", long: "外部AIへの提供の同意が記録されていません。同意を記録するか、事務所の設定で事務所のプライバシーポリシーを確かめるまで、AIに渡せません" },
  refused: { short: "AI: 共有しない（同意なし）", long: "お客さまが外部AIへの提供に「同意しない」と答えました。事務所の設定にかかわらず、AIに渡せません" },
  withdrawn: { short: "AI: 共有しない（撤回）", long: "お客さまが外部AIへの提供の同意を撤回しました。事務所の設定にかかわらず、AIに渡せません" },
  given: { short: "AI: 同意あり・共有していない", long: "同意があります。いまはAIに渡していません" },
  office: { short: "AI: 事務所のポリシー・共有していない", long: "同意の記録はありませんが、事務所のプライバシーポリシーに沿って AI に渡せます（お客さまは「同意しない」と答えていません）。いまはAIに渡していません" },
  fictional: { short: "AI: 架空の世帯・共有していない", long: "架空の世帯なので、同意の記録が無くてもAIに渡せます。いまはAIに渡していません" },
  sharing: { short: "AI: 共有中", long: "この世帯をAIに渡しています（縮約版。期限つき）" },
};

/** AIに渡した記録の「渡したときの同意」の欄（0226。officePolicy は事務所のプライバシーポリシーで渡した記録） */
export function grantStateText(state: string): string {
  if (state === "given") return "同意あり";
  if (state === "officePolicy") return "事務所のプライバシーポリシー（同意の記録なし・お客さまは断っていない）";
  if (state === "fictional") return "架空の世帯（同意は要らない）";
  return `同意なし（${state}）`;
}

/**
 * 保存した本文から、AIに渡る現状の入力（世帯の request.input）を画面の形で取り出す（0184 の追記）。
 * 本体は保存した世帯の現状の入力を渡すので、これと画面の今の入力が違えば、画面と接続口の数字が違う。読めない本文は undefined
 */
export function savedInputOf(body: string | undefined): unknown {
  if (body === undefined) return undefined;
  try {
    return fromBody(body).wh.request.input;
  } catch {
    return undefined;
  }
}

/**
 * 共有中の帯に「保存するとAIにも反映されます」を出すか（0184 の追記）: この世帯をAIに渡していて、画面の現状の入力が保存した入力と中身で違うときだけ。
 * 自動保存を待っている間・ほかの人が開いていて保存を止めている間・保存に失敗した後のどれも同じ。プランの保存していない変更（結果のタブ）・表示の設定は、AIに渡らないので見ない
 */
export function unsavedForAi(sharing: boolean, savedInput: unknown, input: unknown): boolean {
  return sharing && savedInput !== undefined && input !== undefined && !sameJson(savedInput, input);
}

/** 記録の読まれた回数の合計 */
export const readCount = (r: AiShareRecord): number => r.reads.reduce((n, x) => n + x.count, 0);

// ---- AIからの候補 → プラン ----
// 候補の変更を動かす項目に当てはめる決まりは plans/candidates.ts（AI接続口の計算も同じ関数で当てる。0195）

export { candidateRows, candidateValues, coerce, type CandidateRow } from "../plans/candidates.ts";

/** プランの名前の例（アプリが作る。AI の題名はプランの名前に使わない） */
export function candidatePlanName(wh: WorkingHousehold, cat: Catalog, values: Values): string {
  return suggestName(wh.proposals, values, wh, cat, null);
}

/**
 * 承認待ちの候補ごとの、プランの名前の欄に出す名前（並びの順）。name は FP が欄で直した名前（直していなければ null。そのまま出す）。
 * 直していない候補は、保存したプランの文字・FP が直した名前の文字・前の候補の名前の文字を避けて名前の例を作る
 * （候補が2つ届いたら、保存する前から1つ目はプランC・2つ目はプランD。保存・捨てたあとは、残った候補で毎回作り直す）
 */
export function candidatePlanNames(wh: WorkingHousehold, cat: Catalog, list: readonly { values: Values; name: string | null }[]): string[] {
  const taken = list.flatMap((c) => {
    const l = c.name === null ? undefined : headLetter(c.name);
    return l === undefined ? [] : [l];
  });
  return list.map((c) => {
    if (c.name !== null) return c.name;
    const name = suggestName(wh.proposals, c.values, wh, cat, null, taken);
    const l = headLetter(name);
    if (l !== undefined) taken.push(l);
    return name;
  });
}

/** 候補をプランとして保存する（FP が承認したときだけ呼ぶ）。差分の出どころは AI、承認は FP の記録を持つ */
export function acceptCandidate(wh: WorkingHousehold, cat: Catalog, c: AiCandidate, values: Values, name: string, now: string): { wh: WorkingHousehold; id: string } {
  const r = savePlan(wh, cat, { name, base: null, values, now });
  const proposals = r.wh.proposals.map((p) =>
    p.id !== r.id
      ? p
      : {
          ...p,
          source: { kind: "ai" as const, candidate: c.id },
          diffs: p.diffs.map((d) => ({ ...d, origin: { kind: "ai" as const, ref: c.id, connector: c.origin.connector }, approval: { by: "fp" as const, at: now, candidate: c.id } })),
        },
  );
  return { wh: { ...r.wh, proposals }, id: r.id };
}
