// 対策（作業の層の部品。主画面のグラフの下）: 選んだ案にだけ効くスライダー。基準の案（と現状）を選んでいるときは動かせず、理由を出す。
// 各項目に基準の案の値を点線の札で出す。「＋ 動かす項目を追加」「元に戻す」「上書き保存」「案として保存」（名前の欄はその場に開く。別の窓は出さない）。
// 動かしている間（input）は画面側の先出し、指を離したら（change・pointerup・keyup）正の計算（0005 の5）
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { LeverKey } from "./levers.ts";
import type { ChangeRow } from "./plans/plans.ts";

export interface LeverRow {
  key: LeverKey;
  label: string;
  steps: number[];
  index: number;
  /** 基準の案の値の位置 */
  baseIndex: number;
  valueText: string;
  stepText: (v: number) => string;
  /** 基準の案の値 */
  baseText: string;
  note: string | null;
}

/** FP顧問料の ON/OFF（選んだ案の側だけ。現状は変えない） */
export interface FeeToggle {
  on: boolean;
  /** 例: 「単発30万円＋年額12万円（2027年1月から）」 */
  note: string;
  /** 基準の案に入っているか */
  inBase: boolean;
  onToggle: () => void;
}

export interface LeverCardProps {
  /** 例: 「B案」 */
  selected: string;
  /** 基準の案の文字（例: 「A」） */
  baseLetter: string;
  /** 動かせないときの理由（動かせるときは null） */
  locked: string | null;
  modified: boolean;
  levers: LeverRow[];
  fee: FeeToggle | null;
  onSlide: (key: LeverKey, index: number) => void;
  onRelease: () => void;
  onReset: () => void;
  /** 上書き保存（保存した案でないときは null） */
  onOverwrite: (() => void) | null;
  onSaveNew: (name: string) => void;
  /** 「案として保存」の名前の例 */
  suggested: string;
  changes: ChangeRow[];
  onAck: ((key: string) => void) | null;
  onDrop: ((key: string) => void) | null;
  /** 開いた直後に保存の欄を開く（画面の確かめ用） */
  initialSave?: boolean;
  /** 足した動かす項目の行 */
  children?: ComponentChildren;
  /** 「＋ 動かす項目を追加」とその一覧 */
  addRow?: ComponentChildren;
}

export function LeverCard(p: LeverCardProps) {
  const [saving, setSaving] = useState(p.initialSave === true);
  const [name, setName] = useState(p.initialSave === true ? p.suggested : "");
  const [open, setOpen] = useState(false);
  const locked = p.locked !== null;
  const review = p.changes.filter((c) => c.state !== "ok");
  const baseTag = (t: string) => `基準（${p.baseLetter}）: ${t}`;
  return (
    <section class="card levers" aria-labelledby="h-lev" data-levers>
      <div class="lv-head">
        <h2 id="h-lev">対策</h2>
        <span class="lv-who">
          {locked ? (
            <>{p.selected}を表示中</>
          ) : (
            <>
              <b>{p.selected}</b>に効きます。基準の{p.baseLetter}案は動きません
            </>
          )}
        </span>
        {p.modified ? <span class="lv-mod">変更あり（保存していない）</span> : null}
        {!locked ? (
          <button type="button" class="pb-changes" aria-expanded={open} onClick={() => setOpen(!open)} data-plan-changes>
            変えたこと <b>{p.changes.length}</b>件 {open ? "▴" : "▾"}
          </button>
        ) : null}
        {review.length > 0 ? (
          <button type="button" class="pb-review" onClick={() => setOpen(true)} data-plan-review>
            ! 要確認 {review.length}
          </button>
        ) : null}
        <span class="lv-gap" />
        <button type="button" class="btn" disabled={!p.modified} onClick={p.onReset} data-plan-reset>
          元に戻す
        </button>
        <button type="button" class="btn" disabled={!p.modified || p.onOverwrite === null} onClick={() => p.onOverwrite?.()} data-plan-overwrite>
          上書き保存
        </button>
        <button
          type="button"
          class="btn primary"
          disabled={!p.modified || locked}
          onClick={() => {
            setName(p.suggested);
            setSaving(true);
          }}
          data-plan-save
        >
          案として保存
        </button>
      </div>
      {open ? (
        <ul class="pb-list" aria-label="変えたこと">
          {p.changes.length === 0 ? <li class="in-note">現状から変えたことはありません（スライダーを動かすと、ここに並びます）</li> : null}
          {p.changes.map((c) => (
            <li key={c.key} class={c.state !== "ok" ? "review" : ""}>
              <span class="pb-l">{c.label}</span>
              <span class="pb-v">
                {c.from} → <b>{c.to}</b>
              </span>
              {c.inherited ? <span class="pb-tag">元の案から</span> : null}
              {c.reviewNote !== null ? (
                <span class="pb-note">
                  <b>要確認:</b> {c.reviewNote}
                  {c.state === "changed" && p.onAck !== null ? (
                    <button type="button" class="link-btn" onClick={() => p.onAck?.(c.key)}>
                      確認した（このまま）
                    </button>
                  ) : null}
                  {p.onDrop !== null ? (
                    <button type="button" class="link-btn danger" onClick={() => p.onDrop?.(c.key)}>
                      この差分を外す
                    </button>
                  ) : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {saving && !locked ? (
        <form
          class="save-form"
          onSubmit={(e) => {
            e.preventDefault();
            setSaving(false);
            p.onSaveNew(name);
          }}
          data-plan-save-form
        >
          <label>
            新しい案の名前
            <input type="text" value={name} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
          </label>
          <span class="sf-note">元の{p.selected}は保存した内容のまま残します</span>
          <button type="submit" class="btn primary">
            保存
          </button>
          <button type="button" class="btn" onClick={() => setSaving(false)}>
            やめる
          </button>
        </form>
      ) : null}
      {locked ? (
        <p class="lv-lock" data-lever-lock>
          {p.locked}
        </p>
      ) : null}
      <fieldset class="lv-grid" disabled={locked}>
        {p.levers.map((l) => (
          <div class={`lever${l.index !== l.baseIndex ? " changed" : ""}`} key={l.key}>
            <div class="lever-head">
              <label for={`lv-${l.key}`}>{l.label}</label>
              <span class="lever-val">{l.valueText}</span>
            </div>
            <input
              id={`lv-${l.key}`}
              type="range"
              min={0}
              max={l.steps.length - 1}
              step={1}
              value={l.index}
              data-lever={l.key}
              aria-valuetext={l.valueText}
              onInput={(e) => p.onSlide(l.key, Number((e.currentTarget as HTMLInputElement).value))}
              onChange={p.onRelease}
              onPointerUp={p.onRelease}
              onKeyUp={p.onRelease}
            />
            <div class="ticks">
              {l.steps.map((v, i) => (
                <button
                  type="button"
                  key={v}
                  tabIndex={-1}
                  class={`tick${i === l.index ? " is-on" : ""}${i === l.baseIndex ? " is-base" : ""}`}
                  onClick={() => {
                    p.onSlide(l.key, i);
                    p.onRelease();
                  }}
                >
                  {l.stepText(v)}
                </button>
              ))}
            </div>
            <div class="lever-note">
              {l.note !== null ? <span>{l.note}</span> : <span />}
              <span class="base-tag">{baseTag(l.baseText)}</span>
            </div>
          </div>
        ))}
        {p.fee !== null ? (
          <div class={`lever toggle${p.fee.on !== p.fee.inBase ? " changed" : ""}`}>
            <div class="lever-head">
              <span class="lever-label">FP顧問料</span>
              <span class="lever-val">{p.fee.on ? "入れる" : "入れない"}</span>
            </div>
            <span class="tg" role="group" aria-label="FP顧問料">
              <button type="button" aria-pressed={!p.fee.on} onClick={() => p.fee !== null && p.fee.on && p.fee.onToggle()} data-fee-toggle="off">
                入れない
              </button>
              <button type="button" aria-pressed={p.fee.on} onClick={() => p.fee !== null && !p.fee.on && p.fee.onToggle()} data-fee-toggle="on">
                入れる
              </button>
            </span>
            <div class="lever-note">
              <span>{p.fee.note}</span>
              <span class="base-tag">{baseTag(p.fee.inBase ? "入れる" : "入れない")}</span>
            </div>
          </div>
        ) : null}
        {p.children}
      </fieldset>
      {!locked ? p.addRow : null}
    </section>
  );
}
