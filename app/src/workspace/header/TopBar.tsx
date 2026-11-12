// 上の帯（画面の上に固定しない。スクロールで流れる）。
// 並び: 左＝ロゴと世帯の選択（と、急ぎの札）、中＝タブ、右＝↶↷・メモ・FP のメニュー・文字の大きさ（中・大）・お知らせのベル。
// 左上のロゴ: 事務所の見た目（0121）で事務所の名前・ロゴを決めていれば、「ファイナンシア」とその印の代わりに出す（ロゴが無ければ名前だけ。
// 両方無ければ今のまま）。ソフトの名前は FP のメニューの「ファイナンシアへ」に残す
// ふだんは状態の札を出さない。急ぎのもの（保存の失敗・保存を止めている・AIと共有中・重大なお知らせ）だけ札で出し、
// 利用者に行動を求める通知（復元キーの保管など）と配信元のお知らせは、お知らせの一覧（ベル。常に出す。0087）にまとめる。詳しい状態は世帯の選択のメニューの中で見る
import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { NoticeCenter, type NoticeCenterProps } from "../notices/NoticeCenter.tsx";
import { fitBar } from "./fit.ts";
import { LogoCanvas, type LogoImage } from "../../presentation/LogoCanvas.tsx";

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


export interface TopBarProps<T extends string> {
  tabs: readonly { id: T; label: string }[];
  tab: T;
  onTab: (t: T) => void;
  /** 世帯の選択（本体・開発用のサーバーにつながっていないときは null） */
  household: { no: string; sub: string; open: boolean; onToggle: () => void; /** 架空の世帯（「架空」の印を出す） */ fictional?: boolean } | null;
  alerts: readonly BarAlert[];
  /** お知らせの一覧（ベル。常に出す。0087） */
  notices: NoticeCenterProps;
  /** 世帯を開いているときの右側の操作（↶↷・メモ） */
  tools: ComponentChildren;
  /** 文字の大きさが「大」 */
  big: boolean;
  onBig: (big: boolean) => void;
  /** 事務所の名前とロゴ（0121。無ければ null＝「ファイナンシア」） */
  brand?: { name: string | null; logo: LogoImage | null } | null;
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
        <Brand brand={p.brand ?? null} />
        {p.household !== null ? (
          <button type="button" class="hh-btn" aria-expanded={p.household.open} aria-haspopup="dialog" aria-label={`世帯の選択（${p.household.no}${p.household.fictional === true ? "・架空の世帯" : ""}）`} title={p.household.sub !== "" ? `${p.household.no} ${p.household.sub}` : p.household.no} onClick={p.household.onToggle} data-household-button>
            <span class="hh-no">{p.household.no}</span>
            {p.household.fictional === true ? (
              <span class="pl-tag hh-fictional-tag" title="AIの候補から作った架空の世帯（お客さまの世帯ではありません）" data-household-fictional>
                架空
              </span>
            ) : null}
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
        <NoticeCenter {...p.notices} />
      </div>
    </header>
  );
}

/** 左上のロゴ（事務所の見た目が無ければ「ファイナンシア」とその印。ロゴの画像が読めなければ名前だけ） */
function Brand({ brand }: { brand: { name: string | null; logo: LogoImage | null } | null }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [brand?.logo?.data]);
  if (brand === null)
    return (
      <span class="brand" title="ファイナンシア">
        <span class="brand-mark" aria-hidden="true" />
        <span class="brand-name">ファイナンシア</span>
      </span>
    );
  const logo = broken ? null : brand.logo;
  const name = brand.name;
  const label = name ?? "事務所のロゴ";
  return (
    <span class={`brand office${logo !== null ? " has-logo" : ""}`} data-office-brand>
      {logo !== null ? <LogoCanvas logo={logo} height={24} maxWidth={132} label={label} class="brand-logo" onError={() => setBroken(true)} /> : null}
      {name !== null ? <span class="brand-name">{name}</span> : logo === null ? <span class="brand-name">ファイナンシア</span> : null}
    </span>
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
