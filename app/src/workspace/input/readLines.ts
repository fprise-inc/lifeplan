// 読むだけの1行（作業の層）: 1つの物は1つのカードにだけ出し、ほかのカードには「何があるか」と「どのカードで入れるか」を1行で見せる。
// 欄の形は見せるだけの欄（readOnly）。当て先も入力項目IDも持たないので、確かめの一覧・プランの違いの一覧・動かす項目には出ない
import { field, type FieldDef, type GroupDef } from "./form.ts";

/** 読むだけの1行の欄（値の文字と、どのカードで入れるか） */
export function readLine(key: string, label: string, value: string, where: string): FieldDef {
  return field({ key: `ro/${key}`, item: null, label, level: "simple", kind: "text", readOnly: `${where}のカードで入れます`, get: () => ({ value }), set: (w) => w });
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
