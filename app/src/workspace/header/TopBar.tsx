// 上の帯（画面の上に固定しない。スクロールで流れる）。
// 並び: 左＝ロゴと世帯の選択（と、急ぎの札）、中＝タブ、右＝↶↷・メモ・FP のメニュー・文字の大きさ（中・大）・通知の印。
// ふだんは状態の札を出さない。急ぎのもの（保存の失敗・保存を止めている・AIと共有中）だけ札で出し、
// 利用者に行動を求める通知（復元キーの保管など）は通知の印にまとめる。詳しい状態は世帯の選択のメニューの中で見る
import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { fitBar } from "./fit.ts";

/** 急ぎの札（左側。押すと詳しい場所を開く） */
export interface BarAlert {
  id: string;
  text: string;
  /** 帯が狭いときの短い文 */
  short: string;
  /** 札にかざしたときの詳しい説明 */
  title: string;
  tone: "err" | "warn" | "ai";
  onClick: () => void;
}

/** 通知の一覧の1件 */
export interface BarNotice {
  id: string;
  text: string;
  /** 押したときにすること（開く画面の名前を添える） */
  action: string;
  onClick: () => void;
}

export interface TopBarProps<T extends string> {
  tabs: readonly { id: T; label: string }[];
  tab: T;
  onTab: (t: T) => void;
  /** 世帯の選択（本体・開発用のサーバーにつながっていないときは null） */
  household: { no: string; sub: string; open: boolean; onToggle: () => void } | null;
  alerts: readonly BarAlert[];
  notices: readonly BarNotice[];
  /** 世帯を開いているときの右側の操作（↶↷・メモ） */
  tools: ComponentChildren;
  /** 文字の大きさが「大」 */
  big: boolean;
  onBig: (big: boolean) => void;
}

/** 文字の大きさを切り替える・帯の詰め方を決める（文字の大きさを変えた直後・窓の幅や中身が変わったときに測り直す） */
function useBarFit(ref: { current: HTMLElement | null }, big: boolean): void {
  const last = useRef("");
  const measure = (force: boolean) => {
    const el = ref.current;
    if (el === null) return;
    // 測り直すのは、幅・文字の大きさ・中身の文字が変わったときだけ（スライダーを動かすたびに測らない）
    const sig = `${el.clientWidth}|${big ? 1 : 0}|${el.textContent ?? ""}|${el.querySelectorAll("*").length}`;
    if (!force && sig === last.current) return;
    last.current = sig;
    fitBar(el);
  };
  // 文字の大きさ（大）: 文字の大きさ・線の太さは html の class で切り替える（描いた直後に。次の描画を待たない）。帯はそのあと測る
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("big", big);
    measure(true);
  }, [big]);
  useLayoutEffect(() => measure(false));
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure(false));
    ro?.observe(el);
    // 字の形（フォント）を読み終えると幅が変わる
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    const onFonts = () => measure(true);
    void fonts?.ready.then(onFonts);
    fonts?.addEventListener?.("loadingdone", onFonts);
    return () => {
      ro?.disconnect();
      fonts?.removeEventListener?.("loadingdone", onFonts);
    };
  }, [big]);
}

export function TopBar<T extends string>(p: TopBarProps<T>) {
  const ref = useRef<HTMLElement>(null);
  useBarFit(ref, p.big);
  return (
    <header class="top" ref={ref}>
      <div class="top-l">
        <span class="brand" title="ファイナンシア">
          <span class="brand-mark" aria-hidden="true" />
          <span class="brand-name">ファイナンシア</span>
        </span>
        {p.household !== null ? (
          <button type="button" class="hh-btn" aria-expanded={p.household.open} aria-haspopup="dialog" aria-label={`世帯の選択（${p.household.no}）`} title={p.household.sub !== "" ? `${p.household.no} ${p.household.sub}` : p.household.no} onClick={p.household.onToggle} data-household-button>
            <span class="hh-no">{p.household.no}</span>
            {p.household.sub !== "" ? <span class="hh-sub">{p.household.sub}</span> : null}
            <span class="caret" aria-hidden="true">
              {p.household.open ? "▲" : "▼"}
            </span>
          </button>
        ) : null}
        {p.alerts.map((a) => (
          <button type="button" key={a.id} class={`bar-alert t-${a.tone}`} title={a.title} onClick={a.onClick} aria-label={a.text} data-bar-alert={a.id}>
            <span class="full" aria-hidden="true">
              {a.text}
            </span>
            <span class="short" aria-hidden="true">
              {a.short}
            </span>
          </button>
        ))}
      </div>
      <nav class="tabs" aria-label="画面">
        {p.tabs.map((t) => (
          <button type="button" key={t.id} class={t.id === p.tab ? "on" : ""} aria-current={t.id === p.tab ? "page" : undefined} onClick={() => p.onTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <div class="top-r">
        {p.tools}
        <TextSizePick big={p.big} onPick={p.onBig} />
        {p.notices.length > 0 ? <NoticeBell notices={p.notices} /> : null}
      </div>
    </header>
  );
}

const SIZES = [
  { big: false, label: "中" },
  { big: true, label: "大" },
] as const;

/**
 * 文字の大きさ「文字 [中] [大]」。どちらかを選ぶ（radio のグループ）。
 * キーボード: Tab でグループに入り（選んでいる方に止まる）、← → ↑ ↓ で選び替える
 */
export function TextSizePick({ big, onPick }: { big: boolean; onPick: (big: boolean) => void }) {
  const group = useRef<HTMLDivElement>(null);
  const pick = (next: boolean) => {
    if (next !== big) onPick(next);
    // 選んだ方にフォーカスを移す（矢印キーで選び替えたとき）
    group.current?.querySelector<HTMLButtonElement>(`[data-text-size="${next ? "large" : "mid"}"]`)?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") pick(true);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") pick(false);
    else return;
    e.preventDefault();
  };
  return (
    <div class="fs-pick" role="radiogroup" aria-label="文字の大きさ" ref={group} onKeyDown={onKey} data-text-size-pick>
      <span class="fs-lbl" aria-hidden="true">
        文字
      </span>
      {SIZES.map((s) => (
        <button
          type="button"
          key={s.label}
          role="radio"
          class={s.big ? "fs-opt fs-l" : "fs-opt"}
          aria-checked={big === s.big}
          tabIndex={big === s.big ? 0 : -1}
          aria-label={`文字の大きさ ${s.label}`}
          title={`文字の大きさ: ${s.label}`}
          onClick={() => pick(s.big)}
          data-text-size={s.big ? "large" : "mid"}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

/** 通知の印（件数つき）。押すと一覧が開き、1件を押すとその画面を開く */
export function NoticeBell({ notices }: { notices: readonly BarNotice[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (box.current !== null && e.target instanceof Node && !box.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);
  return (
    <div class="bell" ref={box}>
      <button type="button" class="bell-btn" aria-expanded={open} aria-haspopup="true" aria-label={`通知（${notices.length}件）`} title={`通知（${notices.length}件）`} onClick={() => setOpen(!open)} data-notice-bell={notices.length}>
        <svg class="bell-ico" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M10 2.5a5 5 0 0 0-5 5v3.2L3.5 13.5h13L15 10.7V7.5a5 5 0 0 0-5-5Z" />
          <path d="M8 15.5a2 2 0 0 0 4 0" />
        </svg>
        <span class="lbl" aria-hidden="true">
          通知
        </span>
        <span class="bell-n" aria-hidden="true">
          {notices.length}
        </span>
      </button>
      {open ? (
        <ul class="bell-list" role="list" aria-label="通知" data-notice-list>
          {notices.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                class="bell-item"
                onClick={() => {
                  setOpen(false);
                  n.onClick();
                }}
                data-notice={n.id}
              >
                <span class="bell-text">{n.text}</span>
                <span class="bell-act">{n.action} ›</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
