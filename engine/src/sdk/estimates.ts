// 0111 の2回目: 計算エンジンの中の目安（マスタデータでない、出典の無いよくある割合・日数など）の一覧。
// 部品は定数を直書きせず、ここの値ID を ctx.estimate で引く。計算の要求の estimateValues に同じ値ID があれば、その値（事務所の推定の値）を使う。
// ここに無い値ID（マスタデータでも、この一覧でもない値ID）は estimateValues で置き換えられない（E_ARGUMENT）。
// 画面とヒアリングシートの目安の一覧（hearing/src/presets.ts）は、この一覧をそのまま取り込む（値を書く所はここの1か所）。
// ほかの所に頼らないよう、何も読み込まない（画面・ヒアリングシートからも読む）

/** 数の単位（事務所の既定値の画面の欄の読み方）: 円・月数・率（％で見せる）・年数（整数）・歳・日数・時間・回数・係数 */
export type PresetUnit = "yen" | "months" | "pct" | "yearCount" | "age" | "days" | "hours" | "count" | "coef";

/** 種類: guide＝出典の無いよくある額・割合のひな形（目安）、market＝市場で動く値の目安（相場）、statistic＝統計を丸めた値（原本での確かめ前） */
export type PresetKind = "guide" | "market" | "statistic";

/**
 * 効く所: fill＝空欄・「わからない」を補う推定（推定のままの値は入れ直しで新しい値になる）、template＝ボタンで足すときの初めの値
 * （新しく足す行だけ）、engine＝計算のときにエンジンが引く目安（世帯に値が無いとき。どの世帯の計算にもすぐ効く）
 */
export type PresetUse = "fill" | "template" | "engine";

export interface PresetDef {
  /** 値ID（「preset.」で始まる） */
  readonly id: string;
  /** 値（額・月数・日数などは数、率・割合は10進の文字） */
  readonly value: number | string;
  readonly unit: PresetUnit;
  /** まとまり（事務所の既定値の画面の見出し） */
  readonly group: string;
  /** 画面の名前 */
  readonly name: string;
  /** 出典・時点（出典の無い物は「出典なし」） */
  readonly source: string;
  readonly kind: PresetKind;
  readonly use: PresetUse;
  /** 版（値を変えたら1つ上げる。事務所の値を使っている事務所に「公式の値が新しくなりました」と出す） */
  readonly rev: number;
}

/** エンジンが引く目安（use は engine）。値を変えるときは rev を上げ、docs/estimates-review.md の値も直す */
export const ENGINE_PRESETS: readonly PresetDef[] = [
  // 万一（死亡）のときの遺族の生活費の割合（expense.living・protection.need。万一の想定の survivor.livingRatio が空欄のとき）
  { id: "preset.survivor.livingRatio.beforeIndependence", value: "0.7", unit: "pct", group: "万一・保険", name: "遺族の生活費の割合（末子の独立まで）", source: "出典なし（よく使われる目安。出典の確かめ前）", kind: "guide", use: "engine", rev: 1 },
  { id: "preset.survivor.livingRatio.afterIndependence", value: "0.5", unit: "pct", group: "万一・保険", name: "遺族の生活費の割合（末子の独立の後）", source: "出典なし（よく使われる目安。出典の確かめ前）", kind: "guide", use: "engine", rev: 1 },
  { id: "preset.survivor.livingRatio.noChildren", value: "0.7", unit: "pct", group: "万一・保険", name: "遺族の生活費の割合（子のいない世帯）", source: "出典なし（よく使われる目安。出典の確かめ前）", kind: "guide", use: "engine", rev: 1 },
  // 医療保険の入院の1回の限度日数（insurance.policy。保険の限度日数が空欄のとき。画面の保険の種類のひな形も同じ値）
  { id: "preset.insurance.hospitalMaxDays", value: 60, unit: "days", group: "万一・保険", name: "医療保険の入院の1回の限度日数", source: "ひな形（よくある医療保険の型）", kind: "guide", use: "engine", rev: 1 },
  // 持ち家・不動産の評価（housing.valuation・asset.realEstate。0025 の2。土地と建物の割合などが空欄のとき。画面の欄の既定も同じ値）
  { id: "preset.realEstate.landShare", value: "0.3", unit: "pct", group: "住まい・ローン", name: "持ち家・不動産の評価: 土地の割合", source: "住宅金融支援機構「フラット35利用者調査」2025年度の土地付注文住宅（全国）の、建設費と土地取得費の合計に占める土地取得費の割合（29.7%。首都圏は40.4%）", kind: "guide", use: "engine", rev: 1 },
  { id: "preset.realEstate.residualFloor", value: "0.2", unit: "pct", group: "住まい・ローン", name: "持ち家・不動産の評価: 建物の残りの価値の下限", source: "よくある目安（固定資産評価の下限）", kind: "guide", use: "engine", rev: 1 },
  { id: "preset.realEstate.saleCostRate", value: "0.04", unit: "pct", group: "住まい・ローン", name: "持ち家・不動産を売るときの費用の割合", source: "よくある目安（仲介手数料・印紙税など）", kind: "guide", use: "engine", rev: 1 },
  // 保育料の自治体の水準（education.nurseryFee。0029。国の基準に対する割合。進路の保育園の段の割合が空欄のとき）
  { id: "preset.education.nurseryFeeRatio", value: "0.8", unit: "pct", group: "教育", name: "保育料の自治体の水準（国の基準に対する割合）", source: "よくある目安（自治体の独自の軽減）", kind: "guide", use: "engine", rev: 1 },
  // ストレステストの既定（engine/overlay.ts。型の値が空欄のとき。画面のストレステスト・万一の場面の初めの値も同じ値）
  { id: "preset.stress.marketDrop", value: "0.3", unit: "pct", group: "前提条件・資産運用", name: "ストレステスト: 退職した年の資産の時価の下がり幅", source: "出典なし", kind: "guide", use: "engine", rev: 1 },
  { id: "preset.stress.lowReturn.years", value: 10, unit: "yearCount", group: "前提条件・資産運用", name: "ストレステスト: 退職から利回りが低いままの年数", source: "出典なし", kind: "guide", use: "engine", rev: 1 },
  { id: "preset.stress.lowReturn.cap", value: "0.005", unit: "pct", group: "前提条件・資産運用", name: "ストレステスト: 低いままの利回り", source: "出典なし", kind: "guide", use: "engine", rev: 1 },
  { id: "preset.stress.returnShortfall.add", value: "-0.01", unit: "pct", group: "前提条件・資産運用", name: "ストレステスト: 想定より低い利回りの差", source: "出典なし", kind: "guide", use: "engine", rev: 1 },
  { id: "preset.stress.inflationSpike.rate", value: "0.04", unit: "pct", group: "前提条件・資産運用", name: "ストレステスト: インフレの上振れの物価上昇率", source: "出典なし", kind: "guide", use: "engine", rev: 1 },
  { id: "preset.stress.inflationSpike.years", value: 5, unit: "yearCount", group: "前提条件・資産運用", name: "ストレステスト: インフレの上振れの年数", source: "出典なし", kind: "guide", use: "engine", rev: 1 },
  { id: "preset.stress.rateRise.add", value: "0.01", unit: "pct", group: "前提条件・資産運用", name: "ストレステスト: 変動金利の上がり幅", source: "出典なし", kind: "guide", use: "engine", rev: 1 },
  { id: "preset.stress.incomeDrop.ratio", value: "0.2", unit: "pct", group: "前提条件・資産運用", name: "収入が減る場面: 収入の減る割合", source: "出典なし", kind: "guide", use: "engine", rev: 1 },
  { id: "preset.stress.incomeDrop.years", value: 3, unit: "yearCount", group: "前提条件・資産運用", name: "収入が減る場面: 減る年数", source: "出典なし", kind: "guide", use: "engine", rev: 1 },
];

const BY_ID: ReadonlyMap<string, PresetDef> = new Map(ENGINE_PRESETS.map((d) => [d.id, d]));

/** エンジンが引く目安の定義（無ければ undefined） */
export const enginePreset = (id: string): PresetDef | undefined => BY_ID.get(id);

/** エンジンが引く目安の公式の値（事務所の値を当てない値。知らない値ID は投げる） */
export function enginePresetValue(id: string): number | string {
  const d = BY_ID.get(id);
  if (d === undefined) throw new Error(`unknown preset: ${id}`);
  return d.value;
}

/**
 * 計算のときにエンジンが引く統計の目安のうち、事務所の既定値で「推定で埋めない」にできる物（0111 の2回目）。
 * 埋めないにした物は、世帯に値が無ければ目安を引かず、0円（介護・学校の費用）か、平均余命を使わない期間で計算し、「入力が足りない」の知らせを出す
 */
export const ENGINE_NO_FILL = ["care", "education", "lifeExpectancy"] as const;
export type EngineNoFill = (typeof ENGINE_NO_FILL)[number];
