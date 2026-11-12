// AI接続口（crates/lifeplan）に同梱する「入力の確かめ」（check_inputs。0210）。面談の前に「お客さまに聞くこと」を作るための一覧。
// - 中身は画面の入力のタブの確かめの一覧（workspace/input/checkRows.ts の checkList。推定・書類待ち・未入力・まだ入れていない項目・
//   確かめの注意〔範囲の外の値・ほかの入力と合わない値・購入の払い方が無いなど〕・入力で直せる計算のお知らせ）と同じ行。接続口は行を選ばず、
//   画面の行に「お客さまに聞くこと」（question）と短い理由（reason）を添えるだけ
// - 聞くことの文は、下の決まりの表（RULES）で行ごとに決める。表に無い行は、種類ごとの決まりの文（FALLBACK）。決まりを足すときは RULES に1件足す
// - 計算のお知らせは、接続口が計算した結果を、画面の結果のタブと同じ関数（notices.ts）で行にして渡す
// - 画面の部品（preact）・本体の命令・保存の部品は読まない（lint とまとめる道具が止める）。世帯の物の ID は返さない
import type { EngineRequest, PreviewResult } from "../engine/types.ts";
import type { NoticeRow } from "../workspace/engineNotices.ts";
import { CHECK_KIND_LABELS, checkList, DEFAULT_KINDS, KIND_ORDER, type CheckKind, type CheckRow } from "../workspace/input/checkRows.ts";
import type { WorkingHousehold } from "../workspace/input/household.ts";
import { inputItems } from "../workspace/input/items.ts";
import { publishOfficeEstimates, readOfficeEstimates } from "../workspace/office/estimates.ts";
import { resolveTimepoint } from "../workspace/timepoint.ts";
import { KIND_SHORT, screenNoticeRows } from "./notices.ts";
import { workingOf, type WorkingArgs } from "./working.ts";

/** 接続口から渡す引数 */
export interface CheckArgs extends WorkingArgs {
  /** 出す種類（既定は画面の確かめの一覧の既定と同じ。確かさ certainty・前提条件の標準の値 premise は選んだときだけ） */
  kinds?: CheckKind[];
  /** 返す行の上限（既定 30。並びは画面の確かめの一覧と同じ: 未入力 → まだ入れていない → 書類待ち → 確かめの注意 → 計算のお知らせ → 推定〔結果に効く順〕） */
  max?: number;
}

/** 返す行の上限の既定 */
export const DEFAULT_MAX = 30;

/** 聞くことを決める材料（画面の行と、計算のお知らせの行なら元の知らせ） */
export interface CheckCtx {
  row: CheckRow;
  notice: NoticeRow | null;
}

/** 聞くことの決まり1件: 当てはまる行（id・入力項目ID・種類で選ぶ）と、短い理由・お客さまに聞く文 */
export interface CheckRule {
  /** 決まりの名前（テストと説明のため） */
  id: string;
  match: (c: CheckCtx) => boolean;
  /** 短い理由（省くと画面の行の根拠の最初の文） */
  reason?: (c: CheckCtx) => string;
  question: (c: CheckCtx) => string;
}

/** 画面の行の根拠・今の扱いの最初の文（短い理由の既定。かっこの中の「。」では切らない） */
export function firstSentence(t: string | null): string | null {
  if (t === null || t === "") return null;
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "（" || ch === "「") depth++;
    else if ((ch === "）" || ch === "」") && depth > 0) depth--;
    else if (ch === "。" && depth === 0) return t.slice(0, i);
  }
  return t;
}

/** 「〇〇の教育費」のような見出しから、人の呼び名（「〇〇」）を取る */
const whoOf = (label: string, suffix: string): string => (label.endsWith(suffix) ? label.slice(0, -suffix.length) : label);

/** 欄の見出し（「まとまり: 欄」）を、聞く文の中で使う形に（かぎかっこで囲む） */
const quoted = (label: string): string => `「${label}」`;

/** 行の id が、この前置きで始まるか */
const idStarts = (prefix: string) => (c: CheckCtx) => c.row.id.startsWith(prefix);

/** 計算のお知らせの行の対象（人・物の呼び名。無ければ空の並び） */
const subjectsOf = (c: CheckCtx): string[] => c.notice?.subjects ?? [];

/** 計算のお知らせの行の対象を文の頭に（「ご本人・配偶者の」。無ければ空） */
const forWhom = (c: CheckCtx): string => (subjectsOf(c).length > 0 ? `${subjectsOf(c).join("・")}の` : "");

/** 計算のお知らせの行の鍵（engineNotices.ts の文の表の鍵か、まとめる鍵）に、この文字が入っているか */
const noticeHas = (code: string, topic: string) => (c: CheckCtx) => c.notice !== null && c.notice.key.startsWith(`${code}|`) && c.notice.key.includes(topic);

/** 生活費を聞く文（入っていない物・まだ入れていない項目で同じ） */
const LIVING_Q = "毎月の生活費（食費・水道光熱費・通信費・日用品など。住居費・保険料・教育費を除く）は、おおよそいくらですか。";
const HOUSING_Q = "今のお住まいは賃貸ですか、持ち家ですか。毎月の住居費（家賃か住宅ローンの返済・管理費など）を教えていただけますか。";
const INSURANCE_Q = "今入っている保険（生命保険・医療保険・がん保険・学資保険など）はありますか。あれば、保険証券かご契約内容のお知らせを見せていただけますか。";
const PENSION_Q = "ねんきん定期便（かねんきんネットの画面）はお手元にありますか。あれば、見せていただけますか。";

/**
 * まだ入れていない項目（入れ始める前の入力項目）ごとの聞く文。入力項目の ID（入力のホームの入力項目）で引く。
 * 無い入力項目は、種類ごとの決まりの文
 */
export const NOT_STARTED_QUESTIONS: Readonly<Record<string, string>> = {
  family: "ご家族の構成（配偶者・お子さま・ご一緒に暮らすご家族）と、生まれた年月を教えていただけますか。",
  work: "今のお仕事（会社員・自営業など）と年収、何歳まで働くご予定かを教えていただけますか。",
  retirement: "勤め先に退職金や企業年金の制度はありますか。ある場合は、見込みの額を教えていただけますか。",
  pension: PENSION_Q,
  living: LIVING_Q,
  education: "お子さまの進学のご予定（公立か私立か、大学まで進むかなど）を教えていただけますか。",
  housing: HOUSING_Q,
  insurance: INSURANCE_Q,
  savings: "預金・NISA・iDeCo・株や投資信託などの資産と、毎月の積立の額を教えていただけますか。",
  rental: "家賃の入る不動産（貸しているマンション・駐車場など）はお持ちですか。これから持つご予定はありますか。",
  events: "これからの大きなお金の出入り（旅行・家電の買い替え・お祝い・リフォーム・一時的な収入など）のご予定はありますか。",
  car: "車はお持ちですか。これから買う・買い替えるご予定はありますか。",
  care: "親御さんの介護や仕送りなど、ご家族を支えるご予定はありますか。",
  inheritance: "親御さんなどから、相続や贈与（住宅資金・教育資金の援助を含む）を受けるご予定はありますか。",
};

/**
 * 聞くことの決まりの表（上から順に、最初に当てはまった決まりを使う）。どれも画面の行の id（入っていない物は fill.ts の gapsOf の id、
 * 確かめの注意は checkRows.ts の id、計算のお知らせは engineNotices.ts の文の表の鍵）か、欄の入力項目ID で選ぶ。
 * 決まりを足すときは、ここに1件足し、app/test/connector-check.test.ts に当たる世帯を1つ足す
 */
export const RULES: readonly CheckRule[] = [
  // ---- 入っていない物（fill.ts の gapsOf） ----
  {
    id: "educationPlan",
    match: idStarts("gap:education/"),
    question: (c) => `${whoOf(c.row.label, "の教育費")}の進学のご予定（幼稚園・小学校から大学まで、公立か私立か、自宅から通うかなど）を教えていただけますか。`,
  },
  {
    id: "retirementBenefit",
    match: idStarts("gap:work/retirement/"),
    question: (c) => `${whoOf(c.row.label, "の退職金")}の勤め先に、退職金の制度はありますか。ある場合は、見込みの額（退職金の規程や会社の資料の額）を教えていただけますか。`,
  },
  {
    id: "pensionAmounts",
    match: idStarts("gap:pension/amounts/"),
    question: (c) => `${whoOf(c.row.label, "の年金の額")}のねんきん定期便（かねんきんネット）に書かれている、老齢基礎年金と老齢厚生年金の見込みの額を教えていただけますか。`,
  },
  {
    id: "pensionMonths",
    match: idStarts("gap:pension/months/"),
    question: (c) => `${whoOf(c.row.label, "のねんきん定期便の加入月数")}のねんきん定期便に書かれている、これまでの加入月数を教えていただけますか。`,
  },
  {
    id: "unemployment",
    match: idStarts("gap:work/unemployment/"),
    question: (c) => `${c.row.label.replace(/の失業給付.*$/, "")}は、仕事を辞めた後に雇用保険の失業給付を受け取るご予定ですか。`,
  },
  { id: "livingExpense", match: (c) => c.row.id === "gap:living", question: () => LIVING_Q },
  { id: "housing", match: (c) => c.row.id === "gap:housing", question: () => HOUSING_Q },
  {
    id: "adultCare",
    match: idStarts("gap:care/"),
    question: (c) => `${whoOf(c.row.label, "の介護の費用")}の将来の介護について、備えておきたい費用や、在宅か施設かのお考えはありますか。`,
  },
  { id: "insurance", match: (c) => c.row.id === "gap:insurance", question: () => INSURANCE_Q },
  // ---- まだ入れていない項目（入れ始める前の入力項目。入力項目ごとの文） ----
  {
    id: "notStarted",
    match: (c) => c.row.id.startsWith("notStarted:") && NOT_STARTED_QUESTIONS[c.row.card] !== undefined,
    question: (c) => NOT_STARTED_QUESTIONS[c.row.card] as string,
  },
  // ---- 確かめの注意（checkRows.ts） ----
  {
    id: "unfundedPurchase",
    match: (c) => c.row.id.startsWith("notice:unfundedPurchase:") || (c.row.fieldKey ?? "").endsWith("/purchase/funding"),
    reason: () => "住宅の購入で、物件の価格から頭金を除いた分の払い方が入っていません（計算に入っていません）",
    question: () => "家を買うとき、物件の価格から頭金を除いた分は、住宅ローンを使うご予定ですか、それとも手元のお金で払うご予定ですか。住宅ローンなら、借りる額と返す年数の見込みも教えていただけますか。",
  },
  {
    id: "retirementCheck",
    match: idStarts("notice:retirement/"),
    question: (c) => `${quoted(c.row.label)}について、勤め先の退職金の制度と、見込みの額を確かめさせていただけますか。`,
  },
  {
    id: "insuranceOverlap",
    match: (c) => c.row.kind === "notice" && c.row.card === "insurance" && c.row.fieldKey === null,
    question: (c) => `${quoted(c.row.label)}について、同じ保障の保険が重なっていないか、保険証券かご契約内容のお知らせで確かめさせていただけますか。`,
  },
  {
    id: "outOfRange",
    match: (c) => c.row.kind === "notice" && (c.row.detail ?? "").startsWith("範囲（"),
    question: (c) => `${quoted(c.row.label)}は、${c.row.value ?? "今の値"}で合っていますか（入れ間違いでないかを確かめます）。`,
  },
  // ---- 計算のお知らせ（engineNotices.ts の文の表の鍵。入力で直せる物） ----
  {
    id: "pensionRecord",
    match: noticeHas("N_ESTIMATED", "pensionRecord"),
    question: (c) => `${forWhom(c)}${PENSION_Q}`,
  },
  {
    id: "retirementPaidAt",
    match: noticeHas("N_INPUT_REQUIRED", "retirementBenefit.paidAt"),
    question: () => "退職金を受け取る時期（何歳で、どの勤め先を辞めるときか）を教えていただけますか。",
  },
  {
    id: "residenceValuation",
    match: noticeHas("N_INPUT_REQUIRED", "residence.valuation"),
    question: () => "持ち家を買ったときの価格と時期（か、今の時価の目安）を教えていただけますか。",
  },
  {
    id: "landShare",
    match: (c) => c.notice !== null && c.notice.key === "landShare",
    question: (c) => `${forWhom(c)}価格のうち、土地と建物の割合は分かりますか（売買契約書や、固定資産税の通知書の評価額で分かります）。`,
  },
  {
    id: "careDefault",
    match: (c) => c.notice !== null && c.notice.key === "care.default",
    question: (c) => `${forWhom(c)}費用や期間について、見込みやお考えがあれば教えていただけますか（無ければ統計の平均のままにします）。`,
  },
  // ---- 欄（入力項目ID） ----
  {
    id: "downPayment",
    match: (c) => c.row.id.startsWith("downPayment:") || (c.row.item === "residence.purchase" && (c.row.fieldKey ?? "").endsWith("/down") && (c.row.kind === "missing" || c.row.kind === "estimated")),
    question: () => "家を買うときの頭金は、いくらくらいをお考えですか（頭金なしのご予定か、親御さんなどからの援助があればその額も）。",
  },
  {
    id: "annualIncome",
    match: (c) => (c.row.item === "employment.salary.annual" || c.row.item === "employment.business.income") && (c.row.kind === "estimated" || c.row.kind === "missing"),
    question: (c) => `${quoted(c.row.label)}は、源泉徴収票（か確定申告書）でいくらですか。`,
  },
];

/** 値のある行の「〜は、〇〇で合っていますか。」、値の無い行の「〜を教えていただけますか。」 */
const confirmOrAsk = (c: CheckCtx): string => (c.row.value !== null && c.row.value !== undefined ? `${quoted(c.row.label)}は、${c.row.value}で合っていますか。` : `${quoted(c.row.label)}を教えていただけますか。`);

/** 種類ごとの決まりの文（決まりの表に当てはまらない行） */
export const FALLBACK: Readonly<Record<CheckKind, (c: CheckCtx) => string>> = {
  missing: (c) => `${quoted(c.row.label)}を教えていただけますか。`,
  notStarted: (c) => `${c.row.cardLabel}について、今の状況やこれからのご予定で当てはまることはありますか。`,
  unknown: (c) => (c.row.doc !== undefined ? `${c.row.doc.name}をお持ちでしたら、見せていただけますか（${quoted(c.row.doc.field)}を確かめます）。` : `${quoted(c.row.label)}を、書類で確かめさせていただけますか。`),
  notice: confirmOrAsk,
  calc: (c) => `${c.row.cardLabel}${subjectsOf(c).length > 0 ? `（${subjectsOf(c).join("・")}）` : ""}について、今の内容を確かめさせていただけますか。`,
  estimated: confirmOrAsk,
  certainty: (c) => `${quoted(c.row.label)}を、書類で確かめさせていただけますか。`,
  premise: (c) => `${quoted(c.row.label)}は、標準の値のままでよろしいですか（FP が決める前提です）。`,
};

/** 入力の確かめの1行（AI に返す形） */
export interface CheckItem {
  /** 入力項目（入力のホームの入力項目の名前） */
  item: string;
  /** 欄（「まとまり: 欄」）か物の見出し。計算のお知らせの行は、画面と同じお知らせの文 */
  field: string;
  /** 今の値（言葉で。無ければ省く） */
  value?: string;
  /** 計算のお知らせの行の対象（人・物の呼び名。無ければ省く） */
  subjects?: string[];
  reason: string;
  /** お客さまに聞くこと（丁寧な言葉） */
  question: string;
  /** 当てた決まりの名前（決まりの表に無ければ省く） */
  rule?: string;
}

/** 画面の行を、AI に返す1行にする */
export function itemOf(c: CheckCtx): CheckItem {
  const rule = RULES.find((r) => r.match(c));
  const subjects = subjectsOf(c);
  // 計算のお知らせの行の理由は、お知らせの種類（画面の閉じた1行の内訳と同じ言葉）
  const calcReason = c.notice !== null ? `計算のお知らせ（${KIND_SHORT[c.notice.kind]}）` : null;
  const reason = rule?.reason?.(c) ?? calcReason ?? firstSentence(c.row.detail) ?? CHECK_KIND_LABELS[c.row.kind];
  const value = c.row.value ?? null;
  return {
    item: c.row.cardLabel,
    field: c.row.label,
    ...(value !== null ? { value } : {}),
    ...(subjects.length > 0 ? { subjects } : {}),
    reason,
    question: rule !== undefined ? rule.question(c) : FALLBACK[c.row.kind](c),
    ...(rule !== undefined ? { rule: rule.id } : {}),
  };
}

/**
 * これからの住宅の購入で、頭金が0円の物（計算の入力では頭金を省けないので、入っていない頭金は0円になる。画面の欄は0円を確定の値として
 * 見せるので、確かめの一覧には出ない）。頭金なしで買う予定か、入れていないだけかを確かめる行を、確かめの注意に入れる。
 * 計算の基準の月より前に買った家は出さない（もう払った頭金は、これからの計算に効かない）
 */
export function zeroDownPaymentRows(wh: WorkingHousehold): CheckRow[] {
  const h = wh.request.input.household;
  const base = wh.request.input.baseMonth;
  const label = inputItems(wh).find((i) => i.id === "housing")?.label ?? "住まい・ローン";
  const out: CheckRow[] = [];
  for (const r of h.residences ?? []) {
    if (r.kind !== "own" || r.purchase === undefined || r.purchase.price <= 0 || (r.purchase.downPayment ?? 0) > 0) continue;
    const at = resolveTimepoint(h, r.from);
    if (at === null || at < base) continue;
    out.push({ id: `downPayment:${r.id}`, kind: "notice", card: "housing", cardLabel: label, label: "住宅の購入: 頭金", detail: "これから買う家の頭金が0円です（頭金なしで、物件の価格を住宅ローンか手元のお金で払う計算です）", fieldKey: null, level: "simple", impact: 0, actions: [], value: "0円", item: "residence.purchase" });
  }
  return out;
}

/** 選べる種類 */
export const CHECK_KINDS: readonly CheckKind[] = KIND_ORDER;

/**
 * 入力の確かめ。reqJson は計算の要求（プランの変更を当てた後・計算の前の処理を当てる前）、previewJson はその要求を計算した表示の形の出力
 * （計算のお知らせを作る。計算できなかったときは null）、ctxJson は { args: CheckArgs, office }。戻り値は JSON の文字
 * { status: "ok", total, counts, groups: [{ kind, items }], truncated } か { status: "noSelf" } か { status: "badInput" }
 */
export function checkInputs(reqJson: string, previewJson: string, ctxJson: string): string {
  const req = JSON.parse(reqJson) as EngineRequest;
  const preview = JSON.parse(previewJson) as PreviewResult | null;
  const ctx = JSON.parse(ctxJson) as { args?: CheckArgs; office?: unknown };
  const a = ctx.args ?? {};
  publishOfficeEstimates(readOfficeEstimates(ctx.office ?? null));
  let rows: CheckRow[];
  let notices: NoticeRow[];
  try {
    const w = workingOf(req, a);
    if (w === null) return JSON.stringify({ status: "noSelf" });
    notices = preview === null ? [] : screenNoticeRows(req, preview);
    const list = checkList(w.wh, notices);
    // 頭金が0円のこれからの購入は、確かめの注意の並びの最後に
    const extra = zeroDownPaymentRows(w.wh);
    const at = list.findIndex((r) => KIND_ORDER.indexOf(r.kind) > KIND_ORDER.indexOf("notice"));
    rows = at < 0 ? [...list, ...extra] : [...list.slice(0, at), ...extra, ...list.slice(at)];
  } catch {
    return JSON.stringify({ status: "badInput" });
  }
  const kinds = new Set<CheckKind>(a.kinds !== undefined && a.kinds.length > 0 ? a.kinds : DEFAULT_KINDS);
  const byKey = new Map(notices.map((n) => [`calc:${n.key}`, n]));
  const chosen = rows.filter((r) => kinds.has(r.kind));
  const max = a.max ?? DEFAULT_MAX;
  const shown = chosen.slice(0, max);
  const present = KIND_ORDER.filter((k) => chosen.some((r) => r.kind === k));
  const groups = present
    .filter((k) => shown.some((r) => r.kind === k))
    .map((k) => ({ kind: CHECK_KIND_LABELS[k], items: shown.filter((r) => r.kind === k).map((row) => itemOf({ row, notice: byKey.get(row.id) ?? null })) }));
  const counts = Object.fromEntries(present.map((k) => [CHECK_KIND_LABELS[k], chosen.filter((r) => r.kind === k).length]));
  return JSON.stringify({ status: "ok", total: chosen.length, counts, groups, truncated: chosen.length > shown.length });
}
