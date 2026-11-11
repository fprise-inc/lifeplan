// AI接続口（crates/lifeplan）に同梱する「プランの動かす項目」（0195）。画面の結果のタブのプランと同じ関数で:
// - listPlanItems: この世帯で動かせる項目（働く最後の年齢・年金の受け取り開始・NISA・生活費・配偶者の働き方と年収・繰上返済・金利の上昇・
//   資産運用の配分・入力の数の欄など）を、今の値・動かせる範囲・プランの候補の書き方（対象・入力項目ID）で返す
// - applyPlan: プランの候補と同じ書き方（対象・入力項目ID・値。propose_scenario の changes）を、画面の「AIからの候補」と同じ当てはめ
//   （workspace/plans/candidates.ts）で動かす項目の値にし、画面のプランと同じ関数（plans.ts の applyValues）で計算の要求に当てる。
//   関係する欄も画面と同じく一緒に動く（働く最後の年齢なら、生活費の退職の段階・積立の終わり・定年後の働き方も）
// - 同じ対象・同じ入力項目ID で場所だけが違う項目は、場所（入力の欄の at か合成の対策の lever。プランの差分の当て先と同じ）を添えて
//   一覧に出し、同じ書き方で当てる（0201）。場所の要らない項目は今までどおり対象と入力項目ID だけ
// - 画面の状態（帯・選んだプラン・保存していない変更・小窓）には依らない。世帯の要求から画面と同じく作業中の世帯（fromRequest）と
//   動かす項目の一覧（buildCatalog）を作るだけ。見本の世帯では、画面と同じく見本の目盛りと定年後の働き方を使う。渡された世帯では、
//   縮約版の定年後の働き方の条件を、画面で保存した世帯を開いたときと同じくそのまま使う
// - 事務所の推定の値は、計算の前の処理（prepare.ts）と同じく、渡された世帯のときだけモジュールの中に入れてから当てる（画面が事務所データを
//   読んでから動かす項目を作るのと同じ。働き方を選び直したときの年収の目安などが読む）。呼び出しをまたいで残らない
// - 画面の部品（preact）・本体の命令・保存の部品は読まない（lint とまとめる道具が止める）。世帯の物の ID は、AI に渡した世帯の ID
//   （渡された世帯では共有の仮の ID）のまま返す
import type { EngineRequest } from "../engine/types.ts";
import { demoHousehold } from "../workspace/catalog.ts";
import { fromRequest, type PostRetirement, type WorkingHousehold } from "../workspace/input/household.ts";
import { STRESS_KEYS, stressLabel, stressRequests, type StressKey } from "../workspace/invest/present.ts";
import { publishOfficeEstimates, readOfficeEstimates } from "../workspace/office/estimates.ts";
import { candidateRefOf, candidateRows, candidateValues, placeText, type CandidateRow, type ProposedChange } from "../workspace/plans/candidates.ts";
import { buildCatalog, OUTLOOK_STEP_YEARS, type Catalog, type ItemValue, type MovableItem } from "../workspace/plans/items.ts";
import { applyValues } from "../workspace/plans/plans.ts";
import { roles } from "../workspace/roles.ts";

/** 接続口から渡す引数（JSON の文字） */
export interface PlanArgs {
  /** 見本の世帯の ID（見本の目盛り・定年後の働き方を画面と同じに使う。見本でなければ省く） */
  sampleId?: string;
  /** 一覧を絞る: 項目のまとまり（group）の名前 */
  group?: string;
  /** 一覧を絞る: 入力の数の欄から作った項目（fields）も入れるか（既定は入れない。対策・資産運用・貯まり方・よく使う項目だけ） */
  fields?: boolean;
  /**
   * 渡された世帯の定年後の働き方の条件（縮約版の postRetirement。構成員の ID → 条件）。あれば、画面で保存した世帯を開いたときと同じく
   * これをそのまま使う（無い構成員は条件なし。入力の働き方の期間から推し量らない）。見本の世帯・AI が組み立てた入力では省く
   */
  postRetirement?: Record<string, PostRetirement>;
}

/** プランの候補の書き方の1件（propose_scenario の changes の1件と同じ）。場所 at・lever は、一覧が添えた項目だけ（どちらか1つ。0201） */
export interface PlanChange {
  target: string;
  item: string;
  at?: string[];
  lever?: string;
  value: unknown;
}

interface Opened {
  wh: WorkingHousehold;
  cat: Catalog;
}

/** 世帯の要求から、画面と同じく作業中の世帯と動かす項目の一覧を作る（本人がいなければ null。形の違う入力は "badInput"） */
function open(req: EngineRequest, a: PlanArgs): Opened | null | "badInput" {
  try {
    return opened(req, a);
  } catch {
    // 形の違う入力（AI が組み立てた入力の誤りなど。画面の世帯には無い）
    return "badInput";
  }
}

function opened(req: EngineRequest, a: PlanArgs): Opened | null {
  const self = roles(req).find((r) => r.key === "self");
  if (self === undefined) return null;
  const demo = a.sampleId === undefined ? null : (demoHousehold(a.sampleId) ?? null);
  const re = demo?.reemployment;
  const wh0 = fromRequest(req, re !== undefined ? { postRetirement: { [self.member.id]: { ...re, type: re.type as "contract" } } } : {});
  // 渡された世帯: 保存した条件をそのまま（store/body.ts の fromBody と同じ。0195）
  const wh = a.postRetirement !== undefined ? { ...wh0, postRetirement: { ...a.postRetirement } } : wh0;
  return { wh, cat: buildCatalog(wh, self.member.id, demo) };
}

/** 項目の値の入れ方と動かせる範囲（AI に見せる形。画面のスライダー・欄と同じ範囲） */
function controlOf(it: MovableItem, now: ItemValue): Record<string, unknown> {
  const c = it.control;
  switch (c.kind) {
    case "age":
      // 上の端は、今の値が外にあれば広げる（画面のスライダーと同じ）
      return { kind: "age", unit: "歳（整数）", min: c.min, max: typeof now === "number" ? Math.max(c.max, now) : c.max };
    case "range":
      return { kind: "amount", unit: `円（${c.per === "月" ? "月額" : c.per === "年" ? "年額" : "額"}・整数）`, min: 0, slider: { min: c.min, max: c.max, step: c.step } };
    case "rate":
      return { kind: "rate", unit: "率（10進の文字列。\"0.02\" は 2%）", slider: { min: c.min, max: c.max, step: c.step }, ...(c.limit !== undefined ? { limitPercent: c.limit } : {}) };
    case "toggle":
      return { kind: "toggle", unit: "true（入れる）か false（入れない）" };
    case "mix":
      return { kind: "mix", unit: "配分の並び [{assetClass, share}]（share は10進の文字列の割合。合計 1）", accountKind: c.accountKind };
    case "shift":
      return { kind: "rateShift", unit: "{add: 上乗せの幅（10進の文字列）, from: 始まりの月 YYYY-MM}", years: c.years };
    case "outlook":
      // 住宅ローン1本の金利の見込み（入力の「金利の見込み（変動金利）」の欄と同じ型・同じ関数。0203）
      return {
        kind: "rateOutlook",
        unit: "{adds: [5年後の上乗せ, 10年後の上乗せ, …]}（今の金利からの上乗せ。10進の文字列。[] は今の金利のまま）か、型の名前（presets の value）",
        presets: c.presets,
        currentRate: c.current,
        from: c.from,
        stepYears: OUTLOOK_STEP_YEARS,
        maxSteps: c.maxSteps,
        addRange: c.range,
      };
    case "work":
      return { kind: "work", unit: "{type: 働き方, annual: 1年の収入（円の整数。給与は賞与込みの年収・自営業は事業所得）}", options: c.options.map((o) => ({ value: o.value, label: o.label })), max: c.max };
    case "field": {
      const f = c.field;
      if (f.kind === "yen") return { kind: "amount", unit: `円（${f.basis === "monthly" ? "月額" : f.basis === "annual" ? "年額" : "1回の額"}・整数）`, ...(c.slider !== undefined ? { slider: { min: c.slider.min, max: c.slider.max, step: c.slider.step } } : {}) };
      if (f.kind === "int") return { kind: "int", unit: f.suffix !== undefined ? `整数（${f.suffix}）` : "整数", ...(f.min !== undefined ? { min: f.min } : {}), ...(f.max !== undefined ? { max: f.max } : {}) };
      if (f.kind === "pct") return { kind: "rate", unit: "率（10進の文字列。\"0.02\" は 2%）", ...(f.min !== undefined || f.max !== undefined ? { limitPercent: { ...(f.min !== undefined ? { min: f.min } : {}), ...(f.max !== undefined ? { max: f.max } : {}) } } : {}) };
      return { kind: "decimal", unit: f.kind === "decimal" && f.suffix !== undefined ? `10進の文字列（${f.suffix}）` : "10進の文字列" };
    }
  }
}

const fromFields = (it: MovableItem): boolean => it.key.startsWith("field:");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * 場所 at の中に、世帯のデータに書かれていない要素の ID（ID を持たない並びの要素に、親の物の ID と場所から決めて振る ID。資産配分の割合・
 * 取得の時期ごとの残高・借り換えなど）があるか（0201）。渡された世帯では親の ID が共有の仮の ID なので、アプリ本体が元の ID に戻せず、
 * プランの候補には出せない（計算はできる）
 */
const derivedAt = (at: readonly string[] | undefined, inputText: string): boolean => at !== undefined && at.some((s) => UUID.test(s) && !inputText.includes(`"${s}"`));

/**
 * この世帯で動かせる項目の一覧。reqJson は計算の要求（input を持つ）、argsJson は PlanArgs、officeJson は事務所データの defaults.estimates
 * （無ければ null）。戻り値は JSON の文字 { status: "ok", items, groups, ... } か { status: "noSelf" } か { status: "badInput" }
 */
export function listPlanItems(reqJson: string, argsJson: string, officeJson: string): string {
  const req = JSON.parse(reqJson) as EngineRequest;
  const a = JSON.parse(argsJson) as PlanArgs;
  publishOfficeEstimates(readOfficeEstimates(JSON.parse(officeJson) as unknown));
  const o = open(req, a);
  if (o === null) return JSON.stringify({ status: "noSelf" });
  if (o === "badInput") return JSON.stringify({ status: "badInput" });
  const all = o.cat.items.map((it) => ({ it, ref: candidateRefOf(it, o.wh, o.cat) }));
  const usable = all.flatMap((x) => (x.ref !== null ? [{ it: x.it, ref: x.ref }] : []));
  const groups = [...new Set(usable.map((x) => x.it.group))].map((g) => ({ group: g, count: usable.filter((x) => x.it.group === g).length, fromFields: usable.some((x) => x.it.group === g && fromFields(x.it)) }));
  // 世帯のデータに書かれている要素の ID（画面で開いた世帯と同じく、保存するときに振る並びの要素の ID を含む）
  const inputText = JSON.stringify(o.wh.request.input);
  const shown = usable.filter((x) => (a.group !== undefined ? x.it.group === a.group : a.fields === true || !fromFields(x.it)));
  const items = shown.map(({ it, ref }) => {
    const now = it.read(o.wh);
    const note = it.note?.(now) ?? null;
    const placed = ref.at !== undefined || ref.lever !== undefined;
    return {
      target: ref.target,
      item: it.item,
      // 場所だけ違う項目は、選ぶための場所（そのまま渡す）と、人が読める区別（0201）
      ...(ref.at !== undefined ? { at: ref.at } : {}),
      ...(ref.lever !== undefined ? { lever: ref.lever } : {}),
      ...(placed ? { place: placeText(it) } : {}),
      label: it.label,
      group: it.group,
      value: now,
      valueText: it.text(now),
      ...controlOf(it, now),
      ...(note !== null ? { note } : {}),
      // プランの候補（propose_scenario）で前提（assumptions）を対象にできるのは、前提条件の入力項目（assumptions.〜）か、場所を添えた変更（0201）。
      // 場所に、世帯のデータに書かれていない要素の ID があれば出せない（元の ID に戻せない）
      proposable: (ref.target !== "assumptions" || it.item.startsWith("assumptions.") || placed) && !derivedAt(ref.at, inputText),
    };
  });
  return JSON.stringify({ status: "ok", count: items.length, total: usable.length, groups, items, unlisted: all.length - usable.length });
}

/** 当てはめの結果の1件（AI に返す形） */
function rowOut(c: PlanChange, r: CandidateRow): Record<string, unknown> {
  return { target: c.target, item: c.item, ...(c.at !== undefined ? { at: c.at } : {}), ...(c.lever !== undefined ? { lever: c.lever } : {}), ...(r.place !== null ? { place: r.place } : {}), label: r.label, from: r.from, to: r.to, status: r.key === null ? "rejected" : r.reason === null ? "applied" : "same", ...(r.reason !== null ? { reason: r.reason } : {}) };
}

/**
 * プランの候補と同じ書き方の変更を、画面のプランと同じ関数で計算の要求に当てる。reqJson は計算の要求（trace と input）、changesJson は
 * PlanChange の並び、argsJson は PlanArgs と officeJson（事務所データの defaults.estimates か null）を { args, office } にまとめた物。
 * 戻り値は JSON の文字 { status: "ok", request, changes } か { status: "rejected", changes }（当てはまらない変更が1つでもあれば何も当てない）か
 * { status: "noSelf" }（本人がいない）か { status: "badInput" }（画面の部品が読めない形の入力）
 */
export function applyPlan(reqJson: string, changesJson: string, ctxJson: string): string {
  const req = JSON.parse(reqJson) as EngineRequest;
  const changes = JSON.parse(changesJson) as PlanChange[];
  const ctx = JSON.parse(ctxJson) as { args?: PlanArgs; office?: unknown };
  publishOfficeEstimates(readOfficeEstimates(ctx.office ?? null));
  const o = open(req, ctx.args ?? {});
  if (o === null) return JSON.stringify({ status: "noSelf" });
  if (o === "badInput") return JSON.stringify({ status: "badInput" });
  const diffs: ProposedChange[] = changes.map((c, i) => ({
    id: `c${i + 1}`,
    target: c.target === "assumptions" ? { plan: "assumptions" } : { object: c.target },
    item: c.item,
    ...(c.at !== undefined ? { at: c.at } : {}),
    ...(c.lever !== undefined ? { lever: c.lever } : {}),
    value: c.value,
    note: null,
  }));
  // 場所は at か lever のどちらか1つ（両方を書いた変更は当てない）
  const rows = candidateRows({ diffs }, o.wh, o.cat).map((r, i): CandidateRow => {
    const c = changes[i] as PlanChange;
    return c.at !== undefined && c.lever !== undefined ? { ...r, key: null, value: null, reason: "場所は at か lever のどちらか1つにしてください（list_plan_items が添えた方）" } : r;
  });
  const out = changes.map((c, i) => rowOut(c, rows[i] as CandidateRow));
  if (rows.some((r) => r.key === null)) return JSON.stringify({ status: "rejected", changes: out });
  // 同じ項目を2回動かす変更は、後の値が勝つ（画面で同じつまみを2回動かしたのと同じ）
  const values = candidateValues(rows);
  if (Object.keys(values).length === 0) return JSON.stringify({ status: "ok", request: req, changes: out });
  const applied = applyValues(o.wh, values, o.cat);
  return JSON.stringify({ status: "ok", request: { ...req, input: applied.input }, changes: out });
}


/**
 * 画面の資産運用のタブの「相場が下がった場合」（invest/present.ts の stressRequests・stressLabel。0026）の型を、計算の要求に重ねる（0199）。
 * 画面と同じく、プランを当てた後の要求に重ねる（退職の年・取り崩しを始める年は、その要求から読む）。key は drop（退職の直後に株などが下がる）・
 * low（取り崩しを始めてから利回りが低いまま）・minus1（利回りがずっと想定より1%低い）。戻り値は JSON の文字
 * { status: "ok", request, label } か { status: "unknown", keys }
 */
export function marketStress(reqJson: string, key: string, _unused: string): string {
  void _unused;
  const req = JSON.parse(reqJson) as EngineRequest;
  if (!(STRESS_KEYS as readonly string[]).includes(key)) return JSON.stringify({ status: "unknown", keys: STRESS_KEYS });
  const k = key as StressKey;
  return JSON.stringify({ status: "ok", request: stressRequests(req)[k], label: stressLabel(req, k) });
}
