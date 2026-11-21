// 物1件の欄を中枠（band。左の線＋小見出し）に分ける道具（0237）。住宅ローンの中枠（housing.ts の mortgageBands）と同じ形を、
// 欄の多いほかの物（車・保険・働き方の期間）にもそろえる。欄とボタンのキー・中身（読み方・書き方）は変えず、まとまりだけを分ける。
import type { ActionDef, FieldDef, GroupDef } from "../form.ts";

/** 中枠1つの決まり */
export interface BandSpec {
  id: string;
  title: string;
  /** この中枠に入れる欄: キーの末尾（物のキーの後の最初の区切り） */
  keys: readonly string[];
  /** この中枠に入れるボタン: キーの末尾（物のキーの後ろ全部） */
  actions?: readonly string[];
  note?: string;
}

/** 欄のキーの末尾（物のキー k の後の最初の区切り） */
export const keyTail = (k: string, key: string): string => key.slice(k.length + 1).split("/")[0] ?? "";

/** 中枠のまとまりのキー */
export const bandKey = (k: string, id: string): string => `${k}/band/${id}`;

/**
 * 物1件（頭のまとまりのキー k）の欄とボタンを、中枠に分ける。どの中枠の決まりにも無い欄・ボタンは rest の中枠（省略は最初の中枠）に入れる。
 * 欄は中枠の決まり（keys）の順に並べる。inner は中枠の中に描くまとまり（足して増える小さな物。partOf で中枠に入れる）。欄もボタンも中のまとまりも無い中枠は作らない。
 * 中枠の欄・ボタンが詳細だけなら、中枠も詳細（標準では物の「▸」で開く）。
 * where は物の見出し（入力項目の画面の外で、どこの欄かを言う名前。中枠の見出しだけでは、どの物の欄か分からないため）
 */
export function splitBands(k: string, specs: readonly BandSpec[], fields: readonly FieldDef[], actions: readonly ActionDef[], o: { rest?: string; inner?: Readonly<Record<string, readonly GroupDef[]>>; tail?: (key: string) => string; where?: string } = {}): GroupDef[] {
  const rest = o.rest ?? specs[0]?.id ?? "";
  // 欄のキーの末尾の読み方（キーの形が物のキーと別の欄を混ぜるときは tail で渡す）
  const tailOf = o.tail ?? ((key: string) => keyTail(k, key));
  const bandOfField = (f: FieldDef): string => specs.find((b) => b.keys.includes(tailOf(f.key)))?.id ?? rest;
  const bandOfAction = (a: ActionDef): string => specs.find((b) => (b.actions ?? []).includes(a.key.slice(k.length + 1)))?.id ?? rest;
  const out: GroupDef[] = [];
  for (const b of specs) {
    const bk = bandKey(k, b.id);
    // 欄は、中枠の決まり（keys）に書いた順に並べる（同じ末尾の欄どうしは元の順）
    const fs = fields.filter((f) => bandOfField(f) === b.id);
    const order = (f: FieldDef): number => {
      const i = b.keys.indexOf(tailOf(f.key));
      return i < 0 ? b.keys.length : i;
    };
    const sorted = fs.map((f, i) => ({ f, i })).sort((x, y) => order(x.f) - order(y.f) || x.i - y.i).map((x) => x.f);
    const as = actions.filter((a) => bandOfAction(a) === b.id);
    const inner = (o.inner?.[b.id] ?? []).map((g) => (g.key.startsWith(`${bk}/`) || g.partOf !== undefined ? g : { ...g, partOf: bk }));
    if (sorted.length === 0 && as.length === 0 && inner.length === 0) continue;
    const simple = sorted.some((f) => f.level === "simple") || as.some((a) => a.level === "simple") || inner.some((g) => g.level === "simple");
    out.push({ key: bk, title: b.title, ...(o.where !== undefined ? { where: o.where } : {}), ...(b.note !== undefined ? { note: b.note } : {}), band: true, level: simple ? "simple" : "detail", fields: sorted, actions: as }, ...inner);
  }
  return out;
}

/**
 * 入力項目の定義の形の選択肢（0237）。bands は、入力項目の画面が詳細で開くときの形（保険の契約1件の欄を中枠に分ける）。
 * 既定は今までの形（標準の画面と、確かめの一覧・プランの違いの一覧・入力の検索・書類の読み取りはこちら。まとまりのキーと名前が変わらない）
 */
export interface StageOptions {
  bands?: boolean;
}
