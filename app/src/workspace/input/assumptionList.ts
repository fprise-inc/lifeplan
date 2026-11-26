// 前提と推定の一覧（0070・0260）: 前提条件の入力項目の道具。計算の前提（経済の前提・計算の範囲・不動産の評価・資産の種類ごとの利回り）と、ほかの入力項目の推定
// （確かめの一覧と同じ行を前提の側から見る）、万一の前提を、区分（見出しの行）・項目・値・状態・出典で並べる。行から欄へ移れる（前提条件の欄だけ）。読むだけ。
// 一覧は世帯の欄の定義から毎回作る（保存しない）。
// - 前提条件の事務所の既定値の欄（0214）は、状態を欄と同じ印で見せる: 事務所の既定値どおりは印なし、「この世帯だけ」「既定値が変わりました」。
//   出典は短く（「事務所の既定値」「この世帯で入れた値（事務所は 1%）」「前の事務所の既定値（今は 1.5%）」。決めていない値も「事務所の既定値」で、
//   提供元の既定の値であることは一覧の「?」の中で言う）
// - 事務所の既定値どおりの資産の種類ごとの利回り・耐用年数は、それぞれ1行にまとめる（違う物だけ1行ずつ。0260）
// - 前の「お客さまと確かめた」の列（世帯ファイルの household.agreed）はなくした（0260。世帯ファイルの形式 0.92 で記録も外した）
import { ILLNESS_DEFAULT, marketDropDefault } from "../contingency/requests.ts";
import { checkList } from "./checkRows.ts";
import { allFields, type FieldDef, type GroupDef, type Level, type SectionDef } from "./form.ts";
import type { WorkingHousehold } from "./household.ts";
import { premiseOfKey } from "./premiseDefaults.ts";
import { assumptionsStage } from "./stages/assumptions.ts";
import { fieldStatus, STATUS_LABELS } from "./valueState.ts";
import { pctText } from "../plans/decimal.ts";
import { officeNow } from "../office/current.ts";
import { presetValue } from "../../../../hearing/src/presets.ts";

export type ListGroup = "economy" | "range" | "realEstate" | "assetReturns" | "estimate" | "contingency";

export const LIST_GROUP_LABELS: Readonly<Record<ListGroup, string>> = {
  economy: "経済の前提",
  range: "計算の範囲・決まり",
  realEstate: "不動産の評価（持ち家・収益不動産など）",
  assetReturns: "資産の種類ごとの利回り",
  estimate: "推定の根拠（各入力項目）",
  contingency: "万一の前提",
};

/** 状態の印の色分け（欄の印と同じ: この世帯だけは藍、既定値が変わりました・推定は橙、決まりは灰。plain は印の色なしの言葉だけ） */
export type RowTone = "household" | "officeChanged" | "estimated" | "rule" | "plain";

export interface AssumptionRow {
  /** 行の印（行の見分け） */
  id: string;
  group: ListGroup;
  label: string;
  value: string;
  /** 状態の言葉（事務所の既定値・この世帯だけ・事務所の既定値が変わりました・推定・決まり・確定 など） */
  state: string;
  /** 状態の印の色分け（null は印を出さない＝事務所の既定値どおり） */
  tone: RowTone | null;
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

/** 前提条件の事務所の既定値の状態の言葉（0214） */
export const PREMISE_STATE_LABELS = { office: "事務所の既定値", household: "この世帯だけ", officeChanged: "事務所の既定値が変わりました" } as const;

/** 印の言葉（欄の印と同じ短い言い方。plain は状態の言葉をそのまま） */
export const ROW_TONE_TEXT: Readonly<Record<Exclude<RowTone, "plain">, string>> = { household: "この世帯だけ", officeChanged: "既定値が変わりました", estimated: "推定", rule: "決まり" };

/** 前提条件の区画 → 一覧の区分（まとまりで分ける区画は、まとまりのキーで。例外の年のまとまりの欄は行にしない） */
function groupOf(sec: SectionDef, g: GroupDef): ListGroup | null {
  if (sec.key === "assume/economy") return g.key === "assume/economy/fields" ? "economy" : null;
  if (sec.key === "assume/period" || sec.key === "assume/conv") return "range";
  if (sec.key === "assume/realEstate") return g.key === "assume/realEstate/fields" || g.key === "assume/realEstate/fields/life" ? "realEstate" : null;
  if (sec.key === "assume/assetReturns") return g.key === "assume/assetReturns/grid" || g.key === "assume/assetReturns/invest" ? "assetReturns" : null;
  return null;
}

function valueText(f: FieldDef, wh: WorkingHousehold): string {
  const v = f.get(wh).value;
  if (v === null || v === "") return "—";
  // 表を何歳まで見るか: 年と、選んだ決め方（「2085年（配偶者が100歳まで）」。年で決めた年は年だけ）
  if (f.key === "assume/endYear") {
    const label = f.kind === "select" ? f.options.find((o) => o.value === v)?.label : undefined;
    const end = `${String(wh.request.input.endYear)}年`;
    return label === undefined || v === "year" ? end : `${end}（${label.replace("（既定）", "")}）`;
  }
  if (f.kind === "select") return f.options.find((o) => o.value === v)?.label ?? String(v);
  if (f.kind === "pct") return pctText(String(v));
  if (f.kind === "int") return `${String(v)}${f.suffix ?? ""}`;
  if (f.kind === "yen") return `${(Number(v) / 10000).toLocaleString("en-US")}万円`;
  return String(v);
}

/** 空欄の欄の値の言葉（ほかの値と同じになる物は「物価と同じ」「基礎年金と同じ」のように短く。欄の下の「空欄: …」から） */
function blankText(f: FieldDef, wh: WorkingHousehold): string | null {
  const hint = f.get(wh).hint;
  return hint != null && hint.startsWith("空欄: ") ? hint.slice("空欄: ".length).replace(/の上昇率と同じ$/, "と同じ") : null;
}

/** 前提と推定の一覧（区分の順。区分の中は欄の順。事務所の既定値どおりの資産の種類・耐用年数はまとめる） */
export function assumptionRows(wh: WorkingHousehold): AssumptionRow[] {
  const rows: AssumptionRow[] = [];
  const stage = assumptionsStage(wh);
  /** まとめる行（事務所の既定値どおりの資産の種類ごとの利回り・耐用年数） */
  const officeClasses: FieldDef[] = [];
  const officeLife: FieldDef[] = [];
  for (const sec of stage.sections) {
    for (const g of sec.groups) {
      const group = groupOf(sec, g);
      if (group === null) continue;
      for (const f of g.fields) {
        // 表の最後の年は「表を何歳まで見るか」の行1つ（「年で決める」の年の欄は同じ値の入れ方）
        if (f.key === "assume/endYear/year") continue;
        const st = f.get(wh);
        const s = fieldStatus(f, wh);
        const ex = st.derived ?? null;
        const p = s.premise;
        const level: Level = sec.level === "detail" || g.level === "detail" || f.level === "detail" ? "detail" : "simple";
        const label = premiseOfKey(f.key)?.label ?? f.label;
        const value = `${st.value === null || st.value === "" ? (blankText(f, wh) ?? valueText(f, wh)) : valueText(f, wh)}${ex !== null ? `（${ex.replace(/（.*$/, "")}）` : ""}`;
        if (p !== undefined) {
          if (p.state === "office" && ex === null && g.key === "assume/assetReturns/grid") {
            officeClasses.push(f);
            continue;
          }
          if (p.state === "office" && g.key === "assume/realEstate/fields/life") {
            officeLife.push(f);
            continue;
          }
          const officeShown = p.officeValue ?? p.officeText;
          rows.push({
            id: `field:${f.key}`,
            group,
            label,
            value,
            state: PREMISE_STATE_LABELS[p.state],
            tone: p.state === "office" ? null : p.state,
            source: p.state === "office" ? (p.decided ? officeNow().basis : "事務所の既定値") : p.state === "household" ? `この世帯で入れた値（事務所は ${officeShown}）` : `前の事務所の既定値（今は ${p.officeText}）`,
            fieldKey: f.key,
            level,
            card: null,
            warn: st.warn ?? null,
          });
          continue;
        }
        const rule = f.readOnly !== undefined;
        rows.push({
          id: `field:${f.key}`,
          group,
          label,
          value,
          state: rule ? "決まり" : STATUS_LABELS[s.status],
          tone: rule ? "rule" : s.status === "estimated" ? "estimated" : "plain",
          source: s.basis ?? (rule ? null : s.status === "confirmed" ? "入れた値" : null),
          fieldKey: f.key,
          level,
          card: null,
          warn: st.warn ?? null,
        });
      }
    }
  }
  // 事務所の既定値どおりの耐用年数（1行。構造の名前と年数を「・」で）
  if (officeLife.length > 0) {
    rows.push({
      id: "group:assume/realEstate/life",
      group: "realEstate",
      label: `耐用年数（${officeLife.map((f) => f.label).join("・")}）`,
      value: `${officeLife.map((f) => String(f.get(wh).value ?? "—")).join("・")}年`,
      state: PREMISE_STATE_LABELS.office,
      tone: null,
      source: "事務所の既定値",
      fieldKey: (officeLife[0] as FieldDef).key,
      level: "detail",
      card: null,
      warn: null,
    });
  }
  // 事務所の既定値どおりの資産の種類（1行。空欄の種類の計算の決まりを出典に）
  if (officeClasses.length > 0) {
    const own = rows.some((r) => r.group === "assetReturns");
    const inv = wh.request.input.assumptions?.investmentReturn?.default;
    rows.push({
      id: "group:assume/assetReturns",
      group: "assetReturns",
      label: `${own ? "そのほかの種類" : "どの種類も"}（${String(officeClasses.length)}）`,
      value: "事務所の既定値",
      state: PREMISE_STATE_LABELS.office,
      tone: null,
      source: `空欄の種類は、預金・外貨預金は預金の利回り、不動産は0%、ほかは${inv !== undefined ? pctText(inv) : "事務所の既定値"}`,
      fieldKey: (officeClasses[0] as FieldDef).key,
      level: "detail",
      card: null,
      warn: null,
    });
  }
  // 区分の順に並べ直す（同じ区分の中は前の並びのまま。まとめた行は区分の最後）
  const order = Object.keys(LIST_GROUP_LABELS);
  rows.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  // ほかのカードの推定（確かめの一覧の推定の行と同じ）
  for (const r of checkList(wh)) {
    if (r.card === "assumptions" || r.kind !== "estimated") continue;
    rows.push({ id: r.id, group: "estimate", label: r.label, value: "—", state: "推定", tone: "estimated", source: r.detail, fieldKey: null, level: r.level, card: r.cardLabel, warn: null });
  }
  // 万一の前提（全プラン共通の値。万一のタブで直す）
  const c = wh.contingency;
  const lr = c.survivor.livingRatio ?? {};
  const cg = (id: string, label: string, v: string, given: boolean, source: string) =>
    rows.push({ id: `cg:${id}`, group: "contingency", label, value: v, state: given ? "確定" : "推定", tone: given ? "plain" : "estimated", source: given ? "入れた値（万一のタブ）" : source, fieldKey: null, level: "simple", card: "万一のタブ", warn: null });
  cg("living/before", "遺族の生活費（子がいる間）", pctText(lr.beforeIndependence ?? String(presetValue("preset.survivor.livingRatio.beforeIndependence"))), lr.beforeIndependence !== undefined, "既定の値（出典は確かめ前）");
  cg("living/after", "遺族の生活費（末子の独立の後）", pctText(lr.afterIndependence ?? String(presetValue("preset.survivor.livingRatio.afterIndependence"))), lr.afterIndependence !== undefined, "既定の値（出典は確かめ前）");
  cg("living/noKids", "遺族の生活費（子がいない世帯）", pctText(lr.noChildren ?? String(presetValue("preset.survivor.livingRatio.noChildren"))), lr.noChildren !== undefined, "既定の値（出典は確かめ前）");
  cg("illness/months", "大きな病気の働けない期間", `${c.illness?.months ?? ILLNESS_DEFAULT.months}か月`, c.illness?.months !== undefined, "仮の値（事務所で根拠を確かめる）");
  cg("market/drop", "相場の下がる幅", `${Math.round(Number(c.market?.drop ?? marketDropDefault()) * 10)}割`, c.market?.drop !== undefined, "仮の値");
  return rows;
}

/** カードの欄の全部（テスト用） */
export const assumptionFields = (wh: WorkingHousehold): FieldDef[] => allFields(assumptionsStage(wh));
