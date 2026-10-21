// 持ち帰り用のレポートの中身（TakeawayPayload）を作る（作業の層。0030）。
// - 許可した項目だけを写す: プランの文字と名前・計算の要求（sanitize.ts で自由記述と識別子を外し、ID を付け替えたもの）・つまみの範囲と補足・
//   作成日・制度データの版・必須の記載・○歳時点の年齢・載せる画面。宛名と事務所名は FP がこの書き出しのために入れたものだけ
// - 写さないもの: FP用のメモ・呼び名・控え・ヒアリングの記録・AIの記録・案の差分（作った日時・出どころ・承認・注記）・世帯の内部ID・顧客番号・
//   事務所の設定（料金表の写し）・カスタム計算の印・ファイルのパス
// - 計算の要求は、主画面と同じ当て方（plans.ts の applyValues。保存していない変更を含む今の中身）で作る
import type { EngineRequest } from "../../engine/types.ts";
import type { MoneyThreeSettings } from "../../presentation/model.ts";
import { TAKEAWAY_FORMAT, TAKEAWAY_LEVER_KEYS, TAKEAWAY_VERSION, type TakeawayLever, type TakeawayLeverKey, type TakeawayPayload } from "../../takeaway/model.ts";
import { applyTry, type LeverConfig, type TryValues } from "../../takeaway/levers.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { feeSummary, hasAdvisoryFee, readLevers } from "../levers.ts";
import { CURRENT } from "../plans/band.ts";
import { amountRange, reemploymentFor, type Catalog } from "../plans/items.ts";
import { applyValues, type Values } from "../plans/plans.ts";
import { IdMap, sanitizeRequest } from "./sanitize.ts";

/** 必須の記載（提案書の PDF と同じ文。本体の app/src-tauri/src/report.rs の STANDARD_NOTICES と同じことを cargo test で確かめる） */
export const STANDARD_NOTICES: readonly string[] = [
  "この提案書は、お伺いした情報と前提条件にもとづく試算です。将来の金額や結果を保証するものではありません。",
  "公的データの出典: 国税庁、厚生労働省、日本年金機構、文部科学省、金融庁、総務省統計局の公表資料（加工して作成）",
  "前提条件や計算方法の一部は担当FPが設定しています。",
];

/** 顧客が動かせるつまみの選択（外したいものを外す。既定は結果の画面の対策と同じ全部） */
export type TakeawayKnob = TakeawayLeverKey | "fee";

export interface TakeawayChoice {
  /** FP の提案のプラン（帯の案の ID） */
  proposal: string;
  /** 一緒に載せるプラン（現状 CURRENT と帯の案の ID）。現状はいつも載せる */
  compare: readonly string[];
  /** 基準のプラン（主画面の基準。載せないプランなら現状） */
  base: string;
  /** 帯の並び（現状のほか） */
  band: readonly string[];
  /** 顧客が動かせないようにするつまみ */
  excluded: ReadonlySet<TakeawayKnob>;
  views: { balance: boolean; table: boolean; moneyThree: boolean };
  /** お金の3つの分け方の何か月分・何年先まで・呼び方（資産と負債のタブの表示の設定。0032） */
  moneyThree: MoneyThreeSettings;
  addressee: string;
  office: string;
  targetAge: number;
  /** 作成日（YYYY-MM-DD） */
  createdOn: string;
  /** 制度データの版（提案書の刻印と同じ書式） */
  dataSet: string;
}

export interface TakeawayContext {
  wh: WorkingHousehold;
  catalog: Catalog;
  valuesOf: (id: string) => Values;
  letterOf: (id: string) => { letter: string; name: string };
}

/** 文字の欄を整える（前後の空白を外し、長さの上限で切る。空なら null） */
export function cleanText(s: string, max: number): string | null {
  const t = [...s].map((c) => (c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f ? " " : c)).join("").trim().slice(0, max);
  return t === "" ? null : t;
}

/** 載せるプランの ID（現状が先頭、帯の並び） */
export function planIds(c: Pick<TakeawayChoice, "proposal" | "compare" | "band">): string[] {
  const set = new Set([CURRENT, c.proposal, ...c.compare]);
  return [CURRENT, ...c.band].filter((id) => set.has(id));
}

/** 結果の画面の対策の固定の項目から、顧客が動かせるつまみの範囲を作る（載せるプランの値が範囲に入るように広げる） */
export function leverItems(ctx: TakeawayContext, requests: readonly EngineRequest[], excluded: ReadonlySet<TakeawayKnob>): TakeawayLever[] {
  const out: TakeawayLever[] = [];
  for (const k of TAKEAWAY_LEVER_KEYS) {
    if (excluded.has(k)) continue;
    const it = ctx.catalog.byKey.get(`lever:${k}`);
    if (it === undefined) continue;
    const c = it.control;
    if (c.kind !== "age" && c.kind !== "range") continue;
    const vals = requests.map((r) => readLevers(r, ctx.catalog.selfId)[k]).filter((v): v is number => typeof v === "number");
    if (vals.length === 0) continue;
    const now = it.read(ctx.wh);
    const note = k === "pensionAge" ? null : (it.note?.(now) ?? null);
    if (c.kind === "age") {
      out.push({ key: k, label: it.label, kind: "age", min: Math.min(c.min, ...vals), max: Math.max(c.max, ...vals), step: 1, ticks: [...c.ticks], per: "", note });
    } else {
      const r = amountRange(c.min, c.max, ...vals);
      out.push({ key: k, label: it.label, kind: "amount", min: r.min, max: r.max, step: c.step, ticks: [...c.ticks], per: c.per ?? "", note });
    }
  }
  return out;
}

/** 制度データを絞るための確かめの要求: 載せるプランと、提案のプランでつまみをそれぞれ端まで動かしたもの・FP顧問料を入れ替えたもの */
export function probeRequests(payload: TakeawayPayload): EngineRequest[] {
  const out = payload.plans.map((p) => p.request);
  const prop = payload.plans.find((p) => p.letter === payload.proposal) ?? payload.plans[0];
  if (prop === undefined) return out;
  const cfg: LeverConfig = payload.levers;
  const tries: TryValues[] = [];
  for (const it of cfg.items) tries.push({ levers: { [it.key]: it.min } }, { levers: { [it.key]: it.max } });
  if (cfg.fee !== null) tries.push({ levers: {}, fee: true }, { levers: {}, fee: false });
  for (const t of tries) out.push(applyTry(prop.request, cfg, t));
  return out;
}

/** 持ち帰り用のレポートの中身を作る。ids は書き出し1回分の ID の付け替え（テストで決まった値を渡せる） */
export function buildPayload(ctx: TakeawayContext, choice: TakeawayChoice, notices: readonly string[] = STANDARD_NOTICES, ids: IdMap = new IdMap()): TakeawayPayload {
  const order = planIds(choice);
  const raw = order.map((id) => applyValues(ctx.wh, ctx.valuesOf(id), ctx.catalog));
  const plans = order.map((id, i) => {
    const l = ctx.letterOf(id);
    return { letter: l.letter, name: (id === CURRENT ? "現状" : cleanText(l.name, 60)) ?? `プラン${l.letter}`, request: sanitizeRequest(raw[i] as EngineRequest, ids) };
  });
  const letter = (id: string) => ctx.letterOf(id).letter;
  const re = reemploymentFor(ctx.wh, ctx.catalog.selfId);
  const levers: LeverConfig = {
    self: ids.of(ctx.catalog.selfId),
    reemployment: re === undefined ? null : { fromAge: re.fromAge, type: re.type, annualSalary: re.annualSalary, ...(re.standardMonthlyRemuneration !== undefined ? { standardMonthlyRemuneration: re.standardMonthlyRemuneration } : {}) },
    items: leverItems(ctx, raw, choice.excluded),
    fee: !choice.excluded.has("fee") && hasAdvisoryFee(ctx.wh.request) && ctx.catalog.byKey.has("lever:fee") ? { note: feeSummary(ctx.wh.request) } : null,
  };
  return {
    format: TAKEAWAY_FORMAT,
    version: TAKEAWAY_VERSION,
    createdOn: choice.createdOn,
    office: cleanText(choice.office, 60),
    addressee: cleanText(choice.addressee, 40),
    dataSet: choice.dataSet,
    notices: [...notices],
    targetAge: choice.targetAge,
    plans,
    proposal: letter(choice.proposal),
    base: order.includes(choice.base) ? letter(choice.base) : "A",
    levers,
    views: { balance: choice.views.balance, table: choice.views.table, moneyThree: choice.views.moneyThree },
    ...(choice.views.moneyThree ? { moneyThree: { months: choice.moneyThree.months, years: choice.moneyThree.years, wording: choice.moneyThree.wording } } : {}),
  };
}

/** 制度データの版（提案書の刻印と同じ: 計算基準月と、パックと版の組の指紋の先頭8桁。本体の report.rs の data_set_label と同じ作り方） */
export async function dataSetLabel(baseMonth: string, packsJson: string): Promise<string> {
  const packs = JSON.parse(packsJson) as { pack?: { packId?: string; version?: string } }[];
  const ids = packs.flatMap((p) => (p.pack?.packId !== undefined && p.pack.version !== undefined ? [`${p.pack.packId}@${p.pack.version}`] : [])).sort();
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ids.join("\n"))));
  const hex = [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${baseMonth.replace("-", ".")}-${hex.slice(0, 8)}`;
}
