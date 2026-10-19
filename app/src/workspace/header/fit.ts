// 上の帯の詰め方（文字を大きくしたとき・窓が狭いときに、右端が見切れないようにする）。
// 帯の見た目は data-fit の値（0〜3）で CSS が切り替える。広い順に試して、はみ出さない最初の段を使う:
//   0: すべて文字つき
//   1: 右側の操作をアイコンだけに（文字は読み上げの名前に残す）・世帯の要約を短く
//   2: さらに、世帯のボタンを省略して詰める・ロゴの文字を隠す
//   3: それでも入らない幅では、タブを2行目に折り返す（見切れさせない）

export const FIT_MAX = 3;

/** はみ出さない最初の段を選ぶ（overflows: その段にしたときにはみ出すか。最後の段は折り返すので試さない） */
export function chooseFit(overflows: (fit: number) => boolean, max: number = FIT_MAX): number {
  for (let f = 0; f < max; f++) if (!overflows(f)) return f;
  return max;
}

/** 帯の中身が、帯の内側（左右の余白を除く）に収まっていないか */
export function overflowsBar(el: HTMLElement): boolean {
  if (el.scrollWidth > el.clientWidth + 1) return true;
  const box = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const left = box.left + parseFloat(cs.paddingLeft) - 0.5;
  const right = box.right - parseFloat(cs.paddingRight) + 0.5;
  const parts = [...el.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.getClientRects().length > 0);
  for (const c of parts) {
    const r = c.getBoundingClientRect();
    if (r.left < left || r.right > right) return true;
    // 部品の中身が部品の枠からはみ出している（縮めすぎ）
    if (c.scrollWidth > c.clientWidth + 1) return true;
  }
  // 同じ行の部品どうしが重なっていないか
  for (let i = 1; i < parts.length; i++) {
    const a = parts[i - 1]!.getBoundingClientRect();
    const b = parts[i]!.getBoundingClientRect();
    if (a.top < b.bottom && b.top < a.bottom && a.right > b.left + 0.5) return true;
  }
  return false;
}

/** 帯を詰める段を決めて data-fit に書く（同じ描画の中で試すので、途中の段は画面に出ない） */
export function fitBar(el: HTMLElement): number {
  const fit = chooseFit((f) => {
    el.dataset.fit = String(f);
    return overflowsBar(el);
  });
  el.dataset.fit = String(fit);
  return fit;
}
