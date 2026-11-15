// 入力のパネルの標準・詳細のスクロールの位置（0078 の 2026-11-14 の追記）。
// 標準と詳細は同じ本文（.ip-body）を描き替えるので、位置が共通だった（詳細で下へ動かして標準に戻ると、標準が元の所にない）。
// 開いている間だけ、切り替えの前の位置を細かさごとに覚え、切り替えのボタンで戻ってきたときに戻す。
// 初めて行く細かさは今までどおり（本文の位置をそのまま。描き替えで短くなれば、その分だけ上に詰まる）。
// 欄へ移る切り替え（前提と推定の一覧から詳細の欄へ移るなど）は、移る先へのスクロールに任せて戻さない。パネルを閉じると忘れる
import type { Level } from "./form.ts";

/** スクロールする本文（テストでは scrollTop だけの物を渡す） */
export interface ScrollBox {
  scrollTop: number;
}

export class LevelScroll {
  private readonly saved = new Map<Level, number>();
  private pending: number | null = null;

  /**
   * 細かさを from から to へ切り替える前に呼ぶ。今の位置を from の位置として覚える。
   * restore なら、描き替えた後（arrive）に to の覚えた位置へ戻す（覚えていなければ何もしない＝今までどおり）
   */
  leave(from: Level, to: Level, box: ScrollBox | null, restore: boolean): void {
    if (from === to || box === null) return;
    this.saved.set(from, box.scrollTop);
    const back = this.saved.get(to);
    this.pending = restore && back !== undefined ? back : null;
  }

  /** 描き替えた直後（描く前の画面に出る前）に呼ぶ。leave で予約した位置へ戻す */
  arrive(box: ScrollBox | null): void {
    const p = this.pending;
    this.pending = null;
    if (p !== null && box !== null) box.scrollTop = p;
  }
}
