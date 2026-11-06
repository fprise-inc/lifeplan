// キャッシュフロー表の行の公式の名前と、事務所の名前（カスタム層の settings/terms.json。0016 の 2026-11-02 の追記）の当て方。
// 表の行の名前は、FP の画面の結果の表・お客さまに見せる画面・提案書・持ち帰り用のレポートのどこでも同じ名前にするので、
// アプリの画面（app/src/workspace/present.ts）と提案書（build.ts）が同じこの表と当て方を使う。
// - 名前の一覧の id は `row:<行の鍵>`（行の鍵は表の行の key。人ごとの行は salary・business・pension で、{person} に呼び方が入る）
// - 当てるのは、FP が承認した名前（本体が承認した中身から作った物）だけ。承認したときの公式の名前が今の公式の名前と同じときだけ当てる
// - 名前はただの文字。差し込む値も文字として入れ、印として読み直さない

/** 表の行の公式の名前（{person} は呼び方。字の { } は {{ }}） */
export const ROW_NAMES: Readonly<Record<string, string>> = {
  salary: "{person}の給与",
  business: "{person}の事業所得",
  pension: "{person}の年金",
  corporatePension: "企業年金・個人年金",
  retirement: "退職金",
  benefit: "給付・手当",
  rent: "家賃収入",
  realEstateSale: "不動産の売却",
  incomeOther: "その他の収入",
  incomeTotal: "収入合計",
  living: "基本生活費",
  surplusSpend: "ゆとりの支出",
  housing: "住居費（ローン・税・修繕）",
  education: "教育費",
  insurance: "保険料",
  lumpSum: "一時的支出（旅行など）",
  car: "車の費用",
  realEstateExpense: "不動産の経費",
  realEstateLoan: "不動産のローンの返済",
  advisoryFee: "FP顧問料",
  expenseOther: "その他の支出",
  taxSi: "税・社会保険料",
  expenseTotal: "支出合計",
  net: "年間収支",
  nisaIn: "NISAへの積立",
  financial: "金融資産残高",
  debt: "住宅ローン残高",
  realEstateDebt: "不動産のローン残高",
};

/** 人ごとの行（名前に {person} が入る） */
export const ROW_NAME_VARS: Readonly<Record<string, readonly string[]>> = { salary: ["person"], business: ["person"], pension: ["person"] };

/** 事務所の名前（名前の一覧の id → 名前と、承認したときの公式の名前）。表の行の名前（row:…）だけを持つ。お客さまに見せる所へ渡してよい（事務所の名前である印は持たない） */
export type OfficeRowNames = Readonly<Record<string, { name: string; official: string }>>;

export const rowNameId = (key: string): string => `row:${key}`;

/** 名前の中の差し込みの印 {name} に値を入れ、{{・}} を字にする（知らない印は字のまま。本体の検査で知らない印は承認できない） */
export function fillName(template: string, vars: Readonly<Record<string, string>> = {}): string {
  let out = "";
  for (let i = 0; i < template.length; i++) {
    const c = template[i] as string;
    const next = template[i + 1];
    if ((c === "{" && next === "{") || (c === "}" && next === "}")) {
      out += c;
      i++;
      continue;
    }
    if (c === "{") {
      const end = template.indexOf("}", i);
      const name = end < 0 ? null : template.slice(i + 1, end);
      if (name !== null && /^[A-Za-z][A-Za-z0-9_]*$/.test(name) && vars[name] !== undefined) {
        out += vars[name];
        i = end;
        continue;
      }
    }
    out += c;
  }
  return out;
}

/** 表の行の名前（事務所の名前があれば当てる）。key は行の鍵（人ごとの行は salary・business・pension） */
export function rowName(names: OfficeRowNames | undefined, key: string, vars: Readonly<Record<string, string>> = {}): string {
  const official = ROW_NAMES[key];
  if (official === undefined) return key;
  const e = names?.[rowNameId(key)];
  return fillName(e !== undefined && e.official === official ? e.name : official, vars);
}

/**
 * 表の行と同じ公式の名前の、ほかの所の名前（提案書の「家計の今」の内訳・万一の想定の内訳など）。
 * 公式の名前が表の行の名前（人ごとの行を除く）と同じなら、その行の事務所の名前にする。違う名前の所は公式の名前のまま
 */
export function sameRowName(names: OfficeRowNames | undefined, label: string): string {
  if (names === undefined) return label;
  for (const [key, official] of Object.entries(ROW_NAMES)) {
    if (official === label && ROW_NAME_VARS[key] === undefined) return rowName(names, key);
  }
  return label;
}
