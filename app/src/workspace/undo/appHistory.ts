// 画面の大枠の履歴: 世帯データ（現状・案・メモ・万一の想定の前提）・保存していない対策の変更・表示の設定を1つの状態として積む。
// 世帯・案・表示の設定を変える setter を track で包むだけで、その変更が履歴に入る（包んだ setter の中で別の包んだ setter を呼んでも1件）。
// 選んだ案・基準の案だけを替えたときは中身が変わらないので積まない（戻すときは、その操作をしたときの選び方に戻る）。
// 提案書の宛名など保存しない値は、この状態に入れないので履歴にも残らない
import { useCallback, useMemo, useRef } from "preact/hooks";
import type { WorkingHousehold } from "../input/household.ts";
import type { BalanceSettings, DisplaySettings } from "../settings.ts";
import { historyScope, undoController, useUndoScope, type Hint, type UndoController } from "./controller.ts";
import { deepEqual, HistoryBook, UndoHistory } from "./history.ts";

/** 主画面の作業の状態のうち、履歴で見るところ */
export interface WorkLike {
  band: string[];
  base: string;
  sel: string;
  drafts: Record<string, unknown>;
}

export interface AppSnap<W extends WorkLike = WorkLike> {
  wh: WorkingHousehold;
  work: W;
  /** 結果のタブの表示の設定 */
  settings: DisplaySettings;
  /** 資産と負債のタブの表示の設定 */
  bs: BalanceSettings;
}

/** 中身（世帯・帯・保存していない変更・表示の設定）が同じか。選んだ案・基準の案は見ない */
export function sameSnap(a: AppSnap, b: AppSnap): boolean {
  return deepEqual(a.wh, b.wh) && deepEqual(a.work.drafts, b.work.drafts) && deepEqual(a.work.band, b.work.band) && deepEqual(a.settings, b.settings) && deepEqual(a.bs, b.bs);
}

/** 知らせに出す名前: 何が変わったか（入力・案・対策・表示の設定など）＋操作した部品の名前 */
export function describeSnap(a: AppSnap, b: AppSnap, hint: Hint): string {
  const what = !deepEqual(a.settings, b.settings) || !deepEqual(a.bs, b.bs)
    ? "表示の設定"
    : !deepEqual(a.wh.request, b.wh.request)
      ? "入力"
      : !deepEqual(a.wh.memo, b.wh.memo)
        ? "メモ"
        : !deepEqual(a.wh.contingency, b.wh.contingency)
          ? "万一のときの前提"
          : !deepEqual(a.wh.companyBs, b.wh.companyBs)
            ? "会社の数字（合算BS）"
          : !deepEqual(a.wh.proposals, b.wh.proposals)
            ? "プラン"
            : !deepEqual(a.work.drafts, b.work.drafts)
              ? "対策"
              : !deepEqual(a.work.band, b.work.band)
                ? "プランの帯"
                : "入力";
  const detail = hint.dialog ?? hint.control;
  return detail !== null && detail !== what ? `${what}（${detail}）` : what;
}

export interface HistoryBookOptions<S> {
  /** いまの状態（世帯を開く前は null） */
  read: () => S | null;
  same: (a: S, b: S) => boolean;
  describe: (before: S, after: S, hint: Hint) => string;
  /** 戻した状態を画面に入れる（このときの変更は履歴に積まない） */
  apply: (s: S) => void;
  limit?: number;
}

/** 世帯ごとの履歴と、setter を包む track。画面の大枠のスコープ（level 0）として元に戻すにつなぐ */
export function useHistoryBook<S>(opts: HistoryBookOptions<S>, c: UndoController = undoController) {
  const latest = useRef(opts);
  latest.current = opts;
  const book = useRef<HistoryBook<S> | null>(null);
  if (book.current === null) book.current = new HistoryBook<S>(() => new UndoHistory<S>({ same: (a, b) => latest.current.same(a, b), ...(opts.limit !== undefined ? { limit: opts.limit } : {}) }));
  const depth = useRef(0);
  const applying = useRef(false);

  const track = useCallback(<T>(fn: () => T): T => {
    const h = book.current?.current ?? null;
    const before = depth.current === 0 && !applying.current && h !== null ? latest.current.read() : null;
    depth.current += 1;
    try {
      return fn();
    } finally {
      depth.current -= 1;
      if (before !== null && h !== null) {
        const after = latest.current.read();
        if (after !== null) c.record(h, before, after, (hint) => latest.current.describe(before, after, hint));
      }
    }
  }, []);

  /** 世帯を開いた（読み直した）: その世帯の履歴を空にする。戻せる・やり直せる履歴を捨てたら true */
  const reset = useCallback((id: string): boolean => {
    const lost = book.current?.has(id) ?? false;
    book.current?.reset(id);
    c.changed();
    return lost;
  }, []);

  /** 世帯を開いた（中身が前に開いていたときと同じ）: その世帯の履歴を続きから使う */
  const select = useCallback((id: string) => {
    book.current?.select(id);
    c.changed();
  }, []);

  /** 開いている世帯を新しい世帯として保存した: いまの履歴をその世帯の名前で持ち直す（続きから使う） */
  const rename = useCallback((id: string) => {
    book.current?.rename(id);
    c.changed();
  }, []);

  /** 世帯を消した: 履歴を捨てる */
  const drop = useCallback((id: string) => {
    book.current?.drop(id);
    c.changed();
  }, []);

  useUndoScope(
    historyScope(
      0,
      () => book.current?.current ?? null,
      (s) => {
        applying.current = true;
        try {
          latest.current.apply(s);
        } finally {
          applying.current = false;
        }
      },
    ),
    c,
  );

  return useMemo(() => ({ track, reset, select, rename, drop }), [track, reset, select, rename, drop]);
}
