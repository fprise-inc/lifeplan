// AI接続口の画面の側の決まり（0014・0015）: 言葉・状態の見せ方・AIからの候補をプランにする変換。
// - 画面は本体から「同意とAIの記録」（AiHouseholdView）と状態（AiStatus）を受け取って見せるだけ。記録を書くのは本体
// - AIが書いた題名・説明・理由は、信用しない文章として文字のまま出す（HTML にしない。0016）
// - 候補の変更は、主画面の「動かす項目」（plans/items.ts）に対応するものだけをプランにする。対応しないものは取り込まない
import type { AiCandidate, AiConsentMethod, AiHouseholdView, AiProposedDiff, AiShareRecord, AiStatus } from "../../engine/host.ts";
import { ITEM_LABELS } from "../../generated/labels.ts";
import type { WorkingHousehold } from "../input/household.ts";
import type { Catalog, DiffTarget, ItemValue, MovableItem } from "../plans/items.ts";
import { savePlan, suggestName, type Values } from "../plans/plans.ts";
import { currentPeriodId, resolveKey } from "../store/readings.ts";
import { rangeText, rateInRange, type PctRange } from "../input/rateRanges.ts";

/** 本体の失敗の符号 → FP に見せる文 */
export const AI_MESSAGES: Record<string, string> = {
  E_AI_OFF: "AI接続口がオフです。事務所の設定（世帯の一覧の「AI接続口」）でオンにしてください",
  E_AI_ENDPOINT: "AI接続口の受け口を開けませんでした。アプリを起動し直してください",
  E_AI_NO_CONSENT: "外部AIへの提供の同意が記録されていない世帯は、AIに渡せません",
  E_AI_NOT_SAVED: "保存していない世帯（見本）は、AIに渡せません。世帯を保存してから使ってください",
  E_AI_ALREADY_SHARED: "この世帯はもう共有中です",
  E_AI_DURATION: "期限の選び方が違います",
  E_AI_DESTINATION: "使うAIのアプリの名前を入れてください（60文字まで）",
  E_AI_CONSENT_DATE: "日付の書き方が違います",
  E_AI_CONSENT_DATE_FUTURE: "未来の日付は記録できません",
  E_AI_CONSENT_METHOD: "同意の取り方を選んでください",
  E_AI_CONSENT_FP_CONFIRM: "説明して同意（撤回）を確かめたことの確認に印を付けてください",
  E_AI_CONSENT_COMPANY: "提供先のAIの会社を入れてください（60文字まで）",
  E_AI_CONSENT_COUNTRY: "AIの会社の所在国を入れてください（30文字まで）",
  E_AI_CONSENT_ALREADY: "すでに同意が記録されています",
  E_AI_CONSENT_NOT_GIVEN: "同意が記録されていないので、撤回は記録できません",
  E_AI_CANDIDATE_DECIDED: "この候補はもう判断済みです",
  E_AI_CANDIDATE_UNKNOWN: "この候補は見つかりません",
  E_AI_CANDIDATE_PLAN: "プランを保存できませんでした",
  E_AI_PERSIST: "記録を世帯ファイルに書けませんでした。もう一度試してください",
  E_AI_RECORDS: "同意とAIの記録が書き換えられていたため、保存を止めました",
  E_AI_CONNECTOR_MISSING: "AI接続口の実行ファイルが見つかりません",
  E_AI_DEV_BROWSER: "開発用のブラウザでは AI接続口を使えません（アプリで確かめてください）",
  E_STORE_NOT_OPEN: "世帯を開き直してください",
};

export const aiMessage = (code: string): string => AI_MESSAGES[code] ?? `AI接続口の処理に失敗しました（${code}）`;
export const codeOf = (e: unknown): string => (typeof e === "string" ? e : e instanceof Error ? e.message : "E_AI");

export const METHODS: { value: AiConsentMethod; label: string }[] = [
  { value: "paper", label: "紙の書面" },
  { value: "inPerson", label: "面談で口頭" },
  { value: "email", label: "メール" },
  { value: "hearingSheet", label: "ヒアリングシートの同意欄" },
  { value: "other", label: "その他" },
];
export const methodLabel = (m: string): string => METHODS.find((x) => x.value === m)?.label ?? m;

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

/** 日時（ISO 8601 → 2026/10/19 14:03。端末の時刻で） */
export function dateTimeText(iso: string | null | undefined): string {
  if (iso == null) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 今日（端末の日付。YYYY-MM-DD） */
export function todayText(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** 入力項目IDの短い名前。知らない ID はそのまま */
export const itemName = (id: string): string => ITEM_LABELS[id] || id;

/** 世帯の「AIとの共有」の状態（カード・上の帯の印） */
export type ShareState = "off" | "unsaved" | "none" | "refused" | "withdrawn" | "given" | "sharing";

export function shareState(status: AiStatus | null, view: AiHouseholdView | null): ShareState {
  if (view !== null && view.share !== null) return "sharing";
  if (status === null || !status.enabled) return "off";
  if (view === null || !view.saved) return "unsaved";
  if (view.consentState === "given") return "given";
  if (view.consentState === "refused") return "refused";
  if (view.consentState === "withdrawn") return "withdrawn";
  return "none";
}

export const SHARE_STATE_TEXT: Record<ShareState, { short: string; long: string }> = {
  off: { short: "AI: 使わない", long: "AI接続口はオフです（事務所の設定）。この世帯はAIに渡りません" },
  unsaved: { short: "AI: 共有しない", long: "保存していない世帯はAIに渡せません" },
  none: { short: "AI: 共有しない", long: "外部AIへの提供の同意が記録されていません。AIに渡せません" },
  refused: { short: "AI: 共有しない（同意なし）", long: "顧客は外部AIへの提供に同意しませんでした。AIに渡せません" },
  withdrawn: { short: "AI: 共有しない（撤回）", long: "顧客は外部AIへの提供の同意を撤回しました。AIに渡せません" },
  given: { short: "AI: 同意あり・共有していない", long: "同意があります。いまはAIに渡していません" },
  sharing: { short: "AI: 共有中", long: "この世帯をAIに渡しています（縮約版。期限つき）" },
};

/** 記録の読まれた回数の合計 */
export const readCount = (r: AiShareRecord): number => r.reads.reduce((n, x) => n + x.count, 0);

// ---- AIからの候補 → プラン ----

/** 候補の変更1件の見せ方と、プランにできるか */
export interface CandidateRow {
  diffId: string;
  label: string;
  from: string;
  to: string;
  /** AIが書いた理由（信用しない文章） */
  note: string | null;
  /** プランにするときの動かす項目のキー。プランにできないときは null */
  key: string | null;
  /** プランにできない理由 */
  reason: string | null;
  value: ItemValue;
}

const sameTarget = (it: DiffTarget, t: AiProposedDiff["target"]): boolean => {
  if ("plan" in t) return "plan" in it && it.plan === t.plan;
  return ("object" in it && it.object === t.object) || ("member" in it && it.member === t.object);
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const DECIMAL = /^-?\d+(\.\d+)?$/;

/** 値の箱（{value: …}）・年ごとの列の既定の値だけ（{default: …}）で来たら中身を取り出す */
const unbox = (v: unknown): unknown => {
  if (isObj(v) && "value" in v && Object.keys(v).every((k) => ["value", "state", "origin", "estimate"].includes(k))) return v.value;
  if (isObj(v) && "default" in v && Object.keys(v).length === 1) return v.default;
  return v;
};

/** AI の値を、動かす項目の値の形にする（合わなければ undefined） */
export function coerce(it: MovableItem, raw: unknown): ItemValue | undefined {
  const v = unbox(raw);
  const c = it.control;
  const num = (): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && DECIMAL.test(v) ? Number(v) : undefined);
  const rate = (): string | undefined => (typeof v === "string" && DECIMAL.test(v) ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : undefined);
  switch (c.kind) {
    case "range":
    case "age":
      return num();
    case "rate":
      return rate();
    case "toggle":
      return typeof v === "boolean" ? v : undefined;
    case "field":
      return c.field.kind === "pct" || c.field.kind === "decimal" ? rate() : num();
    case "mix":
      return Array.isArray(v) && v.every((m) => isObj(m) && typeof m.assetClass === "string" && typeof m.share === "string") ? (v as { assetClass: string; share: string }[]).map((m) => ({ assetClass: m.assetClass, share: m.share })) : undefined;
    case "shift": {
      const s = Array.isArray(v) ? v[0] : v;
      return isObj(s) && typeof s.add === "string" && typeof s.from === "string" && DECIMAL.test(s.add) ? { add: s.add, from: s.from } : undefined;
    }
  }
}

const short = (v: unknown): string => {
  const s = typeof v === "string" ? v : JSON.stringify(v) ?? "—";
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
};

/** 率の項目の入れてよい範囲（割合の欄の min・max か、率のスライダーの limit。0098）。無ければ null */
function rangeOf(it: MovableItem): PctRange | { min?: number; max?: number } | null {
  const c = it.control;
  if (c.kind === "rate") return c.limit ?? null;
  if (c.kind === "field" && c.field.kind === "pct" && (c.field.min !== undefined || c.field.max !== undefined)) return { ...(c.field.min !== undefined ? { min: c.field.min } : {}), ...(c.field.max !== undefined ? { max: c.field.max } : {}) };
  return null;
}

/** 候補の変更を、主画面の動かす項目に当てはめる（当てはまらないものは理由つきで返す） */
export function candidateRows(c: AiCandidate, wh: WorkingHousehold, cat: Catalog): CandidateRow[] {
  return c.diffs.map((d) => {
    const base = { diffId: d.id, note: d.note };
    // 当て先を正にする（0036 の9）: 欄の当て先の向き先と入力項目ID が候補と同じ欄。今までの向き先（働き方の欄は構成員など、欄の
    // 一覧の向き先）で送る AI のアプリも当てはまるよう、どちらで合っても当てはめる。候補はまだ場所（at）を持たないので、当てはまる欄が
    // 1つに決まらなければ取り込まない
    const input = wh.request.input as unknown as Record<string, unknown>;
    // 働き方の値を構成員に向けて送る候補は、その人の今の働き方の期間の欄にも当てはめる（今の働き方の年収は標準では年収〔賞与込み〕の1欄で、
    // 年収・賞与の動かす項目は働き方の期間の欄にある。0078）
    const tid = "object" in d.target ? d.target.object : null;
    const memberId = tid !== null && wh.request.input.household.members.some((m) => m.id === tid) ? tid : null;
    const period = memberId !== null && d.item?.startsWith("employment.") === true ? currentPeriodId(input, memberId) : null;
    const hits = (t: DiffTarget) => sameTarget(t, d.target) || (period !== null && sameTarget(t, { object: period }));
    const found = cat.items.filter((it) => {
      if (it.phase !== "field" || it.item !== d.item) return false;
      const r = resolveKey(it.key, input);
      return (r !== null && r.kind === "address" && hits(r.address.target as DiffTarget)) || hits(it.target);
    });
    // 同じ値を指す欄（今の働き方の期間の欄と、その期間の欄など）は1つに数える
    const placeOf = (it: MovableItem) => {
      const r = resolveKey(it.key, input);
      return r !== null && r.kind === "address" ? JSON.stringify(r.address) : it.key;
    };
    const matches = found.filter((it, i) => found.findIndex((x) => placeOf(x) === placeOf(it)) === i);
    if (matches.length !== 1) {
      return { ...base, label: itemName(d.item), from: "—", to: short(unbox(d.value)), key: null, value: null, reason: matches.length === 0 ? "「結果」の画面のプランでは動かせない項目です（取り込みません。必要なら入力で直してください）" : "対応する欄が複数あるため、取り込みません" };
    }
    const it = matches[0] as MovableItem;
    const v = coerce(it, d.value);
    const now = it.read(wh);
    if (v === undefined) return { ...base, label: it.label, from: it.text(now), to: short(unbox(d.value)), key: null, value: null, reason: "値の形がこの項目に合わないため、取り込みません" };
    const range = rangeOf(it);
    if (range !== null && typeof v === "string" && !rateInRange(v, range)) return { ...base, label: it.label, from: it.text(now), to: short(unbox(d.value)), key: null, value: null, reason: `入れてよい範囲（${rangeText(range)}）の外の値のため、取り込みません` };
    return { ...base, label: it.label, from: it.text(now), to: it.text(v), key: it.key, value: v, reason: it.same(v, now) ? "今と同じ値です" : null };
  });
}

/** プランにする値（当てはまり、今と違うものだけ） */
export function candidateValues(rows: readonly CandidateRow[]): Values {
  const out: Values = {};
  for (const r of rows) if (r.key !== null && r.reason === null) out[r.key] = r.value;
  return out;
}

/** プランの名前の例（アプリが作る。AI の題名はプランの名前に使わない） */
export function candidatePlanName(wh: WorkingHousehold, cat: Catalog, values: Values): string {
  return suggestName(wh.proposals, values, wh, cat, null);
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
