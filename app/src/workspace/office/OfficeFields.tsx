// 事務所の既定値の画面の部品（0261）: 区画の見出し（左の線＋太字＋「?」）・まとまりの枠・欄。
// 欄は入力項目の部品（0236・0240）と同じ形と class（.fld・.fld-l・.fld-c・.fld-in・input.num・.suffix・.seg-g.fld-seg・.fld.is-check・.fld-help）で描く。
// 説明は「?」の中に入れ、欄の下は1行だけ（空欄のときの値・例・範囲の外の知らせのどれか）
import type { ComponentChildren } from "preact";
import { Help } from "../../presentation/Help.tsx";

type Data = Readonly<Record<`data-${string}`, string | boolean>>;

/** 区画（段2の見出し。見出しは h4〔パネルの名前 h2・画面の名前 h3 の下〕。説明の文は頭に1文だけ。長い説明は「?」の中） */
export function OfficeSection({ id, title, help, lead, children, data }: { id: string; title: string; help?: ComponentChildren; lead?: ComponentChildren; children: ComponentChildren; data?: Data }) {
  return (
    <section class="os-sec" aria-labelledby={id} {...data}>
      <h4 id={id} class="os-h">
        {title}
        {help !== undefined ? (
          <Help label={title} id={`os-${id}`}>
            {help}
          </Help>
        ) : null}
      </h4>
      {lead !== undefined ? <p class="os-lead">{lead}</p> : null}
      {children}
    </section>
  );
}

/** 区画の中のまとまり（枠。段3の見出し） */
export function OfficeGroup({ title, help, children, data, class: cls }: { title?: string; help?: ComponentChildren; children: ComponentChildren; data?: Data; class?: string }) {
  return (
    <div class={`os-grp${cls !== undefined ? ` ${cls}` : ""}`} {...data}>
      {title !== undefined ? (
        <h5 class="os-grp-h">
          {title}
          {help !== undefined ? <Help label={title}>{help}</Help> : null}
        </h5>
      ) : null}
      {children}
    </div>
  );
}

/** 欄の名前の行（名前 →「?」） */
function FieldName({ id, label, help, as = "label" }: { id: string; label: string; help?: ComponentChildren; as?: "label" | "span" }) {
  return (
    <div class="fld-l">
      {as === "label" ? <label for={id}>{label}</label> : <span id={`${id}-l`}>{label}</span>}
      {help !== undefined ? <Help label={label}>{help}</Help> : null}
    </div>
  );
}

/** 文字の欄の id（欄の名前の label と結ぶ。キーの点などはそのまま使える） */
export const fieldId = (key: string): string => `os-f-${key}`;

/** 数の欄（率・年数・円）。範囲の外・読めない文字の知らせは欄の下（無ければ空欄のときの値などの1行） */
export function NumField(p: {
  name: string;
  label: string;
  value: string;
  onInput: (v: string) => void;
  suffix?: string;
  placeholder?: string;
  help?: ComponentChildren;
  note?: ComponentChildren | null;
  problem?: string | null;
  bad?: boolean;
  numeric?: boolean;
  /** 欄（input）に付ける data- の属性 */
  data?: Data;
  /** 知らせの行の data- の属性 */
  problemData?: Data;
  /** 欄を包む .fld に付ける data- の属性 */
  wrapData?: Data;
}) {
  const id = fieldId(p.name);
  const problem = p.problem ?? null;
  return (
    <div class="fld" {...p.wrapData}>
      <FieldName id={id} label={p.label} help={p.help} />
      <div class="fld-c">
        <span class="fld-in">
          <input id={id} type="text" class={`num${p.bad === true || problem !== null ? " bad" : ""}`} inputMode={p.numeric === true ? "numeric" : "decimal"} value={p.value} placeholder={p.placeholder ?? ""} aria-invalid={p.bad === true || problem !== null} onInput={(e) => p.onInput((e.currentTarget as HTMLInputElement).value)} {...p.data} />
          {p.suffix !== undefined && p.suffix !== "" ? <span class="suffix">{p.suffix}</span> : null}
        </span>
      </div>
      {problem !== null ? (
        <div class="fld-help bad" role="alert" {...p.problemData}>
          {problem}
        </div>
      ) : p.note !== undefined && p.note !== null && p.note !== "" ? (
        <div class="fld-help">{p.note}</div>
      ) : null}
    </div>
  );
}

/** 選ぶ欄 */
export function SelectField<V extends string>(p: { name: string; label: string; value: V; options: readonly { value: V; label: string }[]; onPick: (v: V) => void; help?: ComponentChildren; note?: ComponentChildren | null; data?: Data; wrapData?: Data }) {
  const id = fieldId(p.name);
  return (
    <div class="fld" {...p.wrapData}>
      <FieldName id={id} label={p.label} help={p.help} />
      <div class="fld-c">
        <select id={id} value={p.value} onChange={(e) => p.onPick((e.currentTarget as HTMLSelectElement).value as V)} {...p.data}>
          {p.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {p.note !== undefined && p.note !== null && p.note !== "" ? <div class="fld-help">{p.note}</div> : null}
    </div>
  );
}

/**
 * 区切りボタン（決まった短い2〜3択。0236 の4）。矢印キー（←→↑↓）・Home・End で移って選ぶ。
 * 選択肢ごとの data- の属性は、それぞれのボタンに付ける
 */
export function SegField<V extends string>(p: { name: string; label: string; value: V; options: readonly { value: V; label: string; data?: Data }[]; onPick: (v: V) => void; help?: ComponentChildren; note?: ComponentChildren | null; wrapData?: Data }) {
  const id = fieldId(p.name);
  const cur = p.options.findIndex((o) => o.value === p.value);
  const onKey = (e: KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    const to = e.key === "Home" ? 0 : e.key === "End" ? p.options.length - 1 : step !== 0 ? (i + step + p.options.length) % p.options.length : -1;
    if (to < 0) return;
    e.preventDefault();
    ((e.currentTarget as HTMLElement).parentElement?.children[to] as HTMLElement | undefined)?.focus();
    const o = p.options[to];
    if (o !== undefined && to !== cur) p.onPick(o.value);
  };
  return (
    <div class="fld" {...p.wrapData}>
      <FieldName id={id} label={p.label} help={p.help} as="span" />
      <div class="fld-c">
        <span class="seg-g fld-seg" role="radiogroup" aria-labelledby={`${id}-l`}>
          {p.options.map((o, i) => (
            <button key={o.value} type="button" role="radio" aria-checked={i === cur} tabIndex={i === (cur >= 0 ? cur : 0) ? 0 : -1} onClick={() => p.onPick(o.value)} onKeyDown={(e) => onKey(e, i)} {...o.data}>
              {o.label}
            </button>
          ))}
        </span>
      </div>
      {p.note !== undefined && p.note !== null && p.note !== "" ? <div class="fld-help">{p.note}</div> : null}
    </div>
  );
}

/** チェックの欄（四角が左・名前が右の1行。0236 の1）。説明は名前の下の小さな1行 */
export function CheckField(p: { name: string; label: string; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean; title?: string; note?: ComponentChildren | null; help?: ComponentChildren; data?: Data; wrapData?: Data }) {
  const id = fieldId(p.name);
  return (
    <div class="fld is-check" {...p.wrapData}>
      <div class="fld-c fld-check">
        <span class="fld-check-main">
          <input type="checkbox" id={id} checked={p.checked} disabled={p.disabled === true} onChange={(e) => p.onChange((e.currentTarget as HTMLInputElement).checked)} {...(p.title !== undefined ? { title: p.title } : {})} {...p.data} />
          <span class="fld-check-name">
            <label for={id}>{p.label}</label>
            {p.help !== undefined ? (
              <span class="fld-check-q">
                {"⁠"}
                <Help label={p.label}>{p.help}</Help>
              </span>
            ) : null}
            {p.note !== undefined && p.note !== null && p.note !== "" ? <small class="os-note">{p.note}</small> : null}
          </span>
        </span>
      </div>
    </div>
  );
}
