// お金の3つの分け方（説明用の図。0032）の提示用の値を作る部品。アプリの「資産と負債」のタブの区画・結果のタブの一行の知らせ・
// 持ち帰り用のレポートの1ページと、提案書の1ページで同じものを使う（中身の一覧の並びと言葉をそろえる。バランスシートの分け方 bsGroups.ts と同じ考え方）。
// - 計算は計算エンジンの側の関数（engine/src/explain/moneyThree.ts）。ここは今の置き場所（資産と負債のタブの「今」と同じ分け方）を渡し、
//   できごとの名前・文・中身の一覧を作るだけ。キャッシュフロー表・結果の計算には混ぜない。
// - 3つの箱は同じ形: 名前と額・中身の一文・いつも見える中身の一覧（貯めるお金は賄えない分のある年。多ければ大きい順に上から＋「ほか○件」）・ひと言。
//   貯めるお金の全部の表（年・できごと・支出・収入の残り・賄えない分）は別に持つ（画面では「内訳を見る」で開く）。
// - 文は事実だけ（勧める言葉は書かない）。物の ID・FP のメモは入れない
import { moneyThree, MONEY_THREE_MONTHS, MONEY_THREE_YEARS, type MoneyThreeEventPart, type MoneyThreeRegularKind, type MoneyThreeResult } from "../../engine/src/explain/moneyThree.ts";
import { bsSeries, type BsGroup, type Yen } from "./bsGroups.ts";
import type { TableCell } from "./bundle.ts";
import { parseYm, roles } from "./build.ts";

/** 文の1つ（strong は強調） */
export interface TextPart {
  text: string;
  strong?: boolean;
}

/** 計算の要求のうち、この部品が読むところ（アプリの画面の型でも、エンジンの型でも渡せるように、要るところだけ） */
export interface MoneyThreeHouseholdRequest {
  input: {
    baseMonth: string;
    endYear: number;
    household: {
      members: readonly { id: string; kind: string; sex: string; birth: { birthYearMonth: string; bornOnFirst: boolean } }[];
      goals?: readonly { kind: string; owner?: string; education?: { stages: readonly { stage: string }[] } }[];
      cars?: readonly { id: string; purchase?: { first: unknown; owned?: boolean } }[];
      periodicExpenses?: readonly { id: string; row: string; label?: string; everyYears: number; monthly?: boolean; to?: unknown }[];
      accounts?: readonly { kind: string; uninvested?: number }[];
      residences?: readonly { id: string }[];
      debts?: readonly { id: string; kind: string; property?: string }[];
    };
  };
}

/** 呼び方: 使う・貯める・増やす（既定）／すぐ使う・近いうちに使う・しばらく使わない */
export type MoneyThreeWording = "use" | "time";

/** お金の3つの分け方の表示の設定（資産と負債のタブの表示の設定の中） */
export interface MoneyThreeSettings {
  /** 使うお金: ふだんの支出の何か月分か */
  months: number;
  /** 貯めるお金: 今後何年のできごとを数えるか */
  years: number;
  wording: MoneyThreeWording;
}

export type MoneyThreeKey = "spend" | "save" | "grow";

/** 箱の中身の一覧の1行（例: 「2027 車の買い替え 180万円」「基本生活費 月25万円」「− 使うお金 192万円」） */
export interface MoneyThreeItem {
  /** 先頭の文字（年・符号）。無ければ空 */
  lead: string;
  label: string;
  amount: Yen;
  /** 金額の前に付ける（「月」） */
  per: string;
}

/** 1つの箱（使うお金・貯めるお金・増やすお金）。3つとも同じ形: 名前と額、中身の一文、いつも見える中身の一覧、まとめ、ひと言 */
export interface MoneyThreeBox {
  key: MoneyThreeKey;
  name: string;
  /** 箱の額（0 以上。増やすお金がマイナスのときは 0） */
  amount: Yen;
  /** 中身の一文（例: 「ふだんの支出 月32万円 × 6か月」） */
  formula: string;
  items: MoneyThreeItem[];
  /** 一覧に出しきれない分（例: ほか3件 120万円） */
  rest: { count: number; amount: Yen } | null;
  /** 一覧の下のひと言（例: 収入で賄える年は入れていません） */
  note: string | null;
}

/** 貯めるお金の全部の表（内訳を見る）の1行 */
export interface MoneyThreeRow {
  year: number;
  label: string;
  expense: Yen;
  leftover: Yen;
  uncovered: Yen;
}

/** 今の置き場所の1項目（資産と負債のタブの「今」と同じ分け方・色） */
export interface MoneyThreePlace {
  key: string;
  label: string;
  group: BsGroup;
  amount: Yen;
  /** 預金など（すぐ使えるお金）に数える */
  liquid: boolean;
}

export interface MoneyThreeModel {
  /** 今の時点の年（計算基準年） */
  year: number;
  settings: MoneyThreeSettings;
  limits: { months: [number, number]; years: [number, number] };
  /** 呼び方（使う・貯める・増やすの順） */
  names: [string, string, string];
  boxes: [MoneyThreeBox, MoneyThreeBox, MoneyThreeBox];
  /** ふだんの支出の月額（使うお金の中身の一文を、何か月の欄と並べて組み立てるため） */
  spendMonthly: Yen;
  /** 貯めるお金の数えた年（例: 2027〜2036年）と、プランの最後の年で短くなったときのひと言 */
  range: string;
  clipped: string | null;
  /** 貯めるお金の全部の表 */
  table: MoneyThreeRow[];
  place: { lines: MoneyThreePlace[]; total: Yen; liquid: Yen; liquidName: string };
  status: "over" | "short" | "even";
  /** 預金など − (使う＋貯める) */
  gap: Yen;
  need: Yen;
  /** 金融資産の合計でも足りない分 */
  overFinancial: Yen;
  /** 区画の上の文（事実だけ。勧める言葉は書かない） */
  say: { head: TextPart[]; sub: TextPart[]; eq: string | null };
}

export const DEFAULT_MONEY_THREE: MoneyThreeSettings = { months: MONEY_THREE_MONTHS.default, years: MONEY_THREE_YEARS.default, wording: "use" };

/** 呼び方の選択肢（表示の設定） */
export const MONEY_THREE_NAME_CHOICES: readonly { key: MoneyThreeWording; names: [string, string, string]; note: string }[] = [
  { key: "use", names: ["使うお金", "貯めるお金", "増やすお金"], note: "使い道で呼ぶ（既定）" },
  { key: "time", names: ["すぐ使うお金", "近いうちに使うお金", "しばらく使わないお金"], note: "使う時期で呼ぶ" },
];

export const namesOf = (k: MoneyThreeWording): [string, string, string] => (MONEY_THREE_NAME_CHOICES.find((c) => c.key === k) ?? MONEY_THREE_NAME_CHOICES[0])!.names;

const intIn = (v: unknown, min: number, max: number, def: number): number => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : def);

/** 保存した表示の設定から読む（形が合わなければ既定） */
export function readMoneyThree(v: unknown): MoneyThreeSettings {
  const d = DEFAULT_MONEY_THREE;
  if (typeof v !== "object" || v === null) return { ...d };
  const o = v as Record<string, unknown>;
  return {
    months: intIn(o.months, MONEY_THREE_MONTHS.min, MONEY_THREE_MONTHS.max, d.months),
    years: intIn(o.years, MONEY_THREE_YEARS.min, MONEY_THREE_YEARS.max, d.years),
    wording: o.wording === "time" || o.wording === "use" ? o.wording : d.wording,
  };
}

/** 万円の文字列（四捨五入。マイナスは▲。アプリの presentation/format.ts の man と同じ） */
function man(yen: number): string {
  const v = Math.round(Math.abs(yen) / 10000);
  const s = String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (yen < 0 && v !== 0 ? "▲" : "") + s;
}

const STAGE_AGE: Record<string, number> = { elementary: 6, juniorHigh: 12, highSchool: 15, university: 18 };

/** 学校に入る年（4月2日〜翌年4月1日生まれが同じ学年） */
function entryYear(birthYearMonth: string, bornOnFirst: boolean, stage: string): number | null {
  const age = STAGE_AGE[stage];
  if (age === undefined) return null;
  const { y, m } = parseYm(birthYearMonth);
  return y + age + (m < 4 || (m === 4 && bornOnFirst) ? 0 : 1);
}

/** 中身の一覧に出すできごとの数（超えた分は「ほか○件」にまとめる） */
export const MONEY_THREE_LIST_MAX = 6;

const mn = (v: number) => `${man(v)}万円`;
const strong = (text: string): TextPart => ({ text, strong: true });
const plain = (text: string): TextPart => ({ text });

const REGULAR_LABEL: Record<MoneyThreeRegularKind, string> = { living: "基本生活費", housing: "住まい", insurance: "保険料", other: "その他" };
const STAGE_NAME: Record<string, string> = { nursery: "保育所", kindergarten: "幼稚園", elementary: "小学校", juniorHigh: "中学校", highSchool: "高校", university: "大学" };
const PERIODIC_ROW: Record<string, string> = {
  "cf.expense.housing.maintenance": "住まいの修繕",
  "cf.expense.lumpSum.car": "車の買い替え",
  "cf.expense.lumpSum.wedding": "結婚の費用",
  "cf.expense.lumpSum.gift": "贈り物・援助",
  "cf.expense.care.medical": "医療の費用",
};

/** できごとの名前を決める（構成員の呼び方・学校の入学の年・車の買い替え・周期的な支出の見出し） */
function partLabeler(req: MoneyThreeHouseholdRequest): (year: number, p: MoneyThreeEventPart) => string {
  const rs = roles(req);
  const h = req.input.household;
  const cars = new Map((h.cars ?? []).map((c) => [c.id, c]));
  const periodic = new Map((h.periodicExpenses ?? []).map((p) => [p.id, p]));
  const entries = new Map<string, { stage: string; year: number }[]>();
  for (const g of h.goals ?? []) {
    if (g.kind !== "education" || g.owner === undefined) continue;
    const r = rs.find((x) => x.member.id === g.owner);
    if (r === undefined) continue;
    const list = entries.get(r.member.id) ?? [];
    for (const s of g.education?.stages ?? []) {
      const y = entryYear(r.member.birth.birthYearMonth, r.member.birth.bornOnFirst, s.stage);
      if (y !== null) list.push({ stage: s.stage, year: y });
    }
    entries.set(r.member.id, list);
  }
  return (year, p) => {
    switch (p.kind) {
      case "education": {
        const r = rs.find((x) => x.member.id === p.member);
        const who = r !== undefined ? `${r.label}の` : "";
        const list = r !== undefined ? (entries.get(r.member.id) ?? []) : [];
        const entry = list.find((e) => e.year === year);
        if (entry !== undefined) return `${who}${STAGE_NAME[entry.stage] ?? "学校"}入学`;
        const uni = list.find((e) => e.stage === "university" && year > e.year && year <= e.year + 5);
        if (uni !== undefined) return `${who}大学${year - uni.year + 1}年目`;
        return `${who}教育費`;
      }
      case "carPurchase": {
        const c = p.object !== undefined ? cars.get(p.object) : undefined;
        const at = c?.purchase !== undefined && typeof c.purchase.first === "object" && c.purchase.first !== null ? (c.purchase.first as { at?: unknown }).at : undefined;
        const first = typeof at === "string" ? parseYm(at).y : null;
        return c?.purchase !== undefined && c.purchase.owned !== true && first === year ? "車の購入" : "車の買い替え";
      }
      case "carLoan":
        return "車のローンの返済";
      case "homePurchase":
        return "住まいの取得（頭金・諸費用）";
      case "prepayment":
        return "住宅ローンの繰り上げ返済";
      case "care":
        return "介護の費用";
      case "wedding":
        return "結婚の費用";
      case "gift":
        return "贈り物・援助";
      case "funeral":
        return "葬儀の費用";
      case "periodic": {
        const e = p.object !== undefined ? periodic.get(p.object) : undefined;
        const label = e?.label?.trim();
        if (label !== undefined && label !== "") return label;
        return PERIODIC_ROW[p.row] ?? (e === undefined ? "周期的な支出" : e.everyYears >= 2 ? `${e.everyYears}年ごとの支出` : "一時的な支出");
      }
      default:
        return "一時的な支出";
    }
  };
}

/** その年のできごとの名前（大きい順に、同じ名前は1つ。3つを超えたら「ほか」） */
function yearLabel(year: number, parts: readonly MoneyThreeEventPart[], label: (y: number, p: MoneyThreeEventPart) => string): string {
  const names: string[] = [];
  for (const p of parts) {
    const n = label(year, p);
    if (!names.includes(n)) names.push(n);
  }
  return names.length > 3 ? `${names.slice(0, 3).join("・")} ほか` : names.join("・");
}

/** 今の置き場所（計算基準年の年末。資産と負債のタブの「今」と同じ分け方）。まとめた金融資産の運用しない分は預金などに数える */
export function placementOf(req: MoneyThreeHouseholdRequest, table: readonly TableCell[]): MoneyThreePlace[] {
  const h = req.input.household;
  const y0 = parseYm(req.input.baseMonth).y;
  const at = bsSeries(table, [y0], { residences: h.residences ?? [], debts: (h.debts ?? []).map((d) => ({ id: d.id, kind: d.kind, ...(d.property !== undefined ? { property: d.property } : {}) })) })[0];
  if (at === undefined) return [];
  const uninvested = (h.accounts ?? []).filter((a) => a.kind === "pooled").reduce((s, a) => s + Math.max(0, a.uninvested ?? 0), 0);
  const fin: BsGroup[] = ["liquid", "market", "locked"];
  const out: MoneyThreePlace[] = [];
  for (const l of at.lines) {
    if (!fin.includes(l.group)) continue;
    if (l.key === "pooled" && uninvested > 0) {
      const keep = Math.min(uninvested, l.amount);
      out.push({ key: "pooledCash", label: "まとめた金融資産（運用しない分）", group: "liquid", amount: keep, liquid: true });
      if (l.amount - keep > 0) out.push({ key: "pooled", label: "まとめた金融資産（運用する分）", group: "market", amount: l.amount - keep, liquid: false });
      continue;
    }
    out.push({ key: l.key, label: l.label, group: l.group, amount: l.amount, liquid: l.group === "liquid" });
  }
  // 預金など → 値動きのある運用 → 引き出せないお金 の順（すぐ使えるものほど上）
  const order: BsGroup[] = ["liquid", "market", "locked"];
  return out.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
}

/** 「預金」「預金など」（すぐ使えるお金の中身で決める） */
function liquidNameOf(lines: readonly MoneyThreePlace[]): string {
  const ls = lines.filter((l) => l.liquid);
  return ls.length === 0 || (ls.length === 1 && ls[0]?.key === "deposit") ? "預金" : "預金など";
}

/** 使う＋貯めるの範囲に入っている、預金など以外の置き場所（上から積んだときに重なる分） */
function inNeed(lines: readonly MoneyThreePlace[], need: number): { label: string; amount: number }[] {
  let y = 0;
  const out: { label: string; amount: number }[] = [];
  for (const l of lines) {
    const from = y;
    y += l.amount;
    if (l.liquid) continue;
    const a = Math.min(y, need) - from;
    if (a > 0) out.push({ label: l.label, amount: a });
  }
  return out;
}

export interface MoneyThreeInput {
  req: MoneyThreeHouseholdRequest;
  table: readonly TableCell[];
  settings: MoneyThreeSettings;
}

/** 計算の側の値（テスト・提案書の入力でも使う） */
export function moneyThreeResult(o: MoneyThreeInput): { result: MoneyThreeResult; lines: MoneyThreePlace[] } {
  const lines = placementOf(o.req, o.table);
  const financial = lines.reduce((s, l) => s + l.amount, 0);
  const liquid = lines.filter((l) => l.liquid).reduce((s, l) => s + l.amount, 0);
  const result = moneyThree(o.req, o.table, { liquid, financial }, { months: o.settings.months, years: o.settings.years });
  return { result, lines };
}

/** お金の3つの分け方の提示用の値 */
export function moneyThreeModel(o: MoneyThreeInput): MoneyThreeModel {
  const { result: r, lines } = moneyThreeResult(o);
  const N = namesOf(o.settings.wording);
  const label = partLabeler(o.req);
  const q = (s: string) => `「${s}」`;
  const liquidName = liquidNameOf(lines);

  // 使うお金
  const spendItems: MoneyThreeItem[] = r.spend.parts.filter((p) => p.monthly > 0).map((p) => ({ lead: "", label: REGULAR_LABEL[p.kind], amount: p.monthly, per: "月" }));
  const spend: MoneyThreeBox = {
    key: "spend",
    name: N[0],
    amount: r.spend.amount,
    formula: `ふだんの支出 月${mn(r.spend.monthly)} × ${r.months}か月`,
    items: spendItems,
    rest: null,
    note: `ふだんの支出は、毎年続く支出（${r.spend.year}年の値）。教育費・車・住まいの取得などのできごとの支出は入れていません。`,
  };

  // 貯めるお金（賄えない分が 0 の年は一覧に出さない。多いときは大きい順に上から、残りをまとめる）
  const table: MoneyThreeRow[] = r.save.rows.map((x) => ({ year: x.year, label: yearLabel(x.year, x.parts, label), expense: x.eventTotal, leftover: x.leftover, uncovered: x.uncovered }));
  const positive = table.filter((x) => x.uncovered > 0);
  const top = positive.length > MONEY_THREE_LIST_MAX ? [...positive].sort((a, b) => b.uncovered - a.uncovered || a.year - b.year).slice(0, MONEY_THREE_LIST_MAX - 1) : positive;
  const shown = new Set(top);
  const restRows = positive.filter((x) => !shown.has(x));
  const range = r.save.toYear >= r.save.fromYear ? `${r.save.fromYear}〜${r.save.toYear}年` : "数える年なし";
  const clipped = r.save.clipped ? `プランの最後の年（${r.save.toYear}年）までで数えています。` : null;
  const zeroYears = table.length - positive.length;
  const save: MoneyThreeBox = {
    key: "save",
    name: N[1],
    amount: r.save.amount,
    formula: `今後${r.years}年（${range}）のできごとの支出のうち、その年の収入で賄えない分の合計`,
    items: [...top].sort((a, b) => a.year - b.year).map((x) => ({ lead: String(x.year), label: x.label, amount: x.uncovered, per: "" })),
    rest: restRows.length > 0 ? { count: restRows.length, amount: restRows.reduce((s, x) => s + x.uncovered, 0) } : null,
    note: positive.length === 0 ? (table.length === 0 ? "この期間に、できごとの支出はありません。" : "この期間のできごとの支出は、どれもその年の収入で賄えます。") : zeroYears > 0 ? "収入で賄える年は入れていません。" : null,
  };

  // 増やすお金
  const grow: MoneyThreeBox = {
    key: "grow",
    name: N[2],
    amount: Math.max(0, r.grow),
    formula: `金融資産から、${q(N[0])}と${q(N[1])}を引いた残り`,
    items: [
      { lead: "", label: "金融資産", amount: r.placement.financial, per: "" },
      { lead: "−", label: N[0], amount: r.spend.amount, per: "" },
      { lead: "−", label: N[1], amount: r.save.amount, per: "" },
    ],
    rest: null,
    note: r.grow < 0 ? `${q(N[0])}と${q(N[1])}が金融資産より${mn(r.overFinancial)}多いので、0 としています。` : null,
  };

  // 文（事実だけ）
  const both = `${q(N[0])}と${q(N[1])}`;
  let say: MoneyThreeModel["say"];
  if (r.status === "over") {
    say = {
      head: [plain(`${q(N[2])}${mn(Math.max(0, r.grow))}のうち、`), strong(mn(r.gap)), plain(` が${liquidName}のままです。`)],
      sub: [plain(`${liquidName} ${mn(r.placement.liquid)} は、${both}の分（合計 ${mn(r.need)}）より ${mn(r.gap)} 多くなっています。`)],
      eq: `${liquidName} ${man(r.placement.liquid)} − ${N[0]} ${man(r.spend.amount)} − ${N[1]} ${man(r.save.amount)} ＝ ${man(r.gap)}（万円）`,
    };
  } else if (r.status === "short") {
    const ins = inNeed(lines, r.need);
    const sub: TextPart[] = [];
    if (ins.length > 0) sub.push(plain(`この2つの分の範囲に、${ins.map((x) => `${x.label} ${mn(x.amount)}`).join("・")} が入っています。`));
    if (r.overFinancial > 0) sub.push(plain(`金融資産の合計（${mn(r.placement.financial)}）でも ${mn(r.overFinancial)} 足りません。`));
    say = {
      head: [plain(`${liquidName}だけでは、${both}の分が `), strong(mn(-r.gap)), plain(" 足りません。")],
      sub,
      eq: `${N[0]} ${man(r.spend.amount)} ＋ ${N[1]} ${man(r.save.amount)} − ${liquidName} ${man(r.placement.liquid)} ＝ ${man(-r.gap)}（万円）`,
    };
  } else {
    say = {
      head: [plain(`今の${liquidName}（${mn(r.placement.liquid)}）は、${both}の分（${mn(r.need)}）と`), strong("ほぼ同じ"), plain("です。")],
      sub: [plain(`差は ${mn(Math.abs(r.gap))} で、ふだんの支出の1か月分（${mn(r.threshold)}）より小さい差です。`)],
      eq: null,
    };
  }

  return {
    year: r.baseYear,
    settings: { ...o.settings },
    limits: { months: [MONEY_THREE_MONTHS.min, MONEY_THREE_MONTHS.max], years: [MONEY_THREE_YEARS.min, MONEY_THREE_YEARS.max] },
    names: N,
    boxes: [spend, save, grow],
    spendMonthly: r.spend.monthly,
    range,
    clipped,
    table,
    place: { lines, total: r.placement.financial, liquid: r.placement.liquid, liquidName },
    status: r.status,
    gap: r.gap,
    need: r.need,
    overFinancial: r.overFinancial,
    say,
  };
}
