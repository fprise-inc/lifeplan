// ローンの入れ方の区分（借入額から・毎月の返済額から・今の残高から。0052）の逆算。画面の補助で、計算エンジンの返済の計算
// （debt.schedule）とは別に、最初の金利の段だけで解く（金利の段階・繰上返済・借り換えは見ない）。
// - 毎月の返済額は、ボーナス返済に充てる分（借入額×ボーナス返済の割合）を除いた分の月の返済額。元金均等は最初の月の返済額
// - 金利は年利。月の利率は年利÷12
// 額は円（返済額は四捨五入して見せる）。率は10進の文字列（逆算した金利は小数7桁まで）で返す

export type RepayMethod = "equalPayment" | "equalPrincipal" | string;

/** 毎月の返済額（月の分。四捨五入した円） */
export function monthlyPayment(principal: number, annualRate: number, months: number, method: RepayMethod, bonusShare = 0): number {
  if (months <= 0) return 0;
  const p = principal * (1 - bonusShare);
  const r = annualRate / 12;
  if (method === "equalPrincipal") return Math.round(p / months + p * r);
  if (r === 0) return Math.round(p / months);
  return Math.round((p * r) / (1 - Math.pow(1 + r, -months)));
}

/** 毎月の返済額から借入額（円。四捨五入）。解けなければ null */
export function principalFromPayment(payment: number, annualRate: number, months: number, method: RepayMethod, bonusShare = 0): number | null {
  if (months <= 0 || payment <= 0 || bonusShare >= 1) return null;
  const r = annualRate / 12;
  const monthlyPart = method === "equalPrincipal" ? payment / (1 / months + r) : r === 0 ? payment * months : (payment * (1 - Math.pow(1 + r, -months))) / r;
  return Math.round(monthlyPart / (1 - bonusShare));
}

/** 率を10進の文字列に（小数 digits 桁まで。末尾の0は落とす） */
export function rateText(annual: number, digits = 6): string {
  const f = Math.pow(10, digits);
  const s = (Math.round(annual * f) / f).toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
}

/** 金利の上限（年。これより高い金利は返済額の打ち間違いとみなす） */
export const MAX_SOLVED_RATE = 0.2;

/**
 * 今の残高・毎月の返済額・残りの月数から年利を解く。返済額×月数が残高に届かなければ（金利が0より下になる）null、
 * 上限の金利でも返しきれる額より多ければ上限の金利まで（打ち間違いの知らせは呼ぶ側）
 */
export function rateFromPayment(balance: number, payment: number, months: number, method: RepayMethod, bonusShare = 0): number | null {
  if (months <= 0 || payment <= 0 || balance <= 0) return null;
  const p = balance * (1 - bonusShare);
  if (method === "equalPrincipal") {
    const r = (payment - p / months) / p;
    return r < 0 ? null : Math.min(MAX_SOLVED_RATE, r * 12);
  }
  if (payment * months < p - 0.5) return null;
  const pay = (a: number) => (a === 0 ? p / months : ((p * a) / 12) / (1 - Math.pow(1 + a / 12, -months)));
  let lo = 0;
  let hi = MAX_SOLVED_RATE;
  if (pay(hi) <= payment) return hi;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (pay(mid) < payment) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** 今の残高・毎月の返済額・年利から、返しきるまでの月数（切り上げ）。利息に届かない返済額なら null */
export function monthsFromPayment(balance: number, payment: number, annualRate: number, method: RepayMethod, bonusShare = 0): number | null {
  if (payment <= 0 || balance <= 0) return null;
  const p = balance * (1 - bonusShare);
  const r = annualRate / 12;
  if (method === "equalPrincipal") {
    const principalPart = payment - p * r;
    return principalPart <= 0 ? null : Math.max(1, Math.ceil(p / principalPart - 1e-9));
  }
  if (r === 0) return Math.max(1, Math.ceil(p / payment - 1e-9));
  if (payment <= p * r) return null;
  return Math.max(1, Math.ceil(-Math.log(1 - (p * r) / payment) / Math.log(1 + r) - 1e-9));
}

/** 年月の差（月数。b − a） */
export function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number) as [number, number];
  const [by, bm] = b.split("-").map(Number) as [number, number];
  return (by - ay) * 12 + (bm - am);
}

/**
 * 今の残高・毎月の返済額・残りの月数から解いた年利を、10進の文字列（小数7桁）にする。丸めた率で計算し直した返済額が入れた額と
 * 同じになる近くの値を選ぶ（欄に入れた返済額がそのまま見えるように）。解けなければ null
 */
export function fittedRateText(balance: number, payment: number, months: number, method: RepayMethod, bonusShare = 0): string | null {
  const r = rateFromPayment(balance, payment, months, method, bonusShare);
  if (r === null) return null;
  const center = Math.round(r * 1e7);
  let best = center;
  let gap = Infinity;
  for (let k = -5; k <= 5; k++) {
    const c = center + k;
    if (c < 0) continue;
    const g = Math.abs(monthlyPayment(balance, c / 1e7, months, method, bonusShare) - payment);
    if (g < gap || (g === gap && Math.abs(k) < Math.abs(best - center))) {
      gap = g;
      best = c;
    }
  }
  return rateText(best / 1e7, 7);
}
