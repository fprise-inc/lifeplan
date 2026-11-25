// アプリに入っている見本の世帯の形（すべて架空。data/modelHouseholds の世帯に、打ち手の目盛り・最初の提案・プランを添えたもの）と、見本を探す入口。
// 見本の中身と並びは、見本のセットの定義（samples/sets.ts。0247 の3）に置く。見本は顧客番号も見本番号も持たない（0247 の1）
import type { LeverValues, Reemployment } from "./levers.ts";
import type { Values } from "./plans/plans.ts";
import type { SnapshotTrigger } from "./snapshots/snapshots.ts";
import { SAMPLE_SETS } from "./samples/sets.ts";

export interface LeverSteps {
  retireAge: number[];
  pensionAge: number[];
  nisaMonthly: number[];
  livingMonthly: number[];
}

/** 見本の世帯に入れておくプラン（開いたときに保存したプランとして帯に並べる） */
export interface DemoPlan {
  /** 「プランB …」の形（帯の文字は名前の頭から決まる） */
  name: string;
  tags?: string[];
  /** 動かす項目の鍵（plans/items.ts）→ 値 */
  values: Values;
}

/**
 * 見本の世帯に入れておく控え（「前回と比較」の見本）。その時点の世帯は、今の世帯の残高・評価額を balances で置き換えたもの。
 * 計算の基準の月は今の世帯と同じにする（制度データが持つ月より前の基準の月では計算できないため。中身は架空）
 */
export interface DemoSnapshot {
  /** 控えの ID（決まった値。UUID 第4版の形） */
  id: string;
  /** 作った日時（ISO 8601。端末の時差によらない固定の値） */
  createdAt: string;
  trigger: SnapshotTrigger;
  memo: string;
  /** 物の ID（口座・負債）→ その時点の残高（口座は時価、負債は残高） */
  balances: Record<string, number>;
}

export interface DemoHousehold {
  /** data/modelHouseholds/<id>.json */
  id: string;
  /** 家族の形（1 単身・2 夫婦のみ・3 夫婦と子・4 ひとり親・5 シニア。store/numbering.ts の FAMILY_SHAPES） */
  family: number;
  /** 本人の年代（2〜7。20代〜70代） */
  age: number;
  /** 見本の中身の版（整数。中身を直したら上げる。直した見本の出どころ origin.rev と比べる。0247 の5） */
  rev: number;
  /** 見本の名前（アプリのすべての見本と自分で作った見本の間で重ならない。共働き/片働き・会社員/自営業などは名前と絞り込みの項目で見分ける） */
  title: string;
  /** 絞り込みの項目（store/numbering.ts の SAMPLE_TRAITS） */
  traits: readonly string[];
  /** 主役の数字を出す年齢（世帯の「本人」の年齢） */
  targetAge: number;
  steps: LeverSteps;
  /** 最初の提案（開いたときの打ち手） */
  firstProposal: Partial<LeverValues>;
  reemployment?: Reemployment;
  /** 打ち手の補足（スライダーの下の一文） */
  notes?: Partial<Record<keyof LeverValues, string>>;
  /** FP用のメモ（作業の層だけで持つ。提示層には渡さない。0016 の2） */
  memo: string[];
  /** 開いたときに帯に並べておくプラン（あれば firstProposal の代わりに使う） */
  plans?: readonly DemoPlan[];
  /** 開いたときに入れておく控え */
  snapshots?: readonly DemoSnapshot[];
  /**
   * 開いたときに入れておく拡張の束の入力欄の値（入力欄の値の置き場所 → 値。0114 の4）。合算BS の会社の数字など（0197）。
   * 世帯ファイルの拡張領域と同じ形で、開くときに束の宣言で確かめて読む（宣言に合わない値は捨てる）
   */
  extValues?: Readonly<Record<string, Record<string, unknown>>>;
}

/** アプリに入っているすべての見本（セットの定義の順。0247 の3） */
export const DEMO_HOUSEHOLDS: readonly DemoHousehold[] = SAMPLE_SETS.flatMap((s) => s.samples);

/** アプリに入っている見本を ID（モデル世帯の名前）で探す */
export function demoHousehold(id: string): DemoHousehold | undefined {
  return DEMO_HOUSEHOLDS.find((d) => d.id === id);
}
