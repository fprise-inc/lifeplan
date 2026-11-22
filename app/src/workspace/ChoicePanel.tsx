// 消える前に選ばせる中央のパネル: 保存できていない・保存していない変更があるのに、それが消える操作をしようとしたとき。
// 黙って捨てずに、何が無くなるかを書いて、残す道・捨てて進む・やめる を選ばせる（右上の × と Esc はやめる）。
// 世帯を離れる前の確かめ（store/LeaveDialog.tsx）と、プランの帯から外す前の確かめで同じ形にする
import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { CloseX, useEscClose } from "../presentation/CloseX.tsx";

export interface Choice<K extends string> {
  key: K;
  label: string;
  note: string;
  primary?: boolean;
}

export interface ChoicePanelProps<K extends string> {
  /** data-* の名前（画面の確かめ用） */
  name: string;
  title: string;
  children: ComponentChildren;
  choices: readonly Choice<K>[];
  /** Esc で選ぶもの（やめる） */
  cancel: K;
  busy?: boolean;
  /** 押せないときのボタンの名前（保存しています… など） */
  busyLabel?: Partial<Record<K, string>>;
  onChoose: (k: K) => void;
}

export function ChoicePanel<K extends string>(p: ChoicePanelProps<K>) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => panel.current?.focus({ preventScroll: true }), []);
  const busy = p.busy === true;
  // × と Esc は「やめる」と同じ（保存している間は閉じない）
  const cancel = () => p.onChoose(p.cancel);
  useEscClose(busy ? null : cancel);
  return (
    <>
      <div class="scrim" aria-hidden="true" />
      <div
        ref={panel}
        class="rk-panel fork-panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${p.name}-title`}
        tabIndex={-1}
        data-choice-panel={p.name}
      >
        <CloseX onClose={cancel} disabled={busy} />
        <h2 id={`${p.name}-title`}>{p.title}</h2>
        {p.children}
        <div class="fork-choices">
          {p.choices.map((c) => (
            <button key={c.key} type="button" class={c.primary === true ? "btn primary" : "btn"} disabled={busy} onClick={() => p.onChoose(c.key)} data-choice={c.key}>
              <b>{busy ? (p.busyLabel?.[c.key] ?? c.label) : c.label}</b>
              <span>{c.note}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
