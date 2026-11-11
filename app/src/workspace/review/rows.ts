// 確かめの画面の共通の部品の行（0148 の2）: 外から読んだ値（書類の読み取り・他のソフトからの移行）を、FP が1つずつか、まとめて
// 承認・直す・入れないを決める画面の1行の形と、まとめての承認に入れる決まり。書類の読み取りが先に使い、移行の確かめの画面（0113 の9）も
// 同じ行の形と部品（ReviewTable.tsx）を使う（列の名前・どこから決まったかの列は呼ぶ側が選ぶ）。
// 行は毎回、読み取りの記録と世帯から作る（保存しない）

/** 今の値と読んだ値の比較: fill（今は空・推定・書類待ちで、読んだ値が入る）・same（今の確定の値と同じ）・conflict（今の確定の値と違う） */
export type Compare = "fill" | "same" | "conflict";

export type RowStatus = "pending" | "accepted" | "corrected" | "rejected";

/** 直すときの欄の形（入力の欄の種類と同じ言葉） */
export interface RowEdit {
  kind: "yen" | "int" | "pct" | "decimal" | "select" | "ym" | "bool" | "text";
  options?: readonly { value: string; label: string }[];
  /** 欄の単位の言葉（円・か月・% など） */
  unit?: string;
}

export interface ReviewRow {
  id: string;
  /** まとまりの見出し（カード・物。例: 「年金 › ご本人の年金の記録」） */
  group: string;
  /** 欄の名前（移行では伏せ字の後の見出し） */
  label: string;
  /** 今の値（言葉）と状態の言葉。当てる欄が決まらないときは null */
  current: { text: string | null; status: string | null } | null;
  /** 読んだ値（言葉）。読めなかったら text は null で unreadable */
  incoming: { text: string | null; unreadable: boolean };
  compare: Compare | null;
  /** 元の場所（ページ・見出しの言葉）と、その所の文字（伏せ字の後） */
  source: { where: string | null; text: string | null };
  confidence: "high" | "medium" | "low" | null;
  /** どこから決まったか（移行の行: 規則・覚えた対応・AI の候補・FP。書類の読み取りでは読み手） */
  decidedBy?: string | null;
  status: RowStatus;
  /** 承認できない理由（当てる欄が無い・値の形が違う・期間が違う・名義が決まっていない）。直して入れることはできる理由もある */
  problem: string | null;
  /** problem があっても「直す」で入れられるか */
  correctable: boolean;
  /** 種類を決める行（年金の記録の型など。結果を大きく変えるので、まとめての承認に入れない） */
  structural: boolean;
  /** 当てる欄の選択肢（1つに決まらないとき。chosen は FP が選んだ物） */
  choices?: readonly { id: string; label: string }[];
  chosen?: string | null;
  /** 直すときの欄の形（直せない行は null） */
  edit: RowEdit | null;
  /** 読み手・AI の添え書き（信用しない文。文字のまま出す） */
  note?: string | null;
  /** 承認した後に、今の値が承認した値と違っている（元に戻した・手で直した） */
  changedSince?: boolean;
}

/**
 * まとめての承認に入れる行: 未決で、承認できて（理由が無い・当てる欄が決まっている）、確からしさが高く、今の値が空・推定・書類待ちか
 * 同じ値の行だけ。今の確定の値と違う行・確からしさが中・低の行・種類を決める行・読めなかった行は1つずつ
 */
export function bulkEligible(r: ReviewRow): boolean {
  if (r.status !== "pending" || r.problem !== null || r.structural || r.incoming.unreadable) return false;
  if (r.choices !== undefined && r.choices.length > 0 && (r.chosen ?? null) === null) return false;
  return r.confidence === "high" && (r.compare === "fill" || r.compare === "same");
}

export const STATUS_WORDS: Readonly<Record<RowStatus, string>> = { pending: "未決", accepted: "承認した", corrected: "直して入れた", rejected: "入れない" };

export const COMPARE_WORDS: Readonly<Record<Compare, string>> = { fill: "入る", same: "同じ", conflict: "違う" };
