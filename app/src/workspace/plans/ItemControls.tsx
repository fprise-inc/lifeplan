// 動かす項目の部品（作業の層）: 「＋ 動かす項目を追加」のメニューと、足した項目のスライダー・数値の欄。
// 動かしている間（input）は画面側の先出し、指を離したら（change・pointerup・keyup）正の計算（0005 の5）。
// 値は案（作業中の案）にだけ入り、入力（現状）は変えない
import { useMemo, useState } from "preact/hooks";
import { Field } from "../input/FieldViews.tsx";
import type { WorkingHousehold } from "../input/household.ts";
import { shiftDecimal } from "../input/units.ts";
import { BUCKETS, bucketShares, mixFromBuckets, type MixPart } from "./allocation.ts";
import { pctText } from "./decimal.ts";
import type { Catalog, ItemValue, MovableItem, RateShift } from "./items.ts";

/** 率の文字列 ⇔ 10万分の1の整数（スライダーの位置） */
const RATE_UNIT = 5;
const rateToInt = (r: string) => Math.round(Number(shiftDecimal(r, RATE_UNIT)));
const intToRate = (n: number) => shiftDecimal(String(n), -RATE_UNIT);

export function ItemMenu({ catalog, shown, onPick, onClose }: { catalog: Catalog; shown: ReadonlySet<string>; onPick: (key: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const m = new Map<string, MovableItem[]>();
    for (const it of catalog.items) {
      if (it.builtin) continue;
      if (q !== "" && !it.label.includes(q) && !it.group.includes(q)) continue;
      const g = m.get(it.group) ?? [];
      g.push(it);
      m.set(it.group, g);
    }
    return [...m.entries()];
  }, [catalog, q]);
  return (
    <div class="item-menu" role="group" aria-label="動かす項目を選ぶ" data-item-menu>
      <div class="item-menu-h">
        <b>動かす項目を選ぶ</b>
        <button type="button" class="link-btn" onClick={onClose}>
          閉じる
        </button>
      </div>
      <input type="search" class="item-q" placeholder="項目の名前で探す（例: 金利・年収）" value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} aria-label="項目の名前で探す" />
      <div class="item-menu-list">
        {groups.length === 0 ? <p class="in-note">当てはまる項目がありません</p> : null}
        {groups.map(([g, items]) => (
          <section key={g}>
            <h4>{g === "よく使う" ? "よく使う項目" : `入力: ${g}`}</h4>
            {items.map((it) => (
              <button type="button" key={it.key} disabled={shown.has(it.key)} onClick={() => onPick(it.key)} data-pick={it.key}>
                {it.label}
                {shown.has(it.key) ? <small>（出しています）</small> : null}
              </button>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

export interface ItemRowProps {
  item: MovableItem;
  value: ItemValue;
  /** 現状の値 */
  base: ItemValue;
  /** 現状の世帯（数値の欄の読み書きに使う） */
  wh: WorkingHousehold;
  /** 動かした（先出し） */
  onSlide: (key: string, v: ItemValue) => void;
  /** 指を離した・欄を確定した（正の計算） */
  onRelease: () => void;
  onRemove: (key: string) => void;
}

function RangeRow({ item, value, base, onSlide, onRelease }: ItemRowProps & { item: MovableItem & { control: { kind: "range" } } }) {
  const c = item.control;
  const v = typeof value === "number" ? value : c.min;
  const b = typeof base === "number" ? base : c.min;
  return (
    <>
      <input
        type="range"
        min={c.min}
        max={c.max}
        step={c.step}
        value={v}
        data-item={item.key}
        aria-label={item.label}
        aria-valuetext={item.text(v)}
        onInput={(e) => onSlide(item.key, Number((e.currentTarget as HTMLInputElement).value))}
        onChange={onRelease}
        onPointerUp={onRelease}
        onKeyUp={onRelease}
      />
      <div class="range-scale">
        <span>{c.tick(c.min)}</span>
        <span class="base-mark">現状 {item.text(b)}</span>
        <span>{c.tick(c.max)}</span>
      </div>
    </>
  );
}

function RateRow({ item, value, base, onSlide, onRelease }: ItemRowProps & { item: MovableItem & { control: { kind: "rate" } } }) {
  const c = item.control;
  const min = rateToInt(c.min);
  const max = rateToInt(c.max);
  const step = rateToInt(c.step);
  const v = typeof value === "string" ? rateToInt(value) : min;
  const b = typeof base === "string" ? base : c.min;
  return (
    <>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        data-item={item.key}
        aria-label={item.label}
        aria-valuetext={item.text(intToRate(v))}
        onInput={(e) => onSlide(item.key, intToRate(Number((e.currentTarget as HTMLInputElement).value)))}
        onChange={onRelease}
        onPointerUp={onRelease}
        onKeyUp={onRelease}
      />
      <div class="range-scale">
        <span>{pctText(c.min)}</span>
        <span class="base-mark">現状 {pctText(b)}</span>
        <span>{pctText(c.max)}</span>
      </div>
    </>
  );
}

function MixRow({ item, value, onSlide, onRelease }: ItemRowProps & { item: MovableItem & { control: { kind: "mix" } } }) {
  const mix = Array.isArray(value) ? (value as MixPart[]) : null;
  const sh = bucketShares(mix ?? undefined, item.control.accountKind);
  const room = 100 - sh.other;
  const set = (eq: number, bond: number) => onSlide(item.key, mixFromBuckets(mix ?? undefined, eq, bond));
  const row = (key: "equity" | "bond") => {
    const label = BUCKETS.find((x) => x.key === key)?.label ?? key;
    const cur = sh[key];
    const max = key === "equity" ? room : room - sh.equity;
    return (
      <label class="mix-row" key={key}>
        <span class="mix-l">{label}</span>
        <input
          type="range"
          min={0}
          max={Math.max(0, max)}
          step={10}
          value={cur}
          data-item={`${item.key}:${key}`}
          aria-valuetext={`${label}${cur}%`}
          onInput={(e) => {
            const n = Number((e.currentTarget as HTMLInputElement).value);
            if (key === "equity") set(n, Math.min(sh.bond, room - n));
            else set(sh.equity, n);
          }}
          onChange={onRelease}
          onPointerUp={onRelease}
          onKeyUp={onRelease}
        />
        <span class="mix-v">{cur}%</span>
      </label>
    );
  };
  return (
    <div class="mix">
      {row("equity")}
      {row("bond")}
      <div class="mix-row ro">
        <span class="mix-l">預金</span>
        <span class="mix-rest">{sh.cash}%（残り）</span>
        {sh.other > 0 ? <span class="mix-rest">その他 {sh.other}%（今の配分のまま）</span> : null}
      </div>
    </div>
  );
}

function ShiftRow({ item, value, onSlide, onRelease }: ItemRowProps & { item: MovableItem & { control: { kind: "shift" } } }) {
  const s = (value as RateShift | null) ?? { add: "0", from: `${item.control.years[2] ?? 2030}-01` };
  const add = Math.round(Number(shiftDecimal(s.add, 4)));

  return (
    <div class="shift">
      <input
        type="range"
        min={0}
        max={300}
        step={25}
        value={add}
        data-item={item.key}
        aria-label="上乗せの幅"
        aria-valuetext={item.text(s)}
        onInput={(e) => onSlide(item.key, { ...s, add: shiftDecimal(String(Number((e.currentTarget as HTMLInputElement).value)), -4) })}
        onChange={onRelease}
        onPointerUp={onRelease}
        onKeyUp={onRelease}
      />
      <div class="range-scale">
        <span>0%</span>
        <span class="base-mark">現状: 上がらない</span>
        <span>+3%</span>
      </div>
      <label class="shift-from">
        上がり始める年
        <select value={s.from.slice(0, 4)} onChange={(e) => {
            onSlide(item.key, { ...s, from: `${(e.currentTarget as HTMLSelectElement).value}-01` });
            onRelease();
          }}>
          {item.control.years.map((y) => (
            <option key={y} value={String(y)}>
              {y}年
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** 足した項目の1行（スライダーか数値の欄） */
export function ItemRow(props: ItemRowProps) {
  const { item, value, base, wh, onSlide, onRelease, onRemove } = props;
  const changed = !item.same(value, base);
  const c = item.control;
  let control;
  if (c.kind === "range") control = <RangeRow {...props} item={item as MovableItem & { control: typeof c }} />;
  else if (c.kind === "rate") control = <RateRow {...props} item={item as MovableItem & { control: typeof c }} />;
  else if (c.kind === "mix") control = <MixRow {...props} item={item as MovableItem & { control: typeof c }} />;
  else if (c.kind === "shift") control = <ShiftRow {...props} item={item as MovableItem & { control: typeof c }} />;
  else if (c.kind === "field") {
    // 入力の欄と同じ部品で、案の値を見せる（書いた値は案にだけ入る）
    const view = changed ? item.apply(wh, value) : wh;
    control = <Field f={c.field} wh={view} onEdit={(w) => {
          onSlide(item.key, c.field.get(w).value as ItemValue);
          onRelease();
        }} />;
  } else control = null;
  const note = item.note?.(value) ?? null;
  return (
    <div class={`lever added${changed ? " changed" : ""}`} data-added={item.key}>
      <div class="lever-head">
        <span class="lever-label">{item.label}</span>
        <button type="button" class="link-btn" onClick={() => onRemove(item.key)} title="この項目を対策から外す（動かした値は現状に戻す）">
          外す
        </button>
      </div>
      {c.kind !== "field" ? <div class="lever-val added-val">{item.text(value)}</div> : null}
      {control}
      <div class="lever-note">
        {note !== null ? <span>{note}</span> : <span />}
        <span class="base-tag">現状: {item.text(base)}</span>
      </div>
    </div>
  );
}
