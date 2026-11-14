// AI接続口（crates/lifeplan）の表示の設定の今の値（get_display_settings。0213）: アプリ本体が切り出した見せ方だけの値（事務所データの
// defaults のうち見せ方だけの欄と、渡された世帯の display・itemChoice・shownItems）を、画面と同じ読み方の関数で読み、一覧の id ごとの今の値にする。
// - 読み方は画面と同じ欄ごとの関数（対策は readLeverChoice、万一のタブは readPremiseChoice・readSceneChoice、入力項目は readItemChoice・cardOrder、
//   基本生活費の内訳は readLivingLayout、資産と負債のタブは readBsGuide・readBsPoints・readBsColumns・readMoneyThree）。読めない値・知らない種類は
//   画面と同じく既定にする。事務所データ全体を読む office/settings.ts・世帯ファイルの本文を読む store/body.ts は、拡張やヒアリングの部品まで
//   読み込む（接続口の JS に入れられない）ので使わず、同じ欄の読み方になることをテスト（app/test/display-catalog.test.ts）で確かめる
// - 一覧（displayCatalog.ts）に無い欄は返さない。計算の結果を変える設定（前提条件の標準値・推定の値など）は、届いても読まない
// - 接続口は plan.js（画面の部品をまとめた JS）の中で、計算と同じ固めた実行環境で動かす。答えは JSON の文字
import { DEFAULT_OPEN_SCENE, PREMISE_KINDS, premiseStartKinds, readPremiseChoice, readSceneChoice, SCENE_KINDS, sceneShown } from "../workspace/contingency/premiseChoice.ts";
import type { StageId } from "../workspace/input/form.ts";
import { readItemChoice, type ItemChoice } from "../workspace/input/itemChoice.ts";
import { STAGE_ORDER } from "../workspace/input/stageOrder.ts";
import { cardOrder } from "../workspace/input/items.ts";
import { readLivingLayout, STANDARD_LIVING_LAYOUT, STANDARD_LIVING_NAMES, rowLabel } from "../workspace/office/livingLayout.ts";
import { LEVER_KINDS, leverKindOf, readLeverChoice, startKinds } from "../workspace/plans/leverChoice.ts";
import { readBsColumns, readBsGuide, readBsPoints } from "../workspace/balanceTab.ts";
import { readMoneyThree } from "../workspace/moneyThree.ts";
import { DEFAULT_BALANCE_SETTINGS, DEFAULT_DISPLAY_SETTINGS, LAYOUT_CHOICES, METRIC_CHOICES, type BalanceSettings, type DisplaySettings, type MetricKey } from "../workspace/settings.ts";
import { buildDisplayCatalog, GUIDE_BASIS_CHOICES, type DisplayCatalog, type DisplaySetting } from "./displayCatalog.ts";

/** 1つの設定の今の値（value は事務所データ・世帯ファイルと同じ形。text は画面の言葉の短い要約） */
export interface CurrentValue {
  value: unknown;
  isDefault: boolean;
  text: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

let catalog: DisplayCatalog | null = null;
const settingOf = (id: string): DisplaySetting | undefined => (catalog ??= buildDisplayCatalog()).settings.find((s) => s.id === id);

/** 選べる値の言葉（無ければ値そのもの） */
function labelOf(id: string, v: unknown): string {
  const c = settingOf(id)?.choices?.find((x) => x.value === v);
  return c !== undefined ? c.label : String(v);
}

const listText = (id: string, vs: readonly unknown[]): string => (vs.length === 0 ? "なし" : vs.map((v) => labelOf(id, v)).join("・"));

function current(id: string, value: unknown, text: string): CurrentValue {
  const s = settingOf(id);
  return { value, isDefault: s !== undefined && same(value, s.default), text };
}

function itemChoiceValue(c: ItemChoice): { hidden: string[]; levels: Record<string, string> } {
  return { hidden: [...(c.hidden ?? [])], levels: { ...(c.levels ?? {}) } };
}

function itemChoiceText(c: ItemChoice): string {
  const name = (id: string) => STAGE_ORDER.find((s) => s.id === id)?.label ?? id;
  const hidden = c.hidden ?? [];
  const detail = Object.keys(c.levels ?? {});
  const a = hidden.length === 0 ? "全部出す" : `出さない: ${hidden.map(name).join("・")}`;
  const b = detail.length === 0 ? "全部「標準」で開く" : `「詳細」で開く: ${detail.map(name).join("・")}`;
  return `${a}／${b}`;
}

/** 事務所データの見せ方だけの欄の読み方（office/settings.ts の readOfficeSettings の同じ欄と同じ。テストで確かめる） */
export function readOfficeDisplay(raw: unknown) {
  const v = isObj(raw) ? raw : {};
  const order = isObj(v.layout) && Array.isArray(v.layout.order) ? v.layout.order.filter((x): x is StageId => typeof x === "string") : [];
  return {
    layout: { order: cardOrder({ order }) },
    items: readItemChoice(v.items),
    levers: readLeverChoice(v.levers),
    premises: readPremiseChoice(v.premises),
    scenes: readSceneChoice(v.scenes),
    living: readLivingLayout(v.living) ?? undefined,
    features: { combinedBs: isObj(v.features) && v.features.combinedBs === true },
  };
}

/** 世帯ファイルの本文の表示の設定の読み方（store/body.ts の readDisplay と同じ。区画の無い 0.7 までの本文は直下の値から読む。テストで確かめる） */
export function readDisplaySettings(v: unknown): { result: DisplaySettings; balance: BalanceSettings } {
  const d = isObj(v) ? v : {};
  const r = isObj(d.result) ? d.result : d;
  const bal = isObj(d.balance) ? d.balance : null;
  const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((y): y is string => typeof y === "string") : []);
  return {
    result: {
      metrics: strings(r.metrics).filter((k): k is MetricKey => METRIC_CHOICES.some((c) => c.key === k)),
      atAge: typeof r.atAge === "number" ? r.atAge : DEFAULT_DISPLAY_SETTINGS.atAge,
      layout: LAYOUT_CHOICES.some((c) => c.key === r.layout) ? (r.layout as DisplaySettings["layout"]) : DEFAULT_DISPLAY_SETTINGS.layout,
      invBreakdown: typeof r.invBreakdown === "boolean" ? r.invBreakdown : DEFAULT_DISPLAY_SETTINGS.invBreakdown,
      invPeriods: typeof r.invPeriods === "boolean" ? r.invPeriods : DEFAULT_DISPLAY_SETTINGS.invPeriods,
    },
    balance: {
      health: typeof bal?.health === "boolean" ? bal.health : DEFAULT_BALANCE_SETTINGS.health,
      guide: readBsGuide(bal !== null ? bal.guide : d.bsGuide),
      points: readBsPoints(bal !== null ? bal.points : d.bsPoints),
      columns: readBsColumns(bal !== null ? bal.columns : d.bsColumns),
      moneyThree: readMoneyThree(bal !== null ? bal.moneyThree : undefined),
    },
  };
}

/** 事務所データの見せ方だけの欄（アプリ本体が切り出した物）から、一覧の id ごとの今の値 */
export function officeCurrent(raw: unknown): Record<string, CurrentValue> {
  const s = readOfficeDisplay(raw);
  const out: Record<string, CurrentValue> = {};
  const order = cardOrder(s.layout);
  out["input.order"] = current("input.order", order, listText("input.order", order));
  const items = itemChoiceValue(s.items);
  out["input.items"] = current("input.items", items, itemChoiceText(s.items));
  const living = s.living ?? STANDARD_LIVING_LAYOUT;
  const shown = new Set(living.rows.flatMap((r) => (r.kind === "group" ? r.categories : [r.category])));
  const hiddenCats = Object.keys(STANDARD_LIVING_NAMES).filter((k) => !shown.has(k as keyof typeof STANDARD_LIVING_NAMES));
  const livingText = living.rows.map((r) => (r.kind === "split" ? `${rowLabel(r)}（${r.parts.map((p) => p.label).join("・")}に分ける）` : rowLabel(r))).join("・");
  out["input.living"] = current("input.living", living, s.living === undefined ? `標準（${livingText}）` : `${livingText}${hiddenCats.length > 0 ? `／隠す: ${hiddenCats.map((k) => STANDARD_LIVING_NAMES[k as keyof typeof STANDARD_LIVING_NAMES]).join("・")}` : ""}`);
  const levers = startKinds(s.levers);
  out["result.levers"] = current("result.levers", levers, listText("result.levers", levers));
  const prem = premiseStartKinds(s.premises);
  const premises = PREMISE_KINDS.map((k) => k.kind).filter((k) => prem.has(k));
  out["contingency.premises"] = current(
    "contingency.premises",
    premises,
    SCENE_KINDS.map((sc) => `${sc.label}: ${listText("contingency.premises", PREMISE_KINDS.filter((k) => k.scene === sc.kind && prem.has(k.kind)).map((k) => k.kind))}`).join("／"),
  );
  const scenes = SCENE_KINDS.map((k) => k.kind).filter((k) => sceneShown(s.scenes, k));
  out["contingency.scenes"] = current("contingency.scenes", scenes, listText("contingency.scenes", scenes));
  const open = s.scenes.open ?? DEFAULT_OPEN_SCENE;
  out["contingency.openScene"] = current("contingency.openScene", open, labelOf("contingency.openScene", open));
  const active = isObj(raw) && Array.isArray(raw.featureCodes) && raw.featureCodes.includes("combinedBs");
  const on = s.features.combinedBs;
  out["features.combinedBs"] = current("features.combinedBs", on, `${on ? "使う" : "使わない"}（機能を有効にするコード: ${active ? "入っている" : "入っていない"}${on && !active ? "。コードが入っていないので効いていない" : ""}）`);
  return out;
}

/** 動かす項目の鍵の言葉（種類の名前。入力の欄から足した項目は「入力の欄」） */
function itemKeyLabel(key: string): { kind: string | null; label: string } {
  const k = leverKindOf(key);
  if (k !== null) return { kind: k, label: LEVER_KINDS.find((x) => x.kind === k)?.label ?? k };
  if (key.startsWith("field:")) return { kind: null, label: "入力の欄から足した項目" };
  return { kind: null, label: key };
}

/** 世帯ファイルの本文の見せ方の区画（アプリ本体が切り出した display・itemChoice・shownItems）から、一覧の id ごとの今の値 */
export function householdCurrent(raw: unknown): Record<string, CurrentValue> {
  const r = isObj(raw) ? raw : {};
  const d = readDisplaySettings(r.display);
  const out: Record<string, CurrentValue> = {};
  const c = readItemChoice(r.itemChoice);
  out["input.items"] = current("input.items", itemChoiceValue(c), itemChoiceText(c));
  const keys = Array.isArray(r.shownItems) ? r.shownItems.filter((x): x is string => typeof x === "string") : [];
  const added = keys.map((key) => ({ key, ...itemKeyLabel(key) }));
  out["result.addedItems"] = current("result.addedItems", added, added.length === 0 ? "なし" : added.map((a) => a.label).join("・"));
  out["result.metrics"] = current("result.metrics", d.result.metrics, listText("result.metrics", d.result.metrics));
  out["result.atAge"] = current("result.atAge", d.result.atAge, `${d.result.atAge}歳`);
  out["result.layout"] = current("result.layout", d.result.layout, labelOf("result.layout", d.result.layout));
  out["result.invBreakdown"] = current("result.invBreakdown", d.result.invBreakdown, labelOf("result.invBreakdown", d.result.invBreakdown));
  out["result.invPeriods"] = current("result.invPeriods", d.result.invPeriods, labelOf("result.invPeriods", d.result.invPeriods));
  out["balance.health"] = current("balance.health", d.balance.health, labelOf("balance.health", d.balance.health));
  const g = d.balance.guide;
  const basisText = g.basis === undefined ? "分母は世帯から決める" : (GUIDE_BASIS_CHOICES.find((x) => x.value === g.basis)?.label ?? g.basis);
  out["balance.guide"] = current("balance.guide", g, `すぐ使えるお金 ${g.months[0]}〜${g.months[1]}か月分（${basisText}）・値動きのある資産 ${g.risk[0]}〜${g.risk[1]}%・負債の重さ ${g.debt}%未満`);
  out["balance.points"] = current("balance.points", d.balance.points, listText("balance.points", d.balance.points));
  const cols = d.balance.columns;
  out["balance.columns"] = current("balance.columns", cols, cols === null ? "「時点を並べる」の既定のまま" : cols.map((x) => ("point" in x ? labelOf("balance.columns", x.point) : `${x.year}年`)).join("・"));
  const m3 = d.balance.moneyThree;
  out["balance.moneyThree.wording"] = current("balance.moneyThree.wording", m3.wording, labelOf("balance.moneyThree.wording", m3.wording));
  out["balance.moneyThree.months"] = current("balance.moneyThree.months", m3.months, `${m3.months}か月分`);
  out["balance.moneyThree.years"] = current("balance.moneyThree.years", m3.years, `${m3.years}年先まで`);
  return out;
}

/**
 * 接続口の入口: office は事務所データの見せ方だけの欄（JSON。アプリが起動していなければ "null"）、household は渡された世帯の見せ方の区画
 * （JSON。世帯を選ばなければ "null"）。答えは `{ office: {id: 今の値} | null, household: {id: 今の値} | null }` の JSON の文字
 */
export function displayCurrent(officeJson: string, householdJson: string, _unused: string): string {
  const office = JSON.parse(officeJson === "" ? "null" : officeJson) as unknown;
  const household = JSON.parse(householdJson === "" ? "null" : householdJson) as unknown;
  return JSON.stringify({ office: office === null ? null : officeCurrent(office), household: household === null ? null : householdCurrent(household) });
}
