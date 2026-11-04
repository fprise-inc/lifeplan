// お知らせの一覧（上の帯のベル。0087）。ボタンはベルの印だけ（名前は aria-label と title）。ベルは常に出し、未読の件数（参考を除く）だけを数字で出す（0件なら数字なし）。
// 押すと帯の下に一覧を重ねて出す: 「未読」「すべて」の切り替えと種類の絞り込み・「すべて既読にする」。
// 1件を押すと詳しい中身（何があったか → 何が変わったか → 関係する世帯 → その画面を開くボタン）。開いたものは既読にして一覧に残す
import { useEffect, useRef, useState } from "preact/hooks";
import { CATEGORIES, countsAsUnread, dateText, filterItems, RECEIPT_MATCH_TEXT, sortItems, unreadCount, URGENCY_LABEL, type CenterItem, type NoticeCategory } from "./center.ts";

export interface NoticeCenterProps {
  items: readonly CenterItem[];
  /** 既読にする（鍵の並び） */
  onRead: (keys: string[]) => void;
  /** 「要望・不具合を送る」を開く（無ければ出さない） */
  onFeedback?: (() => void) | undefined;
  /** 外から1件を開く（帯の札を押した・画面の確かめ）。n が変わるたびに開き直す */
  focus?: { key: string | null; n: number } | null | undefined;
}

const catLabel = (c: NoticeCategory) => CATEGORIES.find((x) => x.id === c)?.short ?? c;

function Marks({ i }: { i: CenterItem }) {
  return (
    <span class="nc-marks">
      <span class={`nc-cat c-${i.category}`} data-notice-category={i.category}>
        {catLabel(i.category)}
      </span>
      {i.urgency !== "normal" ? (
        <span class={`nc-urg u-${i.urgency}`} data-notice-urgency={i.urgency}>
          {URGENCY_LABEL[i.urgency]}
        </span>
      ) : null}
      {i.receipts.length > 0 ? <span class="nc-rcpt">{RECEIPT_MATCH_TEXT}</span> : null}
    </span>
  );
}

export function NoticeCenter({ items, onRead, onFeedback, focus }: NoticeCenterProps) {
  const [open, setOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [cat, setCat] = useState<NoticeCategory | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const count = unreadCount(items);
  const sorted = sortItems(items);
  const anyUnread = items.some((i) => !i.read);

  const show = (key: string | null) => {
    setOpen(true);
    setCat(null);
    setUnreadOnly(key === null ? items.some((i) => !i.read) : false);
    setSel(key);
    if (key !== null) onRead([key]);
  };
  useEffect(() => {
    if (focus != null) show(focus.key);
  }, [focus?.n]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      btn.current?.focus();
    };
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

  const shown = filterItems(sorted, { unreadOnly, category: cat });
  const current = sel === null ? null : (items.find((i) => i.key === sel) ?? null);
  const label = count > 0 ? `お知らせ（未読 ${count}件）` : "お知らせ";
  return (
    <div class="bell" ref={box}>
      <button
        type="button"
        class={`bell-btn${count > 0 ? "" : " quiet"}`}
        ref={btn}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        title={label}
        onClick={() => (open ? setOpen(false) : show(null))}
        data-notice-bell={count}
      >
        <svg class="bell-ico" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M10 2.5a5 5 0 0 0-5 5v3.2L3.5 13.5h13L15 10.7V7.5a5 5 0 0 0-5-5Z" />
          <path d="M8 15.5a2 2 0 0 0 4 0" />
        </svg>
        {count > 0 ? (
          <span class="bell-n" aria-hidden="true">
            {count}
          </span>
        ) : null}
      </button>
      {open ? (
        <div class="nc" role="dialog" aria-label="お知らせ" data-notice-center>
          {current !== null ? (
            <div class="nc-detail" data-notice-detail={current.key}>
              <button type="button" class="link-btn nc-back" onClick={() => setSel(null)} data-notice-back>
                ‹ 一覧に戻る
              </button>
              <div class="nc-head">
                <Marks i={current} />
                {current.date !== null ? <span class="nc-date">{dateText(current.date)}</span> : null}
              </div>
              {current.receipts.length > 0 ? (
                <p class="nc-rcpt-note" data-notice-receipts>
                  {RECEIPT_MATCH_TEXT}（受付番号 {current.receipts.join("・")}）。送っていただいた要望・不具合の知らせをもとに直しました。
                </p>
              ) : null}
              <h3 class="nc-h">何があったか</h3>
              <p class="nc-title">{current.title}</p>
              {current.body !== "" ? (
                <>
                  <h3 class="nc-h">何が変わったか</h3>
                  <p class="nc-body">{current.body}</p>
                </>
              ) : null}
              {current.household !== null ? (
                <>
                  <h3 class="nc-h">関係する世帯</h3>
                  <p class="nc-body">{current.household}</p>
                </>
              ) : null}
              {current.action !== null ? (
                <button
                  type="button"
                  class="btn nc-go"
                  onClick={() => {
                    setOpen(false);
                    current.action?.run();
                  }}
                  data-notice-go={current.key}
                >
                  {current.action.label}を開く
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div class="nc-top">
                <span class="nc-ttl">お知らせ</span>
                <button type="button" class="link-btn" disabled={!anyUnread} onClick={() => onRead(items.filter((i) => !i.read).map((i) => i.key))} data-notice-read-all>
                  すべて既読にする
                </button>
              </div>
              <div class="nc-tabs" role="radiogroup" aria-label="出すお知らせ">
                {[
                  { on: true, label: `未読（${items.filter((i) => !i.read).length}）` },
                  { on: false, label: `すべて（${items.length}）` },
                ].map((t) => (
                  <button type="button" key={t.label} role="radio" aria-checked={unreadOnly === t.on} class={unreadOnly === t.on ? "on" : ""} onClick={() => setUnreadOnly(t.on)} data-notice-tab={t.on ? "unread" : "all"}>
                    {t.label}
                  </button>
                ))}
              </div>
              <div class="nc-cats" role="radiogroup" aria-label="種類">
                {[{ id: null, label: "すべての種類" }, ...CATEGORIES.map((c) => ({ id: c.id, label: c.label }))].map((c) => (
                  <button type="button" key={c.label} role="radio" aria-checked={cat === c.id} class={`nc-cat-pick${cat === c.id ? " on" : ""}${c.id !== null ? ` c-${c.id}` : ""}`} onClick={() => setCat(c.id)} data-notice-filter={c.id ?? "all"}>
                    {c.label}
                  </button>
                ))}
              </div>
              {shown.length === 0 ? (
                <p class="nc-empty" data-notice-empty>
                  {unreadOnly ? "未読のお知らせはありません" : "お知らせはありません"}
                </p>
              ) : (
                <ul class="nc-list" role="list" data-notice-list>
                  {shown.map((i) => (
                    <li key={i.key}>
                      <button type="button" class={`nc-item${i.read ? " read" : ""}${countsAsUnread(i) ? " counts" : ""}`} onClick={() => show(i.key)} data-notice={i.key} data-notice-read={i.read ? "1" : "0"}>
                        <span class="nc-dot" aria-hidden="true" />
                        <span class="nc-main">
                          <span class="nc-line">
                            <Marks i={i} />
                            {i.date !== null ? <span class="nc-date">{dateText(i.date)}</span> : null}
                          </span>
                          <span class="nc-item-title">
                            {i.read ? null : <span class="sr-only">未読 </span>}
                            {i.title}
                          </span>
                          {i.household !== null ? <span class="nc-hh">{i.household}</span> : null}
                        </span>
                        <span class="nc-more" aria-hidden="true">
                          ›
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {onFeedback !== undefined ? (
                <div class="nc-foot">
                  <button
                    type="button"
                    class="link-btn"
                    onClick={() => {
                      setOpen(false);
                      onFeedback();
                    }}
                    data-notice-feedback
                  >
                    要望・不具合を送る
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
