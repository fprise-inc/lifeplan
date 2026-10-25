// 入力の欄の部品（作業の層）: 区画・まとまり・欄。欄は段階の定義（form.ts・stages/）だけを見て描く。
// 値を変えるたびに世帯を作り直して onEdit に渡す（入力のパネルでは下書きに、万一の画面では世帯にそのまま入れる）
import { createContext } from "preact";
import { useContext, useState } from "preact/hooks";
import { PopIcon } from "../../presentation/icons.tsx";
import type { ActionDef, FieldDef, GroupDef, Level, SectionDef, Val } from "./form.ts";
import type { WorkingHousehold } from "./household.ts";
import { formatYearMonth, formatYen, fromPeriod, normalizeNumberText, parseInteger, parseYearMonth, parseYen, pctFromRate, rateFromPct, toPeriod, type YenPeriod, type YenUnit } from "./units.ts";

export const visible = (level: Level, l: Level) => level === "detail" || l === "simple";

/** 欄の横に出す提案（例: 控えから見た実際の割合。押すと value が入る。value が null ならボタンを出さない。0031） */
export interface FieldSuggestion {
  text: string;
  action: string;
  value: Val;
  /** 根拠（開いて見る） */
  detail: string[];
}

/** 欄のキー → 提案（入力のパネルが計算して渡す） */
export const FieldSuggestions = createContext<Readonly<Record<string, FieldSuggestion>>>({});

/** 区画の見出しの横に出す小さな文字のリンク。別のパネルを開く（例: 基本生活費の「明細から出す」。0034） */
export interface SectionLink {
  label: string;
  title?: string;
  onClick: () => void;
}

/** 区画のキー → 見出しの横のリンク（入力のパネルが渡す） */
export const SectionLinks = createContext<Readonly<Record<string, SectionLink>>>({});

export function Section({ section, wh, level, onEdit }: { section: SectionDef; wh: WorkingHousehold; level: Level; onEdit: (w: WorkingHousehold) => void }) {
  const actions = section.actions.filter((a) => visible(level, a.level));
  const link = useContext(SectionLinks)[section.key];
  return (
    <section class="in-section" aria-label={section.title}>
      {link !== undefined ? (
        <div class="in-section-h">
          <h3>{section.title}</h3>
          {/* 押したときに欄からフォーカスを外さない（外すと、欄の値が入れ直されて「保存していない変更」になるため） */}
          <button type="button" class="link-btn in-section-link" onMouseDown={(e) => e.preventDefault()} onClick={link.onClick} {...(link.title !== undefined ? { title: link.title } : {})} data-section-link={section.key}>
            {link.label}
            <PopIcon />
          </button>
        </div>
      ) : (
        <h3>{section.title}</h3>
      )}
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
        <button
          type="button"
          key={a.key}
          class={a.danger === true ? "link-btn danger" : "add-btn"}
          onClick={() => onEdit(a.run(wh))}
          data-action={a.key}
          {...(a.pressed !== undefined ? { "aria-pressed": a.pressed } : {})}
          {...(a.title !== undefined ? { title: a.title } : {})}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

/**
 * 入れた文字を使えない理由（欄のすぐ下に言葉で出す。赤い枠だけにしない）。使える文字なら null。
 * 円の欄は万円か円か（unit）で読む
 */
export function rejectReason(f: FieldDef, text: string, unit: YenUnit = "man"): string | null {
  const t = normalizeNumberText(text);
  if (t === "") return f.optional === true ? null : "空にはできません。値を入れてください";
  switch (f.kind) {
    case "yen": {
      const v = parseYen(text, unit);
      if (v === null) return `数字で入れてください（例: ${unit === "man" ? "12.5" : "125000"}）`;
      return v < 0 ? "マイナスの額は入れられません。0 以上の額を入れてください" : null;
    }
    case "int": {
      const v = parseInteger(text);
      if (v === null) return "整数で入れてください";
      const out = (f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max);
      if (!out) return null;
      const u = (f.suffix ?? "").replace(/(まで|から)$/, "");
      return f.min !== undefined && f.max !== undefined ? `${f.min}${u}〜${f.max}${u}の範囲で入れてください` : f.min !== undefined ? `${f.min}${u}以上で入れてください` : `${f.max ?? ""}${u}以下で入れてください`;
    }
    case "pct":
      return rateFromPct(text) === null ? "数字で入れてください（例: 1.5）" : null;
    case "decimal":
      return /^\d+(\.\d+)?$/.test(t) ? null : "0 以上の数字で入れてください";
    case "ym":
      return parseYearMonth(text) === null ? "年月は「2041-06」のように西暦の年と月で入れてください" : null;
    default:
      return null;
  }
}

/** 欄1つ。打っている間は下書きの文字を持ち、読める値になったらすぐ世帯に入れる（計算は親が間引く） */
export function Field({ f, wh, onEdit }: { f: FieldDef; wh: WorkingHousehold; onEdit: (w: WorkingHousehold) => void }) {
  const state = f.get(wh);
  const sug = useContext(FieldSuggestions)[f.key];
  const [draft, setDraft] = useState<string | null>(null);
  /** 使えない文字のまま欄を離れたときの知らせ（前の値のままにしたこと）。次に打つまで出す */
  const [rejected, setRejected] = useState<string | null>(null);
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
  /** 入れた文字を使えない理由（打っている間）か、使えないまま離れた知らせ */
  let problem: string | null = null;
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
    problem = bad ? (rejectReason(f, draft, unit) ?? "この値は入れられません") : rejected;
    control = (
      <input
        id={id}
        type="text"
        inputMode={f.kind === "text" || f.kind === "ym" ? undefined : "decimal"}
        class={`${f.kind === "text" ? "txt" : f.kind === "ym" ? "ym" : "num"}${bad ? " bad" : ""}`}
        value={draft ?? shown}
        placeholder={f.kind === "ym" ? "例: 2041-06" : f.kind === "text" ? (f.placeholder ?? "") : state.estimated != null ? "空欄＝推定" : ""}
        aria-invalid={bad ? true : undefined}
        aria-describedby={problem !== null ? `${id}-problem` : undefined}
        onFocus={() => setDraft(shown)}
        onInput={(e) => {
          const t = (e.currentTarget as HTMLInputElement).value;
          setDraft(t);
          setRejected(null);
          if (f.kind === "text") return;
          const v = parse(t);
          if (v !== undefined) commit(v);
        }}
        onBlur={(e) => {
          const t = (e.currentTarget as HTMLInputElement).value;
          const v = parse(t);
          if (v !== undefined) commit(v);
          else setRejected(`「${t}」は入れられないため、前の値のままです。${rejectReason(f, t, unit) ?? ""}`);
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
      {sug !== undefined ? (
        <div class="fld-suggest" data-suggest={f.key}>
          <span>{sug.text}</span>
          {sug.value !== null && sug.action !== "" ? (
            <button type="button" class="link-btn" onClick={() => commit(sug.value)} data-suggest-apply>
              （{sug.action}）
            </button>
          ) : null}
          {sug.detail.length > 0 ? (
            <details>
              <summary>根拠</summary>
              <ul>
                {sug.detail.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
      {problem !== null ? (
        <div class="fld-help bad" id={`${id}-problem`} role="alert" data-field-problem={f.key}>
          {problem}
        </div>
      ) : null}
      {state.derived != null ? <div class="fld-help warn">{state.derived}</div> : null}
      {state.warn != null ? (
        <div class="fld-help warn" data-field-warn>
          {state.warn}
        </div>
      ) : null}
      {state.estimated != null ? <div class="fld-help est-basis">推定: {state.estimated}</div> : null}
      {f.readOnly !== undefined ? <div class="fld-help">{f.readOnly}</div> : f.help !== undefined ? <div class="fld-help">{f.help}</div> : null}
      {f.sideEffects !== undefined ? <div class="fld-help">{f.sideEffects}</div> : null}
    </div>
  );
}
