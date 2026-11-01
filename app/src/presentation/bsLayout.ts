// バランスシートの図の置き方と、家計の体力の目安の計算（提示層。受け取った値から形を決めるだけで、計算エンジンの計算はしない）
import type { BsGroupKey, BsGuide, BsLineModel, BsYearModel, Yen } from "./model.ts";

/** 左（資産）の分け方。上から */
export const LEFT_GROUPS: readonly BsGroupKey[] = ["liquid", "market", "locked", "illiquid"];
/** 右（負債と純資産）の分け方。上から（純資産は一番下に別に置く） */
export const RIGHT_GROUPS: readonly BsGroupKey[] = ["mortgage", "debt"];
export const FINANCIAL_GROUPS: readonly BsGroupKey[] = ["liquid", "market", "locked"];

/** 図の1つの箱（分け方のまとまり）。parts は箱の中の項目（上から） */
export interface FigBox {
  side: "L" | "R";
  key: BsGroupKey | "netWorth" | "neg";
  value: Yen;
  parts: { key: string; label: string; value: Yen }[];
}

/** 図に描く箱（左: 資産の4つ＋純資産のマイナス、右: 住宅ローン・その他の負債・純資産） */
export function figureBoxes(y: Pick<BsYearModel, "lines" | "netWorth" | "netParts">): { left: FigBox[]; right: FigBox[] } {
  const mk = (side: "L" | "R", g: BsGroupKey): FigBox => {
    const parts = y.lines.filter((l: BsLineModel) => l.group === g).map((l) => ({ key: l.key, label: l.label, value: Math.max(0, l.amount) }));
    return { side, key: g, value: parts.reduce((s, p) => s + p.value, 0), parts };
  };
  const left = LEFT_GROUPS.map((g) => mk("L", g));
  if (y.netWorth < 0) left.push({ side: "L", key: "neg", value: -y.netWorth, parts: [{ key: "neg", label: "純資産のマイナス", value: -y.netWorth }] });
  const right = RIGHT_GROUPS.map((g) => mk("R", g));
  // 純資産の内訳（会社と合わせたバランスシートの「会社の財産」「個人の財産」など。0108）があれば、純資産の箱の中に分けて積む
  const np = (y.netParts ?? []).filter((p) => p.amount > 0);
  const nwParts = y.netWorth > 0 && np.length > 0 ? np.map((p) => ({ key: p.key, label: p.label, value: p.amount })) : [{ key: "netWorth", label: "純資産", value: Math.max(0, y.netWorth) }];
  right.push({ side: "R", key: "netWorth", value: Math.max(0, y.netWorth), parts: nwParts });
  return { left, right };
}

/** 左右の高さの基になる額（資産の合計と、負債の合計＋純資産。純資産がマイナスなら負債の合計） */
export function columnTotal(y: Pick<BsYearModel, "totalAssets" | "totalLiabilities" | "netWorth">): Yen {
  return Math.max(y.totalAssets, y.totalLiabilities, 0);
}

/**
 * 縮尺（図のいっぱいの高さに当たる額）: 1年ずつ見るときはその年の大きさ、並べるときは並べたものの中のいちばん大きい額（共通の縮尺）
 */
export function scaleFor(years: readonly Pick<BsYearModel, "totalAssets" | "totalLiabilities" | "netWorth">[]): Yen {
  return Math.max(1, ...years.map(columnTotal));
}

/** 小さい箱も読める高さにするときの、額の目安（これより小さい箱は最低限の高さをなめらかに小さくする。30万円） */
export const MIN_FULL_YEN = 300_000;

/**
 * 箱の高さ（px）: 額に比例。ただし額のある箱は読める最低限の高さ minH を持たせ（30万円より小さい箱は額に応じて小さく）、
 * 残りの高さをほかの箱で額に比例して分ける。合計はいつも colH（左右の高さがそろう）。
 * adjusted は比例からずれた箱があるか（図の下に目立たない注記を出す）
 */
export function allocHeights(values: readonly number[], colH: number, minH: number): { heights: number[]; adjusted: boolean } {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  const heights = values.map(() => 0);
  if (total <= 0 || colH <= 0) return { heights, adjusted: false };
  const k = colH / total;
  const min = (v: number) => minH * Math.min(1, v / MIN_FULL_YEN);
  const fixed = values.map(() => false);
  for (let it = 0; it < values.length + 1; it++) {
    let fixedH = 0;
    let restV = 0;
    values.forEach((v, i) => {
      if (v <= 0) return;
      if (fixed[i] === true || v * k < min(v)) {
        fixed[i] = true;
        heights[i] = Math.max(v * k, min(v));
        fixedH += heights[i] as number;
      } else restV += v;
    });
    const rest = colH - fixedH;
    if (rest <= 0 || restV <= 0) {
      // 全部が最低限の高さ（狭い図）: 比で分け直す
      if (rest < 0) {
        const s = colH / fixedH;
        values.forEach((v, i) => {
          if (v > 0) heights[i] = (heights[i] as number) * s;
        });
      }
      break;
    }
    let again = false;
    values.forEach((v, i) => {
      if (v <= 0 || fixed[i] === true) return;
      heights[i] = (v / restV) * rest;
      if ((heights[i] as number) < min(v)) again = true;
    });
    if (!again) break;
  }
  const adjusted = values.some((v, i) => v > 0 && fixed[i] === true && (heights[i] as number) > v * k + 0.5);
  return { heights, adjusted };
}

/** 縦の目盛りの間隔（円）。tickMax 本以下になる刻み */
export function tickStep(scale: Yen, tickMax: number): Yen {
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].map((m) => m * 1_000_000);
  return steps.find((s) => scale / s <= tickMax) ?? 10_000_000_000;
}

/**
 * 引き出し線の札の縦の位置: 箱の中央に近い位置に置き、重なる札は lh ずつずらす（上下の範囲の中に収める）
 */
export function spreadLabels(centers: readonly number[], minY: number, maxY: number, lh: number): number[] {
  const order = centers.map((c, i) => ({ c, i })).sort((a, b) => a.c - b.c);
  const ys: number[] = [];
  order.forEach((o, n) => {
    ys[n] = Math.max(o.c, minY, n > 0 ? (ys[n - 1] as number) + lh : -Infinity);
  });
  for (let n = order.length - 1; n >= 0; n--) {
    const lim = n === order.length - 1 ? maxY : (ys[n + 1] as number) - lh;
    if ((ys[n] as number) > lim) ys[n] = lim;
  }
  const out = centers.map(() => 0);
  order.forEach((o, n) => {
    out[o.i] = ys[n] as number;
  });
  return out;
}

// ---- 家計の体力の目安 ----

export type HealthTone = "low" | "in" | "high" | "none";

export interface HealthItem {
  /** 値（月数・%）。出せないときは null */
  value: number | null;
  tone: HealthTone;
  /** 落ち着いた言葉の一文（太字の部分つき） */
  text: { text: string; strong?: boolean }[];
}

export interface Health {
  months: HealthItem;
  risk: HealthItem;
  debt: HealthItem;
}

const groupSum = (y: Pick<BsYearModel, "lines">, g: BsGroupKey) => y.lines.reduce((s, l) => (l.group === g ? s + l.amount : s), 0);

/**
 * 家計の体力の目安: すぐ使えるお金が生活費の何か月分か／資産のうち値動きのある資産の割合／負債の重さ（負債 ÷ 資産）。
 * 目安の幅は事務所の設定（guide）。赤で煽らず「少なめ」「多め」「目安の幅の中」で言う
 */
export function healthOf(y: Pick<BsYearModel, "lines" | "living" | "totalAssets" | "totalLiabilities" | "fact"> & Partial<Pick<BsYearModel, "loanPay">>, guide: BsGuide): Health {
  const liquid = groupSum(y, "liquid");
  const market = groupSum(y, "market");
  const mortgage = groupSum(y, "mortgage");
  // 分母: 生活費、または生活費＋ローン返済（0105。生活費が入っていなければ出さない）
  const outgo = y.living + (guide.basis === "livingLoan" ? (y.loanPay ?? 0) : 0);
  const months = y.living > 0 ? liquid / (outgo / 12) : null;
  const risk = y.totalAssets > 0 ? (market / y.totalAssets) * 100 : null;
  const debt = y.totalAssets > 0 ? (y.totalLiabilities / y.totalAssets) * 100 : null;
  const [m0, m1] = guide.months;
  const [r0, r1] = guide.risk;
  const mRange = `目安（${m0}〜${m1}か月分）`;
  const rRange = `目安の幅（${r0}〜${r1}%）`;
  const monthsItem: HealthItem =
    months === null
      ? { value: null, tone: "none", text: [{ text: "生活費が入っていないため、出せません。" }] }
      : months < m0
        ? { value: months, tone: "low", text: [{ text: `${mRange}より` }, { text: "少なめ", strong: true }, { text: `です。${monthSteps(months, m0, m1)}` }] }
        : months <= m1
          ? { value: months, tone: "in", text: [{ text: `${mRange}の中です。` }] }
          : { value: months, tone: "high", text: [{ text: `${mRange}より` }, { text: "多め", strong: true }, { text: `です。${y.fact ? "一部を運用に回す余地があります。" : ""}` }] };
  const riskItem: HealthItem =
    risk === null
      ? { value: null, tone: "none", text: [{ text: "資産がありません。" }] }
      : risk < r0
        ? { value: risk, tone: "low", text: [{ text: `${rRange}より` }, { text: "低め", strong: true }, { text: "。値動きの心配は小さい一方、増えにくい形です。" }] }
        : risk <= r1
          ? { value: risk, tone: "in", text: [{ text: `${rRange}の中です。` }] }
          : { value: risk, tone: "high", text: [{ text: `${rRange}より` }, { text: "高め", strong: true }, { text: "。相場が下がったときの影響が大きくなります。" }] };
  const debtItem: HealthItem =
    y.totalLiabilities <= 0
      ? { value: 0, tone: "in", text: [{ text: "負債はありません。" }] }
      : debt === null
        ? { value: null, tone: "high", text: [{ text: "資産が無く、負債だけがあります。" }] }
        : debt < guide.debt
          ? { value: debt, tone: "in", text: [{ text: `目安（${guide.debt}%未満）の中です。` }] }
          : { value: debt, tone: "high", text: [{ text: `目安（${guide.debt}%未満）より` }, { text: "重め", strong: true }, { text: `です。${mortgage > 0 ? "ローンの返済とともに軽くなっていきます。" : ""}` }] };
  return { months: monthsItem, risk: riskItem, debt: debtItem };
}

/**
 * 目安に届かないときの、段で目指す文（0105）: 3か月分 → 目安の下限 → 上限の順に、今より上の2つを示す。
 * 例: 1.5か月分・目安6〜12か月分なら「まず3か月分、次に6か月分を目指しましょう。」
 */
export function monthSteps(months: number, m0: number, m1: number): string {
  const steps = [3, m0, m1].filter((v, i, a) => v > months && a.indexOf(v) === i).sort((a, b) => a - b);
  const [first, second] = steps;
  if (first === undefined) return "";
  return second !== undefined ? `まず${first}か月分、次に${second}か月分を目指しましょう。` : `まず${first}か月分を目指しましょう。`;
}

/** 月数の見せ方（2年以上は年）。withLoan は分母が生活費＋ローン返済のとき */
export function monthsValue(m: number, withLoan = false): { value: string; unit: string } {
  const of = withLoan ? "生活費＋返済" : "生活費";
  return m >= 24 ? { value: (m / 12).toFixed(1), unit: `年分の${of}` } : { value: m.toFixed(1), unit: `か月分の${of}` };
}
