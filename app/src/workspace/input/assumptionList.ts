// 前提と推定の一覧（0070）: 前提条件のカードの道具。計算の前提（経済の前提・計算の範囲・持ち家の評価）と、ほかのカードの推定（確かめの一覧と
// 同じ行を前提の側から見る）、万一の前提を、区分・値・状態・値段の基準・出典・確かめた記録で並べる。行から欄へ移れる（前提条件の欄だけ）。
// 「お客さまと確かめた」はプランごと（現状は "current"）に、確かめた日とメモを画面の側の値 agreed に持つ（計算には使わない）。
// 一覧は世帯の欄の定義から毎回作る（保存しない）
import { ILLNESS_DEFAULT, marketDropDefault } from "../contingency/requests.ts";
import { checkList } from "./checkRows.ts";
import { allFields, type FieldDef, type Level } from "./form.ts";
import type { WorkingHousehold } from "./household.ts";
import { assumptionsStage } from "./stages/assumptions.ts";
import { fieldStatus, STATUS_LABELS } from "./valueState.ts";
import { pctText } from "../plans/decimal.ts";
import { presetValue } from "../../../../hearing/src/presets.ts";

export type ListGroup = "economy" | "range" | "realEstate" | "estimate" | "contingency";

export const LIST_GROUP_LABELS: Readonly<Record<ListGroup, string>> = {
  economy: "経済の前提",
  range: "計算の範囲・決まり",
  realEstate: "持ち家の評価",
  estimate: "推定の根拠（各入力項目）",
  contingency: "万一の前提",
};

export interface AssumptionRow {
  /** 行の印（確かめた記録の鍵） */
  id: string;
  group: ListGroup;
  label: string;
  value: string;
  /** 推定・確定・わからない など（標準と違う値は「標準と違う」） */
  state: string;
  /** 出典・根拠 */
  source: string | null;
  /** 移る欄のキー（前提条件のカードの欄だけ） */
  fieldKey: string | null;
  level: Level;
  /** ほかのカードの行のカードの名前 */
  card: string | null;
  /** 高すぎる値の注意など */
  warn: string | null;
}

const ECONOMY = new Set(["assume/inflation", "assume/wageGrowth", "assume/investmentReturn", "assume/educationInflation", "assume/pensionMacroSlide", "assume/pensionMacroSlideEmployee"]);

function valueText(f: FieldDef, wh: WorkingHousehold): string {
  const v = f.get(wh).value;
  if (v === null || v === "") return "—";
  if (f.kind === "pct") return pctText(String(v));
  if (f.kind === "int") return `${String(v)}${f.suffix ?? ""}`;
  if (f.kind === "yen") return `${(Number(v) / 10000).toLocaleString("en-US")}万円`;
  return String(v);
}

/** 前提と推定の一覧（区分の順。区分の中は欄の順） */
export function assumptionRows(wh: WorkingHousehold): AssumptionRow[] {
  const rows: AssumptionRow[] = [];
  const stage = assumptionsStage(wh);
  for (const sec of stage.sections) {
    if (sec.key.startsWith("ev/")) continue;
    for (const g of sec.groups)
      for (const f of g.fields) {
        const group: ListGroup | null = ECONOMY.has(f.key) ? "economy" : sec.key === "assume/main" ? "range" : sec.key === "assume/realEstate" && g.key === "assume/realEstate/fields" ? "realEstate" : null;
        if (group === null || f.key.startsWith("assume/endYear/age/")) continue;
        const st = f.get(wh);
        const s = fieldStatus(f, wh);
        const ex = st.derived ?? null;
        rows.push({
          id: `field:${f.key}`,
          group,
          label: f.label,
          value: `${valueText(f, wh)}${ex !== null ? `（${ex.replace(/（.*$/, "")}）` : ""}`,
          state: f.readOnly !== undefined ? "決まり" : STATUS_LABELS[s.status],
          source: s.basis ?? (f.readOnly !== undefined ? null : s.status === "confirmed" ? "入れた値" : null),
          fieldKey: f.key,
          level: sec.level === "detail" || g.level === "detail" || f.level === "detail" ? "detail" : "simple",
          card: null,
          warn: st.warn ?? null,
        });
      }
  }
  // ほかのカードの推定（確かめの一覧の推定の行と同じ）
  for (const r of checkList(wh)) {
    if (r.card === "assumptions" || r.kind !== "estimated") continue;
    rows.push({ id: r.id, group: "estimate", label: r.label, value: "—", state: "推定", source: r.detail, fieldKey: null, level: r.level, card: r.cardLabel, warn: null });
  }
  // 万一の前提（全プラン共通の値。万一のタブで直す）
  const c = wh.contingency;
  const lr = c.survivor.livingRatio ?? {};
  const cg = (id: string, label: string, v: string, given: boolean, source: string) =>
    rows.push({ id: `cg:${id}`, group: "contingency", label, value: v, state: given ? "確定" : "推定", source: given ? "入れた値（万一のタブ）" : source, fieldKey: null, level: "simple", card: "万一のタブ", warn: null });
  cg("living/before", "遺族の生活費（子がいる間）", pctText(lr.beforeIndependence ?? String(presetValue("preset.survivor.livingRatio.beforeIndependence"))), lr.beforeIndependence !== undefined, "既定の値（出典は確かめ前）");
  cg("living/after", "遺族の生活費（末子の独立の後）", pctText(lr.afterIndependence ?? String(presetValue("preset.survivor.livingRatio.afterIndependence"))), lr.afterIndependence !== undefined, "既定の値（出典は確かめ前）");
  cg("living/noKids", "遺族の生活費（子がいない世帯）", pctText(lr.noChildren ?? String(presetValue("preset.survivor.livingRatio.noChildren"))), lr.noChildren !== undefined, "既定の値（出典は確かめ前）");
  cg("illness/months", "大きな病気の働けない期間", `${c.illness?.months ?? ILLNESS_DEFAULT.months}か月`, c.illness?.months !== undefined, "仮の値（事務所で根拠を確かめる）");
  cg("market/drop", "相場の下がる幅", `${Math.round(Number(c.market?.drop ?? marketDropDefault()) * 10)}割`, c.market?.drop !== undefined, "仮の値");
  return rows;
}

/** 確かめた記録のプランの鍵（現状は "current"） */
export const agreedKey = (planId: string | null | undefined): string => planId ?? "current";

/** 確かめた記録を付け外しした世帯（on は YYYY-MM-DD。null は外す） */
export function setAgreed(wh: WorkingHousehold, planId: string | null | undefined, rowId: string, on: string | null): WorkingHousehold {
  const key = agreedKey(planId);
  const all = structuredClone(wh.agreed ?? {});
  const mine = all[key] ?? {};
  if (on === null) delete mine[rowId];
  else mine[rowId] = { on };
  if (Object.keys(mine).length === 0) delete all[key];
  else all[key] = mine;
  const { agreed: _a, ...rest } = wh;
  void _a;
  return Object.keys(all).length === 0 ? rest : { ...rest, agreed: all };
}

/** カードの欄の全部（テスト用） */
export const assumptionFields = (wh: WorkingHousehold): FieldDef[] => allFields(assumptionsStage(wh));
