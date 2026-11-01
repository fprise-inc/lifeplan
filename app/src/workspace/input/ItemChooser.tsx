// 入力項目を選ぶ（入力のホームの上部の右の1つの入口。itemChoice.ts）: 入力のホームと同じ並びで、出すか（チェック）と開いたときの入れ方（標準／詳細）を
// 1行ずつ選ぶ小さな一覧。選ぶとその場で世帯に入る（↶ で戻せる）。値が入っている入力項目と、家族・前提条件は出したまま（チェックを外せない）。
// 一覧の下で、この選び方を事務所の既定（新しい世帯で出す入力項目と開いたときの入れ方）にでき、事務所の既定にそろえることもできる（0091）
import { useEffect, useRef, useState } from "preact/hooks";
import { Help } from "../../presentation/Help.tsx";
import type { Level, StageId } from "./form.ts";
import type { WorkingHousehold } from "./household.ts";
import { ALWAYS_SHOWN, isHiddenIn, levelIn, sameChoice, setItemChoice, withLevel, withShown, type ItemChoice } from "./itemChoice.ts";
import type { InputItem } from "./items.ts";

interface Props {
  /** 世帯（現状。選び方は世帯全体の物で、プランごとには持たない） */
  wh: WorkingHousehold;
  /** ホームと同じ並びの入力項目（非表示の物も含む。値が入っているかは見ている中身で決まる） */
  items: readonly InputItem[];
  /** 選んだ世帯を保存する */
  onChange: (next: WorkingHousehold) => void;
  /** 開いたときの入れ方を変えた（その項目のその場の切り替えを外す） */
  onLevel?: (id: StageId) => void;
  initialOpen?: boolean;
  /** 事務所の既定（新しい世帯で出す入力項目と開いたときの入れ方）。無ければ事務所の既定の操作を出さない（本体の無い画面の確かめ） */
  office?: OfficeItems;
}

/** 事務所の既定の選び方と、それを置き換える操作（事務所データに保存する。世帯の ↶↷ には入らない） */
export interface OfficeItems {
  items: ItemChoice;
  onSave: (items: ItemChoice) => Promise<void>;
}

/** 事務所の既定にした後の知らせ（取り消すときに戻す前の既定を持つ） */
type OfficeMsg = { kind: "saved"; before: ItemChoice } | { kind: "undone" } | { kind: "error"; text: string };

const errText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "E_OFFICE_SETTINGS");

/** 行の注記（チェックを外せない理由） */
export function lockedReason(item: InputItem): string | null {
  if (ALWAYS_SHOWN.includes(item.id as StageId)) return "いつも出します";
  if (item.entered) return "値が入っているので出します";
  return null;
}

export function ItemChooser({ wh, items, onChange, onLevel, initialOpen = false, office }: Props) {
  const [open, setOpen] = useState(initialOpen);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<OfficeMsg | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const c = wh.itemChoice;
  const hiddenCount = items.filter((i) => i.hidden).length;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t !== null && box.current !== null && !box.current.contains(t) && !(t instanceof Element && t.closest("[data-help-host]") !== null)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);
  const show = (id: StageId, on: boolean) => {
    onChange(setItemChoice(wh, withShown(c, id, on)));
    setMsg(null);
  };
  const level = (id: StageId, l: Level) => {
    onChange(setItemChoice(wh, withLevel(c, id, l)));
    onLevel?.(id);
    setMsg(null);
  };
  const same = office !== undefined && sameChoice(c, office.items);
  /** この選び方を事務所の既定にする（取り消せるよう、前の既定を知らせに持つ） */
  const toOffice = async () => {
    if (office === undefined) return;
    const before = office.items;
    setBusy(true);
    try {
      await office.onSave(c ?? {});
      setMsg({ kind: "saved", before });
    } catch (e) {
      setMsg({ kind: "error", text: `事務所の既定にできませんでした（${errText(e)}）` });
    } finally {
      setBusy(false);
    }
  };
  const undo = async (before: ItemChoice) => {
    if (office === undefined) return;
    setBusy(true);
    try {
      await office.onSave(before);
      setMsg({ kind: "undone" });
    } catch (e) {
      setMsg({ kind: "error", text: `取り消せませんでした（${errText(e)}）` });
    } finally {
      setBusy(false);
    }
  };
  /** この世帯の選び方を事務所の既定にそろえる（世帯の変更なので ↶ で戻せる。入れ方が変わる項目は、その場の切り替えも外す） */
  const fromOffice = () => {
    if (office === undefined) return;
    onChange(setItemChoice(wh, office.items));
    for (const i of items) if ((levelIn(c, i.id) ?? "simple") !== (levelIn(office.items, i.id) ?? "simple")) onLevel?.(i.id as StageId);
    setMsg(null);
  };
  return (
    <div class="ih-choose" ref={box} data-item-choose>
      <button type="button" class="add-btn" aria-expanded={open} onClick={() => setOpen(!open)} data-item-choose-open>
        入力項目を選ぶ{hiddenCount > 0 ? `（非表示 ${hiddenCount}）` : ""} {open ? "▴" : "▾"}
      </button>
      {open ? (
        <div class="ih-choose-pop" role="group" aria-label="入力項目を選ぶ" data-item-choose-list>
          <div class="ih-choose-h">
            <b>この世帯で出す入力項目</b>
            <Help label="入力項目を選ぶ" id="item-choose">
              <p>チェックを外した入力項目は、この世帯の入力のホームに出しません。見せ方だけで、値も計算も変えません（入れていない物は、今までどおり推定か「無し」で計算します）。</p>
              <p>値が入っている入力項目は、外せません（値を隠さないため）。値が入ると、外してあった入力項目もホームに出ます。</p>
              <p>「該当なし」（この世帯には無いと決めて、進み具合に数える）とは別です。外した入力項目は進み具合に数えません。</p>
              <p>標準／詳細は、その入力項目を開いたときの入れ方です。パネルの見出しの切り替えは、その場だけ変えます。</p>
              <p>新しく作る世帯は、事務所の既定（事務所の既定値の「新しい世帯で出す入力項目と、開いたときの入れ方」）で始まります。下の「この選び方を事務所の既定にする」で、この世帯の選び方をそのまま事務所の既定にできます（作った世帯は変わりません）。「事務所の既定にそろえる」は、この世帯を事務所の既定と同じ選び方にします（↶ で戻せます）。</p>
              <p>事務所の既定は、この PC の設定です。事務所の既定値の「既定に戻す」で、全部出す・全部「標準」で開く形に戻せます。</p>
            </Help>
            <button type="button" class="btn small" onClick={() => setOpen(false)} data-item-choose-close>
              閉じる
            </button>
          </div>
          <ol class="ih-choose-list">
            {items.map((i) => {
              const id = i.id as StageId;
              const locked = lockedReason(i);
              const lv = levelIn(c, id) ?? "simple";
              return (
                <li key={i.id} data-item-choice={i.id}>
                  <label class="ih-choose-show">
                    <input type="checkbox" checked={locked !== null || !isHiddenIn(c, id)} disabled={locked !== null} onChange={(e) => show(id, (e.currentTarget as HTMLInputElement).checked)} data-item-show={i.id} {...(locked !== null ? { title: locked } : {})} />
                    <span class="ih-choose-name">{i.label}</span>
                    {locked !== null && isHiddenIn(c, id) ? <small data-item-locked={i.id}>{locked}</small> : null}
                  </label>
                  <span class="level-switch mini" role="group" aria-label={`${i.label}を開いたときの入れ方`}>
                    <button type="button" class={lv === "simple" ? "on" : ""} aria-pressed={lv === "simple"} onClick={() => level(id, "simple")} data-item-level={`${i.id}:simple`}>
                      標準
                    </button>
                    <button type="button" class={lv === "detail" ? "on" : ""} aria-pressed={lv === "detail"} onClick={() => level(id, "detail")} data-item-level={`${i.id}:detail`}>
                      詳細
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
          {office !== undefined ? (
            <div class="ih-choose-office" data-item-choose-office={same ? "same" : "differ"}>
              <p class="ih-choose-state">{same ? "事務所の既定と同じです（新しく作る世帯は、この選び方で始まります）" : "事務所の既定と違います"}</p>
              {!same ? (
                <p class="ih-choose-acts">
                  <button type="button" class="btn small" disabled={busy} onClick={() => void toOffice()} data-item-choose-to-office>
                    この選び方を事務所の既定にする
                  </button>
                  <button type="button" class="link-btn" disabled={busy} onClick={fromOffice} data-item-choose-from-office>
                    事務所の既定にそろえる
                  </button>
                </p>
              ) : null}
              {msg !== null ? (
                <p class={msg.kind === "error" ? "fatal" : "rp-note"} role="status" data-item-choose-office-msg={msg.kind}>
                  {msg.kind === "saved" ? (
                    <>
                      事務所の既定にしました。これから作る世帯に写します（作った世帯は変わりません）。
                      <button type="button" class="link-btn" disabled={busy} onClick={() => void undo(msg.before)} data-item-choose-undo>
                        取り消す
                      </button>
                    </>
                  ) : msg.kind === "undone" ? (
                    "事務所の既定を前の選び方に戻しました"
                  ) : (
                    msg.text
                  )}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
