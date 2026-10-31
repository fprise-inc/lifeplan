// 対策（作業の層の部品。主画面のグラフの下）: 選んだ案にだけ効くスライダー。基準の案（と現状）を選んでいるときは動かせず、理由を出す。
// 各項目に基準の案の値を札（薄いグレーの実線の枠）で出す。どの項目を最初から出すかは事務所の既定値（plans/leverChoice.ts。0084）で、
// 最初から出さない対策の固定の項目も、足した・値が入っているときはこの形で出し、「外す」を付ける。「＋ 動かす項目を追加」「変更を取り消す」（保存していない変更を全部取り消す。1つずつ戻すのは上部の ↶）「上書き保存」「案として保存」（名前の欄はその場に開く。別の窓は出さない）。
// 動かしている間（input）は画面側の先出し、指を離したら（change・pointerup・keyup）正の計算（0005 の5）
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { LeverKey } from "./levers.ts";
import { AmountInput } from "./plans/ItemControls.tsx";
import type { ChangeRow } from "./plans/plans.ts";

/** 年齢: 1歳ずつのスライダー（値＝歳）。目盛りの数字は ticks だけ（値の位置に置く） */
export interface AgeSlider {
  kind: "age";
  min: number;
  max: number;
  value: number;
  /** 基準の案の値 */
  base: number;
  ticks: number[];
  stepText: (v: number) => string;
}

/** 金額: 1万円の刻みのスライダー（値＝円）と、横の数値の欄（万円） */
export interface AmountSlider {
  kind: "amount";
  min: number;
  max: number;
  step: number;
  value: number;
  base: number;
  /** 月額・年額の別（「月」「年」） */
  per: "月" | "年" | "";
  tick: (v: number) => string;
}

export interface LeverRow {
  key: LeverKey;
  label: string;
  slider: AgeSlider | AmountSlider;
  valueText: string;
  /** 基準の案の値 */
  baseText: string;
  note: string | null;
  /** 外せる（最初から出す項目でない。足した・値が入っているので出している） */
  removable?: boolean;
}

const changedOf = (l: LeverRow) => l.slider.value !== l.slider.base;

/** スライダーの値の位置（つまみの幅の分を除いた、線の上の割合） */
export const tickLeft = (v: number, min: number, max: number): string => {
  const f = max > min ? Math.max(0, Math.min(1, (v - min) / (max - min))) : 0;
  return `calc(var(--thumb, 16px) / 2 + (100% - var(--thumb, 16px)) * ${f.toFixed(4)})`;
};

/** FP顧問料の ON/OFF（選んだ案の側だけ。現状は変えない） */
export interface FeeToggle {
  on: boolean;
  /** 例: 「単発30万円＋年額12万円（2027年1月から）」 */
  note: string;
  /** 基準の案に入っているか */
  inBase: boolean;
  onToggle: () => void;
  /** 外す（最初から出す項目でないとき。最初から出すときは省略か null） */
  onRemove?: (() => void) | null;
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
  /** 動かした（値。目盛りのスライダーは目盛りの値、金額は円） */
  onSlide: (key: LeverKey, value: number) => void;
  /** 外せる項目を外す（動かした値は現状に戻す） */
  onRemove?: (key: LeverKey) => void;
  onRelease: () => void;
  onReset: () => void;
  /** 上書き保存（保存した案でないときは null） */
  onOverwrite: (() => void) | null;
  onSaveNew: (name: string) => void;
  /** 「案として保存」の名前の例 */
  suggested: string;
  changes: ChangeRow[];
  onAck: ((key: string) => void) | null;
  /** 「このプランを入力で開く」（入力の画面で、このプランの欄を直す。0036 の8）。現状のときは出さない */
  onOpenInput?: (() => void) | null;
  onDrop: ((key: string) => void) | null;
  /** 開いた直後に保存の欄を開く（画面の確かめ用） */
  initialSave?: boolean;
  /** 最初から出す項目のうち、対策の固定の項目でない物の行（固定の項目の後ろ、FP顧問料の前。0084） */
  fixedRows?: ComponentChildren;
  /** 足した動かす項目の行 */
  children?: ComponentChildren;
  /** 「＋ 動かす項目を追加」とその一覧 */
  addRow?: ComponentChildren;
  /** 対策の欄の中の小さな欄（取り崩しの計算。0026） */
  extra?: ComponentChildren;
}

export function LeverCard(p: LeverCardProps) {
  const [saving, setSaving] = useState(p.initialSave === true);
  const [name, setName] = useState(p.initialSave === true ? p.suggested : "");
  const [open, setOpen] = useState(false);
  const locked = p.locked !== null;
  const review = p.changes.filter((c) => c.state !== "ok");
  const baseTag = (t: string) => `基準（${p.baseLetter}）: ${t}`;
  return (
    <section class="card levers" aria-labelledby="h-lev" data-levers data-reveal-root>
      <div class="lv-head">
        <h2 id="h-lev">対策</h2>
        <span class="lv-who">
          {locked ? (
            <>{p.selected}を表示中</>
          ) : (
            <>
              <b>{p.selected}</b>に効きます。基準のプラン{p.baseLetter}は動きません
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
        {p.onOpenInput != null ? (
          <button type="button" class="link-btn" onClick={() => p.onOpenInput?.()} title="入力の画面で、このプランの欄を直します（物を足す・外す・選び直すもできます）" data-plan-open-input>
            このプランを入力で開く
          </button>
        ) : null}
        <span class="lv-gap" />
        <button type="button" class="btn" disabled={!p.modified} onClick={p.onReset} title="保存していない変更を全部取り消し、保存した状態に戻します（1つずつ戻すのは上部の ↶）" data-plan-reset>
          変更を取り消す
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
          プランとして保存
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
              {c.inherited ? <span class="pb-tag">元のプランから</span> : null}
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
            新しいプランの名前
            <input type="text" value={name} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
          </label>
          <span class="sf-note">元の{p.selected}は保存した内容のまま残します</span>
          <button type="submit" class="btn primary">
            保存
          </button>
          <button type="button" class="btn" onClick={() => setSaving(false)}>
            キャンセル
          </button>
        </form>
      ) : null}
      {locked ? (
        <p class="lv-lock" data-lever-lock>
          {p.locked}
        </p>
      ) : null}
      <fieldset class="lv-grid" disabled={locked}>
        {p.levers.map((l) => {
          const sl = l.slider;
          return (
            <div class={`lever${changedOf(l) ? " changed" : ""}`} key={l.key} data-lever-kind={sl.kind} data-lever-row={l.key} data-reveal-item>
              <div class="lever-head">
                <label for={`lv-${l.key}`}>{l.label}</label>
                {sl.kind === "amount" ? (
                  <AmountInput
                    value={sl.value}
                    per={sl.per}
                    label={l.label}
                    onCommit={(v) => {
                      p.onSlide(l.key, v);
                      p.onRelease();
                    }}
                  />
                ) : (
                  <span class="lever-val">{l.valueText}</span>
                )}
              </div>
              {sl.kind === "age" ? (
                <>
                  <input
                    id={`lv-${l.key}`}
                    type="range"
                    min={sl.min}
                    max={sl.max}
                    step={1}
                    value={sl.value}
                    // 動かせる幅が無い（もう年金を受け取り始めている人の受け取り開始）ときは押せない形にする
                    disabled={sl.min >= sl.max}
                    data-lever={l.key}
                    aria-valuetext={l.valueText}
                    onInput={(e) => p.onSlide(l.key, Number((e.currentTarget as HTMLInputElement).value))}
                    onChange={p.onRelease}
                    onPointerUp={p.onRelease}
                    onKeyUp={p.onRelease}
                  />
                  <div class="ticks age-ticks">
                    {sl.base >= sl.min && sl.base <= sl.max ? <i class="age-base" style={{ left: tickLeft(sl.base, sl.min, sl.max) }} aria-hidden="true" /> : null}
                    {sl.ticks.map((v) => (
                      <button
                        type="button"
                        key={v}
                        tabIndex={-1}
                        class={`tick${v === sl.value ? " is-on" : ""}${v === sl.base ? " is-base" : ""}`}
                        style={{ left: tickLeft(v, sl.min, sl.max) }}
                        onClick={() => {
                          p.onSlide(l.key, v);
                          p.onRelease();
                        }}
                      >
                        {sl.stepText(v)}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <input
                    id={`lv-${l.key}`}
                    type="range"
                    min={sl.min}
                    max={sl.max}
                    step={sl.step}
                    value={sl.value}
                    data-lever={l.key}
                    aria-valuetext={l.valueText}
                    onInput={(e) => p.onSlide(l.key, Number((e.currentTarget as HTMLInputElement).value))}
                    onChange={p.onRelease}
                    onPointerUp={p.onRelease}
                    onKeyUp={p.onRelease}
                  />
                  <div class="range-scale">
                    <span>{sl.tick(sl.min)}</span>
                    <span class="amt-step">1万円ずつ</span>
                    <span>{sl.tick(sl.max)}</span>
                  </div>
                </>
              )}
              <div class="lever-note">
                {l.note !== null ? <span>{l.note}</span> : <span />}
                <span class="base-tag">{baseTag(l.baseText)}</span>
                {l.removable === true && p.onRemove !== undefined ? (
                  <button type="button" class="link-btn" onClick={() => p.onRemove?.(l.key)} title="この項目を対策から外す（動かした値は現状に戻す）" data-lever-remove={l.key}>
                    外す
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
        {p.fixedRows ?? null}
        {p.fee !== null ? (
          <div class={`lever toggle${p.fee.on !== p.fee.inBase ? " changed" : ""}`} data-lever-row="fee" data-reveal-item>
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
              {p.fee.onRemove != null ? (
                <button type="button" class="link-btn" onClick={() => p.fee?.onRemove?.()} title="この項目を対策から外す（入れる・入れないは現状に戻す）" data-lever-remove="fee">
                  外す
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {p.children}
      </fieldset>
      {!locked ? p.addRow : null}
      {p.extra ?? null}
    </section>
  );
}
