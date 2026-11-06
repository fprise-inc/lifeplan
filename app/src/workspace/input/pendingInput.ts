// 打ちかけの値（欄に入ったまま、まだ決めていない文字）を、画面を変える操作の前に決める（0131）。
// 欄は離れたとき（Enter）に値を決めるので、欄を離れずに起きる操作（Esc・閉じる・保存・タブやプランの切り替え・世帯の切り替え・
// アプリを閉じる・ページの再読み込み）の前に、ここを呼んで打ちかけの値を決める。読めない打ち方なら決めずに止め、その欄に戻す
// （欄の下には打っている間から理由が出ている）。欄の部品（FieldViews.tsx の Field・時点の欄、貯蓄の表の数の欄）が、入ったときに登録する。

/** 打ちかけの値を決めた結果: none は決める物が無い（入ったときと同じ文字）、committed は書いた、rejected は読めないので書かずに止めた */
export type Settled = "none" | "committed" | "rejected";

/** 今入っている欄（1つだけ） */
export interface ActiveInput {
  /** 打ちかけの値を決める（読めれば書く） */
  settle: () => Settled;
  /** その欄に戻す（止めたとき） */
  focus: () => void;
}

/** 保存していない変更を持つパネル（入力のパネル。開いている間だけ） */
export interface PanelGuard {
  unsaved: () => boolean;
  /** 「保存していない変更があります」を出す（閉じない） */
  warn: () => void;
}

let active: ActiveInput | null = null;
/** 欄を離れたときに読めずに前の値に戻した欄（その直後の操作を1回だけ止め、知らせを見せる。次のキー・押す操作で消える） */
let unseen: Pick<ActiveInput, "focus"> | null = null;
let panel: PanelGuard | null = null;

/** 欄に入った。離れたとき（か消えたとき）に呼ぶ関数を返す */
export function enterInput(a: ActiveInput): () => void {
  active = a;
  unseen = null;
  return () => {
    if (active === a) active = null;
  };
}

let armed = false;
/**
 * 欄を離れたときに読めずに前の値に戻した（離れた操作が「保存」などを押すためのものなら、その操作を1回止めて欄に戻す）。
 * 次のキー・押す操作で忘れる（押した所が保存などのボタンでなければ、知らせはその欄の下に残っている）
 */
export function noteRejected(focus: () => void): void {
  unseen = { focus };
  if (armed || typeof document === "undefined") return;
  armed = true;
  const forget = () => {
    unseen = null;
    armed = false;
    document.removeEventListener("pointerdown", forget, true);
    document.removeEventListener("keydown", forget, true);
  };
  // 今の押す操作（この離れ方を起こした pointerdown）はもう届いているので、次の操作で忘れる
  document.addEventListener("pointerdown", forget, true);
  document.addEventListener("keydown", forget, true);
}

/**
 * 画面を変える操作の前に、打ちかけの値を決める。ok が false なら操作を止める（読めない打ち方の欄に戻した）。
 * committed は値を書いたか（書いた世帯が画面の状態に入るのは次の描画の後）
 */
export function settleInput(): { ok: boolean; committed: boolean } {
  if (active !== null) {
    const a = active;
    const r = a.settle();
    if (r === "rejected") {
      a.focus();
      return { ok: false, committed: false };
    }
    if (r === "committed") return { ok: true, committed: true };
  }
  if (unseen !== null) {
    const u = unseen;
    unseen = null;
    u.focus();
    return { ok: false, committed: false };
  }
  return { ok: true, committed: false };
}

/** 入力のパネルを開いた（保存していない変更を、世帯の切り替え・アプリを閉じる前に確かめる）。閉じたときに呼ぶ関数を返す */
export function guardPanel(g: PanelGuard): () => void {
  panel = g;
  return () => {
    if (panel === g) panel = null;
  };
}

/**
 * 世帯を離れる・アプリを閉じる・ページを読み直す前の確かめ: 打ちかけの値を決め、開いている入力のパネルに保存していない変更があれば
 * そのパネルに知らせを出して止める。go が false なら止める
 */
export function settleBeforeLeave(): { go: boolean; committed: boolean } {
  const s = settleInput();
  if (!s.ok) return { go: false, committed: false };
  if (panel !== null && panel.unsaved()) {
    panel.warn();
    return { go: false, committed: s.committed };
  }
  return { go: true, committed: s.committed };
}

/** テスト用: 登録を空にする */
export function resetPendingInput(): void {
  active = null;
  unseen = null;
  panel = null;
}
