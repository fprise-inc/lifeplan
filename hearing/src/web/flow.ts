// Web のヒアリング（0125・0130）のお客さまの画面の流れ: 1画面に小さなまとまり（人ごと・お住まい・お金）を並べ、答えに合わせて問いを飛ばす。
// - 手軽さが主軸（通常の票が主）: 人ごとに「生年月・年齢・性別」「働き方・年収」、お住まいは「住まいの形・家賃かローン」、お金は「預貯金・投資」を同じ画面に。
//   ご両親は1人1画面（ご健在か・お年・同居）、お子さまの生年月は全員を1画面に。まとめ方は GROUPS・ACROSS の表（詳細の票にも同じ表が効く）
// - 分岐の問い（配偶者の方がいるか・お子さまの人数・住宅ローンの本数・保険の件数・ご両親のことを聞いてよいか）は答えの一覧に入れず、決まった答えに写す
//   （配偶者の方がいない → 配偶者の方の生年月・年齢・ご結婚の形を「該当なし」。人数を超える分・聞かないと答えた分は出さない＝未回答）。受け皿は Excel と同じ
//   同じ区画の分岐の問いは1画面にまとめる（ご家族: 配偶者の方・お子さまの人数）
// - 項目ごとの出す条件（働き方・住まい・保険の種類・ご健在か など）は SHOW の表。前の答えがまだ無いときは出す（飛ばしすぎない）
// - 金額の項目と、その「だいたいの範囲」は同じ欄の別の答え方（alt）。生年月と年齢（簡易の票）も同じ
// - 「ご相談したいこと・気になっていること」は同意の直後に出す（答える気持ちが続くように）
// - 見えなくなった問いの答えは、送るときに捨てる（下書きには残すので、戻って答えを変えれば元に戻る）
import type { Answer, RawValue } from "../answers.ts";
import { yearLabel } from "../definition.ts";
import type { DocumentAnswer, QuestionsPacket, WebItem } from "./packet.ts";
import { ANSWERS_FORMAT, FILLED_ON, WEB_FORMAT_VERSION, type AnswersPacket } from "./packet.ts";

export type GateId = "spouse" | "child" | "loan" | "policy" | "parent";

/** 下書きの1つの答え（later は「あとで」。送るときは未回答） */
export interface DraftAnswer {
  readonly status: "value" | "unknown" | "notApplicable" | "later";
  readonly raw?: RawValue;
  readonly raw2?: RawValue;
}

export interface DraftFile {
  readonly fileId: string;
  readonly mime: AnswersPacket["documents"][number]["files"][number]["mime"];
  readonly bytes: number;
  readonly sha256: string;
  /** お客さまの画面に出す名前（「写真1」など。ファイル名は使わない） */
  readonly label: string;
}

export interface DraftDocument {
  readonly status: DocumentAnswer["status"];
  readonly files: readonly DraftFile[];
}

export interface Draft {
  readonly v: 1;
  readonly gates: Partial<Record<GateId, number>>;
  readonly answers: Readonly<Record<string, DraftAnswer>>;
  readonly documents: Readonly<Record<string, DraftDocument>>;
  /** 最初の画面の「はじめる」を押したか */
  readonly started: boolean;
}

export const draftKey = (key: string, index?: number): string => `${key}#${String(index ?? 0)}`;

/** 1つの画面の中の1つの問い（key の答えか、alt のどれかで答える。alt は金額の「だいたいの範囲」・生年月の代わりの年齢） */
export interface ScreenField {
  readonly key: string;
  readonly index?: number;
  readonly alt: readonly string[];
}

export type Screen =
  | { readonly kind: "intro" }
  | { readonly kind: "consent" }
  | { readonly kind: "gate"; readonly gates: readonly GateId[]; readonly section: string }
  /** key・index は画面の最初の問い（画面の名前に使う） */
  | { readonly kind: "item"; readonly key: string; readonly index?: number; readonly section: string; readonly fields: readonly ScreenField[] }
  | { readonly kind: "documents" }
  | { readonly kind: "review" };

/** 同意の直後に出す問いの区画（「はじめに」） */
export const START_SECTION = "@start";
export const START_TITLE = "はじめに";
/** 同意の直後に出す問い */
const FIRST_KEYS = ["hs.consult.topics"];

export const screenId = (s: Screen): string => (s.kind === "item" ? `item:${draftKey(s.key, s.index)}` : s.kind === "gate" ? `gate:${s.gates.join("+")}` : s.kind);

/** 画面のすべての欄の項目キー（答えの欄と、別の答え方の欄） */
export const fieldKeys = (f: ScreenField): string[] => [f.key, ...f.alt];

function axisCount(p: QuestionsPacket, id: string): number {
  return p.items.find((i) => i.axis?.id === id)?.axis?.labels.length ?? 0;
}

const GATE_TEXT: Readonly<Record<GateId, { readonly label: string; readonly lead: string }>> = {
  spouse: { label: "配偶者の方（事実婚の方を含みます）はいらっしゃいますか", lead: "いらっしゃらなければ、配偶者の方についての問いは出しません。" },
  child: { label: "お子さまは何人いらっしゃいますか（出産の予定を含みます）", lead: "人数の分だけ、お子さまごとにお聞きします。" },
  loan: { label: "住宅ローンは何本ありますか", lead: "ペアローンなどで2本あるときは「2本」を選んでください。" },
  policy: { label: "ご加入の保険は何件ありますか（保険証券の数）", lead: "件数の分だけ、1件ずつお聞きします。" },
  parent: { label: "ご両親のことも、うかがってよいですか", lead: "お年や暮らし方を、介護や相続の備えを考えるのに使います。答えたくなければ「いいえ」で飛ばせます。" },
};

const COUNT_WORD: Readonly<Partial<Record<GateId, { readonly unit: string; readonly zero: string }>>> = {
  child: { unit: "人", zero: "いない" },
  loan: { unit: "本", zero: "ない" },
  policy: { unit: "件", zero: "入っていない" },
};

/** 分岐の問いの言葉と選択肢（人数・本数は「1人」「2本」。最後の段は「4人以上」のように） */
export function gateText(p: QuestionsPacket, g: GateId): { readonly label: string; readonly lead: string; readonly options: readonly { readonly value: string; readonly label: string }[] } {
  const t = GATE_TEXT[g];
  if (g === "spouse") return { ...t, options: [{ value: "1", label: "いらっしゃる" }, { value: "0", label: "いらっしゃらない" }] };
  if (g === "parent") return { ...t, options: [{ value: "1", label: "はい" }, { value: "0", label: "いいえ（今回は答えない）" }] };
  const w = COUNT_WORD[g] as { unit: string; zero: string };
  const max = axisCount(p, g);
  const options = Array.from({ length: max + 1 }, (_, n) => ({ value: String(n), label: n === 0 ? w.zero : n === max && max > 2 ? `${n}${w.unit}以上` : `${n}${w.unit}` }));
  const lead = max > 2 ? `${t.lead}${max + 1}${w.unit}以上のときは「${max}${w.unit}以上」を選び、${max}${w.unit}までお答えください。` : t.lead;
  return { label: t.label, lead, options };
}

/** 分岐の答えの言葉（確かめの画面） */
export function gateAnswerText(p: QuestionsPacket, g: GateId, v: number | undefined): string {
  if (v === undefined) return "（まだ）";
  return gateText(p, g).options.find((o) => o.value === String(v))?.label ?? String(v);
}

const AXIS_GATE: Readonly<Record<string, GateId>> = { child: "child", loan: "loan", policy: "policy" };

/** 答えの値の文字（選択肢の値・金額の数など）。無ければ null */
export function valueOf(d: Draft, key: string, index?: number): string | null {
  const a = d.answers[draftKey(key, index)];
  if (a === undefined) return null;
  if (a.status === "notApplicable") return "@na";
  if (a.status !== "value" || a.raw === undefined) return null;
  return a.raw.kind === "bool" ? String(a.raw.value) : a.raw.text;
}

type Cond = (d: Draft, n: number | undefined) => boolean;
/** その答えが無いか、どれかに当たる */
const isAny = (key: string, values: readonly string[]): Cond => (d, n) => {
  const v = valueOf(d, key, n);
  return v === null || values.includes(v);
};
const isNot = (key: string, values: readonly string[]): Cond => (d, n) => {
  const v = valueOf(d, key, n);
  return v === null || !values.includes(v);
};
const all = (...cs: Cond[]): Cond => (d, n) => cs.every((c) => c(d, n));
/** 住まいの問いは繰り返さない（住まいの答えは番号なしで見る） */
const home = (c: Cond): Cond => (d) => c(d, undefined);

/** 働いている（「働いていない」と、配偶者の方がいないときの「該当なし」は除く。休業中は年収を聞く: 休業の前の年収で、戻った後を考えるため） */
const WORKING = isNot("hs.work.type", ["@na", "unemployed"]);
const SALARIED = all(WORKING, isNot("hs.work.type", ["selfEmployed"]));
const OWN = isAny("hs.housing.type", ["own"]);
const HAS_LOAN = all(OWN, isNot("hs.loan.monthlyTotal", ["@na"]));
const ALIVE = isNot("hs.family.parent.alive", ["deceased"]);
const NOTICE = isNot("hs.pension.notice.type", ["@na"]);
const RENT = isAny("hs.housing.type", ["rent", "company"]);

/** 項目ごとの出す条件（同じ人・同じ番号の答えで決める。住まいは繰り返さない） */
const SHOW: Readonly<Record<string, Cond>> = {
  "hs.work.since": WORKING,
  "hs.work.employerSize": SALARIED,
  "hs.work.weeklyHours": all(WORKING, isAny("hs.work.type", ["partTime", "contract"])),
  "hs.work.healthInsurance": WORKING,
  "hs.work.prefecture": all(WORKING, isAny("hs.work.healthInsurance", ["kyokaikenpo"])),
  "hs.income.salary": SALARIED,
  "hs.income.bonus": SALARIED,
  "hs.income.business": all(WORKING, isAny("hs.work.type", ["selfEmployed"])),
  "hs.income.annual": WORKING,
  "hs.income.annualRange": WORKING,
  "hs.income.residentTax": WORKING,
  "hs.work.retireAge": SALARIED,
  "hs.retirement.lumpSum": SALARIED,
  "hs.company.shares": isAny("hs.work.type", ["executive"]),
  "hs.company.loanToCompany": isAny("hs.work.type", ["executive"]),
  "hs.company.loanFromCompany": isAny("hs.work.type", ["executive"]),
  "hs.company.loanFromCompanyMonthly": isAny("hs.work.type", ["executive"]),
  "hs.company.guarantee": isAny("hs.work.type", ["executive"]),
  "hs.pension.notice.asOf": NOTICE,
  "hs.pension.months.total": NOTICE,
  "hs.pension.months.employee": NOTICE,
  "hs.pension.amount.basic": NOTICE,
  "hs.pension.amount.employee": NOTICE,
  "hs.housing.rent": home(RENT),
  "hs.housing.rentRange": home(RENT),
  "hs.housing.propertyTax": home(OWN),
  "hs.housing.maintenance": home(OWN),
  "hs.loan.monthlyTotal": home(OWN),
  "hs.loan.monthlyTotalRange": home(OWN),
  "hs.loan.balanceTotal": home(HAS_LOAN),
  "hs.loan.balanceTotalRange": home(HAS_LOAN),
  "hs.family.parent.age": ALIVE,
  "hs.family.parent.cohabiting": ALIVE,
  "hs.insurance.monthlyBenefit": isAny("hs.insurance.type", ["insurance.incomeProtection"]),
  "hs.insurance.deathBenefit": isNot("hs.insurance.type", ["insurance.medical", "insurance.cancer"]),
  "hs.education.living": isNot("hs.education.after", ["@na"]),
};

/** 同じ画面に出す問い（主の項目 → 続けて出す項目。同じ区画・同じ繰り返しのときだけ。続けて出す項目にも SHOW が効く） */
const GROUPS: Readonly<Record<string, readonly string[]>> = {
  "hs.family.adult.birthYearMonth": ["hs.family.adult.sex"],
  "hs.family.child.birthYearMonth": ["hs.family.child.sex"],
  "hs.work.type": ["hs.income.annual"],
  "hs.housing.type": ["hs.housing.rent", "hs.loan.monthlyTotal", "hs.loan.balanceTotal"],
  "hs.assets.depositTotal": ["hs.assets.investTotal"],
  "hs.expense.living": ["hs.insurance.premiumTotal"],
  "hs.family.parent.alive": ["hs.family.parent.age", "hs.family.parent.cohabiting"],
};

/** 番号ごとに分けず、全員を1画面に並べる項目（続けて出す項目が無いときだけ。簡易の票のお子さまの生年月） */
const ACROSS = new Set(["hs.family.child.birthYearMonth"]);

/** 別の答え方（主の項目 → その欄）: 金額の「だいたいの範囲」と、簡易の票の生年月の代わりの年齢 */
function alternatives(p: QuestionsPacket): Map<string, string[]> {
  const keys = new Set(p.items.map((i) => i.key));
  const out = new Map<string, string[]>();
  const add = (main: string, sub: string) => out.set(main, [...(out.get(main) ?? []), sub]);
  if (keys.has("hs.family.adult.birthYearMonth") && keys.has("hs.family.adult.age")) add("hs.family.adult.birthYearMonth", "hs.family.adult.age");
  for (const i of p.items) if (i.rangeOf !== undefined && keys.has(i.rangeOf)) add(i.rangeOf, i.key);
  return out;
}

/** 続けて出す項目 → 主の項目（主と同じ区画・同じ繰り返しのときだけ） */
function followers(p: QuestionsPacket): Map<string, string> {
  const by = new Map(p.items.map((i) => [i.key, i]));
  const out = new Map<string, string>();
  for (const [main, subs] of Object.entries(GROUPS)) {
    const m = by.get(main);
    if (m === undefined) continue;
    for (const s of subs) {
      const it = by.get(s);
      if (it !== undefined && it.section === m.section && it.axis?.id === m.axis?.id) out.set(s, main);
    }
  }
  return out;
}

/** その番号の人・物が出るか（分岐の答えで決める） */
function indexOn(d: Draft, axis: string | undefined, n: number | undefined): boolean {
  if (axis === undefined || n === undefined) return true;
  if (axis === "adult") return n === 1 || d.gates.spouse === 1;
  if (axis === "parent") return d.gates.parent !== 0 && (n <= 2 || d.gates.spouse === 1);
  const g = AXIS_GATE[axis];
  if (g === undefined) return true;
  if (g === "loan" && !OWN(d, undefined)) return false;
  return n <= (d.gates[g] ?? 0);
}

export function itemShown(p: QuestionsPacket, d: Draft, item: WebItem, n: number | undefined): boolean {
  if (!indexOn(d, item.axis?.id, n)) return false;
  if (item.key === "hs.family.spouse.marriage") return d.gates.spouse === 1;
  const c = SHOW[item.key];
  return c === undefined || c(d, n);
}

/** その項目のために要る分岐の問い（並びの順） */
function gatesOf(item: WebItem): GateId[] {
  const a = item.axis?.id;
  if (a === "adult" || item.key === "hs.family.spouse.marriage") return ["spouse"];
  if (a === "parent") return ["parent", "spouse"];
  if (a !== undefined && AXIS_GATE[a] !== undefined) return [AXIS_GATE[a] as GateId];
  return [];
}

/** 今の下書きで出す画面の並び（最初の画面・同意・はじめの問い・問い・書類・確かめ） */
export function screens(p: QuestionsPacket, d: Draft): Screen[] {
  const out: Screen[] = [{ kind: "intro" }];
  if (p.consent.items.length > 0) out.push({ kind: "consent" });
  const alts = alternatives(p);
  const altKeys = new Set([...alts.values()].flat());
  const follow = followers(p);
  const byKey = new Map(p.items.map((i) => [i.key, i]));
  const field = (it: WebItem, n: number | undefined): ScreenField => ({ key: it.key, ...(n !== undefined ? { index: n } : {}), alt: (alts.get(it.key) ?? []).filter((k) => itemShown(p, d, byKey.get(k) as WebItem, n)) });
  const fieldsAt = (it: WebItem, n: number | undefined): ScreenField[] => {
    const subs = (GROUPS[it.key] ?? []).filter((k) => follow.get(k) === it.key).map((k) => byKey.get(k) as WebItem);
    return [field(it, n), ...subs.filter((s) => itemShown(p, d, s, n)).map((s) => field(s, n))];
  };
  const push = (section: string, fields: ScreenField[]) => {
    const f = fields[0];
    if (f !== undefined) out.push({ kind: "item", key: f.key, ...(f.index !== undefined ? { index: f.index } : {}), section, fields });
  };
  // はじめの問い（ご相談したいこと）は同意の直後
  for (const k of FIRST_KEYS) {
    const it = byKey.get(k);
    if (it !== undefined && it.axis === undefined && itemShown(p, d, it, undefined)) push(START_SECTION, fieldsAt(it, undefined));
  }
  const asked = new Set<GateId>();
  const gateOn = (g: GateId) => !(g === "loan" && !OWN(d, undefined)) && (g === "spouse" || g === "parent" || axisCount(p, g) > 0);
  for (const sec of p.sections) {
    const items = p.items.filter((i) => i.section === sec.id && !altKeys.has(i.key) && !follow.has(i.key) && !FIRST_KEYS.includes(i.key));
    // 同じ軸の項目は、番号ごと（人ごと・物ごと）にまとめて聞く（区画の中で軸の項目が並ぶ順を保つ）
    const runs: WebItem[][] = [];
    let k = 0;
    while (k < items.length) {
      const first = items[k] as WebItem;
      let end = k + 1;
      if (first.axis !== undefined) while (end < items.length && items[end]?.axis?.id === first.axis.id) end++;
      runs.push(items.slice(k, end));
      k = end;
    }
    for (let r = 0; r < runs.length; r++) {
      const run = runs[r] as WebItem[];
      // この区画でまだ聞いていない分岐の問いを、最初に要る所でまとめて1画面に
      const mine = gatesOf(run[0] as WebItem).filter((g) => !asked.has(g) && gateOn(g));
      if (mine.length > 0) {
        const rest = runs.slice(r + 1).flatMap((x) => gatesOf(x[0] as WebItem));
        const gates = [...new Set([...mine, ...rest])].filter((g) => !asked.has(g) && gateOn(g));
        for (const g of gates) asked.add(g);
        out.push({ kind: "gate", gates, section: sec.id });
      }
      const axis = run[0]?.axis;
      const count = axis === undefined ? 1 : axis.labels.length;
      const only = run.length === 1 ? (run[0] as WebItem) : null;
      if (only !== null && axis !== undefined && ACROSS.has(only.key) && fieldsAt(only, 1).length === 1) {
        const fields: ScreenField[] = [];
        for (let n = 1; n <= count; n++) if (itemShown(p, d, only, n)) fields.push(field(only, n));
        push(sec.id, fields);
        continue;
      }
      for (let n = 1; n <= count; n++) {
        const index = axis === undefined ? undefined : n;
        for (const it of run) if (itemShown(p, d, it, index)) push(sec.id, fieldsAt(it, index));
      }
    }
  }
  if (p.documents.length > 0) out.push({ kind: "documents" });
  out.push({ kind: "review" });
  return out;
}

/** その項目を含む画面（FP のアプリの見本の「この問いを見る」） */
export function screenOf(list: readonly Screen[], key: string): Screen | undefined {
  return list.find((s) => s.kind === "item" && s.fields.some((f) => fieldKeys(f).includes(key)));
}

/** 問いに答えたか（答えの欄か、別の答え方のどれかに「あとで」でない答えがある） */
export function fieldAnswered(d: Draft, f: ScreenField): boolean {
  return fieldKeys(f).some((k) => {
    const a = d.answers[draftKey(k, f.index)];
    return a !== undefined && a.status !== "later";
  });
}

/** 最初の下書き（確かめてもらう項目の前回の値と、そこから分かる分岐の答え） */
export function initialDraft(p: QuestionsPacket): Draft {
  const answers: Record<string, DraftAnswer> = {};
  for (const i of p.items) for (const [n, a] of Object.entries(i.prefill ?? {})) if (a.status !== "blank") answers[draftKey(i.key, n === "0" ? undefined : Number(n))] = { status: a.status, ...(a.raw !== undefined ? { raw: a.raw } : {}), ...(a.raw2 !== undefined ? { raw2: a.raw2 } : {}) };
  const gates: Partial<Record<GateId, number>> = {};
  const pre = (key: string, n?: number) => p.items.find((i) => i.key === key)?.prefill?.[String(n ?? 0)];
  const sp = pre("hs.family.adult.birthYearMonth", 2);
  if (sp?.status === "value") gates.spouse = 1;
  else if (sp?.status === "notApplicable") gates.spouse = 0;
  const count = (key: string, axis: string) => {
    let c = 0;
    for (let n = 1; n <= axisCount(p, axis); n++) if (pre(key, n)?.status === "value") c = n;
    return c;
  };
  if (p.items.some((i) => i.confirm === true && i.axis?.id === "child")) gates.child = count("hs.family.child.birthYearMonth", "child");
  if (p.items.some((i) => i.confirm === true && i.axis?.id === "loan")) gates.loan = count("hs.loan.principal", "loan");
  if (p.items.some((i) => i.confirm === true && i.axis?.id === "policy")) gates.policy = count("hs.insurance.type", "policy");
  if (count("hs.family.parent.alive", "parent") > 0) gates.parent = 1;
  return { v: 1, gates, answers, documents: {}, started: false };
}

/** 年月の答えに月があるか（月を「わからない」にした答えは、年だけでは取り込めないので送らない） */
const hasMonth = (a: DraftAnswer): boolean => a.raw2 !== undefined && a.raw2.kind !== "bool" && /^\d{1,2}$/.test(a.raw2.text);

/** 下書きから送る答えを作る（見えない問いの答えは捨てる。分岐の答えを決まった答えに写す。記入の年月は送る月） */
export function answersOf(p: QuestionsPacket, d: Draft, submittedAt: Date): AnswersPacket {
  const out: Answer[] = [];
  const types = new Map(p.items.map((i) => [i.key, i.type]));
  const ym = `${submittedAt.getFullYear()}`;
  out.push({ key: FILLED_ON, status: "value", raw: { kind: "text", text: ym }, raw2: { kind: "number", text: String(submittedAt.getMonth() + 1) } });
  const put = (key: string, index: number | undefined, a: DraftAnswer | undefined) => {
    if (a === undefined || a.status === "later") return;
    if (a.status === "value" && types.get(key) === "yearMonth" && !hasMonth(a)) return;
    out.push({ key, ...(index !== undefined ? { index } : {}), status: a.status, ...(a.status === "value" && a.raw !== undefined ? { raw: a.raw } : {}), ...(a.status === "value" && a.raw2 !== undefined ? { raw2: a.raw2 } : {}) });
  };
  for (const c of p.consent.items) put(c.key, undefined, d.answers[draftKey(c.key)]);
  for (const s of screens(p, d)) {
    if (s.kind !== "item") continue;
    for (const f of s.fields) for (const key of fieldKeys(f)) put(key, f.index, d.answers[draftKey(key, f.index)]);
  }
  // 配偶者の方がいない: 配偶者の方の欄を「該当なし」に（取り込みは生年月の「該当なし」で配偶者の方を作らない）
  if (d.gates.spouse === 0) {
    for (const key of ["hs.family.adult.birthYearMonth", "hs.family.adult.age"]) {
      const it = p.items.find((i) => i.key === key);
      if (it !== undefined && it.states.includes("notApplicable")) out.push({ key, index: 2, status: "notApplicable" });
    }
    const m = p.items.find((i) => i.key === "hs.family.spouse.marriage");
    if (m !== undefined && m.states.includes("notApplicable")) out.push({ key: m.key, status: "notApplicable" });
  }
  const documents: DocumentAnswer[] = p.documents.map((doc) => {
    const x = d.documents[doc.id];
    const files = (x?.files ?? []).map(({ fileId, mime, bytes, sha256 }) => ({ fileId, mime, bytes, sha256 }));
    const status = x === undefined ? "blank" : x.status === "attached" && files.length === 0 ? "blank" : x.status;
    return { id: doc.id, status, files: status === "attached" ? files : [] };
  });
  return { format: ANSWERS_FORMAT, version: WEB_FORMAT_VERSION, requestId: p.requestId, submittedAt: submittedAt.toISOString(), answers: out, documents };
}

// ---- 画面に出す言葉 ----

/** 繰り返しの見出し（ご本人・お子さま1 …） */
export function indexLabel(item: WebItem, index?: number): string | null {
  if (item.axis === undefined || index === undefined) return null;
  return item.axis.labels[index - 1] ?? `${index}番目`;
}

/** 打った数の文字をそろえる（全角→半角・桁区切りと空白を外す。取り込みと同じ読み方） */
export const normNumber = (t: string): string => t.normalize("NFKC").replace(/[,\s]/g, "").replace(/[−ー―‐]/g, "-");

const fmt = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 4 });

/** 月を「わからない」にしたときの月の欄の値 */
export const MONTH_UNKNOWN = "unknown";

/** 答えを言葉にする（確かめの画面・送った内容・FP の見本） */
export function answerText(item: WebItem, a: DraftAnswer | undefined): string {
  if (a === undefined) return "（まだ）";
  if (a.status === "later") return "あとで";
  if (a.status === "unknown") return "わからない";
  if (a.status === "notApplicable") return item.naLabel ?? "当てはまらない";
  const t = a.raw === undefined ? "" : a.raw.kind === "bool" ? (a.raw.value ? "はい" : "いいえ") : a.raw.text;
  switch (item.type) {
    case "choice":
      return item.choices?.find((c) => c.value === t || c.label === t)?.label ?? t;
    case "moneyRange": {
      const basis = item.unit?.basis === "monthly" ? "月 " : item.unit?.basis === "annual" ? "年 " : "";
      return `${basis}${item.ranges?.find((r) => r.label === t)?.label ?? t}`;
    }
    case "money": {
      const n = Number(normNumber(t).replace(/万円?$|円$/, ""));
      const unit = item.unit?.scale === "manYen" ? "万円" : "円";
      const basis = item.unit?.basis === "monthly" ? "月 " : item.unit?.basis === "annual" ? "年 " : "";
      return t !== "" && Number.isFinite(n) ? `${basis}${fmt(n)}${unit}` : t;
    }
    case "yearMonth": {
      const y = /\d{4}/.exec(normNumber(t))?.[0];
      const m2 = a.raw2 !== undefined && a.raw2.kind !== "bool" ? a.raw2.text : undefined;
      const m = m2 === undefined ? undefined : /\d{1,2}/.exec(m2)?.[0];
      if (y === undefined) return t;
      return `${yearLabel(Number(y))}${m !== undefined ? ` ${Number(m)}月` : m2 === MONTH_UNKNOWN ? "（月はわからない）" : ""}`;
    }
    case "percent":
      return `${normNumber(t).replace(/%$/, "")}%`;
    default: {
      const n = normNumber(t);
      if (item.unitLabel !== undefined && n !== "") return `${n.endsWith(item.unitLabel) ? n.slice(0, -item.unitLabel.length) : n}${item.unitLabel}`;
      return item.type === "integer" || item.type === "decimal" ? n : t;
    }
  }
}

/** 年の選択肢（新しい年から。大人の生年月は15年前から・お子さまの生年月は出産の予定のため3年後から・ほかの年月は今年から） */
export function yearChoices(item: WebItem, years: { readonly from: number; readonly to: number }, now: Date, selected?: number): number[] {
  const y = now.getFullYear();
  const top = item.key === "hs.family.child.birthYearMonth" ? y + 3 : item.key === "hs.family.adult.birthYearMonth" ? y - 15 : y;
  const to = Math.min(years.to, top);
  const list: number[] = [];
  for (let n = to; n >= years.from; n--) list.push(n);
  // 前回の答えなどで範囲の外の年が入っていれば、それも選べるように
  if (selected !== undefined && !list.includes(selected) && selected >= years.from && selected <= years.to) return [selected, ...list].sort((a, b) => b - a);
  return list;
}

/** 進み具合の段（最初の段は同意とご相談・後は区画の順・書類・確かめ）。分母は答えで変わらない */
export interface Progress {
  readonly stages: readonly { readonly id: string; readonly title: string }[];
  /** 今の段の番号（0から。最初の画面は -1） */
  readonly current: number;
  /** 全体の何％か（0〜100） */
  readonly pct: number;
}

const stageOf = (s: Screen): string | null => (s.kind === "intro" ? null : s.kind === "consent" ? START_SECTION : s.kind === "item" || s.kind === "gate" ? s.section : s.kind);

export function progress(p: QuestionsPacket, list: readonly Screen[], at: number): Progress {
  const stages: { id: string; title: string }[] = [];
  if (p.consent.items.length > 0 || p.items.some((i) => FIRST_KEYS.includes(i.key))) stages.push({ id: START_SECTION, title: START_TITLE });
  for (const s of p.sections) if (p.items.some((i) => i.section === s.id && !FIRST_KEYS.includes(i.key))) stages.push({ id: s.id, title: s.title });
  if (p.documents.length > 0) stages.push({ id: "documents", title: "書類" });
  stages.push({ id: "review", title: "確かめ" });
  const here = list[at];
  const id = here === undefined ? null : stageOf(here);
  const current = id === null ? -1 : stages.findIndex((x) => x.id === id);
  if (current < 0) return { stages, current, pct: 0 };
  const same = list.filter((s) => stageOf(s) === id);
  const pos = Math.max(0, same.indexOf(here as Screen));
  const pct = here?.kind === "review" ? 100 : Math.round(((current + pos / Math.max(1, same.length)) / stages.length) * 100);
  return { stages, current, pct };
}

/** 問いの画面の数と所要時間の目安（夫婦と子2人の世帯で数える。前の答えが無い問いは出す。1画面15秒・書類1通1分ほど） */
export function estimate(p: QuestionsPacket): { readonly screens: number; readonly minutes: number } {
  const base = initialDraft(p);
  const d: Draft = { ...base, gates: { spouse: 1, child: Math.min(2, axisCount(p, "child")), loan: Math.min(1, axisCount(p, "loan")), policy: Math.min(2, axisCount(p, "policy")), parent: 1, ...base.gates } };
  const n = screens(p, d).filter((s) => s.kind === "consent" || s.kind === "gate" || s.kind === "item").length;
  return { screens: n, minutes: Math.max(1, Math.round((n * 15) / 60 + p.documents.length)) };
}

/** 下書きの JSON を読む（形の違うものは null） */
export function readDraft(v: unknown): Draft | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.v !== 1 || typeof o.gates !== "object" || o.gates === null || typeof o.answers !== "object" || o.answers === null || typeof o.documents !== "object" || o.documents === null) return null;
  return { v: 1, gates: o.gates as Draft["gates"], answers: o.answers as Draft["answers"], documents: o.documents as Draft["documents"], started: o.started === true };
}
