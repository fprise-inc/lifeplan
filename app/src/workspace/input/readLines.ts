// 読むだけの1行（作業の層）: 1つの物は1つのカードにだけ出し、ほかのカードには「何があるか」と「どのカードで入れるか」を1行で見せる。
// 欄の形は見せるだけの欄（readOnly）。当て先も入力項目IDも持たないので、確かめの一覧・プランの違いの一覧・動かす項目には出ない
import { field, type FieldDef, type GroupDef } from "./form.ts";

/** 読むだけの1行の「?」の文（ここでは変えられないことと、どこで入れるか。where は入力項目の名前、tab なら結果のタブの名前） */
export function readLineHelp(where: string, place: "item" | "tab" = "item"): string {
  return `この欄はここでは変えられません。「${where}」の${place === "tab" ? "タブ" : "項目"}で入れます`;
}

/** 読むだけの1行の欄（短い値の文字と、どの入力項目〔か結果のタブ〕で入れるか） */
export function readLine(key: string, label: string, value: string, where: string, place: "item" | "tab" = "item"): FieldDef {
  return field({ key: `ro/${key}`, item: null, label, level: "simple", kind: "text", readOnly: readLineHelp(where, place), get: () => ({ value }), set: (w) => w });
}

/**
 * 説明の欄（値ではなく、扱いの説明の文）: 欄の幅いっぱいに出し、見出しの左に ⓘ を付けて折りたためる（InfoNote.tsx）。
 * 欄を持たないので、確かめの一覧・プランの違いの一覧・動かす項目には出ない。本文がすでに説明なので「?」は付けない。
 * fold は折りたたみを覚えるときのキー（同じ種類の説明は、人が違っても同じキーにする）
 */
export function infoNote(key: string, title: string, text: string, fold: string = key): GroupDef {
  return { key: `info/${key}`, level: "simple", fields: [], actions: [], info: { title, text, fold } };
}

/** 読むだけの1行を並べたまとまり（行が無ければ null） */
export function readGroup(key: string, title: string | undefined, lines: readonly FieldDef[], note?: string): GroupDef | null {
  if (lines.length === 0) return null;
  return { key: `ro/${key}`, ...(title !== undefined ? { title } : {}), ...(note !== undefined ? { note } : {}), level: "simple", fields: [...lines], actions: [] };
}

/** 円を「1,234万円」の文字に（読むだけの1行の値） */
export function manYen(yen: number): string {
  const man = yen / 10000;
  return `${Number.isInteger(man) ? man.toLocaleString("ja-JP") : (Math.round(man * 10) / 10).toLocaleString("ja-JP")}万円`;
}
