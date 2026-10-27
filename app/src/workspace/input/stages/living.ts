// 5. 基本生活費のカード（0048）: 毎月の生活費（住居費・教育費・保険料・車の費用・税と社会保険料を除く）と、その時期ごとの変化。
// - 入れ方: 総額で／内訳で（簡易は6つの束、詳細は家計調査の9費目）。両方の値を持ち、選んだほうで計算する（切り替えても片方を消さない）
// - 段階: 推定の段階（子の誕生と独立・自宅外の在学・同居・施設の介護・退職・70歳・80歳。livingStages.ts。0049）と FP が足す段。表は詳細、簡易は札
// - 区画: 毎月の生活費／年払い・数年おきの暮らしの支出（お金の行。0044）／毎年の黒字のうち貯金に回る割合（0031。surplusSaving.ts）／
//   実際に貯められている額（答え合わせ。savingsChecks）
// - 医療費の窓口負担（70歳・75歳）は自動で変えない。保健医療の費目と「医療・介護」の行の説明に、段階で額を変えるよう書く
import type { Box, Household, LivingExpense, PeriodicExpense, Timepoint } from "../../../engine/types.ts";
import { addMonths, ageAt, ageReachedMonth, readLevers } from "../../levers.ts";
import { resolveTimepoint } from "../../timepoint.ts";
import { livingCategoryAverages } from "../../../../../hearing/src/estimates.ts";
import { householdSize, isPureSplit, livingEstimate, splitCategories } from "../estimates.ts";
import { byId, field, getPath, plain, removeAction, timepointField, yenBox, type ActionDef, type FieldDef, type Finder, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { confirmedBox, mutate, newId, presetBasis, type WorkingHousehold } from "../household.ts";
import { GROWTH_KINDS, LIVING_CATEGORIES, LIVING_STAGE_LABELS, memberLabel } from "../labels.ts";
import { applyAutoStages, autoActive, autoBasis, autoStages, autoStageTitle, isAutoStage, rememberDropped, settleStage, startLiving } from "../livingStages.ts";
import { addExpense, expenseCard, MEDICAL_HELP, moneySections } from "../moneyRows.ts";
import { readLine } from "../readLines.ts";
import { putRow } from "../rows.ts";
import type { Address } from "../../store/readings.ts";
import { onContingencyDetailFields, onContingencyFields } from "./onContingency.ts";
import { surplusSection } from "./surplusSaving.ts";

type Obj = Record<string, unknown>;
type Stage = NonNullable<LivingExpense["stages"]>[number];
type Category = NonNullable<LivingExpense["categories"]>[number];

const livings = (h: Household) => h.livingExpenses;
/** 生活費に入れない物（欄の下の1行） */
export const LIVING_NOTE = "税・社会保険料・住居費・教育費・保険料・車の費用は入れません（計算で別に出します）";
const NONE: ReadonlySet<string> = new Set();
const man = (yen: number) => `${(Math.round(yen / 1000) / 10).toLocaleString("ja-JP")}万円`;
const addr =
  (objectId: string, item: string, at: string[] = []): (() => Address) =>
  () => ({ target: { object: objectId }, item, at });
const withAddress = (f: FieldDef, a: () => Address): FieldDef => ({ ...f, address: a });

/** 節目の時点の目安: 子の独立＝一番下の子の独立、退職後＝本人の働く最後の年齢の翌月、70歳・80歳＝本人がその年齢になる月 */
export function stageDefaultAt(wh: WorkingHousehold, label: string): Timepoint {
  const h = wh.request.input.household;
  const self = h.members.find((m) => m.kind === "self");
  if (label === "childIndependence") {
    // 一番遅い子の独立。年齢・出来事で決めた独立なら、その形のまま指す（独立が動くと節目も動く。0038）
    const last = h.members
      .filter((m) => m.kind === "child" && m.leaves != null)
      .map((m) => ({ t: m.leaves as Timepoint, ym: resolveTimepoint(h, m.leaves) }))
      .filter((x): x is { t: Timepoint; ym: string } => x.ym !== null)
      .sort((a, b) => (a.ym < b.ym ? -1 : 1))
      .at(-1);
    if (last !== undefined) return last.t.at !== undefined ? { at: last.ym } : structuredClone(last.t);
  }
  if (label === "retirement" && self !== undefined) {
    const age = readLevers(wh.request, self.id).retireAge ?? 65;
    return { at: ageReachedMonth(self, age) };
  }
  if ((label === "age70" || label === "age80") && self !== undefined) return { memberAge: { member: self.id, years: label === "age70" ? 70 : 80, months: 0 } };
  return { at: addMonths(wh.request.input.baseMonth, 120) };
}

/** 伸び方の種類を変えたあと: 決まった率のときだけ率を持つ（0008 の追記の growth） */
export function fixGrowth(t: Record<string, unknown>, v: unknown): void {
  const g = t.growth as { kind?: string; rate?: string } | undefined;
  if (g === undefined) return;
  if (v === "rate") g.rate ??= "0.01";
  else delete g.rate;
  if (g.kind === undefined) delete t.growth;
}

/** 節目のボタンの割合（目安のボタンの値。最初の額に対して） */
const DEFAULT_RATIO: Record<string, string> = { childIndependence: "0.85", retirement: "0.8", age70: "0.75", age80: "0.7", other: "0.9" };

// ---- 費目（簡易の6つの束・詳細の9費目） ----

interface Bundle {
  key: string;
  label: string;
  cats: readonly string[];
  /** 束の合計を直したとき、差を置く費目（比例で配り直さない） */
  rep: string;
}

/** 簡易の6つの束（家計調査の9費目をまとめる） */
export const BUNDLES: readonly Bundle[] = [
  { key: "food", label: "食費", cats: ["food"], rep: "food" },
  { key: "utilities", label: "水道・光熱費", cats: ["utilities"], rep: "utilities" },
  { key: "daily", label: "日用品・衣服", cats: ["furniture", "clothing"], rep: "furniture" },
  { key: "transport", label: "交通・通信費（車を除く）", cats: ["transport"], rep: "transport" },
  { key: "recreation", label: "趣味・旅行（教養娯楽）", cats: ["recreation"], rep: "recreation" },
  { key: "misc", label: "医療・こづかい・その他", cats: ["health", "otherConsumption", "allowance"], rep: "otherConsumption" },
];

const catLabel = (c: string) => LIVING_CATEGORIES.find((o) => o.value === c)?.label ?? c;
const catOf = (l: LivingExpense | undefined, c: string): Category | undefined => (l?.categories ?? []).find((x) => x.category === c);
const CAT_HELP: Record<string, string> = {
  health: `通院・薬・医療用品など。${MEDICAL_HELP}（医療費だけを分けて伸ばしたいときは「年払い・数年おきの暮らしの支出」に「医療・介護」の行を足します）`,
  transport: "電車・バスの運賃・通信費。車の費用（ガソリン・駐車場・保険など）は車のカードで入れます",
  allowance: "親への仕送りは介護・親のカードの「親への仕送り」、子の自宅外の在学の仕送りは子ども・教育のカードでも入れられます（相手ごとに分けて見られます）。両方に入れると二重になります",
  otherConsumption: "こづかい・交際費・理美容など。内訳に分けていない分もここに入ります",
};

/** 同じ人数の世帯の平均（欄の横の目安） */
function averageHint(wh: WorkingHousehold, cats: readonly string[]): string | null {
  const avg = livingCategoryAverages(householdSize(wh.request.input.household, wh.request.input.baseMonth));
  if (avg === null) return null;
  const v = cats.reduce((s, c) => s + ((avg.amounts as Record<string, number>)[c] ?? 0), 0);
  return v > 0 ? `同じ人数の世帯の平均 月${man(v)}` : null;
}

function categoryField(l: LivingExpense, find: Finder, c: string, level: "simple" | "detail", label: string): FieldDef {
  const cat = catOf(l, c);
  const f = yenBox({
    // 欄のキーは並びの番号のまま（読み替え表と同じ）。まだ無い費目は費目の名前で
    key: `living/${l.id}/cat/${cat !== undefined ? String((l.categories ?? []).indexOf(cat)) : `new-${c}`}`,
    item: "livingExpense.categories",
    label,
    level,
    basis: "monthly",
    find: (h, w) => (getPath(find(h, w), ["categories"]) as Category[] | undefined)?.find((x) => x.category === c) as Obj | undefined,
    ensure: (h, w) => {
      const t = find(h, w) as unknown as LivingExpense;
      const el: Category = { id: newId(), category: c, monthly: confirmedBox(0) };
      (t.categories ??= []).push(el);
      return el as unknown as Obj;
    },
    path: ["monthly"],
    optional: true,
    ...(CAT_HELP[c] !== undefined ? { help: CAT_HELP[c] } : {}),
    hint: (w) => averageHint(w, [c]),
  });
  // 名前の左のアイコン（簡易の束は束の絵、詳細の「うち」は費目ごとの絵）
  f.icon = c;
  // 空にしたら、その費目を外す（入れていない費目は物を持たない）
  const g: FieldDef = {
    ...f,
    set: (wh, v) => (v === null ? (f.get(wh).value === null ? wh : dropCategory(wh, find, c)) : f.set(wh, v)),
    ...(f.write !== undefined ? { write: (wh: WorkingHousehold, v: Parameters<NonNullable<FieldDef["write"]>>[1]) => (v === null ? dropCategory(wh, find, c) : (f.write as NonNullable<FieldDef["write"]>)(wh, v)) } : {}),
  };
  return cat?.id !== undefined ? withAddress(g, addr(l.id, "livingExpense.categories", [cat.id, "monthly"])) : g;
}

function dropCategory(wh: WorkingHousehold, find: Finder, c: string): WorkingHousehold {
  return mutate(wh, (h, req) => {
    const t = find(h, { ...wh, request: req }) as unknown as LivingExpense | undefined;
    if (t === undefined) return;
    t.categories = (t.categories ?? []).filter((x) => x.category !== c);
    if (t.categories.length === 0) delete t.categories;
  });
}

/** 束の合計の欄（2つ以上の費目の束）。直すと、差を束の代表の費目に置く（ほかの費目はそのままの値で確定） */
function bundleField(l: LivingExpense, find: Finder, b: Bundle): FieldDef {
  const rep = catOf(l, b.rep);
  const f = field({
    key: `living/${l.id}/group/${b.key}`,
    item: "livingExpense.categories",
    label: b.label,
    level: "simple",
    kind: "yen",
    basis: "monthly",
    optional: true,
    help: `${b.cats.map(catLabel).join("・")}の合計。直すと、差を「${catLabel(b.rep)}」に置きます（ほかの内訳は今の値のまま）${b.key === "misc" ? `。${MEDICAL_HELP}` : ""}`,
    get: (wh) => {
      const t = find(wh.request.input.household, wh) as unknown as LivingExpense | undefined;
      const cs = b.cats.map((c) => catOf(t, c)).filter((x): x is Category => x !== undefined);
      if (cs.length === 0) return { value: null, hint: averageHint(wh, b.cats) };
      const est = cs.find((x) => x.monthly.state === "estimated");
      const basis = est === undefined ? null : ((est.monthly as { estimate?: { basis?: string } }).estimate?.basis ?? "推定");
      return { value: cs.reduce((s, x) => s + (x.monthly.value ?? 0), 0), estimated: basis, hint: averageHint(wh, b.cats) };
    },
    set: (wh, v) =>
      v === null
        ? wh
        : mutate(wh, (h, req) => {
            const t = find(h, { ...wh, request: req }) as unknown as LivingExpense | undefined;
            if (t === undefined) return;
            const list = (t.categories ??= []);
            const others = b.cats.filter((c) => c !== b.rep).reduce((s, c) => s + (catOf(t, c)?.monthly.value ?? 0), 0);
            const value = Math.max(0, Number(v) - others);
            const cur = catOf(t, b.rep);
            if (cur === undefined) list.push({ id: newId(), category: b.rep, monthly: confirmedBox(value) });
            else cur.monthly = confirmedBox(value);
            // 束の合計を FP が決めたので、束の中の推定の費目は今の値のまま確定にする（根拠は残す）
            for (const c of b.cats) {
              const x = catOf(t, c);
              if (x === undefined || c === b.rep || x.monthly.state !== "estimated") continue;
              const est = (x.monthly as { estimate?: unknown }).estimate;
              x.monthly = { ...confirmedBox(x.monthly.value ?? 0), ...(est !== undefined ? { estimate: est } : {}) } as Box<number>;
            }
          }),
  });
  // 値の状態の操作（確定・わからない・該当なし）は、束をまとめた箱で受ける: 確定は束の中の推定の費目を今の値のまま確定にし、
  // ほかの状態は代表の費目に当てる（代わりの値は、束の合計からほかの費目を引いた額）
  const membersOf = (t: LivingExpense | undefined) => b.cats.map((c) => catOf(t, c)).filter((x): x is Category => x !== undefined);
  const boxed: NonNullable<FieldDef["boxed"]> = {
    read: (wh) => {
      const cs = membersOf(find(wh.request.input.household, wh) as unknown as LivingExpense | undefined);
      if (cs.length === 0) return undefined;
      const est = cs.find((x) => x.monthly.state === "estimated");
      const value = cs.reduce((n, x) => n + (x.monthly.value ?? 0), 0);
      return est !== undefined ? { value, state: "estimated", origin: { kind: "auto" }, estimate: (est.monthly as { estimate?: unknown }).estimate ?? { method: "derived", basis: "推定" } } : { value, state: "confirmed", origin: { kind: "manual" } };
    },
    write: (wh, box) =>
      box === undefined
        ? wh
        : mutate(wh, (h, req) => {
            const t = find(h, { ...wh, request: req }) as unknown as LivingExpense | undefined;
            if (t === undefined) return;
            if (box.state === "confirmed") {
              for (const x of membersOf(t)) {
                if (x.monthly.state !== "estimated") continue;
                const est = (x.monthly as { estimate?: unknown }).estimate;
                x.monthly = { ...confirmedBox(x.monthly.value ?? 0), ...(est !== undefined ? { estimate: est } : {}) } as Box<number>;
              }
              return;
            }
            const others = b.cats.filter((c) => c !== b.rep).reduce((n, c) => n + (catOf(t, c)?.monthly.value ?? 0), 0);
            const next = structuredClone(box) as Record<string, unknown> & { substitute?: { value?: number } };
            if (typeof next.value === "number") next.value = Math.max(0, next.value - others);
            if (next.substitute !== undefined && typeof next.substitute.value === "number") next.substitute.value = Math.max(0, next.substitute.value - others);
            const cur = catOf(t, b.rep);
            if (cur === undefined) (t.categories ??= []).push({ id: newId(), category: b.rep, monthly: next as unknown as Box<number> });
            else cur.monthly = next as unknown as Box<number>;
          }),
  };
  const g: FieldDef = { ...f, boxed, icon: b.key };
  return rep?.id !== undefined ? withAddress(g, addr(l.id, "livingExpense.categories", [rep.id, "monthly"])) : g;
}

function categoryGroup(l: LivingExpense, find: Finder): GroupDef {
  const fields: FieldDef[] = [];
  for (const b of BUNDLES) {
    if (b.cats.length === 1) {
      fields.push(categoryField(l, find, b.rep, "simple", b.label));
      continue;
    }
    fields.push(bundleField(l, find, b));
    for (const c of b.cats) fields.push(categoryField(l, find, c, "detail", `うち ${catLabel(c)}`));
  }
  const total = (l.categories ?? []).reduce((s, c) => s + (c.monthly.value ?? 0), 0);
  const other = catOf(l, "otherConsumption");
  const moved = (other?.monthly as { estimate?: { basis?: string } } | undefined)?.estimate?.basis;
  const notes = [`合計 月${man(total)}`];
  if (moved !== undefined && moved.startsWith("総額で")) notes.push(moved);
  if (isPureSplit(l)) notes.push("総額を家計調査の同じ人数の世帯の割合で分けた目安です（直した内訳だけ確定になります）");
  return { key: `living/${l.id}/categories`, title: "内訳（月額）", note: notes.join("。"), level: "simple", fields, actions: [] };
}

/** 入れ方を切り替えたときの始末（総額と費目は両方持ち、片方を消さない。0048 の2） */
function switchMode(h: Household, wh: WorkingHousehold, t: LivingExpense, v: unknown): void {
  const base = wh.request.input.baseMonth;
  if (v === "byCategory") {
    const total = t.monthly?.value ?? livingEstimate(h, base).value;
    if ((t.categories ?? []).length === 0 || isPureSplit(t)) {
      t.categories = splitCategories(h, base, total, newId, t.categories);
      return;
    }
    // 費目で入れた後に総額を直したとき: 差は「その他の消費（まだ分けていない）」に置き、推定の印（比例で配り直さない）
    const sum = (t.categories ?? []).reduce((s, c) => s + (c.monthly.value ?? 0), 0);
    if (t.monthly?.value == null || sum === total) return;
    const diff = total - sum;
    const list = (t.categories ??= []);
    let other = list.find((c) => c.category === "otherConsumption");
    if (other === undefined) {
      other = { id: newId(), category: "otherConsumption", monthly: confirmedBox(0) };
      list.push(other);
    }
    const next = Math.max(0, (other.monthly.value ?? 0) + diff);
    const text = `総額で月${man(total)}に変えました。差の${man(Math.abs(diff))}を「その他の消費（まだ分けていない）」${diff >= 0 ? "に足しています" : "から引いています"}`;
    other.monthly = { value: next, state: "estimated", origin: { kind: "auto" }, estimate: { method: "derived", basis: text } } as Box<number>;
  } else if (v === "total" && (t.categories ?? []).length > 0) {
    const sum = (t.categories ?? []).reduce((s, c) => s + (c.monthly.value ?? 0), 0);
    if (t.monthly?.value === sum) return;
    const anyEstimated = (t.categories ?? []).some((c) => c.monthly.state === "estimated");
    t.monthly = anyEstimated ? ({ value: sum, state: "estimated", origin: { kind: "auto" }, estimate: { method: "derived", basis: "内訳の合計から" } } as Box<number>) : confirmedBox(sum);
  }
}

// ---- 段階 ----

/** 段の見出し（推定の段は理由から。FP が足した段は節目の名前） */
function stageTitles(wh: WorkingHousehold, l: LivingExpense): Map<string, string> {
  const h = wh.request.input.household;
  const out = new Map<string, string>();
  for (const a of autoStages(h, wh.request.input.baseMonth, wh.request.input.endYear, l.id))
    out.set(
      a.id,
      autoStageTitle(a, (id) => memberLabel(wh, id), h),
    );
  return out;
}

const baseMonthly = (l: LivingExpense | undefined): number => (l === undefined ? 0 : l.mode === "byCategory" ? (l.categories ?? []).reduce((s, c) => s + (c.monthly.value ?? 0), 0) : (l.monthly?.value ?? 0));

function stageGroups(wh: WorkingHousehold, l: LivingExpense, find: Finder): GroupDef[] {
  const h = wh.request.input.household;
  const self = h.members.find((m) => m.kind === "self");
  const titles = stageTitles(wh, l);
  const sorted = (l.stages ?? []).map((s, i) => ({ s, i, ym: resolveTimepoint(h, s.at) ?? "9999-12" })).sort((a, b) => a.ym.localeCompare(b.ym));
  // 標準に出す退職後の段: 節目が「退職後」の最初の段
  const retiredIndex = sorted.find((x) => x.s.label === "retirement")?.i;
  return sorted.map(({ s, i, ym }, n): GroupDef => {
    const sid = s.id;
    const findStage: Finder = (hh, w) => {
      const list = (getPath(find(hh, w), ["stages"]) as Stage[] | undefined) ?? [];
      return (sid !== undefined ? list.find((x) => x.id === sid) : list[i]) as Obj | undefined;
    };
    // 欄のキーは並びの番号のまま（読み替え表・動かす項目のキーと同じ。当て先は段の ID で持つ）
    const key = `living/${l.id}/stage/${i}`;
    const put = (f: FieldDef, tail: string[]): FieldDef => (sid === undefined ? f : withAddress(f, addr(l.id, "livingExpense.stages", [sid, ...tail])));
    // 推定の段の割合は、値の状態の行（推定）の根拠を欄に見せる
    const est = (f: FieldDef): FieldDef =>
      sid === undefined
        ? f
        : {
            ...f,
            get: (w) => {
              const st = f.get(w);
              const t = find(w.request.input.household, w) as unknown as LivingExpense | undefined;
              const basis = t === undefined ? null : autoBasis(t, sid);
              return basis === null ? st : { ...st, estimated: basis };
            },
          };
    // 推定の段の時点・入れ方・節目を FP が直したら、その段を確定にする（割合の推定の行を外す。割合を直したときは値の状態の決まりで外れる）
    const settleAfter = (w0: WorkingHousehold, w1: WorkingHousehold): WorkingHousehold => {
      if (w1 === w0 || sid === undefined) return w1;
      const t = find(w1.request.input.household, w1) as unknown as LivingExpense | undefined;
      if (t === undefined || !isAutoStage(t, sid)) return w1;
      return mutate(w1, (hh, req) => {
        const x = find(hh, { ...w1, request: req }) as unknown as LivingExpense | undefined;
        if (x !== undefined) settleStage(x, sid);
      });
    };
    const settle = (f: FieldDef): FieldDef => {
      if (sid === undefined) return f;
      const write = f.write;
      const time = f.time;
      return {
        ...f,
        set: (w, v) => settleAfter(w, f.set(w, v)),
        ...(write !== undefined ? { write: (w: WorkingHousehold, v: Parameters<typeof write>[1]) => settleAfter(w, write(w, v)) } : {}),
        ...(time !== undefined ? { time: { ...time, setWhen: (w: WorkingHousehold, tp: Timepoint | null, how: "auto" | "this") => settleAfter(w, time.setWhen(w, tp, how)) } } : {}),
      };
    };
    const auto = sid !== undefined && isAutoStage(l, sid);
    const base = baseMonthly(l);
    const byAmount = s.monthly !== undefined;
    // 退職後の段（最初の1つ）の割合・月額だけは標準にも出す（推定の当たり外れが大きく、顧客が「今の何割」と答えられる。ほかの節目は詳細。0078）
    const retiredStd = i === retiredIndex;
    const valueLevel = retiredStd ? "simple" : "detail";
    const fields: FieldDef[] = [
      settle(put(plain({ key: `${key}/label`, item: "livingExpense.stages", label: "節目", level: "detail", kind: "select", options: LIVING_STAGE_LABELS, find: findStage, path: ["label"] }), ["label"])),
      settle(
        put(
          timepointField({ key: `${key}/at`, item: "livingExpense.stages", label: "いつから", level: "detail", find: findStage, path: ["at"], ...(self !== undefined ? { ageOf: (hh: Household) => hh.members.find((m) => m.id === self.id) } : {}) }),
          ["at"],
        ),
      ),
      settle(
        put(
          field({
            key: `${key}/mode`,
            item: "livingExpense.stages",
            label: "入れ方",
            level: "detail",
            kind: "select",
            options: [
              { value: "ratio", label: "最初の額に対する割合で" },
              { value: "monthly", label: "月額で" },
            ],
            structural: true,
            get: (w) => {
              const x = findStage(w.request.input.household, w);
              return { value: x === undefined ? null : x.monthly !== undefined ? "monthly" : "ratio" };
            },
            set: (w, v) =>
              mutate(w, (hh, req) => {
                const x = findStage(hh, { ...w, request: req });
                if (x === undefined) return;
                const cur = find(hh, { ...w, request: req }) as unknown as LivingExpense | undefined;
                if (v === "monthly") {
                  const r = Number(x.ratio ?? "1");
                  x.monthly = confirmedBox(Math.round(baseMonthly(cur) * r));
                  delete x.ratio;
                } else if (v === "ratio") {
                  const m = (x.monthly as Box<number> | undefined)?.value ?? 0;
                  const b = baseMonthly(cur);
                  x.ratio = b > 0 ? String(Math.round((m / b) * 100) / 100) : "1";
                  delete x.monthly;
                }
              }),
          }),
          [],
        ),
      ),
      byAmount
        ? put(
            yenBox({
              key: `${key}/monthly`,
              item: "livingExpense.stages",
              label: retiredStd ? "退職後の生活費（月額）" : "その後の月額",
              level: valueLevel,
              basis: "monthly",
              find: findStage,
              path: ["monthly"],
              hint: () => (base > 0 && s.monthly?.value != null ? `今の額の${Math.round((s.monthly.value / base) * 100)}%` : null),
            }),
            ["monthly"],
          )
        : est(
            put(
              plain({
                key: `${key}/ratio`,
                item: "livingExpense.stages",
                label: retiredStd ? "退職後の生活費（今の額に対する割合）" : "その後の割合（最初の額に対して）",
                level: valueLevel,
                kind: "pct",
                find: findStage,
                path: ["ratio"],
                hint: (v) => (base > 0 && v !== null ? `＝月${man(Math.round(base * Number(v)))}（今の値段）` : null),
              }),
              ["ratio"],
            ),
          ),
    ];
    const name = (sid !== undefined ? titles.get(sid) : undefined) ?? LIVING_STAGE_LABELS.find((o) => o.value === s.label)?.label ?? "節目";
    const when = self !== undefined && ym !== "9999-12" ? `（${ym.slice(0, 4)}年・${memberLabel(wh, self.id)}${ageAt(self, ym)}歳）` : "";
    return {
      key,
      title: `段階 ${n + 1}: ${name}${when}`,
      ...(auto ? { note: "推定の段階（人数の変化と年齢から）。家族・進路・働き方が変わると入れ直します。この段を直すと、この段だけ確定になります（外すと、入れ直しでも足しません）" } : {}),
      level: valueLevel,
      fields,
      actions: [
        removeAction(`${key}/remove`, "この段階を外す", "detail", (hh, w) => {
          const t = find(hh, w) as unknown as LivingExpense | undefined;
          if (t === undefined) return;
          t.stages = (t.stages ?? []).filter((x, j) => (sid !== undefined ? x.id !== sid : j !== i));
          if (t.stages.length === 0) delete t.stages;
          if (auto && sid !== undefined) rememberDropped(t, sid);
        }),
      ],
    };
  });
}

/** 節目を足すボタン（目安のボタンの値＝推定。0041）と、推定の段階を入れるボタン */
function stageActions(l: LivingExpense, find: Finder): { simple: ActionDef[]; detail: ActionDef[] } {
  const have = new Set((l.stages ?? []).map((s) => s.label));
  const add = (label: string, text: string): ActionDef => ({
    key: `living/${l.id}/addStage/${label}`,
    label: `＋ ${text}`,
    level: "detail",
    run: (w) =>
      mutate(w, (h, req) => {
        const t = find(h, { ...w, request: req }) as unknown as LivingExpense | undefined;
        if (t === undefined) return;
        const id = newId();
        const ratio = DEFAULT_RATIO[label] ?? "0.9";
        (t.stages ??= []).push({ id, at: stageDefaultAt({ ...w, request: req }, label), label, ratio });
        putRow(
          req.input as unknown as Obj,
          { target: { object: t.id }, item: "livingExpense.stages", at: [id, "ratio"] },
          { state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: presetBasis(`${text} ${Math.round(Number(ratio) * 100)}%`) } },
        );
      }),
  });
  const detail: ActionDef[] = LIVING_STAGE_LABELS.filter((o) => o.value !== "other" && !have.has(o.value)).map((o) => add(o.value, o.label));
  detail.push(add("other", "その他の節目"));
  const simple: ActionDef[] = [];
  if (!autoActive(l)) {
    const none = (l.stages ?? []).length === 0;
    const fill: ActionDef = {
      key: `living/${l.id}/autoStages`,
      label: none ? "子の誕生・独立・退職などで、生活費の段階を推定で入れる" : `推定の段階に入れ替える（今の段階 ${(l.stages ?? []).length}段を外します）`,
      level: none ? "simple" : "detail",
      ...(none ? {} : { danger: true }),
      title: "家計調査の世帯人員別の目安の比と、退職後80%・70歳から75%・80歳から70%の目安で段を作ります。家族・進路・働き方が変わると入れ直します",
      run: (w) =>
        mutate(w, (h, req) => {
          const t = find(h, { ...w, request: req }) as unknown as LivingExpense | undefined;
          if (t === undefined) return;
          delete t.stages;
          applyAutoStages(h, req.input.baseMonth, req.input.endYear, t, true);
        }),
    };
    (none ? simple : detail).push(fill);
  }
  return { simple, detail };
}

// ---- 毎月の生活費のまとまり ----

/** 生活費の万一のときの扱いの「指定しない」は、死亡のとき遺族の生活費の割合（万一のタブ）が効く */
const survivorDefault = (f: FieldDef): FieldDef => (f.kind === "select" ? { ...f, options: f.options.map((o) => (o.value === "" ? { ...o, label: "指定しない（死亡は遺族の生活費の割合）" } : o)) } : f);

function survivorText(wh: WorkingHousehold): string {
  const r = wh.contingency.survivor.livingRatio ?? {};
  const pct = (x: string | undefined, d: string) => `${Math.round(Number(x ?? d) * 100)}%`;
  const hasChild = wh.request.input.household.members.some((m) => m.kind === "child" && m.outside === undefined);
  return hasChild ? `末子の独立まで ${pct(r.beforeIndependence, "0.7")}・独立の後 ${pct(r.afterIndependence, "0.5")}` : pct(r.noChildren, "0.7");
}

function livingGroups(wh: WorkingHousehold, l: LivingExpense, index: number): GroupDef[] {
  const find = byId(livings, l.id);
  const key = `living/${l.id}`;
  const main: FieldDef[] = [
    withAddress(
      plain({
        key: `${key}/mode`,
        item: "livingExpense.mode",
        label: "入れ方",
        level: "simple",
        kind: "select",
        options: [
          { value: "total", label: "総額で" },
          { value: "byCategory", label: "内訳で" },
        ],
        structural: true,
        help: "切り替えても、もう片方の値は消しません（選んだほうで計算します）",
        find,
        path: ["mode"],
        after: (h, t, v) => switchMode(h, wh, t as unknown as LivingExpense, v),
      }),
      addr(l.id, "livingExpense.mode"),
    ),
  ];
  if (l.mode === "total")
    main.push(
      withAddress(
        yenBox({
          key: `${key}/monthly`,
          item: "livingExpense.monthly",
          label: "基本生活費（月額）",
          level: "simple",
          basis: "monthly",
          find,
          path: ["monthly"],
          estimate: (h) => livingEstimate(h, wh.request.input.baseMonth),
          help: "空欄なら統計の目安（世帯の人数ごと）で計算します。結果の対策「毎月の生活費」でも動かせます",
        }),
        addr(l.id, "livingExpense.monthly"),
      ),
    );
  main.push(
    withAddress(
      plain({
        key: `${key}/growth`,
        item: "livingExpense.growth",
        label: "伸び方",
        // 中身は前提条件の物価上昇率そのもので、世帯ごとに変える理由が少ないので詳細（0078）
        level: "detail",
        kind: "select",
        options: GROWTH_KINDS,
        find,
        path: ["growth", "kind"],
        fallback: "inflation",
        optional: true,
        help: "額は今の値段で入れます。物価上昇率は「前提条件」で決めます",
        after: (_h, t, v) => fixGrowth(t, v),
      }),
      addr(l.id, "livingExpense.growth", ["kind"]),
    ),
  );
  if (l.growth?.kind === "rate")
    main.push(
      withAddress(
        plain({ key: `${key}/growthRate`, item: "livingExpense.growth", label: "決まった変動率（年）", level: "detail", kind: "pct", find, path: ["growth", "rate"], help: "マイナスも入れられます" }),
        addr(l.id, "livingExpense.growth", ["rate"]),
      ),
    );
  const selfId = wh.request.input.household.members.find((m) => m.kind === "self")?.id;
  const selfAge = selfId !== undefined ? { ageOf: (h: Household) => h.members.find((m) => m.id === selfId), mode: "ym" as const } : {};
  main.push(
    withAddress(
      timepointField({ key: `${key}/from`, item: "livingExpense.from", label: "始まり", level: "detail", find, path: ["from"], ...selfAge, optional: true, absentWhenEmpty: true, nullText: "計算の初めから" }),
      addr(l.id, "livingExpense.from"),
    ),
    withAddress(
      timepointField({ key: `${key}/to`, item: "livingExpense.to", label: "終わり", level: "detail", find, path: ["to"], startPath: ["from"], ...selfAge, optional: true, absentWhenEmpty: true, nullText: "最後まで" }),
      addr(l.id, "livingExpense.to"),
    ),
  );
  const onItem = "livingExpense.onContingency";
  main.push(
    ...onContingencyFields({
      key: `${key}/on`,
      item: onItem,
      find,
      path: ["onContingency"],
      level: "detail",
      help: "指定しないときは、死亡のときだけ万一のタブの遺族の生活費の割合を当てます（障害・就業不能では変えません）。指定すると、その扱いが遺族の生活費の割合の代わりになります",
    }).map((f) => withAddress(survivorDefault(f), addr(l.id, onItem))),
    ...onContingencyDetailFields({ key: `${key}/on`, item: onItem, find, path: ["onContingency"], on: l.onContingency, level: "detail" }).map((f) => withAddress(f, addr(l.id, onItem))),
    { ...readLine(`living/${l.id}/survivor`, "万一（死亡）のときの遺族の生活費", survivorText(wh), "万一のタブ"), level: "detail" },
  );
  const stages = l.stages ?? [];
  const autoCount = stages.filter((s) => s.id !== undefined && isAutoStage(l, s.id)).length;
  const badge = stages.length === 0 ? null : `この後 ${stages.length}段${autoCount > 0 ? `（推定 ${autoCount}段）` : ""}。詳細で直せます`;
  const groups: GroupDef[] = [
    {
      key,
      title: index === 0 ? "毎月の生活費" : `毎月の生活費 ${index + 1}`,
      note: [LIVING_NOTE, badge].filter((x) => x !== null).join("。"),
      level: "simple",
      fields: main,
      actions: index === 0 ? [] : [removeAction(`${key}/remove`, "外す", "detail", (h) => void (h.livingExpenses = (h.livingExpenses ?? []).filter((x) => x.id !== l.id)))],
    },
  ];
  if (l.mode === "byCategory") groups.push(categoryGroup(l, find));
  groups.push(...stageGroups(wh, l, find));
  const acts = stageActions(l, find);
  if (acts.simple.length > 0) groups.push({ key: `${key}/stages/auto`, level: "simple", note: "子の誕生・独立、退職、70歳・80歳などで生活費が変わる段階がまだありません", fields: [], actions: acts.simple });
  groups.push({ key: `${key}/stages/add`, title: "段階を足す", level: "detail", note: "段階は、その時点から「最初の額に対する割合」か「月額（今の値段）」に変えます。何段でも足せます", fields: [], actions: acts.detail });
  return groups;
}

// ---- 年払い・数年おきの暮らしの支出（お金の行。0044 の基本生活費の区画） ----

export interface AnnualTemplate {
  key: string;
  label: string;
  amount: number;
  everyYears: number;
  row?: string;
  match: RegExp;
}

/** 聞き漏れの確かめの一覧（ひな形の目安。統計ではない） */
export const ANNUAL_TEMPLATES: readonly AnnualTemplate[] = [
  { key: "homecoming", label: "帰省", amount: 100000, everyYears: 1, match: /帰省/u },
  { key: "appliances", label: "家電の買い替え", amount: 250000, everyYears: 8, match: /家電/u },
  { key: "furniture", label: "家具の買い替え", amount: 200000, everyYears: 10, match: /家具/u },
  { key: "fees", label: "年会費・サブスクの年払い", amount: 30000, everyYears: 1, match: /年会費|サブスク|会費/u },
  { key: "ceremonies", label: "冠婚葬祭のつきあい", amount: 50000, everyYears: 1, match: /冠婚|葬祭|祝儀|香典|つきあい/u },
  { key: "gifts", label: "お年玉・贈り物", amount: 30000, everyYears: 1, match: /お年玉|贈り物|歳暮|中元|ギフト/u },
  { key: "medical", label: "通院・歯の治療", amount: 50000, everyYears: 1, row: "cf.expense.care.medical", match: /通院|歯|治療|医療|病院/u },
  { key: "pet", label: "ペットの医療", amount: 50000, everyYears: 1, match: /ペット|動物病院/u },
  { key: "travel", label: "旅行", amount: 200000, everyYears: 1, match: /旅行/u },
];

const templateText = (t: AnnualTemplate) => `${t.label}（${t.everyYears === 1 ? "年" : `${t.everyYears}年ごとに`}${man(t.amount)}）`;

/** ひな形の行を足す（額は目安のボタンの値＝推定） */
export function addAnnual(wh: WorkingHousehold, t: AnnualTemplate, id: string = newId()): WorkingHousehold {
  const w = addExpense(wh, "livingAnnual", id);
  return mutate(w, (h) => {
    const p = (h.periodicExpenses ?? []).find((x) => x.id === id);
    if (p === undefined) return;
    p.label = t.label;
    p.everyYears = t.everyYears;
    if (t.row !== undefined) p.row = t.row;
    p.amount = { value: t.amount, state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: presetBasis(`ひな形の目安 ${templateText(t)}`) } } as PeriodicExpense["amount"];
  });
}

const CARD_NAMES: Record<string, string> = { events: "ライフイベント", housing: "住まい・ローン", car: "車", education: "子ども・教育", care: "介護・親", living: "基本生活費" };

/** 聞き漏れの確かめ（入れた所を自動で見る。読むだけの行と、まだ無い物を足すボタン） */
function annualChecklist(wh: WorkingHousehold, skip: ReadonlySet<string>): GroupDef {
  const h = wh.request.input.household;
  const rows = h.periodicExpenses ?? [];
  const fields: FieldDef[] = [];
  const actions: ActionDef[] = [];
  for (const t of ANNUAL_TEMPLATES) {
    const hit = rows.find((p) => t.match.test(p.label ?? ""));
    if (hit !== undefined) {
      const card = expenseCard(h, hit);
      fields.push({ ...readLine(`living/annual/check/${t.key}`, t.label, `入れた（${hit.label ?? t.label}）`, CARD_NAMES[card] ?? "ライフイベント"), level: "detail" });
    } else if (!skip.has(t.key)) actions.push({ key: `living/annual/add/${t.key}`, label: `＋ ${templateText(t)}`, level: "detail", run: (w) => addAnnual(w, t) });
  }
  // ほかのカードで入れる物（入れたかを、そのカードの物から見る）
  const owned = (h.residences ?? []).some((r) => r.kind === "own");
  fields.push({ ...readLine("living/annual/check/propertyTax", "固定資産税・修繕", owned ? "持ち家の固定資産税・修繕費は、住まいの物で入れます" : "持ち家なし", "住まい・ローン"), level: "detail" });
  fields.push({ ...readLine("living/annual/check/car", "自動車税・車検", (h.cars ?? []).length > 0 ? `車 ${(h.cars ?? []).length}台（税・車検は車の維持費で入れます）` : "車なし", "車"), level: "detail" });
  fields.push({ ...readLine("living/annual/check/insurance", "保険の年払い", (h.insuranceContracts ?? []).length > 0 ? `保険 ${(h.insuranceContracts ?? []).length}件（保険料は保険の契約で入れます）` : "まだありません", "保険"), level: "detail" });
  return { key: "living/annual/check", title: "年1回・数年に1回の支出の確かめ", note: "よくある年払い・数年おきの支出です。まだ入れていない物は、ひな形の目安の額で足せます（足した後に直してください）", level: "detail", fields, actions };
}

function annualSection(wh: WorkingHousehold): SectionDef | null {
  const out = moneySections(wh, "living", { claimed: NONE, level: "simple", outTitle: "年払い・数年おきの暮らしの支出" }).find((s) => s.key.endsWith("/out"));
  if (out === undefined) return null;
  const empty = out.groups.length === 0;
  const QUICK = new Set(["homecoming", "appliances", "fees"]);
  const quick = ANNUAL_TEMPLATES.filter((t) => QUICK.has(t.key)).map((t): ActionDef => ({
    key: `money/living/out/template/${t.key}`,
    label: `＋ ${templateText(t)}`,
    level: "simple",
    run: (w) => addAnnual(w, t),
  }));
  return {
    ...out,
    note: `${empty ? "まだありません。" : ""}帰省・家電の買い替え・年会費など、年1回・数年に1回の暮らしの支出です。表の行の既定は「基本生活費に含める」（医療費は「医療・介護」の行にもできます）`,
    groups: [...out.groups, annualChecklist(wh, empty ? QUICK : new Set<string>())],
    actions: [...(empty ? quick : []), ...out.actions.map((a) => ({ ...a, label: "＋ 年払い・数年おきの支出" }))],
  };
}

// ---- 実際に貯められている額（答え合わせ。savingsChecks） ----

interface SavingsCheck {
  id: string;
  year: number;
  actualSavings: Box<number>;
  treatment: "addToLiving" | "keepUnexplained";
  until?: Timepoint | null;
}
const checksOf = (h: Household) => (h as { savingsChecks?: SavingsCheck[] }).savingsChecks;

function checkSection(wh: WorkingHousehold): SectionDef {
  const h = wh.request.input.household;
  const c = (checksOf(h) ?? [])[0];
  const year0 = Number(wh.request.input.baseMonth.slice(0, 4));
  const title = "実際に貯められている額（答え合わせ）";
  const note = "1年で実際に貯められている額が分かれば、計算上の貯蓄額との差（使途不明金）を、その年から見込みます。差は結果の表の「使途不明金」（または基本生活費）の行に出ます";
  if (c === undefined) {
    return {
      key: "living/check",
      title,
      note,
      level: "detail",
      groups: [
        {
          key: "living/check/new",
          level: "detail",
          fields: [
            field({
              key: "savings/new/actual",
              item: "savingsCheck.actualSavings",
              label: `${year0}年の実際の年間の貯蓄額`,
              level: "detail",
              kind: "yen",
              basis: "annual",
              optional: true,
              help: "入れると答え合わせを始めます（差の扱いは「使途不明金として残す」から）",
              get: (w) => ({ value: (checksOf(w.request.input.household) ?? [])[0]?.actualSavings.value ?? null }),
              set: (w, v) =>
                mutate(w, (hh) => {
                  if (v === null) return void delete (hh as { savingsChecks?: unknown }).savingsChecks;
                  const cur = (checksOf(hh) ?? [])[0];
                  if (cur !== undefined) cur.actualSavings = confirmedBox(Number(v));
                  else (hh as { savingsChecks?: SavingsCheck[] }).savingsChecks = [{ id: newId(), year: year0, actualSavings: confirmedBox(Number(v)), treatment: "keepUnexplained" }];
                }),
            }),
          ],
          actions: [],
        },
      ],
      actions: [],
    };
  }
  const find = byId(checksOf as (h: Household) => unknown[] | undefined, c.id);
  const a = (item: string) => addr(c.id, item);
  const self = h.members.find((m) => m.kind === "self");
  return {
    key: "living/check",
    title,
    note,
    level: "detail",
    groups: [
      {
        key: `savings/${c.id}`,
        level: "detail",
        fields: [
          withAddress(
            plain({
              key: `savings/${c.id}/year`,
              item: "savingsCheck.year",
              label: "確かめる年",
              level: "detail",
              kind: "int",
              suffix: "年",
              min: year0,
              max: year0 + 5,
              find,
              path: ["year"],
              help: "計算基準年か、その後の年。計算基準年の途中からなら、12か月そろう翌年と比べます",
            }),
            a("savingsCheck.year"),
          ),
          withAddress(yenBox({ key: `savings/${c.id}/actual`, item: "savingsCheck.actualSavings", label: "実際の年間の貯蓄額", level: "detail", basis: "annual", find, path: ["actualSavings"] }), a("savingsCheck.actualSavings")),
          withAddress(
            plain({
              key: `savings/${c.id}/treatment`,
              item: "savingsCheck.treatment",
              label: "計算との差の扱い",
              level: "detail",
              kind: "select",
              options: [
                { value: "keepUnexplained", label: "使途不明金として残す" },
                { value: "addToLiving", label: "生活費に足す" },
              ],
              find,
              path: ["treatment"],
            }),
            a("savingsCheck.treatment"),
          ),
          withAddress(
            timepointField({
              key: `savings/${c.id}/until`,
              item: "savingsCheck.until",
              label: "差を見込む終わり",
              level: "detail",
              find,
              path: ["until"],
              optional: true,
              nullText: "最後まで",
              ...(self !== undefined ? { ageOf: (hh: Household) => hh.members.find((m) => m.id === self.id) } : {}),
            }),
            a("savingsCheck.until"),
          ),
        ],
        actions: [removeAction(`savings/${c.id}/remove`, "答え合わせを外す", "detail", (hh) => void delete (hh as { savingsChecks?: unknown }).savingsChecks)],
      },
    ],
    actions: [],
  };
}

// ---- カード ----

export function livingStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const list = h.livingExpenses ?? [];
  const annual = annualSection(wh);
  const tail: SectionDef[] = [...(annual !== null ? [annual] : []), surplusSection(wh), checkSection(wh)];
  if (list.length === 0) {
    const est = livingEstimate(h, wh.request.input.baseMonth);
    return {
      id: "living",
      label: "基本生活費",
      lead: "毎月の生活費（住居費・教育費・保険料・車の費用を除く）。",
      sections: [
        {
          key: "living/none",
          title: "毎月の生活費",
          note: `まだ入っていません（今は0円で計算しています）。${LIVING_NOTE}`,
          level: "simple",
          groups: [],
          actions: [
            {
              key: "living/add",
              label: `目安（月${(est.value / 10000).toLocaleString("ja-JP")}万円）で入れる`,
              level: "simple",
              run: (w) => mutate(w, (hh, req) => void (hh.livingExpenses ??= []).push(startLiving(hh, req.input.baseMonth, req.input.endYear, newId()))),
            },
          ],
        },
        ...tail,
      ],
    };
  }
  return {
    id: "living",
    label: "基本生活費",
    lead: "毎月の生活費（住居費・教育費・保険料・車の費用を除く）と、時期ごとの変化。",
    sections: [{ key: "living/main", title: "毎月の生活費", level: "simple", groups: list.flatMap((l, i) => livingGroups(wh, l, i)), actions: [] }, ...tail],
  };
}
