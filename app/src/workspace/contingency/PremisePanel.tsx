// 万一の想定の前提の欄（作業の層の部品。万一の画面のグラフの下）: 主画面の対策の欄と同じ並べ方・同じ部品・同じ操作で描く（0085）
// （横に 4 → 2 → 1 列のグリッド、スライダー＋値の大きな表示、金額は1万円の刻みと万円の数値の欄、既定の値の札＝薄いグレーの実線の枠）。
// 選んでいる場面の項目だけを出す: 事務所の既定値で最初から出す項目（外せない）・「＋ 動かす項目を追加」で足した項目・値を変えた項目（外せる。外すと値は既定に戻す）。
// 動かしている間（input）は画面の側で先に描き（onDraft）、指を離したら（change・pointerup・keyup）世帯に書く（onCommit）。
// どちらでも計算し直す（計算は ContingencyTab の枠が、打っている間は少し待ってからまとめて送る）。FP用のメモ・物の ID は出さない
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Field } from "../input/FieldViews.tsx";
import type { FieldDef, Val } from "../input/form.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { revealAdded } from "../../presentation/revealAdded.ts";
import { premiseMark, revertPremise, type PremiseMark } from "./planPremise.ts";
import { pctText } from "../plans/decimal.ts";
import { AmountInput } from "../plans/ItemControls.tsx";
import { itemFields, itemValued, premiseMeta, resetItem, SURVIVOR_WORK_TYPES, type PremiseItem, type PremiseMeta } from "./inputs.ts";
import { premiseView, type PremiseKind } from "./premiseChoice.ts";

const MAN = 10000;

/** 欄の値の見せ方（スライダーの横の大きな表示・既定の札） */
export function premiseText(f: FieldDef, v: Val, meta: PremiseMeta | undefined): string {
  if (f.kind === "select") return f.options.find((o) => o.value === String(v ?? ""))?.label ?? "";
  if (f.kind === "bool") return v === true ? "する" : "しない";
  if (v === null || v === "") {
    if (meta?.auto !== undefined) return meta.auto;
    if (f.kind === "yen") return "0万円";
    if (f.kind === "int") return `0${f.suffix ?? ""}`;
    return "—";
  }
  if (f.kind === "pct") return pctText(String(v), 1);
  if (f.kind === "yen") return `${f.basis === "monthly" ? "月" : f.basis === "annual" ? "年" : ""}${(Number(v) / MAN).toLocaleString("en-US")}万円`;
  if (f.kind === "int") return `${String(v)}${f.suffix ?? ""}`;
  return String(v);
}

/** 既定の札の文字（既定の無い欄は「なし」） */
function baseText(f: FieldDef, meta: PremiseMeta | undefined): string | null {
  if (meta === undefined) return null;
  if (meta.fallback !== undefined) return `既定: ${premiseText(f, meta.fallback, meta)}`;
  if (meta.auto !== undefined) return `既定: ${meta.auto}`;
  return "既定: なし";
}

/** スライダーの位置 ⇔ 欄の値 */
function toPos(f: FieldDef, v: Val): number {
  if (v === null || v === "") return 0;
  if (f.kind === "pct") return Math.round(Number(v) * 100);
  return Number(v);
}
function fromPos(f: FieldDef, n: number, meta: PremiseMeta): Val {
  if (f.kind === "pct") return String(n / 100);
  // 空欄が0の意味の欄は、0を空欄（省略）に戻す（要求の形を変えない）
  if (n === 0 && meta.auto === undefined && meta.fallback === undefined) return null;
  return n;
}

const idOf = (f: FieldDef) => `cg-${f.key.replace(/[^A-Za-z0-9_-]/g, "_")}`;
const perOf = (f: FieldDef): "月" | "年" | "" => (f.kind === "yen" ? (f.basis === "monthly" ? "月" : f.basis === "annual" ? "年" : "") : "");

type Mark = { mark: PremiseMark; plan: string; onRevert: () => void } | null;

interface LeverProps {
  f: FieldDef;
  wh: WorkingHousehold;
  onDraft: (w: WorkingHousehold) => void;
  onCommit: (w?: WorkingHousehold) => void;
  /** 欄の下に添える説明（省略は欄の help） */
  note?: string;
  /** 欄の名前（省略は欄の label） */
  label?: string;
  /** プランで共通と違う値の印（0071） */
  mark?: Mark;
  /** 外す（最初から出す項目は外せないので省略） */
  onRemove?: (() => void) | undefined;
  /** 当てはまらないときの説明（欄を出さずに説明だけ） */
  inactive?: string | undefined;
}

/** プランで共通と違う値の印（縦線の色はプランの色。「共通: 70%」「↺ 共通に戻す」） */
function PlanMarkLine({ m }: { m: NonNullable<Mark> }) {
  return (
    <div class="cg-plan-mark" data-plan-mark={m.mark.own ? "own" : "inherited"}>
      <span>{m.mark.own ? `${m.plan}だけ` : "土台のプランで変更"}・{m.mark.common.startsWith("共通") ? m.mark.common : `共通: ${m.mark.common}`}</span>
      <button type="button" class="link-btn" onClick={m.onRevert}>
        ↺ 共通に戻す
      </button>
    </div>
  );
}

function RemoveButton({ onRemove, k }: { onRemove: (() => void) | undefined; k: string }) {
  return onRemove !== undefined ? (
    <button type="button" class="link-btn" onClick={onRemove} title="この項目を想定の前提から外す（値は既定に戻す）" data-premise-remove={k}>
      外す
    </button>
  ) : null;
}

/** スライダーと目盛り（数の欄）。値を動かしている間は onDraft、離したら onCommit */
function PremiseRange({ f, wh, onDraft, onCommit, meta, text }: { f: FieldDef; wh: WorkingHousehold; onDraft: (w: WorkingHousehold) => void; onCommit: (w?: WorkingHousehold) => void; meta: PremiseMeta; text: string }) {
  const sl = meta.slider as NonNullable<PremiseMeta["slider"]>;
  const pos = toPos(f, f.get(wh).value);
  const min = Math.min(sl.min, Math.floor(pos / sl.step) * sl.step);
  const max = Math.max(sl.max, Math.ceil(pos / sl.step) * sl.step);
  const per = perOf(f);
  const suffix = f.kind === "int" ? (f.suffix ?? "") : "";
  const tick = (n: number) => (f.kind === "yen" ? `${per}${(n / MAN).toLocaleString("en-US")}万` : f.kind === "pct" ? `${n}%` : `${n}${suffix}`);
  const release = () => onCommit();
  return (
    <>
      <input
        id={idOf(f)}
        type="range"
        min={min}
        max={max}
        step={sl.step}
        value={pos}
        data-premise-slider={f.key}
        aria-valuetext={text}
        onInput={(e) => onDraft(f.set(wh, fromPos(f, Number((e.currentTarget as HTMLInputElement).value), meta)))}
        onChange={release}
        onPointerUp={release}
        onKeyUp={release}
      />
      <div class="range-scale">
        <span>{tick(min)}</span>
        {f.kind === "yen" ? <span class="amt-step">1万円ずつ</span> : null}
        <span>{tick(max)}</span>
      </div>
    </>
  );
}

/** 欄の値が既定と違うか（枠の「変えた」の印） */
const isChanged = (f: FieldDef, wh: WorkingHousehold): boolean => {
  const meta = premiseMeta(f);
  const st = f.get(wh);
  const v = st.value;
  return st.implicit !== true && v !== null && v !== "" && !(meta?.fallback !== undefined && String(v) === String(meta.fallback));
};

function PremiseLever({ f, wh, onDraft, onCommit, note, label = f.label, mark = null, onRemove, inactive }: LeverProps) {
  const meta = premiseMeta(f);
  const v = f.get(wh).value;
  const base = baseText(f, meta);
  const sl = meta?.slider ?? null;
  const cls = `lever${isChanged(f, wh) ? " changed" : ""}${mark !== null ? " plan-diff" : ""}`;
  if (inactive !== undefined) {
    return (
      <div class={`${cls} inactive`} data-reveal-item data-premise={f.key}>
        <div class="lever-head">
          <span class="lever-label">{label}</span>
          <span class="lever-val auto">—</span>
        </div>
        <div class="lever-note">
          <span>{inactive}</span>
          <RemoveButton onRemove={onRemove} k={f.key} />
        </div>
      </div>
    );
  }
  if (meta === undefined || sl === null || (f.kind !== "pct" && f.kind !== "yen" && f.kind !== "int")) {
    // 選択の欄・住まいの段階と同じ欄（団信）: 入力の画面と同じ欄の部品を、対策の欄と同じ枠に入れる
    return (
      <div class={`${cls} field`} data-reveal-item data-premise={f.key}>
        <div class="lever-head">
          <span class="lever-label">{label}</span>
        </div>
        <Field f={f} wh={wh} onEdit={(w) => onCommit(w)} />
        <div class="lever-note">
          <span>{note ?? ""}</span>
          {base !== null ? <span class="base-tag">{base}</span> : null}
          <RemoveButton onRemove={onRemove} k={f.key} />
        </div>
        {mark !== null ? <PlanMarkLine m={mark} /> : null}
      </div>
    );
  }
  const text = premiseText(f, v, meta);
  const isAuto = (v === null || v === "") && meta.auto !== undefined;
  return (
    <div class={cls} data-reveal-item data-premise={f.key} data-lever-kind={f.kind === "yen" ? "amount" : "steps"}>
      <div class="lever-head">
        <label for={idOf(f)}>{label}</label>
        {f.kind === "yen" && !isAuto ? (
          <AmountInput value={Number(v ?? 0)} per={perOf(f)} label={label} onCommit={(y) => onCommit(f.set(wh, fromPos(f, y, meta)))} />
        ) : (
          <span class={`lever-val${isAuto ? " auto" : ""}`}>{text}</span>
        )}
      </div>
      <PremiseRange f={f} wh={wh} onDraft={onDraft} onCommit={onCommit} meta={meta} text={text} />
      <div class="lever-note">
        <span>
          {note ?? f.help ?? ""}
          {meta.auto !== undefined && !isAuto ? (
            <button type="button" class="link-btn cg-auto" onClick={() => onCommit(f.set(wh, null))}>
              {meta.auto}に戻す
            </button>
          ) : null}
        </span>
        {base !== null ? <span class="base-tag">{base}</span> : null}
        <RemoveButton onRemove={onRemove} k={f.key} />
      </div>
      {mark !== null ? <PlanMarkLine m={mark} /> : null}
    </div>
  );
}

interface BoxProps {
  it: PremiseItem;
  wh: WorkingHousehold;
  onDraft: (w: WorkingHousehold) => void;
  onCommit: (w?: WorkingHousehold) => void;
  mark: Mark;
  onRemove: (() => void) | undefined;
}

/** 配偶者の働き方と年収（1つの枠。0085）: 働き方を選び、働くなら年収を1万円の刻みで動かす（対策の「配偶者の働き方と年収」と同じ形） */
function PremiseWorkLever({ it, wh, onDraft, onCommit, mark, onRemove }: BoxProps) {
  const [typeF, salaryF] = itemFields(it) as [FieldDef, FieldDef];
  const type = String(typeF.get(wh).value ?? "keep");
  const paid = type !== "keep" && type !== "none";
  const meta = premiseMeta(salaryF) as PremiseMeta;
  const sv = salaryF.get(wh).value;
  const isAuto = sv === null || sv === "";
  const text = premiseText(salaryF, sv, meta);
  return (
    <div class={`lever${itemValued(it, wh) ? " changed" : ""}${mark !== null ? " plan-diff" : ""}`} data-reveal-item data-premise={typeF.key} data-premise-work>
      <div class="lever-head">
        <label for={idOf(salaryF)}>{it.label}</label>
        {paid && !isAuto ? (
          <AmountInput value={Number(sv ?? 0)} per="年" label={`${it.label}（年収）`} onCommit={(y) => onCommit(salaryF.set(wh, y))} />
        ) : (
          <span class={`lever-val${paid ? " auto" : ""}`}>{paid ? text : (SURVIVOR_WORK_TYPES.find((o) => o.value === type)?.label ?? "")}</span>
        )}
      </div>
      <label class="shift-from">
        働き方
        <select value={type} data-premise-select={typeF.key} onChange={(e) => onCommit(typeF.set(wh, (e.currentTarget as HTMLSelectElement).value))}>
          {SURVIVOR_WORK_TYPES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {paid ? <PremiseRange f={salaryF} wh={wh} onDraft={onDraft} onCommit={onCommit} meta={meta} text={text} /> : null}
      <div class="lever-note">
        <span>
          {paid ? `${salaryF.label}。空欄は働き方ごとの目安` : "働き方を選ぶと、その働き方と年収に置き換えます"}
          {paid && !isAuto ? (
            <button type="button" class="link-btn cg-auto" onClick={() => onCommit(salaryF.set(wh, null))}>
              目安に戻す
            </button>
          ) : null}
        </span>
        <span class="base-tag">既定: 今の働き方を続ける</span>
        <RemoveButton onRemove={onRemove} k={typeF.key} />
      </div>
      {mark !== null ? <PlanMarkLine m={mark} /> : null}
    </div>
  );
}

/** チェックの並び（下げる資産。1つの枠） */
function PremiseChecks({ it, wh, onCommit, mark, onRemove }: BoxProps) {
  return (
    <div class={`lever field${itemValued(it, wh) ? " changed" : ""}${mark !== null ? " plan-diff" : ""}`} data-reveal-item data-premise={it.kind} data-premise-checks>
      <div class="lever-head">
        <span class="lever-label">{it.label}</span>
      </div>
      <div class="cg-checks">
        {itemFields(it).map((f) => (
          <label key={f.key} class="cg-check">
            <input type="checkbox" checked={f.get(wh).value === true} data-premise-check={f.key} onChange={(e) => onCommit(f.set(wh, (e.currentTarget as HTMLInputElement).checked))} />
            {f.label}
          </label>
        ))}
      </div>
      <div class="lever-note">
        <span>{it.note ?? ""}</span>
        <RemoveButton onRemove={onRemove} k={it.kind} />
      </div>
      {mark !== null ? <PlanMarkLine m={mark} /> : null}
    </div>
  );
}

/** 「＋ 動かす項目を追加」の一覧（選んでいる場面の、まだ出していない項目） */
export function PremiseMenu({ items, onPick, onClose }: { items: readonly PremiseItem[]; onPick: (k: PremiseKind) => void; onClose: () => void }) {
  return (
    <div class="item-menu" role="group" aria-label="動かす項目を選ぶ" data-premise-menu>
      <div class="item-menu-h">
        <b>動かす項目を選ぶ</b>
        <button type="button" class="link-btn" onClick={onClose}>
          閉じる
        </button>
      </div>
      <div class="item-menu-list">
        {items.length === 0 ? <p class="in-note">足せる項目はありません（この場面の項目は全部出しています）</p> : null}
        {items.map((it) => (
          <button
            type="button"
            key={it.kind}
            onClick={(e) => {
              // 足した項目を見える所へ動かして光らせる
              revealAdded(e.currentTarget);
              onPick(it.kind);
            }}
            data-premise-pick={it.kind}
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** プランを見ているときの前提の直し方（0071） */
export interface PremisePlan {
  id: string;
  /** 例: 「プランB」 */
  name: string;
  /** 保存したプランか（保存していないプランは上書きを持てない） */
  saved: boolean;
  /** 直す先 */
  to: "common" | "plan";
  onTo: (t: "common" | "plan") => void;
  /** そのプランで上書きしている前提の数 */
  overrides: number;
  /** 世帯（共通の前提とプランの一覧。印と「共通に戻す」に使う） */
  stored: WorkingHousehold;
  onRevert: (w: WorkingHousehold) => void;
}

export interface PremisePanelProps {
  wh: WorkingHousehold;
  /** 選んでいる場面の名前（例: 「ご本人が亡くなったら」。無ければ null） */
  scene: string | null;
  /** 場面の前提の説明 */
  sceneNote?: string | null;
  /** 選んでいる場面で出せる項目（一覧の並び。premiseItems） */
  items: readonly PremiseItem[];
  /** 最初から出す種類（事務所の既定値） */
  start: ReadonlySet<PremiseKind>;
  /** 「＋ 動かす項目を追加」で足した種類（足した順） */
  added: readonly string[];
  onAdd: (k: PremiseKind) => void;
  /** 足した種類を外す（値は onCommit で既定に戻してから呼ぶ） */
  onRemove: (k: PremiseKind) => void;
  onDraft: (w: WorkingHousehold) => void;
  /** 世帯に書く（w を省略したときは、動かしていた値を書く） */
  onCommit: (w?: WorkingHousehold) => void;
  /** 見ているプラン（現状なら null） */
  plan?: PremisePlan | null;
  /** 一覧の下の小さな行（必要保障額の数え方が事務所の既定値と違うときなど） */
  foot?: ComponentChildren;
  /** 開いた直後に「＋ 動かす項目を追加」の一覧を開く（画面の確かめ用） */
  initialMenu?: boolean;
}

export function PremisePanel({ wh, scene, sceneNote = null, items, start, added, onAdd, onRemove, onDraft, onCommit, plan = null, foot, initialMenu = false }: PremisePanelProps) {
  const [menu, setMenu] = useState(initialMenu);
  const markOf = (f: FieldDef): Mark => {
    const meta = premiseMeta(f);
    if (plan === null || meta === undefined) return null;
    const m = premiseMark(plan.stored, plan.id, meta.path, (v) => premiseText(f, (v ?? meta.fallback ?? null) as Val, meta));
    return m === null ? null : { mark: m, plan: plan.name, onRevert: () => plan.onRevert(revertPremise(plan.stored, plan.id, meta.path)) };
  };
  const byKind = new Map(items.map((it) => [it.kind, it]));
  // 値を変えた項目（共通の前提か見ているプランで既定と違う値・プランで上書きした値）は、最初から出さない項目でも出す
  const valued = (k: PremiseKind) => {
    const it = byKind.get(k);
    return it !== undefined && (itemValued(it, wh) || itemFields(it).some((f) => markOf(f) !== null));
  };
  const view = premiseView(
    items.map((it) => it.kind),
    start,
    added,
    valued,
  );
  const shownSet = new Set(view.shown);
  const rest = items.filter((it) => !shownSet.has(it.kind));
  const remove = (it: PremiseItem) => {
    onCommit(resetItem(it, wh));
    onRemove(it.kind);
  };
  const box = (it: PremiseItem): ComponentChildren => {
    const rm = view.fixed.has(it.kind) ? undefined : () => remove(it);
    const mark = itemFields(it).map(markOf).find((m) => m !== null) ?? null;
    if (it.shape === "work") return <PremiseWorkLever key={it.kind} it={it} wh={wh} onDraft={onDraft} onCommit={onCommit} mark={mark} onRemove={rm} />;
    if (it.shape === "checks") return <PremiseChecks key={it.kind} it={it} wh={wh} onDraft={onDraft} onCommit={onCommit} mark={mark} onRemove={rm} />;
    // 欄が1つの項目は、項目の名前を欄の名前にする（まとまりの見出しの行を作らない）
    const single = it.parts.length === 1 && it.parts[0]?.title === undefined && it.parts[0]?.fields.length === 1;
    return it.parts.flatMap((p, pi) => [
      p.title !== undefined ? (
        <div class="cg-gh" key={`${it.kind}:h:${pi}`}>
          {p.title}
          {pi === 0 && it.note !== undefined ? <span class="in-note">{it.note}</span> : null}
        </div>
      ) : null,
      ...p.fields.map((f) => (
        <PremiseLever
          key={f.key}
          f={f}
          wh={wh}
          onDraft={onDraft}
          onCommit={onCommit}
          mark={markOf(f)}
          onRemove={rm}
          {...(single ? { label: it.label } : {})}
          {...(single && it.note !== undefined ? { note: it.note } : {})}
          {...(single && it.inactive !== undefined ? { inactive: it.inactive } : {})}
        />
      )),
    ]);
  };
  return (
    <section class="card levers cg-premises" aria-labelledby="h-cg-in" data-cg-premises data-reveal-root>
      <div class="lv-head">
        <h2 id="h-cg-in">想定の前提</h2>
        <span class="lv-who">
          {scene !== null ? (
            <>
              <b>{scene}</b>の前提です。
            </>
          ) : null}
          変えるとすぐ計算し直します（必要保障額の推移と、選んだ場面の両方）
        </span>
      </div>
      {plan !== null ? (
        <div class="cg-plan-to" data-cg-premise-to={plan.to}>
          <span>前提を直す先:</span>
          <span class="seg-g" role="group" aria-label="前提を直す先">
            <button type="button" aria-pressed={plan.to === "common"} onClick={() => plan.onTo("common")}>
              全プラン共通
            </button>
            <button type="button" aria-pressed={plan.to === "plan"} disabled={!plan.saved} title={plan.saved ? undefined : "保存したプランだけ、前提を上書きできます"} onClick={() => plan.onTo("plan")}>
              {plan.name}だけ
            </button>
          </span>
          {plan.overrides > 0 ? <span class="p-tag show" data-cg-overrides={plan.overrides}>{`${plan.name}だけの前提 ${plan.overrides}か所`}</span> : null}
        </div>
      ) : null}
      {sceneNote !== null ? <p class="in-note cg-scene-note">{sceneNote}</p> : null}
      <div class="lv-grid cg-grid" data-premise-shown={view.shown.join(",")}>
        {view.shown.map((k) => {
          const it = byKind.get(k);
          return it === undefined ? null : box(it);
        })}
      </div>
      {items.length > 0 ? (
        <div class="add-row">
          {menu ? (
            <PremiseMenu
              items={rest}
              onPick={(k) => {
                onAdd(k);
                setMenu(false);
              }}
              onClose={() => setMenu(false)}
            />
          ) : (
            <button type="button" class="add-item-btn" onClick={() => setMenu(true)} disabled={rest.length === 0} data-premise-add>
              ＋ 動かす項目を追加
            </button>
          )}
        </div>
      ) : null}
      {foot ?? null}
    </section>
  );
}
