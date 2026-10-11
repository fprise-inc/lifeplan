// 入力の画面（作業の層の部品）。左に10段階の一覧、まん中に段階の欄、右の隅に小さな結果。
// 欄は段階の定義（form.ts・stages/）だけを見て描く。値を変えるたびに世帯（現状）を作り直して親に渡し、親が計算し直す
import { useMemo, useState } from "preact/hooks";
import type { ActionDef, FieldDef, GroupDef, Level, SectionDef, StageId, Val } from "./form.ts";
import type { WorkingHousehold } from "./household.ts";
import { buildStage, stageStatus, STAGE_ORDER } from "./stages/index.ts";
import { formatYearMonth, formatYen, fromPeriod, normalizeNumberText, parseInteger, parseYearMonth, parseYen, pctFromRate, rateFromPct, toPeriod, type YenPeriod, type YenUnit } from "./units.ts";

export interface MiniResult {
  /** 例: 「ご主人95歳時点の金融資産（現状）」 */
  targetLabel: string;
  targetAmount: number | null;
  /** 例: 「2058年（ご主人77歳）」。尽きなければ null */
  depletion: string | null;
  years: number[];
  financial: number[];
  provisional: boolean;
  error: string | null;
}

interface Props {
  wh: WorkingHousehold;
  onEdit: (next: WorkingHousehold) => void;
  stage: StageId;
  onStage: (s: StageId) => void;
  level: Level;
  onLevel: (l: Level) => void;
  share: boolean;
  mini: MiniResult | null;
}

const visible = (level: Level, l: Level) => level === "detail" || l === "simple";

export function InputView({ wh, onEdit, stage, onStage, level, onLevel, share, mini }: Props) {
  const def = useMemo(() => buildStage(stage, wh), [stage, wh]);
  const statuses = useMemo(() => STAGE_ORDER.map((s) => stageStatus(buildStage(s.id, wh), wh)), [wh]);
  const idx = STAGE_ORDER.findIndex((s) => s.id === stage);
  const prev = STAGE_ORDER[idx - 1];
  const next = STAGE_ORDER[idx + 1];
  return (
    <div class="input-layout">
      <nav class="card stage-nav" aria-label="入力の段階">
        <div class="level-switch" role="group" aria-label="入力の細かさ">
          <button type="button" class={level === "simple" ? "on" : ""} aria-pressed={level === "simple"} onClick={() => onLevel("simple")}>
            簡易
          </button>
          <button type="button" class={level === "detail" ? "on" : ""} aria-pressed={level === "detail"} onClick={() => onLevel("detail")}>
            詳細
          </button>
        </div>
        <ol>
          {STAGE_ORDER.map((s, i) => {
            const st = statuses[i];
            return (
              <li key={s.id}>
                <button type="button" class={s.id === stage ? "on" : ""} aria-current={s.id === stage ? "step" : undefined} onClick={() => onStage(s.id)} data-stage={s.id}>
                  <span class="no">{i + 1}</span>
                  <span class="nm">{s.label}</span>
                  {st !== undefined && st.estimated > 0 ? (
                    <span class="est-dot" title={`推定・仮の値が ${st.estimated} 件`}>
                      推定{st.estimated}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>
        <p class="nav-note">空欄は統計の目安などで補って計算します（「推定」の印）。</p>
      </nav>

      <section class="card stage" aria-labelledby="h-stage">
        <div class="stage-h">
          <h2 id="h-stage">
            <span class="no">{idx + 1}</span>
            {def.label}
          </h2>
          <span class="aside">{def.lead}</span>
        </div>
        {def.sections
          .filter((s) => visible(level, s.level))
          .map((s) => (
            <Section key={s.key} section={s} wh={wh} level={level} onEdit={onEdit} />
          ))}
        <div class="stage-foot">
          {prev !== undefined ? (
            <button type="button" class="step-btn" onClick={() => onStage(prev.id)}>
              ← {prev.label}
            </button>
          ) : (
            <span />
          )}
          {next !== undefined ? (
            <button type="button" class="step-btn primary" onClick={() => onStage(next.id)}>
              {next.label} →
            </button>
          ) : null}
        </div>
      </section>

      <aside class="input-side">
        <MiniPanel mini={mini} />
        <p class="save-note" role="note">
          保存は次の版です（アプリを閉じると入力は消えます）
        </p>
        {!share ? <MemoPanel wh={wh} onEdit={onEdit} /> : null}
      </aside>
    </div>
  );
}

export function Section({ section, wh, level, onEdit }: { section: SectionDef; wh: WorkingHousehold; level: Level; onEdit: (w: WorkingHousehold) => void }) {
  const actions = section.actions.filter((a) => visible(level, a.level));
  return (
    <section class="in-section" aria-label={section.title}>
      <h3>{section.title}</h3>
      {section.note !== undefined ? <p class="in-note">{section.note}</p> : null}
      {section.groups
        .filter((g) => visible(level, g.level))
        .map((g) => (
          <Group key={g.key} group={g} wh={wh} level={level} onEdit={onEdit} />
        ))}
      {actions.length > 0 ? <Actions actions={actions} wh={wh} onEdit={onEdit} /> : null}
    </section>
  );
}

function Group({ group, wh, level, onEdit }: { group: GroupDef; wh: WorkingHousehold; level: Level; onEdit: (w: WorkingHousehold) => void }) {
  const fields = group.fields.filter((f) => visible(level, f.level));
  const actions = group.actions.filter((a) => visible(level, a.level));
  if (fields.length === 0 && actions.length === 0 && group.note === undefined) return null;
  if (fields.length === 0 && group.title === undefined) return <Actions actions={actions} wh={wh} onEdit={onEdit} note={group.note} />;
  const compact = group.title !== undefined && fields.length > 0 && fields.length <= 3 && fields.every((f) => f.kind === "select" || f.kind === "bool");
  return (
    <div class={`in-group${compact ? " compact" : ""}`}>
      {group.title !== undefined ? (
        <div class="in-group-h">
          <h4>{group.title}</h4>
          {actions.filter((a) => a.danger === true).map((a) => (
            <button type="button" key={a.key} class="link-btn danger" onClick={() => onEdit(a.run(wh))}>
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
      {group.note !== undefined ? <p class="in-note">{group.note}</p> : null}
      <div class="fields">
        {fields.map((f) => (
          <Field key={f.key} f={f} wh={wh} onEdit={onEdit} />
        ))}
      </div>
      {actions.some((a) => a.danger !== true) ? <Actions actions={actions.filter((a) => a.danger !== true)} wh={wh} onEdit={onEdit} /> : null}
    </div>
  );
}

function Actions({ actions, wh, onEdit, note }: { actions: ActionDef[]; wh: WorkingHousehold; onEdit: (w: WorkingHousehold) => void; note?: string | undefined }) {
  return (
    <div class="in-actions">
      {note !== undefined ? <span class="in-note">{note}</span> : null}
      {actions.map((a) => (
        <button type="button" key={a.key} class={a.danger === true ? "link-btn danger" : "add-btn"} onClick={() => onEdit(a.run(wh))} data-action={a.key}>
          {a.label}
        </button>
      ))}
    </div>
  );
}

/** 欄1つ。打っている間は下書きの文字を持ち、読める値になったらすぐ世帯に入れる（計算は親が間引く） */
export function Field({ f, wh, onEdit }: { f: FieldDef; wh: WorkingHousehold; onEdit: (w: WorkingHousehold) => void }) {
  const state = f.get(wh);
  const [draft, setDraft] = useState<string | null>(null);
  const [unit, setUnit] = useState<YenUnit>(f.kind === "yen" ? (f.unit ?? "man") : "man");
  const [period, setPeriod] = useState<YenPeriod>(f.kind === "yen" && f.basis === "annual" ? "annual" : "monthly");
  const id = `fld-${f.key.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  const commit = (v: Val) => onEdit(f.set(wh, v));
  const badge =
    state.estimated != null ? (
      <span class="badge est" title={state.estimated}>
        推定
      </span>
    ) : state.assumed != null ? (
      <span class="badge est" title={state.assumed}>
        仮
      </span>
    ) : null;

  let control;
  if (f.readOnly !== undefined) {
    control = <span class="ro">{f.kind === "select" ? (f.options.find((o) => o.value === state.value)?.label ?? "") : state.value === null ? "—" : String(state.value)}</span>;
  } else if (f.kind === "select") {
    control = (
      <select id={id} value={state.value === null ? "" : String(state.value)} onChange={(e) => commit((e.currentTarget as HTMLSelectElement).value)}>
        {state.value === null || !f.options.some((o) => o.value === state.value) ? <option value="">（選ぶ）</option> : null}
        {f.options.map((o) => (
          <option value={o.value} key={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else if (f.kind === "bool") {
    control = <input id={id} type="checkbox" checked={state.value === true} onChange={(e) => commit((e.currentTarget as HTMLInputElement).checked)} />;
  } else {
    const shown = (() => {
      if (state.value === null) return "";
      if (f.kind === "yen") {
        const v = toPeriod(state.value as number, f.basis, period);
        return v === null ? formatYen(state.value as number, unit) : formatYen(v, unit);
      }
      if (f.kind === "pct") return pctFromRate(String(state.value));
      return String(state.value);
    })();
    const parse = (text: string): Val | undefined => {
      if (normalizeNumberText(text) === "") return f.optional === true ? null : undefined;
      if (f.kind === "yen") {
        const v = parseYen(text, unit);
        return v === null || v < 0 ? undefined : fromPeriod(v, f.basis, period);
      }
      if (f.kind === "int") {
        const v = parseInteger(text);
        if (v === null) return undefined;
        if ((f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max)) return undefined;
        return v;
      }
      if (f.kind === "pct") return rateFromPct(text) ?? undefined;
      if (f.kind === "decimal") {
        const t = normalizeNumberText(text);
        return /^\d+(\.\d+)?$/.test(t) ? t : undefined;
      }
      if (f.kind === "ym") return parseYearMonth(text) ?? undefined;
      return text;
    };
    const bad = draft !== null && parse(draft) === undefined;
    control = (
      <input
        id={id}
        type="text"
        inputMode={f.kind === "text" || f.kind === "ym" ? undefined : "decimal"}
        class={`${f.kind === "text" ? "txt" : f.kind === "ym" ? "ym" : "num"}${bad ? " bad" : ""}`}
        value={draft ?? shown}
        placeholder={f.kind === "ym" ? "例: 2041-06" : f.kind === "text" ? (f.placeholder ?? "") : state.estimated != null ? "空欄＝推定" : ""}
        aria-invalid={bad ? true : undefined}
        onFocus={() => setDraft(shown)}
        onInput={(e) => {
          const t = (e.currentTarget as HTMLInputElement).value;
          setDraft(t);
          if (f.kind === "text") return;
          const v = parse(t);
          if (v !== undefined) commit(v);
        }}
        onBlur={(e) => {
          const t = (e.currentTarget as HTMLInputElement).value;
          const v = parse(t);
          if (v !== undefined) commit(v);
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        }}
      />
    );
  }

  const unitControls =
    f.kind === "yen" && f.readOnly === undefined ? (
      <span class="units">
        <button type="button" class="unit-btn" onClick={() => setUnit(unit === "man" ? "yen" : "man")} title="万円と円を切り替える">
          {unit === "man" ? "万円" : "円"}
        </button>
        {f.basis !== "once" ? (
          <button type="button" class="unit-btn" onClick={() => setPeriod(period === "monthly" ? "annual" : "monthly")} title="月額と年額を切り替える">
            {period === "monthly" ? "月額" : "年額"}
          </button>
        ) : null}
      </span>
    ) : f.kind === "pct" ? (
      <span class="suffix">%</span>
    ) : (f.kind === "int" || f.kind === "decimal") && f.suffix !== undefined ? (
      <span class="suffix">{f.suffix}</span>
    ) : null;
  const hint = state.hint ?? (f.kind === "ym" && typeof state.value === "string" ? formatYearMonth(state.value) : null);
  return (
    <div class={`fld${state.estimated != null || state.assumed != null ? " is-est" : ""}`}>
      <label for={id} class="fld-l">
        {f.label}
        {badge}
      </label>
      <div class="fld-c">
        {control}
        {unitControls}
        {hint !== null ? <span class="fld-hint">{hint}</span> : null}
      </div>
      {state.derived != null ? <div class="fld-help warn">{state.derived}</div> : null}
      {state.estimated != null ? <div class="fld-help est-basis">推定: {state.estimated}</div> : null}
      {f.readOnly !== undefined ? <div class="fld-help">{f.readOnly}</div> : f.help !== undefined ? <div class="fld-help">{f.help}</div> : null}
      {f.sideEffects !== undefined ? <div class="fld-help">{f.sideEffects}</div> : null}
    </div>
  );
}

function MiniPanel({ mini }: { mini: MiniResult | null }) {
  if (mini === null) return <div class="card mini">計算しています…</div>;
  const w = 260;
  const hgt = 84;
  const vals = mini.financial;
  const max = Math.max(1, ...vals);
  const min = Math.min(0, ...vals);
  const x = (i: number) => (vals.length <= 1 ? 0 : (i / (vals.length - 1)) * w);
  const y = (v: number) => hgt - ((v - min) / (max - min)) * hgt;
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const zero = y(0);
  return (
    <div class="card mini" aria-live="polite">
      <div class="mini-h">
        小さな結果（現状）
        {mini.provisional ? <span class="provisional">確定前</span> : null}
      </div>
      {mini.error !== null ? <p class="fatal">計算できませんでした（{mini.error}）</p> : null}
      <div class="mini-kv">
        <span class="k">資産が尽きる年</span>
        <span class={`v${mini.depletion !== null ? " neg" : ""}`} data-mini="depletion">
          {mini.depletion !== null ? `▲ ${mini.depletion}` : "尽きない"}
        </span>
      </div>
      <div class="mini-kv">
        <span class="k">{mini.targetLabel}</span>
        <span class={`v${mini.targetAmount !== null && mini.targetAmount < 0 ? " neg" : ""}`} data-mini="target">
          {mini.targetAmount === null ? "—" : formatYen(Math.round(mini.targetAmount / 10000) * 10000, "man")}
          {mini.targetAmount === null ? null : <span class="u">万円</span>}
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${hgt}`} class="spark" role="img" aria-label="金融資産残高の推移（現状）">
        <line x1={0} x2={w} y1={zero} y2={zero} class="spark-0" />
        <polyline points={pts} class="spark-line" />
        {vals.map((v, i) => (v < 0 ? <rect key={i} x={x(i) - 1} y={zero} width={2} height={Math.max(0, y(v) - zero)} class="spark-neg" /> : null))}
      </svg>
      <div class="spark-axis">
        <span>{mini.years[0]}年</span>
        <span>{mini.years.at(-1)}年</span>
      </div>
    </div>
  );
}

export function MemoPanel({ wh, onEdit }: { wh: WorkingHousehold; onEdit: (w: WorkingHousehold) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = wh.memo.join("\n");
  return (
    <section class="memo" aria-label="FP用のメモ">
      <div class="memo-h">メモ（顧客には見せない）</div>
      <textarea
        rows={5}
        value={draft ?? text}
        aria-label="FP用のメモ"
        onInput={(e) => setDraft((e.currentTarget as HTMLTextAreaElement).value)}
        onBlur={() => {
          if (draft !== null) onEdit({ ...wh, memo: draft.split("\n").filter((l) => l.trim() !== "") });
          setDraft(null);
        }}
      />
      <div class="memo-foot">共有用の表示にすると隠れます</div>
    </section>
  );
}
