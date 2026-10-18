// 入力のパネル（作業の層の部品）: カードを押すと画面の中央に開き、背景を暗くする（別の窓は出さない）。
// 中身は今までの入力の欄（簡易と詳細の切り替えを含む）。値は下書きに入れ、「保存」で世帯に入れる。× と Esc で閉じる（保存していない変更があれば先に知らせる）
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Level } from "./form.ts";
import { Section, visible } from "./FieldViews.tsx";
import { withRefreshedEstimates } from "./estimates.ts";
import type { WorkingHousehold } from "./household.ts";
import { ILLUSTRATIONS } from "./illustrations.ts";
import { inputItems, itemStage, saveItem } from "./items.ts";
import { StatusBadge } from "./StatusBadge.tsx";
import { historyScope, undoController, useUndoScope } from "../undo/controller.ts";
import { deepEqual, UndoHistory } from "../undo/history.ts";

export interface InputPanelProps {
  /** 保存されている世帯（下書きの始まり） */
  wh: WorkingHousehold;
  itemId: string;
  /** 項目を足したとき: 足した物を入れた下書き（保存するまで世帯には入れない） */
  initialDraft?: WorkingHousehold;
  level: Level;
  onLevel: (l: Level) => void;
  onSave: (next: WorkingHousehold, itemId: string) => void;
  onClose: () => void;
}

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function InputPanel({ wh, itemId, initialDraft, level, onLevel, onSave, onClose }: InputPanelProps) {
  const [draft, setDraft] = useState<WorkingHousehold>(initialDraft ?? wh);
  const [dirty, setDirty] = useState(initialDraft !== undefined);
  const [leaving, setLeaving] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const item = useMemo(() => inputItems(draft).find((i) => i.id === itemId) ?? null, [draft, itemId]);
  const stage = useMemo(() => itemStage(draft, itemId), [draft, itemId]);
  const adding = initialDraft !== undefined;

  // 元に戻す・やり直す: 開いている間は、このパネルの下書きの履歴を使う（裏の世帯は戻さない）
  const history = useRef<UndoHistory<WorkingHousehold> | null>(null);
  if (history.current === null) history.current = new UndoHistory<WorkingHousehold>({ same: deepEqual });
  const latest = useRef(draft);
  latest.current = draft;
  const edit = (next: WorkingHousehold) => {
    const cur = latest.current;
    if (next === cur) return;
    const n = withRefreshedEstimates(next);
    if (history.current !== null) undoController.record(history.current, cur, n, (h) => h.control ?? item?.label ?? "入力");
    latest.current = n;
    setDraft(n);
    setDirty(true);
    setLeaving(false);
  };
  useUndoScope(
    historyScope(
      1,
      () => history.current,
      (s) => {
        latest.current = s;
        setDraft(s);
        setDirty(true);
        setLeaving(false);
      },
    ),
  );
  const tryClose = () => {
    if (dirty && !leaving) {
      setLeaving(true);
      return;
    }
    onClose();
  };
  const save = () => onSave(saveItem(draft, itemId), itemId);

  // 開いた直後: 最初の欄（無ければ閉じるボタン）に移る。背景はスクロールさせない
  useEffect(() => {
    const el = panel.current;
    const first = el?.querySelector<HTMLElement>(".ip-body input, .ip-body select") ?? el?.querySelector<HTMLElement>(".ip-body button:not(.danger)") ?? el?.querySelector<HTMLElement>(".x-btn");
    first?.focus({ preventScroll: true });
    document.documentElement.classList.add("panel-open");
    return () => document.documentElement.classList.remove("panel-open");
  }, []);

  // Esc で閉じる（変更があれば先に知らせ、もう一度で閉じる）
  const closeRef = useRef(tryClose);
  closeRef.current = tryClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // 知らせが出たら、その中のボタンに移る
  useEffect(() => {
    if (leaving) panel.current?.querySelector<HTMLElement>("[data-discard]")?.focus();
  }, [leaving]);

  if (item === null || stage === null) return null;
  const sections = stage.sections.filter((s) => visible(level, s.level));
  const removed = item.added !== null && item.summary === null;
  const note = leaving
    ? null
    : removed
      ? "保存すると、このカードがなくなります。"
      : item.estimated > 0
        ? `推定・仮の値のままの欄が ${item.estimated}つ あります。保存しても、推定の欄が残る間はカードは「推定あり」のままです。`
        : adding
          ? "保存すると、カードが足されます（取り消すと足しません）。"
          : "保存すると、このカードは「入力済み」になります。";

  return (
    <>
      <div class="scrim" onClick={tryClose} aria-hidden="true" />
      <div
        ref={panel}
        class="ipanel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ip-title"
        style={{ "--c": item.color }}
        onKeyDown={(e) => {
          if (e.key !== "Tab" || panel.current === null) return;
          const els = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
          const first = els[0];
          const last = els.at(-1);
          if (first === undefined || last === undefined) return;
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <div class="ip-band" aria-hidden="true" />
        <div class="ip-head">
          <div class="ip-thumb" aria-hidden="true">
            <img src={ILLUSTRATIONS[item.art]} alt="" />
          </div>
          <h2 id="ip-title">
            {item.label}
            {item.added !== null ? <span class="fp-tag">FPが追加</span> : null}
            <StatusBadge item={item} />
          </h2>
          <div class="ip-tools">
            <div class="level-switch" role="group" aria-label="入力の細かさ">
              <button type="button" class={level === "simple" ? "on" : ""} aria-pressed={level === "simple"} onClick={() => onLevel("simple")}>
                簡易
              </button>
              <button type="button" class={level === "detail" ? "on" : ""} aria-pressed={level === "detail"} onClick={() => onLevel("detail")}>
                詳細
              </button>
            </div>
            <button type="button" class="x-btn" aria-label="閉じる（Esc）" title="閉じる（Esc）" onClick={tryClose}>
              ×
            </button>
          </div>
          <p class="ip-lead">{item.lead}空欄は統計の目安などで補って計算します（「推定」の印）。</p>
        </div>
        <div class="ip-body">
          {sections.map((s) => (
            <Section key={s.key} section={s} wh={draft} level={level} onEdit={edit} />
          ))}
          {sections.length === 0 ? <p class="in-note">この項目の欄は「詳細」で出ます。</p> : null}
        </div>
        <div class="ip-foot" role={leaving ? "alert" : undefined}>
          {leaving ? (
            <>
              <p class="ip-note warn">保存していない変更があります。閉じると、この変更は消えます。</p>
              <button type="button" class="btn" onClick={() => setLeaving(false)}>
                入力に戻る
              </button>
              <button type="button" class="btn danger" onClick={onClose} data-discard>
                変更を捨てて閉じる
              </button>
            </>
          ) : (
            <>
              <p class="ip-note" data-panel-note>
                {note}
              </p>
              <button type="button" class="btn" onClick={onClose}>
                取り消し
              </button>
              <button type="button" class="btn primary" onClick={save} data-save>
                保存
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
