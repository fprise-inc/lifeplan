// Web のヒアリング（0125）のお客さまの画面の流れ: 1画面に1つの問い（または小さなまとまり）を並べ、答えに合わせて問いを飛ばす。
// - 分岐の問い（配偶者の方がいるか・お子さまの人数・住宅ローンの本数・保険の件数）は答えの一覧に入れず、決まった答えに写す
//   （配偶者の方がいない → 配偶者の方の生年月・年齢・ご結婚の形を「該当なし」。人数を超える分は出さない＝未回答）。受け皿は Excel と同じ
// - 項目ごとの出す条件（働き方・住まい・保険の種類・ご健在か など）は SHOW の表。前の答えがまだ無いときは出す（飛ばしすぎない）
// - 金額の項目と、その「だいたいの範囲」は同じ画面に出す（どちらかで答える）。生年月と年齢（簡易の票）も同じ画面
// - 見えなくなった問いの答えは、送るときに捨てる（下書きには残すので、戻って答えを変えれば元に戻る）
import type { Answer, RawValue } from "../answers.ts";
import { yearLabel } from "../definition.ts";
import type { DocumentAnswer, QuestionsPacket, WebItem } from "./packet.ts";
import { ANSWERS_FORMAT, FILLED_ON, WEB_FORMAT_VERSION, type AnswersPacket } from "./packet.ts";

export type GateId = "spouse" | "child" | "loan" | "policy";

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

export type Screen =
  | { readonly kind: "intro" }
  | { readonly kind: "consent" }
  | { readonly kind: "gate"; readonly gate: GateId; readonly section: string }
  | { readonly kind: "item"; readonly key: string; readonly index?: number; readonly section: string; readonly also: readonly string[] }
  | { readonly kind: "documents" }
  | { readonly kind: "review" };

export const screenId = (s: Screen): string => (s.kind === "item" ? `item:${draftKey(s.key, s.index)}` : s.kind === "gate" ? `gate:${s.gate}` : s.kind);

export const GATE_TEXT: Readonly<Record<GateId, { readonly label: string; readonly lead: string; readonly max: (p: QuestionsPacket) => number }>> = {
  spouse: { label: "配偶者の方（事実婚の方を含みます）はいらっしゃいますか", lead: "いらっしゃらなければ、配偶者の方についての問いは出しません。", max: () => 1 },
  child: { label: "お子さまは何人いらっしゃいますか（出産の予定を含みます）", lead: "人数の分だけ、お子さまごとにお聞きします。", max: (p) => axisCount(p, "child") },
  loan: { label: "住宅ローンは何本ありますか", lead: "ペアローンなどで2本あるときは 2 を選んでください。", max: (p) => axisCount(p, "loan") },
  policy: { label: "ご加入の保険は何件ありますか（保険証券の数）", lead: "件数の分だけ、1件ずつお聞きします。", max: (p) => axisCount(p, "policy") },
};

function axisCount(p: QuestionsPacket, id: string): number {
  return p.items.find((i) => i.axis?.id === id)?.axis?.labels.length ?? 0;
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

const WORKING = isNot("hs.work.type", ["@na"]);
const SALARIED = all(WORKING, isNot("hs.work.type", ["selfEmployed"]));
const OWN = isAny("hs.housing.type", ["own"]);
const ALIVE = isNot("hs.family.parent.alive", ["deceased"]);
const NOTICE = isNot("hs.pension.notice.type", ["@na"]);

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
  "hs.housing.rent": (d) => isAny("hs.housing.type", ["rent", "company"])(d, undefined),
  "hs.housing.rentRange": (d) => isAny("hs.housing.type", ["rent", "company"])(d, undefined),
  "hs.housing.propertyTax": (d) => OWN(d, undefined),
  "hs.housing.maintenance": (d) => OWN(d, undefined),
  "hs.loan.monthlyTotal": (d) => OWN(d, undefined),
  "hs.loan.monthlyTotalRange": (d) => OWN(d, undefined),
  "hs.loan.balanceTotal": (d) => OWN(d, undefined),
  "hs.loan.balanceTotalRange": (d) => OWN(d, undefined),
  "hs.family.parent.age": ALIVE,
  "hs.family.parent.cohabiting": ALIVE,
  "hs.insurance.monthlyBenefit": isAny("hs.insurance.type", ["insurance.incomeProtection"]),
  "hs.insurance.deathBenefit": isNot("hs.insurance.type", ["insurance.medical", "insurance.cancer"]),
  "hs.education.living": isNot("hs.education.after", ["@na"]),
};

/** 同じ画面に出す、従の項目（主の項目 → 従の項目）。範囲の答えと、簡易の票の年齢 */
function companions(p: QuestionsPacket): Map<string, string[]> {
  const keys = new Set(p.items.map((i) => i.key));
  const out = new Map<string, string[]>();
  const add = (main: string, sub: string) => out.set(main, [...(out.get(main) ?? []), sub]);
  for (const i of p.items) if (i.rangeOf !== undefined && keys.has(i.rangeOf)) add(i.rangeOf, i.key);
  if (keys.has("hs.family.adult.birthYearMonth") && keys.has("hs.family.adult.age")) add("hs.family.adult.birthYearMonth", "hs.family.adult.age");
  return out;
}

/** その番号の人・物が出るか（分岐の答えで決める） */
function indexOn(p: QuestionsPacket, d: Draft, axis: string | undefined, n: number | undefined): boolean {
  if (axis === undefined || n === undefined) return true;
  if (axis === "adult") return n === 1 || d.gates.spouse === 1;
  if (axis === "parent") return n <= 2 || d.gates.spouse === 1;
  const g = AXIS_GATE[axis];
  if (g === undefined) return true;
  if (g === "loan" && !OWN(d, undefined)) return false;
  return n <= (d.gates[g] ?? 0);
}

export function itemShown(p: QuestionsPacket, d: Draft, item: WebItem, n: number | undefined): boolean {
  if (!indexOn(p, d, item.axis?.id, n)) return false;
  if (item.key === "hs.family.spouse.marriage") return d.gates.spouse === 1;
  const c = SHOW[item.key];
  return c === undefined || c(d, n);
}

/** どの分岐の問いが要るか（その軸の項目を選んでいるとき） */
function gatesNeeded(p: QuestionsPacket): Set<GateId> {
  const out = new Set<GateId>();
  for (const i of p.items) {
    const a = i.axis?.id;
    if (a === "adult" || a === "parent" || i.key === "hs.family.spouse.marriage") out.add("spouse");
    else if (a !== undefined && AXIS_GATE[a] !== undefined && axisCount(p, a) > 0) out.add(AXIS_GATE[a] as GateId);
  }
  return out;
}

/** 今の下書きで出す画面の並び（最初の画面・同意・問い・書類・確かめ） */
export function screens(p: QuestionsPacket, d: Draft): Screen[] {
  const out: Screen[] = [{ kind: "intro" }];
  if (p.consent.items.length > 0) out.push({ kind: "consent" });
  const comp = companions(p);
  const subs = new Set([...comp.values()].flat());
  const need = gatesNeeded(p);
  const asked = new Set<GateId>();
  const gateFor = (item: WebItem): GateId | null => {
    const a = item.axis?.id;
    if (a === "adult" || a === "parent" || item.key === "hs.family.spouse.marriage") return need.has("spouse") ? "spouse" : null;
    if (a !== undefined && AXIS_GATE[a] !== undefined) return AXIS_GATE[a] as GateId;
    return null;
  };
  for (const sec of p.sections) {
    const items = p.items.filter((i) => i.section === sec.id && !subs.has(i.key));
    // 同じ軸の項目は、番号ごと（人ごと・物ごと）にまとめて聞く（区画の中で軸の項目が並ぶ順を保つ）
    let k = 0;
    while (k < items.length) {
      const first = items[k] as WebItem;
      const axis = first.axis;
      let end = k + 1;
      if (axis !== undefined) while (end < items.length && items[end]?.axis?.id === axis.id) end++;
      const run = items.slice(k, end);
      k = end;
      const g = gateFor(first);
      if (g !== null && !asked.has(g) && !(g === "loan" && !OWN(d, undefined))) {
        asked.add(g);
        out.push({ kind: "gate", gate: g, section: sec.id });
      }
      const count = axis === undefined ? 1 : axis.labels.length;
      for (let n = 1; n <= count; n++) {
        const index = axis === undefined ? undefined : n;
        for (const it of run) {
          if (!itemShown(p, d, it, index)) continue;
          out.push({ kind: "item", key: it.key, ...(index !== undefined ? { index } : {}), section: sec.id, also: (comp.get(it.key) ?? []).filter((s) => itemShown(p, d, p.items.find((x) => x.key === s) as WebItem, index)) });
        }
      }
    }
  }
  if (p.documents.length > 0) out.push({ kind: "documents" });
  out.push({ kind: "review" });
  return out;
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
  return { v: 1, gates, answers, documents: {}, started: false };
}

/** 下書きから送る答えを作る（見えない問いの答えは捨てる。分岐の答えを決まった答えに写す。記入の年月は送る月） */
export function answersOf(p: QuestionsPacket, d: Draft, submittedAt: Date): AnswersPacket {
  const out: Answer[] = [];
  const ym = `${submittedAt.getFullYear()}`;
  out.push({ key: FILLED_ON, status: "value", raw: { kind: "text", text: ym }, raw2: { kind: "number", text: String(submittedAt.getMonth() + 1) } });
  const put = (key: string, index: number | undefined, a: DraftAnswer | undefined) => {
    if (a === undefined || a.status === "later") return;
    out.push({ key, ...(index !== undefined ? { index } : {}), status: a.status, ...(a.status === "value" && a.raw !== undefined ? { raw: a.raw } : {}), ...(a.status === "value" && a.raw2 !== undefined ? { raw2: a.raw2 } : {}) });
  };
  for (const c of p.consent.items) put(c.key, undefined, d.answers[draftKey(c.key)]);
  for (const s of screens(p, d)) {
    if (s.kind !== "item") continue;
    for (const key of [s.key, ...s.also]) put(key, s.index, d.answers[draftKey(key, s.index)]);
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

const fmt = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 4 });

/** 答えを言葉にする（確かめの画面・FP の見本） */
export function answerText(item: WebItem, a: DraftAnswer | undefined): string {
  if (a === undefined) return "（まだ）";
  if (a.status === "later") return "あとで";
  if (a.status === "unknown") return "わからない";
  if (a.status === "notApplicable") return item.naLabel ?? "当てはまらない";
  const t = a.raw === undefined ? "" : a.raw.kind === "bool" ? (a.raw.value ? "はい" : "いいえ") : a.raw.text;
  switch (item.type) {
    case "choice":
      return item.choices?.find((c) => c.value === t || c.label === t)?.label ?? t;
    case "moneyRange":
      return item.ranges?.find((r) => r.label === t)?.label ?? t;
    case "money": {
      const n = Number(t);
      const unit = item.unit?.scale === "manYen" ? "万円" : "円";
      const basis = item.unit?.basis === "monthly" ? "月 " : item.unit?.basis === "annual" ? "年 " : "";
      return Number.isFinite(n) ? `${basis}${fmt(n)}${unit}` : t;
    }
    case "yearMonth": {
      const y = /\d{4}/.exec(t)?.[0];
      const m = a.raw2 !== undefined && a.raw2.kind !== "bool" ? /\d{1,2}/.exec(a.raw2.text)?.[0] : undefined;
      return y === undefined ? t : `${yearLabel(Number(y))}${m !== undefined ? ` ${Number(m)}月` : ""}`;
    }
    case "percent":
      return `${t}%`;
    default:
      return item.unitLabel !== undefined && t !== "" ? `${t}${item.unitLabel}` : t;
  }
}

/** 進み具合（今の画面が全体の何番目か。最初の画面は数えない） */
export function progress(list: readonly Screen[], at: number): { readonly done: number; readonly total: number } {
  const total = Math.max(1, list.length - 1);
  return { done: Math.min(total, Math.max(0, at)), total };
}

/** 下書きの JSON を読む（形の違うものは null） */
export function readDraft(v: unknown): Draft | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.v !== 1 || typeof o.gates !== "object" || o.gates === null || typeof o.answers !== "object" || o.answers === null || typeof o.documents !== "object" || o.documents === null) return null;
  return { v: 1, gates: o.gates as Draft["gates"], answers: o.answers as Draft["answers"], documents: o.documents as Draft["documents"], started: o.started === true };
}
