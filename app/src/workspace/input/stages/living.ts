// 5. 基本生活費のカード（0048）: 毎月の生活費（住居費・教育費・保険料・車の費用・税と社会保険料を除く）と、その時期ごとの変化。
// - 入れ方: 総額で／内訳で（内訳は10費目を並べて全部出し、最後に合計の行。0100・0106）。両方の値を持ち、選んだほうで計算する（切り替えても片方を消さない）
//   内訳の行は事務所の並べ方（名前・まとめた行・隠した内訳・分けた行。office/livingLayout.ts。0109）で出す。計算は10の内訳のまま
// - 段階: 推定の段階（子の誕生と独立・自宅外の在学・同居・施設の介護・退職・70歳・80歳。livingStages.ts。0049）と FP が足す段。表は詳細、簡易は札
// - 区画: 毎月の生活費／年払い・数年おきの暮らしの支出（お金の行。0044）／毎年の黒字のうち貯金に回る割合（0031。surplusSaving.ts）／
//   実際に貯められている額（答え合わせ。savingsChecks）
// - 医療費の窓口負担（70歳・75歳）は自動で変えない。年をとった後の生活費は、推定の段階（70歳・80歳）で生活費の全体が下がる（0106）
import type { Box, Household, LivingExpense, PeriodicExpense, Timepoint } from "../../../engine/types.ts";
import { addMonths, ageAt, ageReachedMonth, readLevers } from "../../levers.ts";
import { resolveTimepoint } from "../../timepoint.ts";
import { livingCategoryAverages, splitTransport } from "../../../../../hearing/src/estimates.ts";
import { presetNum, presetRate, presetText } from "../../../../../hearing/src/presets.ts";
import { householdSize, isPureSplit, LIVING_CATEGORY_ORDER, livingEstimate, splitCategories } from "../estimates.ts";
import { byId, field, getPath, plain, removeAction, timepointField, yenBox, type ActionDef, type FieldDef, type Finder, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { confirmedBox, mutate, newId, presetBasis, standardBox, type WorkingHousehold } from "../household.ts";
import { GROWTH_KINDS, LIVING_CATEGORIES, LIVING_STAGE_LABELS, memberLabel } from "../labels.ts";
import { applyAutoStages, autoActive, autoBasis, autoStages, autoStageTitle, isAutoStage, membersAt, rememberDropped, settleStage, startLiving } from "../livingStages.ts";
import { schoolEntryYear } from "../../present.ts";
import { addExpense, expenseCard, moneySections } from "../moneyRows.ts";
import { readLine } from "../readLines.ts";
import { amountText } from "../units.ts";
import { putRow } from "../rows.ts";
import type { Address } from "../../store/readings.ts";
import { onContingencyDetailFields, onContingencyFields } from "./onContingency.ts";
import { surplusSection } from "./surplusSaving.ts";
import { GROWTH_RANGE, STAGE_RATIO_RANGE } from "../rateRanges.ts";
import { apportion, hasShares, livingLayoutNow, partShares, rowLabel, rowMembers, STANDARD_LIVING_NAMES, type LivingLayout, type LivingRow } from "../../office/livingLayout.ts";
import { partsOf, withParts, type LivingPart } from "../livingParts.ts";

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
/** 節目のボタンの割合（presets.ts の目安。退職・70歳・80歳は年齢の段階〔livingStages.ts〕と同じ値） */
const DEFAULT_RATIO_IDS: Readonly<Record<string, string>> = {
  childIndependence: "preset.living.stage.childIndependence",
  retirement: "preset.living.stage.retirement",
  age70: "preset.living.stage.age70",
  age80: "preset.living.stage.age80",
  other: "preset.living.stage.other",
};

// ---- 内訳（10費目。0100・0106） ----

/** 前の分け方の内訳（0.42 までの世帯。値があるときだけ、前の名前で出す。新しくは作らない） */
const LEGACY_CATEGORIES: readonly string[] = ["transport", "otherConsumption"];
/** 前の分け方の内訳を出す位置（この内訳の後ろ） */
const LEGACY_AFTER: Readonly<Record<string, string>> = { transport: "transit", otherConsumption: "other" };
/** 前の内訳の仕送り（0106。並びから外した。前の世帯で値があるときだけ、内訳の最後に出す） */
export const LEGACY_ALLOWANCE = "allowance";

const catLabel = (c: string) => LIVING_CATEGORIES.find((o) => o.value === c)?.label ?? c;
const catOf = (l: LivingExpense | undefined, c: string): Category | undefined => (l?.categories ?? []).find((x) => x.category === c);
/** 前の内訳の仕送りに値があるか（0円・空は出さない） */
export const hasLegacyAllowance = (l: LivingExpense | undefined): boolean => (catOf(l, LEGACY_ALLOWANCE)?.monthly.value ?? 0) > 0;
/** 年1回・数年に1回の支出の確かめの一覧の名前（欄の説明で入れる所を言うとき） */
const ANNUAL = "「年1回・数年に1回の支出」";
const CAT_HELP: Record<string, string> = {
  food: "食材・外食・お弁当・お菓子・飲み物・お酒など。学校給食は子ども・教育の入力項目で入れます（同じ人数の世帯の平均からも除いています）",
  utilities: "電気・ガス・灯油・水道",
  communication: `スマホ・固定電話・ネット回線の料金、郵便・宅配便など。スマホ本体の買い替えは${ANNUAL}で入れます（同じ人数の世帯の平均は、ネット回線を入れ、スマホ本体を除いた額です）`,
  transit:
    "電車・バス・タクシーの運賃など。ガソリン・駐車場・車検・自動車税・車の保険と、通勤・ふだんの車の高速代は「車」の入力項目で入れます。旅行の高速代は、旅行と一緒に「趣味・娯楽」に入れます（平均からも高速代を除いています）。ときどき使うカーシェア・レンタカーはここに入れます（平均には入っていないので、使う世帯だけ足してください）",
  furniture: `洗剤・ティッシュなどの消耗品、食器・台所用品、家事代行など。家電・家具の買い替えは${ANNUAL}の「家電・家具の買い替え」で入れます（同じ人数の世帯の平均からも除いています）`,
  clothing: "服・靴・クリーニングと、美容院・理容・化粧品など",
  health: "通院・薬・サプリ・メガネ・コンタクトなど",
  recreation: [
    "本・新聞・NHKなどの受信料・スポーツ・映画・旅行・ペットのえさと用品・ペット保険など。",
    "・ふだんの旅行はここに入れます（旅行の高速代も。平均に宿泊・パック旅行が年6万〜9万円ほど入っています）。特別な旅行はライフイベントの夢プランで入れます",
    `・子の習い事は子ども・教育、テレビ・パソコンの買い替えとペットの病気・けがは${ANNUAL}で入れます（平均からも除いています）`,
    "・大人の習い事の月謝は、ここに足してください（平均からは月謝を除いています）",
  ].join("\n"),
  pocketAndSocial: "使い道を決めていないこづかいと、お祝い・お年玉・香典・贈り物・つきあいの費用、町内会費など。マンション・アパートの共益費・管理費は住まい・ローンの入力項目で入れます（同じ人数の世帯の平均からも除いています）",
  other:
    "たばこ、傘・かばん・アクセサリー・腕時計などの身の回り用品、お賽銭・お布施・寄付など。内訳に分けていない分もここに入ります。保険料・保育料・介護の費用・結婚や葬儀の費用は、それぞれの入力項目で入れます（同じ人数の世帯の平均からも除いています）",
  allowance: "前の内訳です。子の在学中の仕送りは子ども・教育、親への仕送りは介護・親の入力項目に移し、移したらこの欄を空にしてください（空にすると欄は消えます）。移すまでは、この額のまま計算します",
  transport: "前の分け方の内訳です（電車・バスの運賃と通信費。車の費用は「車」の入力項目で入れます）。「交通と通信に分ける」で、交通費と通信費に分けられます",
  otherConsumption: "前の分け方の内訳です（こづかい・交際費・理美容など）。内訳に分けていない分もここに入ります",
};

/** 内訳のまとまりの「?」: 推定の作り方と、迷いやすい物の入れ先（0106。家計調査の区分と、アプリの入力項目の作りに合わせる） */
export const CATEGORY_GROUP_HELP = [
  "推定は、同じ人数の世帯の平均（家計調査）から、ほかの入力項目で入れる物を除いた額です。迷いやすい物の入れ先:",
  "・子の下宿・一人暮らしへの仕送り → 子ども・教育（在学中）、家族（在学でない子）",
  "・親への仕送り・介護の費用 → 介護・親",
  "・生命保険・医療保険・火災保険などの保険料 → 保険",
  "・家賃・住宅ローン・管理費・共益費・修繕積立金・固定資産税 → 住まい・ローン",
  "・ガソリン・駐車場・自動車税・車検・車の保険、通勤・ふだんの高速代 → 車",
  "・学費・給食費・塾・子の習い事・保育料 → 子ども・教育",
  `・家電・家具・スマホ・パソコンの買い替え、ペットの病気・けが、年払いの物 → この入力項目の${ANNUAL}`,
  "・結婚・葬儀・お墓 → ライフイベント",
  "・ネット回線 → 通信費",
  "・新聞・NHK受信料・ペットのえさ・ペット保険、旅行の高速代 → 趣味・娯楽",
  "・たばこ → その他",
].join("\n");

/**
 * 同じ人数の世帯の平均（欄の横の比べ）。欄が推定のまま（＝平均から作った値）のときは出さない（同じ数を2つ並べないため）。
 * FP が直したときだけ、比べとして出す。額の書き方は欄の外の書き方（amountText。千円の位で四捨五入）
 */
function averageHint(wh: WorkingHousehold, cats: readonly string[], estimated: boolean): string | null {
  if (estimated) return null;
  const avg = livingCategoryAverages(householdSize(wh.request.input.household, wh.request.input.baseMonth));
  if (avg === null) return null;
  const v = cats.reduce((s, c) => s + ((avg.amounts as Record<string, number>)[c] ?? 0), 0);
  return v > 0 ? `同じ人数の世帯の平均 ${amountText(Math.round(v), "month")}` : null;
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
    hint: (w) => [averageHint(w, [c], elOf(find, w, c)?.monthly.state === "estimated"), storedPartsHint(w, find, c)].filter((x) => x !== null).join("。") || null,
  });
  // 名前の左のアイコン（内訳ごとの絵。前の分け方の交通・通信費は交通費と同じ絵）
  f.icon = c === "transport" ? "transit" : c;
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

/** 前の分け方の交通・通信を、交通費と通信費に分けるボタン（確定の値のとき。統計の割合で分けて推定の印。合計は変えない。0100） */
function splitTransportAction(l: LivingExpense, find: Finder): ActionDef | null {
  const legacy = catOf(l, "transport");
  if (legacy === undefined || legacy.monthly.state !== "confirmed" || (legacy.monthly.value ?? 0) <= 0) return null;
  // 交通費・通信費に値があるときは出さない（足し合わせると、FP が入れた値が推定になる）
  if (["transit", "communication"].some((c) => (catOf(l, c)?.monthly.value ?? 0) > 0)) return null;
  return {
    key: `living/${l.id}/splitTransport`,
    label: "交通と通信に分ける",
    help: "前の分け方の「交通・通信費」を、同じ人数の世帯の平均（家計調査）の割合で「交通費」と「通信費」に分けます。合計は変えず、分けた額は推定になります（直すと確定になります）",
    level: "simple",
    run: (w) =>
      mutate(w, (h, req) => {
        const t = find(h, { ...w, request: req }) as unknown as LivingExpense | undefined;
        const cur = catOf(t, "transport");
        if (t === undefined || cur === undefined) return;
        const total = cur.monthly.value ?? 0;
        const sp = splitTransport(total, householdSize(h, req.input.baseMonth));
        if (sp === null) return;
        const basis = `交通・通信費（月${man(total)}）を${sp.basis}で分けた目安`;
        const box = (value: number): Box<number> => ({ value, state: "estimated", origin: { kind: "auto" }, estimate: { method: "derived", basis } }) as Box<number>;
        // 交通費・通信費は新しい要素（前の交通・通信の ID を引き継ぐと、交通・通信を直したプランの差分が交通費だけに効き、通信費の分が
        // 二重になる。その差分はプランの一覧の要確認に出る）。並びは前の交通・通信の場所に
        const at = (t.categories ?? []).indexOf(cur);
        const rest = (t.categories ?? []).filter((x) => x !== cur && x.category !== "transit" && x.category !== "communication");
        rest.splice(Math.max(0, Math.min(at, rest.length)), 0, { id: newId(), category: "communication", monthly: box(sp.communication) }, { id: newId(), category: "transit", monthly: box(sp.transit) });
        t.categories = rest;
      }),
  };
}

function categoryGroup(l: LivingExpense, find: Finder): GroupDef {
  // 10費目を並べて全部出す（束・「詳しく」の折りたたみは無い。0100）。事務所の並べ方があれば、その行で出す（0109）。
  // 前の分け方の内訳は、値があるときだけ前の名前で（その内訳の行の後ろ）。前の内訳の仕送りは、値があるときだけ最後に（0106）。その後ろに合計の行（読むだけ）
  const layout = livingLayoutNow();
  const fields: FieldDef[] = [];
  const legacyAfter = (c: string) => {
    for (const old of LEGACY_CATEGORIES) if (LEGACY_AFTER[old] === c && catOf(l, old) !== undefined) fields.push(categoryField(l, find, old, "simple", catLabel(old)));
  };
  if (layout === null)
    for (const c of LIVING_CATEGORY_ORDER) {
      fields.push(categoryField(l, find, c, "simple", catLabel(c)));
      legacyAfter(c);
    }
  else
    for (const r of layout.rows) {
      fields.push(...layoutRowFields(l, find, layout, r));
      for (const c of rowMembers(layout, r)) legacyAfter(c);
    }
  if (hasLegacyAllowance(l)) fields.push(categoryField(l, find, LEGACY_ALLOWANCE, "simple", catLabel(LEGACY_ALLOWANCE)));
  fields.push(totalField(l, find));
  const moved = ["other", "otherConsumption"].map((c) => (catOf(l, c)?.monthly as { estimate?: { basis?: string } } | undefined)?.estimate?.basis).find((b) => b !== undefined && b.startsWith("総額で"));
  const notes = [CATEGORY_GROUP_HELP];
  if (layout !== null) notes.push(LAYOUT_NOTE);
  if (moved !== undefined) notes.push(moved);
  if (isPureSplit(l)) notes.push("総額を家計調査の同じ人数の世帯の割合で分けた推定です（直した内訳だけ確定になります）");
  if (LEGACY_CATEGORIES.some((c) => catOf(l, c) !== undefined)) notes.push("「交通・通信費」「その他の消費」は前の分け方の内訳です（そのまま計算に使います）");
  if (hasLegacyAllowance(l)) notes.push("「仕送り（前の内訳）」は、子ども・教育か介護・親の入力項目に移してください（移すまでは、そのまま計算に使います）");
  const split = splitTransportAction(l, find);
  return { key: `living/${l.id}/categories`, title: "内訳（月額）", note: notes.join("\n"), level: "simple", fields, actions: split !== null ? [split] : [] };
}

// ---- 事務所の並べ方の行（0109）: 名前を変えた行・まとめた行・隠した内訳を入れるその他の行・分けた行 ----

/** 事務所の並べ方で出しているときの、まとまりの「?」の1行 */
export const LAYOUT_NOTE = "内訳は事務所の並べ方で出しています（名前を変えた行・まとめた行・分けた行の中身は、行の「?」にあります）。計算は10の内訳のままで、推定も同じです";

const std = (c: string) => STANDARD_LIVING_NAMES[c as keyof typeof STANDARD_LIVING_NAMES] ?? catLabel(c);
const firstLine = (c: string) => (CAT_HELP[c] ?? "").split("\n")[0] ?? "";
const quoted = (cs: readonly string[]) => cs.map((c) => `「${std(c)}」`).join("");
const elOf = (find: Finder, w: WorkingHousehold, c: string) => catOf(find(w.request.input.household, w) as unknown as LivingExpense | undefined, c);
const boxBasisOf = (b: Box<number>): string | null => (b as { estimate?: { basis?: string } }).estimate?.basis ?? null;

/** ほかの並べ方で分けた行の額があれば、その1行（名前と額。合計が今の額と同じ物だけ） */
function storedPartsHint(w: WorkingHousehold, find: Finder, c: string): string | null {
  const el = elOf(find, w, c);
  const ps = partsOf(w, el?.id, el?.monthly.value ?? null);
  return ps === null ? null : `分けた行: ${ps.map((p) => `${p.label} ${man(p.monthly)}`).join("・")}`;
}

/** 新しい内訳の要素を、標準の並びの場所に入れる */
function placeCategory(t: LivingExpense, el: Category): void {
  const list = (t.categories ??= []);
  const rank = (c: string) => {
    const i = (LIVING_CATEGORY_ORDER as readonly string[]).indexOf(c);
    return i < 0 ? LIVING_CATEGORY_ORDER.length : i;
  };
  const at = list.findIndex((x) => rank(x.category) > rank(el.category));
  if (at < 0) list.push(el);
  else list.splice(at, 0, el);
}

function layoutRowFields(l: LivingExpense, find: Finder, layout: LivingLayout, r: LivingRow): FieldDef[] {
  if (r.kind === "split") return splitFields(l, find, r);
  const members = rowMembers(layout, r);
  const label = rowLabel(r);
  const hidden = members.filter((c) => !(r.kind === "group" ? r.categories : [r.category]).includes(c));
  const hiddenLine = hidden.length > 0 ? `隠している内訳（${hidden.map(std).join("・")}）の分も、ここに入れます` : null;
  // 1つの内訳の行（隠した内訳に値が無いその他の行も）: 今までの欄に名前と説明だけを足す
  if (r.kind === "one" && (hidden.length === 0 || hidden.every((c) => catOf(l, c) === undefined))) {
    const f = categoryField(l, find, r.category, "simple", label);
    const renamed = label !== std(r.category) ? `中身は内訳の「${std(r.category)}」です。` : null;
    const help = [renamed, CAT_HELP[r.category] ?? null, hiddenLine].filter((x): x is string => x !== null).join("\n");
    return [{ ...f, help }];
  }
  return [groupField(l, find, r.kind === "group" ? r.categories : [r.category], members, label, hiddenLine)];
}

/**
 * まとめた行（2つ以上の内訳を1つの額で入れる。隠した内訳を入れるその他の行も）。入れた額は内訳の今の額の割合で分け、
 * どれも0円・空なら同じ人数の世帯の平均の割合で分ける（千円単位。端は割合の一番大きい内訳）。分けた額はどれも確定。空にすると、まとめた内訳を外す
 */
function groupField(l: LivingExpense, find: Finder, own: readonly string[], members: readonly string[], label: string, hiddenLine: string | null): FieldDef {
  const els = (w: WorkingHousehold) => members.map((c) => elOf(find, w, c)).filter((x): x is Category => x !== undefined);
  const help = [
    own.length > 1 ? `${quoted(own)}をまとめた行です。` : `中身は内訳の「${std(own[0] ?? "other")}」です。`,
    hiddenLine,
    "入れた額は、今の内訳の額の割合（どれも0円なら同じ人数の世帯の平均の割合）で分けて計算します。",
    ...members.map((c) => `・${std(c)}: ${firstLine(c)}`),
  ]
    .filter((x): x is string => x !== null)
    .join("\n");
  const read = (w: WorkingHousehold): Box<number> | undefined => {
    const xs = els(w);
    if (xs.length === 0) return undefined;
    const value = xs.reduce((s, x) => s + (x.monthly.value ?? 0), 0);
    const est = xs.filter((x) => x.monthly.state === "estimated");
    if (est.length === 0) return confirmedBox(value);
    if (est.length < xs.length) return confirmedBox(value);
    const bases = [...new Set(est.map((x) => boxBasisOf(x.monthly)))];
    const basis = bases.length === 1 && bases[0] !== null ? (bases[0] as string) : `${est.map((x) => std(x.category)).join("・")}の推定の合計`;
    return { value, state: "estimated", origin: { kind: "auto" }, estimate: { method: "derived", basis } } as Box<number>;
  };
  const writeAmount = (w: WorkingHousehold, v: number): WorkingHousehold =>
    mutate(w, (h, req) => {
      const t = find(h, { ...w, request: req }) as unknown as LivingExpense | undefined;
      if (t === undefined) return;
      const cur = members.map((c) => catOf(t, c));
      let weights = cur.map((x) => x?.monthly.value ?? 0);
      if (weights.every((x) => x <= 0)) {
        const avg = livingCategoryAverages(householdSize(h, req.input.baseMonth));
        weights = members.map((c) => (avg === null ? (c === (members.includes("other") ? "other" : members[0]) ? 1 : 0) : ((avg.amounts as Record<string, number>)[c] ?? 0)));
      }
      const amounts = apportion(v, weights) ?? members.map((_c, i) => (i === 0 ? v : 0));
      members.forEach((c, i) => {
        const a = amounts[i] ?? 0;
        const el = cur[i];
        if (el !== undefined) el.monthly = confirmedBox(a);
        else if (a > 0) placeCategory(t, { id: newId(), category: c, monthly: confirmedBox(a) });
      });
      // 0円を入れたときも、入れた印として代表の内訳を1つ持つ（中身の内訳がどれも無いとき）
      if (!members.some((c) => catOf(t, c) !== undefined)) placeCategory(t, { id: newId(), category: members.includes("other") ? "other" : (members[0] ?? "other"), monthly: confirmedBox(v) });
    });
  const drop = (w: WorkingHousehold): WorkingHousehold =>
    mutate(w, (h, req) => {
      const t = find(h, { ...w, request: req }) as unknown as LivingExpense | undefined;
      if (t === undefined) return;
      t.categories = (t.categories ?? []).filter((x) => !members.includes(x.category));
      if (t.categories.length === 0) delete t.categories;
    });
  const f = field({
    key: `living/${l.id}/row/${members.join("+")}`,
    item: "livingExpense.categories",
    label,
    level: "simple",
    kind: "yen",
    basis: "monthly",
    optional: true,
    help,
    get: (w) => {
      const b = read(w);
      const xs = els(w);
      const est = xs.filter((x) => x.monthly.state === "estimated");
      const part = b !== undefined && b.state !== "estimated" && est.length > 0 ? `うち${est.map((x) => std(x.category)).join("・")}は推定（${boxBasisOf(est[0]?.monthly as Box<number>) ?? "推定"}）` : null;
      return { value: b?.value ?? null, estimated: b?.state === "estimated" ? boxBasisOf(b) : null, ...(part !== null ? { partEstimated: part } : {}), hint: averageHint(w, members, b?.state === "estimated") };
    },
    set: (w, v) => (v === null ? drop(w) : writeAmount(w, Number(v))),
    // 値の状態の操作（この値にする）: まとめた内訳の推定を、どれもその額のまま確定にする
    boxed: {
      read,
      write: (w, box) => {
        if (box === undefined) return drop(w);
        if (box.state !== "confirmed") return w;
        return mutate(w, (h, req) => {
          const t = find(h, { ...w, request: req }) as unknown as LivingExpense | undefined;
          for (const x of t?.categories ?? [])
            if (members.includes(x.category) && x.monthly.state === "estimated") {
              const est = (x.monthly as { estimate?: unknown }).estimate;
              x.monthly = { value: x.monthly.value, state: "confirmed", origin: { kind: "manual" }, ...(est !== undefined ? { estimate: est } : {}) } as Box<number>;
            }
        });
      },
    },
  });
  f.icon = own[0] ?? "other";
  return f;
}

/**
 * 分けた行（1つの内訳を2〜6の行で入れる。行の合計がその内訳の額）。分けた額は世帯の側に残す（livingParts.ts。計算は内訳の額）。
 * 分けていない（入れていない・額がほかで変わった）ときは、内訳の額を事務所の割合（決めていなければ等分）で分けた目安を、推定として見せる。
 * 1つの行を入れると、ほかの行は見せていた目安のまま推定で残り、内訳の額は行の合計になる
 */
function splitFields(l: LivingExpense, find: Finder, r: Extract<LivingRow, { kind: "split" }>): FieldDef[] {
  const c = r.category;
  const parent = rowLabel(r);
  const labels = r.parts.map((p) => p.label);
  const shares = partShares(r.parts);
  const named = hasShares(r.parts);
  const current = (w: WorkingHousehold): LivingPart[] | null => {
    const el = elOf(find, w, c);
    const v = el?.monthly.value ?? null;
    if (el === undefined || v === null) return null;
    const ps = partsOf(w, el.id, v, labels);
    if (ps !== null) return ps;
    const amounts = apportion(v, shares) ?? labels.map((_x, i) => (i === labels.length - 1 ? v : 0));
    const how = named ? `事務所の割合（${labels.map((x, i) => `${x} ${shares[i]}%`).join("・")}）` : "等分";
    const basis = `${parent}（月${man(v)}）を${how}で分けた目安`;
    return labels.map((label, i) => ({ label, monthly: amounts[i] ?? 0, estimated: basis }));
  };
  const writePart = (w: WorkingHousehold, i: number, amount: number): WorkingHousehold => {
    const parts: LivingPart[] = (current(w) ?? labels.map((label): LivingPart => ({ label, monthly: 0 }))).map((p) => ({ ...p }));
    parts[i] = { label: labels[i] ?? "", monthly: amount };
    const total = parts.reduce((s, p) => s + p.monthly, 0);
    const est = parts.filter((p) => p.estimated !== undefined);
    let id: string | undefined;
    const next = mutate(w, (h, req) => {
      const t = find(h, { ...w, request: req }) as unknown as LivingExpense | undefined;
      if (t === undefined) return;
      let el = catOf(t, c);
      if (el === undefined) {
        el = { id: newId(), category: c, monthly: confirmedBox(0) };
        placeCategory(t, el);
      }
      id = el.id;
      el.monthly =
        est.length === 0
          ? confirmedBox(total)
          : ({ value: total, state: "estimated", origin: { kind: "auto" }, estimate: { method: "derived", basis: `${labels.join("・")}の合計（${est.map((p) => p.label).join("・")}は${named ? "事務所の割合" : "等分"}の目安）` } } as Box<number>);
    });
    return id === undefined ? next : withParts(next, id, parts, w);
  };
  const subtotal = field({
    key: `ro/living/${l.id}/split/${c}`,
    item: null,
    label: parent,
    level: "simple",
    kind: "yen",
    basis: "monthly",
    readOnly: [`${labels.map((x) => `「${x}」`).join("")}の合計です（この額で計算します）。分けた行を直すと、自動で変わります。`, ...(parent !== std(c) ? [`中身は内訳の「${std(c)}」です。`] : []), CAT_HELP[c] ?? ""].filter((x) => x !== "").join("\n"),
    get: (w) => {
      const el = elOf(find, w, c);
      const v = el?.monthly.value ?? null;
      // ほかの並べ方で分けた額があれば、その名前と額を添える（この並べ方の行とは名前が違うので、目安で見せている）
      const other = partsOf(w, el?.id, v) !== null && partsOf(w, el?.id, v, labels) === null ? storedPartsHint(w, find, c) : null;
      return { value: v, hint: [averageHint(w, [c], el?.monthly.state === "estimated"), other !== null ? `前の${other}` : null].filter((x) => x !== null).join("。") || null };
    },
    set: (w) => w,
  });
  subtotal.icon = c;
  const rows = labels.map((label, i): FieldDef => {
    const share = shares[i] ?? 0;
    return field({
      key: `living/${l.id}/part/${c}/${i}`,
      item: "livingExpense.categories",
      label: `${label}（${parent}）`,
      level: "simple",
      kind: "yen",
      basis: "monthly",
      optional: true,
      help: [`${parent}を分けた行です（分けた行の合計が${parent}になり、この額で計算します）。`, `分けていないときは、${parent}の額を${named ? `事務所の割合（${share}%）` : "等分"}で分けた目安を、推定として見せています。`, firstLine(c)].join("\n"),
      get: (w) => {
        const p = current(w)?.[i];
        const avg = livingCategoryAverages(householdSize(w.request.input.household, w.request.input.baseMonth));
        const a = avg === null ? 0 : ((avg.amounts as Record<string, number>)[c] ?? 0);
        return { value: p?.monthly ?? null, estimated: p?.estimated ?? null, hint: named && a > 0 ? `同じ人数の世帯の平均 月${man(Math.round((a * share) / 100))}（${parent}の平均の${share}%）` : null };
      },
      set: (w, v) => writePart(w, i, v === null ? 0 : Number(v)),
      // 値の状態の操作（この値にする）: 目安のままの行を、その額のまま確定にする
      boxed: {
        read: (w) => {
          const p = current(w)?.[i];
          if (p === undefined) return undefined;
          return p.estimated !== undefined ? { value: p.monthly, state: "estimated", origin: { kind: "auto" }, estimate: { method: "derived", basis: p.estimated } } : confirmedBox(p.monthly);
        },
        write: (w, box) => (box !== undefined && box.state === "confirmed" ? writePart(w, i, Number(box.value ?? 0)) : w),
      },
    });
  });
  return [subtotal, ...rows];
}

/** 内訳の合計（読むだけの行。内訳の欄を直すと変わる。月額と、小さく年額。0106） */
function totalField(l: LivingExpense, find: Finder): FieldDef {
  const sum = (w: WorkingHousehold): number | null => {
    const t = find(w.request.input.household, w) as unknown as LivingExpense | undefined;
    const cs = t?.categories ?? [];
    return cs.length === 0 ? null : cs.reduce((s, c) => s + (c.monthly.value ?? 0), 0);
  };
  return field({
    key: `ro/living/${l.id}/categories/total`,
    item: null,
    label: "合計",
    level: "simple",
    kind: "yen",
    basis: "monthly",
    readOnly: "内訳の合計です。内訳の欄を直すと、自動で変わります（この額で計算します）",
    get: (w) => {
      const v = sum(w);
      return { value: v, hint: v === null ? null : amountText(v * 12, "year") };
    },
    set: (w) => w,
  });
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
    // 内訳で入れた後に総額を直したとき: 差は「その他（まだ分けていない）」に置き、推定の印（比例で配り直さない）
    const sum = (t.categories ?? []).reduce((s, c) => s + (c.monthly.value ?? 0), 0);
    if (t.monthly?.value == null || sum === total) return;
    const diff = total - sum;
    const list = (t.categories ??= []);
    let other = list.find((c) => c.category === "other");
    if (other === undefined) {
      other = { id: newId(), category: "other", monthly: confirmedBox(0) };
      list.push(other);
    }
    const next = Math.max(0, (other.monthly.value ?? 0) + diff);
    const text = `総額で月${man(total)}に変えました。差の${man(Math.abs(diff))}を「その他（まだ分けていない）」${diff >= 0 ? "に足しています" : "から引いています"}`;
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

/** 段の今の額に対する割合（割合の段はその値、月額の段は今の額で割った値） */
const ratioOfStage = (s: Stage, base: number): number | null => (s.ratio !== undefined ? Number(s.ratio) : s.monthly?.value != null && base > 0 ? s.monthly.value / base : null);
/** 欄の外の年月（「2051年4月」） */
const ymText = (ym: string): string => `${ym.slice(0, 4)}年${Number(ym.slice(5, 7))}月`;
/** 退職後の段の欄の下に出す、その後の年齢の段（「70歳から月15.7万円・80歳から月14.7万円（推定）」） */
const AGE_STAGE_NAMES: Readonly<Record<string, string>> = { age70: "70歳から", age80: "80歳から" };

function stageGroups(wh: WorkingHousehold, l: LivingExpense, find: Finder): GroupDef[] {
  const h = wh.request.input.household;
  const self = h.members.find((m) => m.kind === "self");
  const titles = stageTitles(wh, l);
  const sorted = (l.stages ?? []).map((s, i) => ({ s, i, ym: resolveTimepoint(h, s.at) ?? "9999-12" })).sort((a, b) => a.ym.localeCompare(b.ym));
  // 標準に出す退職後の段: 節目が「退職後」の最初の段
  const retiredAt = sorted.findIndex((x) => x.s.label === "retirement");
  const retiredIndex = sorted[retiredAt]?.i;
  const nameOf = (x: Stage): string => (x.id !== undefined ? titles.get(x.id) : undefined) ?? LIVING_STAGE_LABELS.find((o) => o.value === x.label)?.label ?? "節目";
  /** 退職後の段の割合の欄の下: 直前の段との比（「第2子の独立の後（月20.8万円）の80%」）と、その後の70歳・80歳の段の額 */
  const retiredHint = (v: number | null): string[] => {
    const base = baseMonthly(l);
    if (base <= 0 || v === null) return [];
    const out: string[] = [];
    const prev = retiredAt > 0 ? sorted[retiredAt - 1] : undefined;
    const pr = prev === undefined ? null : ratioOfStage(prev.s, base);
    if (prev !== undefined && pr !== null && pr > 0) out.push(`${nameOf(prev.s)}の後（${amountText(Math.round(base * pr), "month")}）の${Math.round((v / pr) * 100)}%`);
    const later = sorted.slice(retiredAt + 1).filter((x) => AGE_STAGE_NAMES[x.s.label] !== undefined);
    const items = later.map((x) => ({ text: `${AGE_STAGE_NAMES[x.s.label]}${amountText(Math.round(base * (ratioOfStage(x.s, base) ?? 0)), "month")}`, auto: x.s.id !== undefined && isAutoStage(l, x.s.id) }));
    if (items.length > 0) out.push(items.every((x) => x.auto) ? `${items.map((x) => x.text).join("・")}（推定）` : items.map((x) => `${x.text}${x.auto ? "（推定）" : ""}`).join("・"));
    return out;
  };
  return sorted.map(({ s, i, ym }): GroupDef => {
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
              { value: "ratio", label: "今の額に対する割合で" },
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
              label: retiredStd ? "退職後の生活費（月額）" : "月額（今の値段）",
              level: valueLevel,
              basis: "monthly",
              find: findStage,
              path: ["monthly"],
              hint: () => (base > 0 && s.monthly?.value != null ? [`今の額の${Math.round((s.monthly.value / base) * 100)}%`, ...(retiredStd ? retiredHint(s.monthly.value / base) : [])].join("。") : null),
            }),
            ["monthly"],
          )
        : est(
            put(
              plain({
                key: `${key}/ratio`,
                item: "livingExpense.stages",
                label: retiredStd ? "退職後の生活費（今の額に対する割合）" : "今の額に対する割合",
                level: valueLevel,
                kind: "pct",
                ...STAGE_RATIO_RANGE,
                find: findStage,
                path: ["ratio"],
                hint: (v) => (base > 0 && v !== null ? [`＝${amountText(Math.round(base * Number(v)), "month")}（今の値段）`, ...(retiredStd ? retiredHint(Number(v)) : [])].join("。") : null),
              }),
              ["ratio"],
            ),
          ),
    ];
    // 見出しに番号を付けない（標準では退職後の段だけが見え、番号が飛ぶため）。退職後の段は「退職後（2051年4月・ご本人65歳から）」
    // 70歳・80歳の段（ほかの理由と重なっていない段）は、年齢を2回書かないよう「70歳から（2056年6月）」
    const ageOnly = AGE_STAGE_NAMES[s.label] !== undefined && !nameOf(s).includes("・");
    const name = retiredStd ? "退職後" : ageOnly ? (AGE_STAGE_NAMES[s.label] as string) : nameOf(s);
    const when = ym === "9999-12" ? "" : ageOnly ? `（${ymText(ym)}）` : self !== undefined ? `（${ymText(ym)}・${memberLabel(wh, self.id)}${ageAt(self, ym)}歳から）` : `（${ymText(ym)}から）`;
    return {
      key,
      title: `${name}${when}`,
      ...(auto ? { note: "家族の人数と年齢から、推定で作った段階です。家族・進路・働き方を変えると作り直します。直した段は、作り直しても変わりません" } : {}),
      level: valueLevel,
      moreLabel: "節目・入れ方を変える",
      fields,
      actions: [
        removeAction(`${key}/remove`, "外す", "detail", (hh, w) => {
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
        const rid = DEFAULT_RATIO_IDS[label] ?? "preset.living.stage.other";
        const ratio = presetRate(rid);
        (t.stages ??= []).push({ id, at: stageDefaultAt({ ...w, request: req }, label), label, ratio });
        putRow(
          req.input as unknown as Obj,
          { target: { object: t.id }, item: "livingExpense.stages", at: [id, "ratio"] },
          { state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: presetBasis(presetText(rid, () => `${text} ${Math.round(Number(ratio) * 100)}%`)) } },
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
      label: none ? "子の誕生・独立・退職などで、生活費の段階を推定で入れる" : "推定の段階に入れ替える",
      ...(none ? {} : { help: `今の段階（${(l.stages ?? []).length}段）を外して、目安の段階に作り直します` }),
      level: none ? "simple" : "detail",
      ...(none ? {} : { danger: true }),
      title: "国の家計の調査をもとに、家族の人数が変わる時期と、退職後（80%）・70歳から（75%）・80歳から（70%）の目安で生活費の段階を作ります",
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

/** 段の節目の短い名前（「▸」の文に並べる） */
const STAGE_SHORT: Readonly<Record<string, string>> = { childIndependence: "子の独立", retirement: "退職後", age70: "70歳", age80: "80歳", other: "人数の変わり目" };

/**
 * 毎月の生活費の「▸」の文: 標準に出ている退職後の段のほかに段があれば「子の独立・70歳・80歳の段（推定 4段）を見る」、無ければ「退職後などの段階を入れる」
 */
export function stagesMoreLabel(wh: WorkingHousehold, l: LivingExpense): string {
  const h = wh.request.input.household;
  const sorted = (l.stages ?? []).map((s) => ({ s, ym: resolveTimepoint(h, s.at) ?? "9999-12" })).sort((a, b) => a.ym.localeCompare(b.ym));
  const retired = sorted.find((x) => x.s.label === "retirement")?.s;
  const others = sorted.map((x) => x.s).filter((s) => s !== retired);
  if (others.length === 0) return "退職後などの段階を入れる";
  const names = [...new Set(others.map((s) => STAGE_SHORT[s.label] ?? "節目"))];
  const auto = others.filter((s) => s.id !== undefined && isAutoStage(l, s.id)).length;
  const count = auto === others.length ? `推定 ${auto}段` : auto > 0 ? `${others.length}段・推定 ${auto}段` : `${others.length}段`;
  return `${names.join("・")}の段（${count}）を見る`;
}

/** 生活費の万一のときの扱いの「指定しない」は、死亡のとき遺族の生活費の割合（万一のタブ）が効く */
const survivorDefault = (f: FieldDef): FieldDef => (f.kind === "select" ? { ...f, options: f.options.map((o) => (o.value === "" ? { ...o, label: "指定しない（死亡は遺族の生活費の割合）" } : o)) } : f);

function survivorText(wh: WorkingHousehold): string {
  const r = wh.contingency.survivor.livingRatio ?? {};
  const pct = (x: string | undefined, d: string) => `${Math.round(Number(x ?? d) * 100)}%`;
  const hasChild = wh.request.input.household.members.some((m) => m.kind === "child" && m.outside === undefined);
  return hasChild ? `末子の独立まで ${pct(r.beforeIndependence, presetRate("preset.survivor.livingRatio.beforeIndependence"))}・独立の後 ${pct(r.afterIndependence, presetRate("preset.survivor.livingRatio.afterIndependence"))}` : pct(r.noChildren, presetRate("preset.survivor.livingRatio.noChildren"));
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
          help: "推定は統計の平均（同じ人数の世帯）です。結果の対策「毎月の生活費」でも動かせます",
          // 内訳で入れたときの合計の行と同じく、年額も添える
          hint: (w) => {
            const v = (find(w.request.input.household, w) as unknown as LivingExpense | undefined)?.monthly?.value;
            return v == null || v <= 0 ? null : amountText(v * 12, "year");
          },
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
        plain({ key: `${key}/growthRate`, item: "livingExpense.growth", label: "伸び率（年）", level: "detail", kind: "pct", ...GROWTH_RANGE, find, path: ["growth", "rate"], help: "マイナスも入れられます" }),
        addr(l.id, "livingExpense.growth", ["rate"]),
      ),
    );
  const selfId = wh.request.input.household.members.find((m) => m.kind === "self")?.id;
  const selfAge = selfId !== undefined ? { ageOf: (h: Household) => h.members.find((m) => m.id === selfId), mode: "ym" as const } : {};
  // 始まり・終わりは、毎月の生活費が2つ以上あるときだけ出す（1つなら計算の初めから最後まで。0100 の追記）。
  // 1つでも前に値を入れていれば、その欄は出す（結果に効く値を隠さない）
  const several = (wh.request.input.household.livingExpenses ?? []).length >= 2;
  if (several || l.from != null)
    main.push(
      withAddress(
        timepointField({ key: `${key}/from`, item: "livingExpense.from", label: "始まり", level: "detail", find, path: ["from"], ...selfAge, optional: true, absentWhenEmpty: true, nullText: "計算の初めから" }),
        addr(l.id, "livingExpense.from"),
      ),
    );
  if (several || l.to != null)
    main.push(
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
      help: "選ばないときは、亡くなったときだけ、遺族の生活費の割合（万一のタブで決めます）で減らします。障害・働けないときは変えません。選ぶと、遺族の生活費の割合の代わりに、その扱いにします",
    }).map((f) => withAddress(survivorDefault(f), addr(l.id, onItem))),
    ...onContingencyDetailFields({ key: `${key}/on`, item: onItem, find, path: ["onContingency"], on: l.onContingency, level: "detail" }).map((f) => withAddress(f, addr(l.id, onItem))),
    { ...readLine(`living/${l.id}/survivor`, "万一（死亡）のときの遺族の生活費", survivorText(wh), "万一のとき", "tab"), level: "detail" },
  );
  const stages = l.stages ?? [];
  const autoCount = stages.filter((s) => s.id !== undefined && isAutoStage(l, s.id)).length;
  const badge = stages.length === 0 ? null : `この後 ${stages.length}段${autoCount > 0 ? `（推定 ${autoCount}段）` : ""}。「詳細」で直せます`;
  const groups: GroupDef[] = [
    {
      key,
      title: index === 0 ? "毎月の生活費" : `毎月の生活費 ${index + 1}`,
      note: [LIVING_NOTE, badge].filter((x) => x !== null).join("。"),
      level: "simple",
      moreLabel: stagesMoreLabel(wh, l),
      fields: main,
      actions: index === 0 ? [] : [removeAction(`${key}/remove`, "外す", "detail", (h) => void (h.livingExpenses = (h.livingExpenses ?? []).filter((x) => x.id !== l.id)))],
    },
  ];
  if (l.mode === "byCategory") groups.push(categoryGroup(l, find));
  // 段階は1段ずつ足して外せる物（それぞれ自分の枠。足すボタンも生活費の枠の外に置く。ownBox）
  groups.push(...stageGroups(wh, l, find).map((g) => ({ ...g, ownBox: true })));
  const acts = stageActions(l, find);
  if (acts.simple.length > 0) groups.push({ key: `${key}/stages/auto`, level: "simple", note: "子の誕生・独立、退職、70歳・80歳などで生活費が変わる段階がまだありません", fields: [], actions: acts.simple, ownBox: true });
  groups.push({ key: `${key}/stages/add`, title: "段階を足す", level: "detail", note: "段階は、その時点から「今の額に対する割合」か「月額（今の値段）」に変えます。何段でも足せます", fields: [], actions: acts.detail, ownBox: true });
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
  /** 名前が match に合っても、これに合う行は入れたと見ない（「ペットの医療」の行を「通院・歯の治療」と読まないため） */
  unless?: RegExp;
  /** 額の数え方（「1台」。根拠の文に書く） */
  per?: string;
  /** ボタンの「?」 */
  help?: string;
}

/**
 * 聞き漏れの確かめの一覧（ひな形の目安。統計ではない）。並びはボタンの並び（0100 の追記: どのボタンも確かめの一覧のまとまりの中に、標準と詳細で同じ形で並べる）。
 * 家電と家具は1つにまとめた（前の家電 8年ごとに25万円と家具 10年ごとに20万円の年あたりとほぼ同じ 8年ごとに40万円）。名前の当て方は家電・家具の両方。
 * 冠婚葬祭のつきあい・お年玉と贈り物は、毎月の生活費の「こづかい・交際費」と重なりやすいので一覧に置かない。ふだんの旅行は毎月の生活費の「趣味・娯楽」、特別な旅行はライフイベントの入力項目の夢プランの「特別な旅行」で入れるので置かない
 * （前に入れた行はふつうの行のまま）
 */
/** ひな形の額と間隔（presets.ts の目安 preset.living.annual.<key>・<key>.everyYears。間隔の目安の無いひな形は毎年。読むたびに引く） */
const annualPreset = (key: string, every: boolean) => ({
  get amount(): number {
    return presetNum(`preset.living.annual.${key}`);
  },
  get everyYears(): number {
    return every ? presetNum(`preset.living.annual.${key}.everyYears`) : 1;
  },
});

export const ANNUAL_TEMPLATES: readonly AnnualTemplate[] = [
  {
    key: "medical",
    label: "通院・歯の治療",
    ...annualPreset("medical", false),
    row: "cf.expense.care.medical",
    help: "歯の治療・人間ドック・健診など、年に1回ほどのまとまった医療費です。毎月の通院・薬・サプリ・メガネは、毎月の生活費の内訳の「医療費」に入れます（両方に入れると二重です）",
    match: /通院|歯|治療|医療|病院/u,
    unless: /ペット|動物/u,
  },
  { key: "pet", label: "ペットの病気・けが", ...annualPreset("pet", false), help: "動物病院の費用です。ペット保険に入っているなら、保険料は毎月の生活費の「趣味・娯楽」に入れます", match: /ペット|動物病院/u },
  { key: "homecoming", label: "帰省", ...annualPreset("homecoming", false), match: /帰省/u },
  { key: "appliances", label: "家電・家具の買い替え", ...annualPreset("appliances", true), match: /家電|家具/u },
  { key: "fees", label: "年会費・サブスクの年払い", ...annualPreset("fees", false), match: /年会費|サブスク|会費/u },
  { key: "smartphone", label: "スマホの買い替え", ...annualPreset("smartphone", true), per: "1台", help: "大人と中学生以上の子の人数分の台数で、1行に足します（1台分の額×台数）。台数が違えば、行の名前と額を直してください", match: /スマホ|スマートフォン|携帯電話/u },
  { key: "pc", label: "パソコンの買い替え", ...annualPreset("pc", true), match: /パソコン/u },
];

/** ひな形の額と間隔の文字（「年10万円」「8年ごとに40万円」）。ボタンには出さず、推定の根拠の文に使う */
const templateAmountText = (t: AnnualTemplate) => `${t.everyYears === 1 ? "年" : `${t.everyYears}年ごとに`}${man(t.amount)}`;

/**
 * ひな形の推定の根拠の文。ボタンの名前に額を出さないので、足した行の額と何年ごとを推定（出し方 standard）にして、根拠に目安の値を書く。
 * 原本で確かめた統計ではないので「よくある額の目安」「よくある間隔の目安」と書く
 */
export const annualBasis = (t: AnnualTemplate) => ({
  amount: presetText(`preset.living.annual.${t.key}`, () => `よくある額の目安（${t.label} ${t.per !== undefined ? `${t.per} ` : ""}${templateAmountText(t)}。この世帯に合わせて直してください）`),
  everyYears: `よくある間隔の目安（${t.label} ${t.everyYears === 1 ? "毎年" : `${t.everyYears}年ごと`}。この世帯に合わせて直してください）`,
});

/**
 * スマホの台数の目安: 今世帯で暮らしている人のうち、大人（18歳以上）と中学生以上の子（中学校の入学の4月を過ぎた子）の人数。1台より少なくしない
 */
export function phoneCount(wh: WorkingHousehold): number {
  const h = wh.request.input.household;
  const base = wh.request.input.baseMonth;
  const n = membersAt(h, base, { now: true }).filter((m) => {
    if (m.kind === "self" || m.kind === "spouse" || ageAt(m, base) >= 18) return true;
    const entry = schoolEntryYear(m.birth.birthYearMonth, m.birth.bornOnFirst === true, "juniorHigh");
    return entry !== null && `${entry}-04` <= base;
  }).length;
  return Math.max(1, n);
}

/** ひな形の行を足す（額と何年ごとは目安＝推定。何年ごとは物の値の状態の欄を持たない数なので、仮の印で持つ）。スマホは人数分の台数で1行 */
export function addAnnual(wh: WorkingHousehold, t: AnnualTemplate, id: string = newId()): WorkingHousehold {
  const w = addExpense(wh, "livingAnnual", id);
  const basis = annualBasis(t);
  const units = t.key === "smartphone" ? phoneCount(wh) : 1;
  const next = mutate(w, (h) => {
    const p = (h.periodicExpenses ?? []).find((x) => x.id === id);
    if (p === undefined) return;
    p.label = units > 1 ? `${t.label}（${units}台）` : t.label;
    p.everyYears = t.everyYears;
    if (t.row !== undefined) p.row = t.row;
    p.amount = standardBox(t.amount * units, units > 1 ? `${basis.amount}×${units}台（大人と中学生以上の子の人数）` : basis.amount) as PeriodicExpense["amount"];
  });
  return { ...next, assumed: { ...next.assumed, [`ev/${id}/every`]: basis.everyYears } };
}

/**
 * ひな形で足した行の額を「この値にする」で確定にしたら、何年ごと（仮の印）も一緒に確定にする（押す数を減らす。何年ごとの印はそれまで残す）。
 * 額の欄の書き方（boxed.write）を包む。確定の箱を書いたときだけ
 */
function confirmEveryWithAmount(f: FieldDef): FieldDef {
  const m = /^ev\/(.+)\/amount$/.exec(f.key);
  const boxed = f.boxed;
  if (m === null || boxed === undefined) return f;
  const every = `ev/${m[1] as string}/every`;
  return {
    ...f,
    boxed: {
      ...boxed,
      write: (w, b) => {
        const next = boxed.write(w, b);
        const state = (b as { state?: string } | undefined)?.state;
        if (state !== "confirmed" || next.assumed[every] === undefined) return next;
        return { ...next, assumed: Object.fromEntries(Object.entries(next.assumed).filter(([k]) => k !== every)) };
      },
    },
  };
}

const CARD_NAMES: Record<string, string> = { events: "ライフイベント", housing: "住まい・ローン", car: "車", education: "子ども・教育", care: "介護・親", living: "基本生活費" };

/** 年払いの区画の「その他」のボタンの名前（ひな形に無い行を足す） */
export const ANNUAL_OTHER_LABEL = "＋ その他の年1回・数年に1回の支出";

/**
 * 聞き漏れの確かめ（入れた所を自動で見る。読むだけの「入れた」の行と、まだ無い物を足すボタン）。どのボタンもこのまとまりの中に、標準と詳細で同じ形で
 * 並べる（ひな形の後ろに「その他」）。ほかの入力項目で入れる物（固定資産税・車検・保険の年払い）の読むだけの行は置かない（生活費ではなく、入れる所は FP が分かる）
 */
function annualChecklist(wh: WorkingHousehold, other: readonly ActionDef[]): GroupDef {
  const h = wh.request.input.household;
  const rows = h.periodicExpenses ?? [];
  const fields: FieldDef[] = [];
  const actions: ActionDef[] = [];
  for (const t of ANNUAL_TEMPLATES) {
    const hit = rows.find((p) => t.match.test(p.label ?? "") && t.unless?.test(p.label ?? "") !== true);
    if (hit !== undefined) {
      const card = expenseCard(h, hit);
      fields.push({ ...readLine(`living/annual/check/${t.key}`, t.label, `入れた（${hit.label ?? t.label}）`, CARD_NAMES[card] ?? "ライフイベント"), level: "simple" });
    } else actions.push({ key: `living/annual/add/${t.key}`, label: `＋ ${t.label}`, ...(t.help !== undefined ? { help: t.help } : {}), level: "simple", run: (w) => addAnnual(w, t) });
  }
  actions.push(...other.map((a) => ({ ...a, label: ANNUAL_OTHER_LABEL, level: "simple" as const })));
  return {
    key: "living/annual/check",
    title: "入れ忘れがないか",
    note: "よくある年1回・数年に1回の支出です。まだ入れていない物は、よくある額と間隔の目安で足せます（足した後で実際の額に直してください）",
    level: "simple",
    fields,
    actions,
  };
}

function annualSection(wh: WorkingHousehold): SectionDef | null {
  const out = moneySections(wh, "living", { claimed: NONE, level: "simple", outTitle: "年1回・数年に1回の支出" }).find((s) => s.key.endsWith("/out"));
  if (out === undefined) return null;
  const empty = out.groups.length === 0;
  return {
    ...out,
    groups: [...out.groups.map((g) => ({ ...g, fields: g.fields.map(confirmEveryWithAmount) })), annualChecklist(wh, out.actions)],
    note: `${empty ? "まだありません。" : ""}帰省・家電や家具・スマホ・パソコンの買い替え・年会費など、年1回・数年に1回の暮らしの支出です`,
    actions: [],
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

// 答え合わせの説明（0106。計算エンジン expense.reconcile の決まりのとおりに書く: 比べるのはその年の年間収支〔器の間の移動は貯蓄に含む〕、
// 計算基準年の途中からなら12か月そろう翌年、差は物価上昇率で伸ばして終わりの月まで毎月、実際のほうが多ければ載せずに知らせ）
/** 区画の説明 */
export const CHECK_NOTE = "1年で実際に貯められた額を入れると、計算の貯蓄額との差（使途不明金）を、毎年の支出として見込みます";
/** まだ入れていないときの欄の説明 */
export const CHECK_NEW_HELP = [
  "その年の1年で実際に増えた貯蓄の額（預金・積立・投資・iDeCo などの合計）を入れます。",
  "・入れると: 計算の年間収支（その年の黒字）と比べ、足りない分を使途不明金として、その年から毎年の支出に入れます（物価上昇率で伸ばします）。結果の表では「その他の支出」の行に入ります",
  "・役に立つこと: 計算の黒字がそのまま貯まるという前提の甘さを外せます。実際との差を見て、家計の見直しの元にできます",
  "・入れないと: 計算の黒字はすべて貯蓄に回る前提です（「毎年の黒字のうち貯金に回る割合」を入れていれば、その割合）",
  "・実際のほうが多いときは差を入れず、お知らせだけ出します",
].join("\n");
/** 入れた後の欄の説明 */
export const CHECK_ACTUAL_HELP = [
  "1年で実際に増えた貯蓄の額（預金・積立・投資・iDeCo などの合計）です。",
  "・計算の年間収支との差を使途不明金として、確かめる年から「差を見込む終わり」まで毎年の支出に入れます（物価上昇率で伸ばします）",
  "・今年の途中から計算するときは、12か月そろう翌年の計算と比べます",
  "・実際のほうが多いときは差を入れず、お知らせだけ出します",
  "・入れないと、計算の黒字はすべて貯蓄に回る前提になります",
].join("\n");
/** 差の扱いの説明 */
export const CHECK_TREATMENT_HELP = [
  "・使途不明金として残す（既定の値）: 結果の表の「その他の支出」に入ります。基本生活費は変えないので、使い道が分からない分として分けて見ることができます",
  "・生活費に足す: 結果の表の「基本生活費」の行に足します（生活費の段階の割合では変わりません）",
  "どちらも年間収支と金融資産への効き方は同じです",
].join("\n");

function checkSection(wh: WorkingHousehold): SectionDef {
  const h = wh.request.input.household;
  const c = (checksOf(h) ?? [])[0];
  const year0 = Number(wh.request.input.baseMonth.slice(0, 4));
  const title = "実際に貯められている額";
  const note = CHECK_NOTE;
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
              help: CHECK_NEW_HELP,
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
              help: "今年か、その後の年。今年の途中から計算するときは、12か月そろう翌年と比べます",
            }),
            a("savingsCheck.year"),
          ),
          withAddress(yenBox({ key: `savings/${c.id}/actual`, item: "savingsCheck.actualSavings", label: "実際の年間の貯蓄額", level: "detail", basis: "annual", find, path: ["actualSavings"], help: CHECK_ACTUAL_HELP }), a("savingsCheck.actualSavings")),
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
              help: CHECK_TREATMENT_HELP,
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
