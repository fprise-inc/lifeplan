// 万一の想定の前提の欄（作業の層の部品。万一の画面のグラフの下）: 主画面の対策の欄と同じ並べ方・同じ部品で描く
// （横に2〜3列のグリッド、スライダー＋値の大きな表示、金額は1万円の刻みと万円の数値の欄、既定の値の札＝薄いグレーの実線の枠）。
// 動かしている間（input）は画面の側で先に描き（onDraft）、指を離したら（change・pointerup・keyup）世帯に書く（onCommit）。
// どちらでも計算し直す（計算は ContingencyTab の枠が、打っている間は少し待ってからまとめて送る）。FP用のメモ・物の ID は出さない
import { Field } from "../input/FieldViews.tsx";
import type { FieldDef, Level, SectionDef, Val } from "../input/form.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { premiseMark, revertPremise, type PremiseMark } from "./planPremise.ts";
import { pctText } from "../plans/decimal.ts";
import { AmountInput } from "../plans/ItemControls.tsx";
import { premiseMeta, type PremiseMeta } from "./inputs.ts";

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
  mark?: { mark: PremiseMark; plan: string; onRevert: () => void } | null;
}

/** プランで共通と違う値の印（縦線の色はプランの色。「共通: 70%」「↺ 共通に戻す」） */
function PlanMarkLine({ m }: { m: NonNullable<LeverProps["mark"]> }) {
  return (
    <div class="cg-plan-mark" data-plan-mark={m.mark.own ? "own" : "inherited"}>
      <span>{m.mark.own ? `${m.plan}だけ` : "土台のプランで変更"}・{m.mark.common.startsWith("共通") ? m.mark.common : `共通: ${m.mark.common}`}</span>
      <button type="button" class="link-btn" onClick={m.onRevert}>
        ↺ 共通に戻す
      </button>
    </div>
  );
}

function PremiseLever({ f, wh, onDraft, onCommit, note, label = f.label, mark = null }: LeverProps) {
  const meta = premiseMeta(f);
  const st = f.get(wh);
  const v = st.value;
  const base = baseText(f, meta);
  const changed = st.implicit !== true && v !== null && v !== "" && !(meta?.fallback !== undefined && String(v) === String(meta.fallback));
  const id = `cg-${f.key.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  const sl = meta?.slider ?? null;
  if (meta === undefined || sl === null || (f.kind !== "pct" && f.kind !== "yen" && f.kind !== "int")) {
    // 選択の欄・住まいの段階と同じ欄（団信）: 入力の画面と同じ欄の部品を、対策の欄と同じ枠に入れる
    return (
      <div class={`lever field${changed ? " changed" : ""}${mark !== null ? " plan-diff" : ""}`} data-premise={f.key}>
        <div class="lever-head">
          <span class="lever-label">{label}</span>
        </div>
        <Field f={f} wh={wh} onEdit={(w) => onCommit(w)} />
        {note !== undefined || base !== null ? (
          <div class="lever-note">
            <span>{note ?? ""}</span>
            {base !== null ? <span class="base-tag">{base}</span> : null}
          </div>
        ) : null}
        {mark !== null ? <PlanMarkLine m={mark} /> : null}
      </div>
    );
  }
  const pos = toPos(f, v);
  const min = Math.min(sl.min, Math.floor(pos / sl.step) * sl.step);
  const max = Math.max(sl.max, Math.ceil(pos / sl.step) * sl.step);
  const text = premiseText(f, v, meta);
  const isAuto = (v === null || v === "") && meta.auto !== undefined;
  const per = f.kind === "yen" ? (f.basis === "monthly" ? "月" : f.basis === "annual" ? "年" : "") : "";
  const tick = (n: number) => (f.kind === "yen" ? `${per}${(n / MAN).toLocaleString("en-US")}万` : f.kind === "pct" ? `${n}%` : `${n}${f.suffix ?? ""}`);
  const release = () => onCommit();
  return (
    <div class={`lever${changed ? " changed" : ""}${mark !== null ? " plan-diff" : ""}`} data-premise={f.key} data-lever-kind={f.kind === "yen" ? "amount" : "steps"}>
      <div class="lever-head">
        <label for={id}>{label}</label>
        {f.kind === "yen" && !isAuto ? (
          <AmountInput value={Number(v ?? 0)} per={per} label={f.label} onCommit={(y) => onCommit(f.set(wh, fromPos(f, y, meta)))} />
        ) : (
          <span class={`lever-val${isAuto ? " auto" : ""}`}>{text}</span>
        )}
      </div>
      <input
        id={id}
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
      </div>
      {mark !== null ? <PlanMarkLine m={mark} /> : null}
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
  sections: SectionDef[];
  /** 選んだ場面で使う区画の鍵（「この場面で使う」の札を出す） */
  used: ReadonlySet<string>;
  /** 区画の最後に足す欄（障害の場面の、65歳からの組み合わせ） */
  extra: { section: string; field: FieldDef; note: string } | null;
  onDraft: (w: WorkingHousehold) => void;
  /** 世帯に書く（w を省略したときは、動かしていた値を書く） */
  onCommit: (w?: WorkingHousehold) => void;
  /** 簡易・詳細（0071） */
  level?: Level;
  onLevel?: (l: Level) => void;
  /** 見ているプラン（現状なら null） */
  plan?: PremisePlan | null;
}

export function PremisePanel({ wh, sections, used, extra, onDraft, onCommit, level = "detail", onLevel, plan = null }: PremisePanelProps) {
  const shown = (lv: Level) => level === "detail" || lv === "simple";
  const markOf = (f: FieldDef): LeverProps["mark"] => {
    const meta = premiseMeta(f);
    if (plan === null || meta === undefined) return null;
    const m = premiseMark(plan.stored, plan.id, meta.path, (v) => premiseText(f, (v ?? meta.fallback ?? null) as Val, meta));
    return m === null ? null : { mark: m, plan: plan.name, onRevert: () => plan.onRevert(revertPremise(plan.stored, plan.id, meta.path)) };
  };
  const lever = (f: FieldDef, label?: string) => <PremiseLever key={f.key} f={f} wh={wh} onDraft={onDraft} onCommit={onCommit} mark={markOf(f)} {...(label !== undefined ? { label } : {})} />;
  return (
    <section class="card levers cg-premises" aria-labelledby="h-cg-in" data-cg-premises>
      <div class="lv-head">
        <h2 id="h-cg-in">想定の前提</h2>
        <span class="lv-who">変えるとすぐ計算し直します（必要保障額の推移と、選んだ場面の両方）</span>
        {onLevel !== undefined ? (
          <span class="seg-g" role="group" aria-label="前提の欄の形式">
            {(["simple", "detail"] as const).map((l) => (
              <button key={l} type="button" aria-pressed={level === l} data-cg-level={l} onClick={() => onLevel(l)}>
                {l === "simple" ? "簡易" : "詳細"}
              </button>
            ))}
          </span>
        ) : null}
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
      {sections.map((sec) => {
        const groups = sec.groups.map((g) => ({ ...g, fields: g.fields.filter((f) => shown(f.level) && shown(g.level)) })).filter((g) => g.fields.length > 0);
        const ext = extra !== null && extra.section === sec.key && shown(extra.field.level) ? extra : null;
        if (groups.length === 0 && ext === null) return null;
        return (
        <div class="cg-sec" key={sec.key} data-section={sec.key}>
          <h3 class="cg-sec-h">
            {sec.title}
            {used.has(sec.key) ? <span class="p-tag show">この場面で使う</span> : null}
          </h3>
          {sec.note !== undefined ? <p class="in-note">{sec.note}</p> : null}
          <div class="lv-grid cg-grid">
            {groups.flatMap((g) =>
              // 欄が1つのまとまりは、まとまりの名前を欄の名前にする（見出しの行を作らない）
              g.title !== undefined && g.fields.length === 1 && g.note === undefined
                ? g.fields.map((f) => lever(f, g.title))
                : [
                    g.title !== undefined ? (
                      <div class="cg-gh" key={`h:${g.key}`}>
                        {g.title}
                        {g.note !== undefined ? <span class="in-note">{g.note}</span> : null}
                      </div>
                    ) : null,
                    ...g.fields.map((f) => lever(f)),
                  ],
            )}
            {ext !== null ? <PremiseLever key={ext.field.key} f={ext.field} wh={wh} onDraft={onDraft} onCommit={onCommit} note={ext.note} mark={markOf(ext.field)} /> : null}
          </div>
        </div>
        );
      })}
    </section>
  );
}
