// 今住んでいる持ち家の買った値段（0176）: 土地の値段 ↔ 土地の割合（土地÷合計）。
// 入力の画面の app/src/workspace/input/ownedHomeValue.ts の shareOfLand・landOfShare と同じ計算（取り込み・書き出しで、入力の画面と同じ割合の文字を書く。
// 同じになることは app/test/hearing-home-purchase.test.ts で確かめる）
// - 土地の値段から割合を作るときは、小数12桁で切り上げる（計算エンジンは合計×割合の円未満を切り捨てるので、入れた土地の値段がそのまま出る）

/** 割合の文字の最大の桁（計算エンジンの率の上限と同じ） */
const SCALE = 12;
const POW = 10n ** BigInt(SCALE);

/** 土地の値段から土地の割合（合計に対する）の文字を作る。合計×割合の円未満を切り捨てると、ちょうど土地の値段になる */
export function shareOfLand(land: number, total: number): string {
  if (!(total > 0) || !(land > 0)) return "0";
  if (land >= total) return "1";
  const t = BigInt(Math.round(total));
  const units = (BigInt(Math.round(land)) * POW + t - 1n) / t;
  const s = units.toString().padStart(SCALE, "0");
  const frac = s.slice(-SCALE).replace(/0+$/u, "");
  const int = s.length > SCALE ? s.slice(0, -SCALE) : "0";
  return frac === "" ? int : `${int}.${frac}`;
}

/** 合計×割合の土地の値段（計算エンジンと同じく円未満を切り捨て） */
export function landOfShare(total: number, share: string): number {
  if (!/^\d+(\.\d+)?$/u.test(share)) return Math.floor(total * Number(share));
  const [i = "0", f = ""] = share.split(".");
  const frac = f.slice(0, SCALE).padEnd(SCALE, "0");
  const units = BigInt(i) * POW + BigInt(frac);
  return Number((BigInt(Math.round(total)) * units) / POW);
}
