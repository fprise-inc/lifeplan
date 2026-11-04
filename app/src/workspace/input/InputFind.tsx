// 入力のホームの「探して開く」（inputSearch.ts）: 言葉を入れると、それを入れる入力項目の欄を数件出し、選ぶとその入力項目を開いてその欄へ移る。
// 新しい物は作らない（入れる場所へ案内するだけ）。置き場所は入力項目の並びの最後（前の「＋ 項目を追加」の所）。顧客と並んで見る画面なので控えめに。
// キーボード: 上下で選ぶ・Enter で選んだ候補を開く（言葉を入れただけでは何も選んでいないので、Enter で最初の候補を開かない）・Esc で候補を閉じる（もう一度で言葉を消す）。候補は入れる欄にフォーカスがあるときだけ出す
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { Help } from "../../presentation/Help.tsx";
import type { WorkingHousehold } from "./household.ts";
import { findEntries, findInInput, type FindHit } from "./inputSearch.ts";
import type { InputItem } from "./items.ts";

interface Props {
  /** 探す世帯（プランを直しているときはそのプランの中身） */
  wh: WorkingHousehold;
  /** 全部の入力項目（非表示の物も） */
  items: readonly InputItem[];
  onPick: (hit: FindHit) => void;
  /** 初めに入れておく言葉（URL の #find=留学。画面の確かめ用） */
  initialQuery?: string;
}

/** キーを押したときの動き（上下: 候補を選ぶ〔閉じていれば開く。初めは何も選んでいない〕・Enter: 上下・指で選んだ候補だけを開く〔選んでいなければ何もしない〕・Esc: 候補を閉じる、閉じていれば言葉を消す）。何もしないなら null */
export type FindKey = { kind: "move"; act: number } | { kind: "reopen" } | { kind: "pick"; index: number } | { kind: "close" } | { kind: "clear" };
export function findKey(key: string, open: boolean, act: number, count: number, query: string): FindKey | null {
  if (key === "ArrowDown" || key === "ArrowUp") {
    if (!open) return query.trim() !== "" ? { kind: "reopen" } : null;
    if (count === 0) return null;
    if (act < 0) return { kind: "move", act: key === "ArrowDown" ? 0 : count - 1 };
    return { kind: "move", act: key === "ArrowDown" ? (act + 1) % count : (act - 1 + count) % count };
  }
  if (key === "Enter") return open && act >= 0 && act < count ? { kind: "pick", index: act } : null;
  if (key === "Escape") return open ? { kind: "close" } : query !== "" ? { kind: "clear" } : null;
  return null;
}

/** 欄の名前の頭の「＋ 」（足すボタン）は、候補では外して「足す」の札にする */
const shownLabel = (label: string): { text: string; add: boolean } => (label.startsWith("＋") ? { text: label.replace(/^＋\s*/, ""), add: true } : { text: label, add: false });

export function InputFind({ wh, items, onPick, initialQuery = "" }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [focused, setFocused] = useState(initialQuery !== "");
  /** 選んだ・Esc で閉じた後は、打ち直すか下を押すまで候補を出さない */
  const [closed, setClosed] = useState(false);
  const [act, setAct] = useState(-1);
  /** 候補の箱の置き方: 右からはみ出すなら右にそろえる（flip）、下に入りきらず上のほうが広ければ欄の上に出す（up） */
  const [place, setPlace] = useState({ flip: false, up: false });
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const uid = useId();
  const listId = `find-list-${uid}`;
  const searching = query.trim() !== "";
  // 探す対象は、言葉を入れたときだけ作る（世帯・入力項目が変わったら作り直す）
  const entries = useMemo(() => (searching ? findEntries(wh, items) : []), [wh, items, searching]);
  const hits = useMemo(() => findInInput(entries, query), [entries, query]);
  const open = focused && searching && !closed;
  useEffect(() => setAct(-1), [query]);
  // 上下で選んだ候補が見えるように（候補の箱の中だけを動かす）
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>("li.act")?.scrollIntoView({ block: "nearest" });
  }, [act, open]);
  useEffect(() => {
    if (initialQuery !== "") input.current?.focus({ preventScroll: true });
  }, []);
  // 候補の箱が画面の右からはみ出すなら右にそろえ、下に入りきらず上のほうが広ければ欄の上に出す（入力項目の並びの最後なので、画面の下の端に来やすい）
  useLayoutEffect(() => {
    if (!open || input.current === null) return;
    const r = input.current.getBoundingClientRect();
    const h = list.current?.offsetHeight ?? 0;
    const below = window.innerHeight - r.bottom;
    const next = { flip: r.left + 380 > window.innerWidth - 16, up: below < h + 12 && r.top > below };
    if (next.flip !== place.flip || next.up !== place.up) setPlace(next);
  }, [open, hits.length]);
  const pick = (h: FindHit | undefined) => {
    if (h === undefined) return;
    setClosed(true);
    onPick(h);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const r = findKey(e.key, open, act, hits.length, query);
    if (r === null) return;
    e.preventDefault();
    // Esc は探す欄の中だけで受ける（ほかの画面の Esc の扱いに渡さない）
    if (e.key === "Escape") e.stopPropagation();
    if (r.kind === "move") setAct(r.act);
    else if (r.kind === "reopen") setClosed(false);
    else if (r.kind === "pick") pick(hits[r.index]);
    else if (r.kind === "close") setClosed(true);
    else setQuery("");
  };
  return (
    <div class={`ih-card ih-find${open ? " on" : ""}`} data-find>
      <div class="ih-find-h">
        <svg class="ih-find-ic" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="2" />
          <path d="M12.6 12.6 L17 17" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
        </svg>
        <label for={`find-q-${uid}`}>探して開く</label>
        <Help label="探して開く">
          <p>入れたい物の言葉（例: 留学・奨学金・養育費・iDeCo・固定資産税）を入れると、それを入れる入力項目の欄を出します。選ぶと、その入力項目を開いて欄へ移ります。</p>
          <p>案内するだけで、物は足しません。足すボタンの所へ移ったときは、そのボタンで足します。</p>
          <p>ホームに出していない入力項目の欄も探せます。開いて値を入れて保存すると、ホームに出ます。</p>
        </Help>
      </div>
      <div class="ih-find-box">
        <input
          ref={input}
          id={`find-q-${uid}`}
          class="ih-find-q"
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          {...(open && hits[act] !== undefined ? { "aria-activedescendant": `${listId}-${act}` } : {})}
          autocomplete="off"
          spellcheck={false}
          placeholder="例: 留学・奨学金・iDeCo"
          value={query}
          onInput={(e) => {
            setQuery(e.currentTarget.value);
            setClosed(false);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          data-find-input
        />
        {open ? (
          <ul id={listId} ref={list} class={`ih-find-list${place.flip ? " flip" : ""}${place.up ? " up" : ""}`} role="listbox" aria-label="探した欄" data-find-list>
            {hits.length === 0 ? (
              <li class="none" role="option" aria-disabled="true" aria-selected={false}>
                見つかりません。ほかの言い方で探してください
              </li>
            ) : (
              hits.map((h, i) => {
                const l = shownLabel(h.label);
                return (
                  <li
                    key={`${h.card}|${h.target.key}|${h.label}`}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === act}
                    class={i === act ? "act" : ""}
                    // 押したときに入れる欄からフォーカスを外さない（外すと候補が閉じて、押した物が選べない）
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setAct(i)}
                    onClick={() => pick(h)}
                    data-find-hit={i}
                    data-find-card={h.card}
                  >
                    <span class="ih-find-path">
                      <span class="c">{h.cardLabel}</span>
                      {h.target.kind !== "card" ? (
                        <>
                          <span class="sep" aria-hidden="true">
                            ›
                          </span>
                          <span class="l">{l.text}</span>
                          {l.add ? <small class="tag">足す</small> : null}
                        </>
                      ) : null}
                    </span>
                    {h.where !== null || h.hidden || h.level === "detail" ? (
                      <span class="ih-find-where">
                        {h.where !== null ? <small>{h.where}</small> : null}
                        {h.level === "detail" ? <small class="tag">詳細</small> : null}
                        {h.hidden ? <small class="tag">ホームに出していない入力項目</small> : null}
                      </span>
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
