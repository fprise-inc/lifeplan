// 動かす項目の部品（作業の層）: 「＋ 動かす項目を追加」のメニューと、足した項目のスライダー・数値の欄。
// 動かしている間（input）は画面側の先出し、指を離したら（change・pointerup・keyup）正の計算（0005 の5）。
// 値は案（作業中の案）にだけ入り、入力（現状）は変えない
import { useMemo, useState } from "preact/hooks";
import { Field } from "../input/FieldViews.tsx";
import { revealAdded } from "../../presentation/revealAdded.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { normalizeNumberText, shiftDecimal } from "../input/units.ts";
import { BUCKETS, bucketShares, mixFromBuckets, type MixPart } from "./allocation.ts";
import { pctText } from "./decimal.ts";
import { ageSliderBounds, AMOUNT_STEP, type Catalog, type ItemValue, type MovableItem, type RateShift, type WorkValue } from "./items.ts";

// ---- 金額の数値の欄（スライダーの横。万円で直接入れる。1万円単位に丸める）----

/** 万円の文字（全角・カンマも可）→ 円（1万円単位に丸める）。読めない・マイナスは null */
export function parseManInput(text: string): number | null {
  const t = normalizeNumberText(text);
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Math.round(Number(t)) * AMOUNT_STEP;
}

/** 円 → 欄に出す万円の文字（1万円の倍数でないときは小数1桁まで） */
export function manInputText(yen: number): string {
  const m = yen / AMOUNT_STEP;
  return Number.isInteger(m) ? String(m) : String(Math.round(m * 10) / 10);
}

/** スライダーの横の数値の欄。打って Enter か欄を離れたら確定（正の計算）。per は「月」「年」 */
export function AmountInput({ value, onCommit, label, per, id }: { value: number; onCommit: (yen: number) => void; label: string; per: "月" | "年" | ""; id?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  /** 使えない文字のまま離れたときの知らせ（前の値のままにしたこと） */
  const [rejected, setRejected] = useState<string | null>(null);
  const shown = manInputText(value);
  const bad = draft !== null && parseManInput(draft) === null;
  const reason = (t: string) => (/^-/.test(normalizeNumberText(t)) ? "マイナスの額は入れられません" : "0 以上の数字（万円）で入れてください");
  const problem = bad ? reason(draft) : rejected;
  const commit = (t: string) => {
    const v = parseManInput(t);
    setDraft(null);
    if (v === null) setRejected(`「${t}」は入れられないため、前の値のままです。${reason(t)}`);
    if (v !== null && v !== value) onCommit(v);
  };
  return (
    <span class="amt-in">
      {per !== "" ? <span class="amt-per">{per}</span> : null}
      <input
        type="text"
        inputMode="numeric"
        class={`num${bad ? " bad" : ""}`}
        id={id}
        value={draft ?? shown}
        aria-label={`${label}（万円で入れる。1万円単位）`}
        aria-invalid={bad ? true : undefined}
        data-amount-input
        onFocus={() => setDraft(shown)}
        onInput={(e) => {
          setDraft((e.currentTarget as HTMLInputElement).value);
          setRejected(null);
        }}
        onBlur={(e) => commit((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          else if (e.key === "Escape") {
            setDraft(null);
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
      />
      <span class="amt-u">万円</span>
      {problem !== null ? (
        <span class="amt-bad" role="alert" data-amount-problem>
          {problem}
        </span>
      ) : null}
    </span>
  );
}

/** 率の文字列 ⇔ 10万分の1の整数（スライダーの位置） */
const RATE_UNIT = 5;
const rateToInt = (r: string) => Math.round(Number(shiftDecimal(r, RATE_UNIT)));
const intToRate = (n: number) => shiftDecimal(String(n), -RATE_UNIT);

/**
 * 「＋ 動かす項目を追加」の一覧。fixed は対策に最初から出す項目（事務所の既定値。plans/leverChoice.ts）で、一覧に出さない。
 * 最初から出さない対策の固定の項目（事務所が外した物）は、見出し「対策」で一覧に出す
 */
export function ItemMenu({ catalog, shown, fixed, onPick, onClose }: { catalog: Catalog; shown: ReadonlySet<string>; fixed: ReadonlySet<string>; onPick: (key: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const m = new Map<string, MovableItem[]>();
    for (const it of catalog.items) {
      if (fixed.has(it.key)) continue;
      if (q !== "" && !it.label.includes(q) && !it.group.includes(q)) continue;
      const g = m.get(it.group) ?? [];
      g.push(it);
      m.set(it.group, g);
    }
    return [...m.entries()];
  }, [catalog, fixed, q]);
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
        {groups.length === 0 ? <p class="in-note">該当する項目がありません</p> : null}
        {groups.map(([g, items]) => (
          <section key={g}>
            <h4>{g === "よく使う" ? "よく使う項目" : g === "対策" || g === "資産運用" || g === "貯まり方" ? g : `入力: ${g}`}</h4>
            {items.map((it) => (
              <button
                type="button"
                key={it.key}
                disabled={shown.has(it.key)}
                onClick={(e) => {
                  // 足した項目を見える所へ動かして光らせ、最初の欄に移る
                  revealAdded(e.currentTarget);
                  onPick(it.key);
                }}
                data-pick={it.key}
              >
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
  /** 外す（対策に最初から出す項目は外せないので null） */
  onRemove: ((key: string) => void) | null;
  /** 基準の値の札の見出し（例: 「基準（A）」）。省略は「現状」 */
  baseLabel?: string;
}

function RangeRow({ item, value, base, onSlide, onRelease, baseLabel = "現状" }: ItemRowProps & { item: MovableItem & { control: { kind: "range" } } }) {
  const c = item.control;
  const v = typeof value === "number" ? value : c.min;
  const b = typeof base === "number" ? base : c.min;
  // 直接入れた値が範囲の外でも、スライダーの範囲を広げて合わせる（刻みは1万円のまま）
  const min = Math.min(c.min, Math.floor(v / c.step) * c.step);
  const max = Math.max(c.max, Math.ceil(v / c.step) * c.step);
  return (
    <>
      <input
        type="range"
        min={min}
        max={max}
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
        <span>{c.tick(min)}</span>
        <span class="base-mark">
          {baseLabel} {item.text(b)}
        </span>
        <span>{c.tick(max)}</span>
      </div>
    </>
  );
}

/** 金額の欄のスライダー（1万円の刻み）。数値の欄は入力の欄と同じ部品を下に置く */
function FieldAmountSlider({ item, value, onSlide, onRelease, slider }: ItemRowProps & { slider: { min: number; max: number; step: number; per: "月" | "年" | "" } }) {
  const v = typeof value === "number" ? value : 0;
  const min = Math.min(slider.min, Math.floor(v / slider.step) * slider.step);
  const max = Math.max(slider.max, Math.ceil(v / slider.step) * slider.step);
  const tick = (n: number) => `${slider.per}${(n / AMOUNT_STEP).toLocaleString("en-US")}万`;
  return (
    <>
      <input
        type="range"
        min={min}
        max={max}
        step={slider.step}
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
        <span>{tick(min)}</span>
        <span>{tick(max)}</span>
      </div>
    </>
  );
}

function RateRow({ item, value, base, onSlide, onRelease, baseLabel = "現状" }: ItemRowProps & { item: MovableItem & { control: { kind: "rate" } } }) {
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
        <span class="base-mark">
          {baseLabel} {pctText(b)}
        </span>
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

function ShiftRow({ item, value, base, onSlide, onRelease, baseLabel = "現状" }: ItemRowProps & { item: MovableItem & { control: { kind: "shift" } } }) {
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
        <span class="base-mark">
          {baseLabel}: {item.text(base)}
        </span>
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

/**
 * 変動金利の見込み（住宅ローン1本。入力の「金利の見込み（変動金利）」の欄と同じ型を選ぶ。0202）。型にない見込み（AI の候補で入った5年ごとの上乗せ・
 * 金利の段階で入れた見込み）は、その値を選べる行として残す（選び直すと型の値になる）
 */
function OutlookRow({ item, value, base, onSlide, onRelease, baseLabel = "現状" }: ItemRowProps & { item: MovableItem & { control: { kind: "outlook" } } }) {
  const c = item.control;
  const hit = c.presets.find((p) => item.same(value, { adds: p.adds }));
  const other = hit === undefined ? "other" : null;
  return (
    <div class="shift">
      <label class="shift-from">
        金利の上がり方
        <select
          value={hit?.value ?? "other"}
          data-item={item.key}
          onChange={(e) => {
            const p = c.presets.find((x) => x.value === (e.currentTarget as HTMLSelectElement).value);
            if (p === undefined) return;
            onSlide(item.key, { adds: [...p.adds] });
            onRelease();
          }}>
          {c.presets.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
          {other !== null ? <option value="other">{item.text(value)}</option> : null}
        </select>
      </label>
      <div class="range-scale">
        <span class="base-mark">
          {baseLabel}: {item.text(base)}
        </span>
      </div>
    </div>
  );
}

/** 年齢のスライダー（1歳ずつ。資産運用の積立をやめる年齢・取り崩しを始める年齢。0026） */
function AgeRow({ item, value, base, onSlide, onRelease, baseLabel = "現状" }: ItemRowProps & { item: MovableItem & { control: { kind: "age" } } }) {
  const c = item.control;
  const v = typeof value === "number" ? value : c.min;
  const b = typeof base === "number" ? base : c.min;
  // 上の端は今の値が外にあれば広げ、下の端は広げない（過ぎた年齢を選べないように）
  const { min, max } = ageSliderBounds(c, v);
  return (
    <>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={v}
        // 動かせる幅が無い（もう年金を受け取り始めている人の受け取り開始）ときは押せない形にする
        disabled={min >= max}
        data-item={item.key}
        aria-label={item.label}
        aria-valuetext={item.text(v)}
        onInput={(e) => onSlide(item.key, Number((e.currentTarget as HTMLInputElement).value))}
        onChange={onRelease}
        onPointerUp={onRelease}
        onKeyUp={onRelease}
      />
      <div class="range-scale">
        <span>{c.tick(min)}歳</span>
        <span class="base-mark">
          {baseLabel} {item.text(b)}
        </span>
        <span>{c.tick(max)}歳</span>
      </div>
    </>
  );
}

/** 働き方と年収（配偶者の働き方と年収。0084）: 働き方を選び、年収を1万円の刻みのスライダーで動かす（数値の欄は上の行） */
function WorkRow({ item, value, onSlide, onRelease }: ItemRowProps & { item: MovableItem & { control: { kind: "work" } } }) {
  const c = item.control;
  const v = (value as WorkValue | null) ?? { type: "unemployed", annual: 0 };
  const paid = v.type !== "unemployed" && v.type !== "leave";
  const max = Math.max(c.max, Math.ceil(v.annual / AMOUNT_STEP) * AMOUNT_STEP);
  return (
    <div class="work-lever">
      <label class="shift-from">
        働き方
        <select
          value={v.type}
          data-item={`${item.key}:type`}
          onChange={(e) => {
            const type = (e.currentTarget as HTMLSelectElement).value;
            // 種類を選び直したら、年収は働いていなかった・0円のときだけ、その種類の目安にする（入れていた年収は残す）
            const annual = type === "unemployed" ? 0 : v.annual > 0 ? v.annual : c.estimate(type);
            onSlide(item.key, { type, annual });
            onRelease();
          }}
        >
          {c.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {paid ? (
        <>
          <input
            type="range"
            min={0}
            max={max}
            step={AMOUNT_STEP}
            value={v.annual}
            data-item={item.key}
            aria-label={`${item.label}（年収）`}
            aria-valuetext={item.text(v)}
            onInput={(e) => onSlide(item.key, { ...v, annual: Number((e.currentTarget as HTMLInputElement).value) })}
            onChange={onRelease}
            onPointerUp={onRelease}
            onKeyUp={onRelease}
          />
          <div class="range-scale">
            <span>0</span>
            <span class="amt-step">1万円ずつ</span>
            <span>{(max / AMOUNT_STEP).toLocaleString("en-US")}万</span>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** 足した項目の1行（スライダーか数値の欄） */
export function ItemRow(props: ItemRowProps) {
  const { item, value, base, wh, onSlide, onRelease, onRemove, baseLabel = "現状" } = props;
  const changed = !item.same(value, base);
  const c = item.control;
  let control;
  if (c.kind === "range") control = <RangeRow {...props} item={item as MovableItem & { control: typeof c }} />;
  else if (c.kind === "rate") control = <RateRow {...props} item={item as MovableItem & { control: typeof c }} />;
  else if (c.kind === "mix") control = <MixRow {...props} item={item as MovableItem & { control: typeof c }} />;
  else if (c.kind === "shift") control = <ShiftRow {...props} item={item as MovableItem & { control: typeof c }} />;
  else if (c.kind === "outlook") control = <OutlookRow {...props} item={item as MovableItem & { control: typeof c }} />;
  else if (c.kind === "age") control = <AgeRow {...props} item={item as MovableItem & { control: typeof c }} />;
  else if (c.kind === "work") control = <WorkRow {...props} item={item as MovableItem & { control: typeof c }} />;
  else if (c.kind === "field") {
    // 入力の欄と同じ部品で、案の値を見せる（書いた値は案にだけ入る）
    const view = changed ? item.apply(wh, value) : wh;
    control = (
      <>
        {c.slider !== undefined ? <FieldAmountSlider {...props} slider={c.slider} /> : null}
        <Field f={c.field} wh={view} onEdit={(w) => {
            onSlide(item.key, c.field.get(w).value as ItemValue);
            onRelease();
          }} />
      </>
    );
  } else control = null;
  const note = item.note?.(value) ?? null;
  return (
    <div class={`lever added${changed ? " changed" : ""}`} data-added={item.key} data-reveal-item>
      <div class={`lever-head${item.where !== undefined ? " two-line" : ""}`}>
        {item.where !== undefined ? (
          // 入力の欄から足した項目: 上の段に物の名前（小さく薄く・1行で収まらなければ … と title）、下の段に欄の名前。読み上げは「物の名前: 欄の名前」のつないだ名前のまま
          <span class="lever-label">
            <span class="ll-where" title={item.where}>
              {item.where}
              <span class="vh">: </span>
            </span>
            <span class="ll-name">{item.short}</span>
          </span>
        ) : (
          <span class="lever-label">{item.label}</span>
        )}
        {onRemove !== null ? (
          <button type="button" class="link-btn" onClick={() => onRemove(item.key)} title="この項目を対策から外す（動かした値は現状に戻す）">
            外す
          </button>
        ) : null}
      </div>
      {c.kind === "range" ? (
        <div class="lever-val added-val amt-row">
          <span>{item.text(value)}</span>
          <AmountInput
            value={typeof value === "number" ? value : c.min}
            per={c.per ?? ""}
            label={item.label}
            onCommit={(n) => {
              onSlide(item.key, n);
              onRelease();
            }}
          />
        </div>
      ) : c.kind === "work" && value !== null && typeof value === "object" && "annual" in value && value.type !== "unemployed" && value.type !== "leave" ? (
        <div class="lever-val added-val amt-row">
          <span>{item.text(value)}</span>
          <AmountInput
            value={value.annual}
            per="年"
            label={item.label}
            onCommit={(n) => {
              onSlide(item.key, { ...(value as WorkValue), annual: n });
              onRelease();
            }}
          />
        </div>
      ) : c.kind !== "field" ? (
        <div class="lever-val added-val">{item.text(value)}</div>
      ) : null}
      {control}
      <div class="lever-note">
        {note !== null ? <span>{note}</span> : <span />}
        <span class="base-tag">
          {baseLabel}: {item.text(base)}
        </span>
      </div>
    </div>
  );
}
