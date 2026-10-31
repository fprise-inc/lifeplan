// 入力の欄の部品（作業の層）: 区画・まとまり・欄。欄は段階の定義（form.ts・stages/）だけを見て描く。
// 値を変えるたびに世帯を作り直して onEdit に渡す（入力のパネルでは下書きに、万一の画面では世帯にそのまま入れる）。
// 0077: 欄の説明（help・読むだけの理由・ほかへの影響）と区画・まとまりの説明は、名前の横の「?」の中へ。推定の根拠は状態の印を押したときに開く。
// 灰色の入力例は欄の幅に収まる物だけ（placeholder.ts）
import { createContext, type ComponentChildren } from "preact";
import { useContext, useState } from "preact/hooks";
import { Help, HelpOf } from "../../presentation/Help.tsx";
import { PopIcon } from "../../presentation/icons.tsx";
import { FieldIcon } from "./fieldIcons.tsx";
import { InfoNote } from "./InfoNote.tsx";
import { fittingPlaceholder, textEm } from "./placeholder.ts";
import type { Timepoint } from "../../engine/types.ts";
import { groupShown, type ActionDef, type FieldDef, type GroupDef, type Level, type SectionDef, type TimeView, type Val, type WhenState } from "./form.ts";
import type { WorkingHousehold } from "./household.ts";
import { availableOps, fieldStatus, FILL_LABEL, fillTitle, OP_LABELS, OP_TITLES, STATUS_LABELS, typeValue, type StateOp, type ValueStatus } from "./valueState.ts";
import { formatYearMonth, formatYen, fromPeriod, normalizeNumberText, parseInteger, parseYearMonth, parseYen, pctFromRate, rateFromPct, toPeriod, type YenPeriod, type YenUnit } from "./units.ts";
import { revealAdded, revealOpened } from "../../presentation/revealAdded.ts";
import { convertWhen, modeOf, parseWhen, readWhen, readYearMonth, showWhen, WHEN_MODE_LABEL, withPerson, type WhenCtx, type WhenMode } from "./when.ts";

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

/**
 * 値の状態の操作（0041）: 欄の「この値にする」「推定に戻す」「わからない」「該当なし」を押したときに、世帯（かプランの差分）を直す関数。
 * 入力のパネルが渡す（現状なら valueState.ts の applyStateOp、プランを選んでいるならそのプランの差分にする planStateOp）。
 * 渡さない画面（結果のタブの項目・万一の前提）では、操作を出さない
 */
export const FieldStateOps = createContext<((wh: WorkingHousehold, f: FieldDef, op: StateOp) => WorkingHousehold) | null>(null);

/** 欄の「現状と違う」印（プランを直しているとき。0036 の8）。kind lever は結果のタブの対策で変わっている（ここでは戻さない） */
export interface PlanFieldMark {
  kind: "own" | "base" | "lever";
  /** 現状の値の言葉 */
  current: string;
  /** 土台のプランの名前 */
  planName: string | null;
}

/**
 * プランを直しているときの欄・まとまりの印（入力のパネルが渡す。現状を直すときは null）。欄の部品は値の読み書きを変えず、
 * 印と「↺ 現状に戻す」を添えるだけ
 */
export interface PlanMarks {
  field: (f: FieldDef, wh: WorkingHousehold) => PlanFieldMark | null;
  /** 欄を現状に戻した作業中の世帯（パネルは戻した世帯を受け取る） */
  revert: (f: FieldDef, wh: WorkingHousehold) => void;
  group: (g: GroupDef, wh: WorkingHousehold) => { kind: "own" | "base"; planName: string | null } | null;
}
export const PlanMarksContext = createContext<PlanMarks | null>(null);

function PlanMarkLine({ f, wh }: { f: FieldDef; wh: WorkingHousehold }) {
  const marks = useContext(PlanMarksContext);
  const m = marks?.field(f, wh) ?? null;
  if (marks === null || m === null) return null;
  return (
    <div class={`fld-plan ${m.kind}`} data-plan-mark={m.kind}>
      <span>
        {m.kind === "base" ? `土台（${m.planName ?? "プラン"}）で変更・` : m.kind === "lever" ? "結果のタブの対策で変わっています・" : ""}現状: {m.current}
      </span>
      {m.kind !== "lever" ? (
        <button type="button" class="link-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => marks.revert(f, wh)} data-plan-revert>
          ↺ 現状に戻す
        </button>
      ) : null}
    </div>
  );
}

function PlanGroupTag({ group, wh }: { group: GroupDef; wh: WorkingHousehold }) {
  const marks = useContext(PlanMarksContext);
  const m = marks?.group(group, wh) ?? null;
  if (m === null) return null;
  return (
    <span class={`plan-tag ${m.kind}`} data-plan-added={m.kind}>
      {m.kind === "own" ? "このプランで足した" : `土台（${m.planName ?? "プラン"}）で足した`}
    </span>
  );
}

/** 開いたときに移る欄のキー（確かめの一覧から「開く」で来たとき） */
export const FocusField = createContext<string | null>(null);

/** 欄の DOM の ID（確かめの一覧から欄へ移るときにも使う） */
export const fieldDomId = (key: string): string => `fld-${key.replace(/[^A-Za-z0-9_-]/g, "_")}`;

/** 状態の印の CSS の名前 */
const STATUS_CLASS: Record<ValueStatus, string> = { estimated: "est", unknown: "unk", notApplicable: "na", confirmed: "", missing: "missing" };

/**
 * 状態の印（推定・仮・わからない・該当なし・未入力）。根拠（推定の出どころ・代わりの値・0円の理由）があれば、印を押すと根拠が開く（0077）。
 * 確定の欄には何も出さない
 */
export function StateMark({ status, basis, text, label, fieldKey }: { status: ValueStatus; basis: string | null; text: string; label: string; fieldKey?: string }) {
  const cls = `badge ${STATUS_CLASS[status]}`;
  const data: Record<string, string> = { "data-state": status, ...(fieldKey !== undefined ? { "data-state-of": fieldKey } : {}) };
  const body =
    status === "estimated" && basis !== null
      ? `推定: ${basis}`
      : status === "unknown"
        ? `わからない（代わりの値: ${basis ?? "推定"}）`
        : status === "missing"
          ? (basis ?? "空欄（0円で計算しています）")
          : basis;
  if (body === null)
    return (
      <span class={cls} {...data}>
        {text}
      </span>
    );
  return (
    <Help label={`${label}の${status === "estimated" ? "推定の根拠" : "状態"}`} mark={text} markClass={cls} data={data}>
      <p class="est-basis" data-basis>
        {body}
      </p>
    </Help>
  );
}

/**
 * 区画・まとまりの説明を、状態の言葉（「まだありません」「該当なし」）と説明に分ける。状態は画面に出し、説明は「?」の中へ（0077）。
 * 例: 「まだありません。旅行・家電…」→ 状態「まだありません」・説明「旅行・家電…」、「まだありません（受け取っていれば…）」→ 説明「受け取っていれば…」、
 * 「該当なし。退職金・企業年金は…」→ 状態「該当なし」（0057 の 2026-10-29 の追記）
 */
export function splitNote(note: string | undefined): { state: string | null; help: string | null } {
  if (note === undefined || note === "") return { state: null, help: null };
  const m = /^(まだありません|該当なし)(。|（)?/.exec(note);
  if (m === null) return { state: null, help: note };
  let rest = note.slice(m[0].length);
  if (m[2] === "（") rest = rest.replace(/）$/, "");
  return { state: m[1] as string, help: rest.trim() === "" ? null : rest };
}

/** 欄の横の読みのうち、推定の根拠を書いた物の頭 */
const BASIS_HINT = /^推定(あり)?: /;

/** 欄の説明（「?」の中に入れる文）。無ければ null */
function fieldHelp(f: FieldDef, extra: readonly (string | null | undefined)[] = []): ComponentChildren | null {
  const lines = [f.readOnly ?? f.help, f.sideEffects, ...extra].filter((x): x is string => x !== undefined && x !== null && x !== "");
  if (lines.length === 0) return null;
  return (
    <Help label={f.label}>
      {lines.map((l, i) => (
        <p key={i}>{l}</p>
      ))}
    </Help>
  );
}

/** 区画の見出しの横に出す小さな文字のリンク。別のパネルを開く（例: 基本生活費の「明細から出す」。0034） */
export interface SectionLink {
  label: string;
  title?: string;
  onClick: () => void;
}

/** 区画のキー → 見出しの横のリンク（入力のパネルが渡す） */
export const SectionLinks = createContext<Readonly<Record<string, SectionLink>>>({});

/** まとまりの見出しの「📌 ホームに出す」（入力のパネルが渡す。ピンにできる物のまとまりだけに出す。items.ts の pinOfGroup） */
export interface PinControl {
  /** ピンにできる物のまとまりなら、その物の ID */
  refOf: (groupKey: string) => string | null;
  pinned: (ref: string) => boolean;
  toggle: (groupKey: string) => void;
}
export const PinControls = createContext<PinControl | null>(null);

function PinButton({ group }: { group: GroupDef }) {
  const pc = useContext(PinControls);
  const ref = pc?.refOf(group.key) ?? null;
  if (pc === null || ref === null) return null;
  const on = pc.pinned(ref);
  return (
    <button type="button" class="link-btn pin-btn" aria-pressed={on} onClick={() => pc.toggle(group.key)} data-pin-toggle={group.key} title={on ? "ホームのピンを外します（物は残ります）" : "入力のホームにピンとして出します（押すと、この物だけを開けます）"}>
      {on ? "📌 ホームから外す" : "📌 ホームに出す"}
    </button>
  );
}

/**
 * 入力の画面の区画の中か。年齢・年数の整数の欄（定年・年金の受け取り開始など）は、区画の中でだけ時点の部品で描く
 * （結果のタブの「動かす項目」は、同じ欄を整数のまま描く。動かす項目の値は整数で持つため）
 */
const InSection = createContext(false);

/**
 * まとまりごとの「▸ 詳しく」の開け閉め（0078 の追記）。入力の画面が渡し、同じ世帯を開いている間だけ覚える（保存しない）。
 * 渡さない画面（万一の前提など）では、区画の中で覚える。開け閉めは見せ方だけで、値は何も変えない
 */
export interface GroupOpenState {
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
}
export const GroupOpen = createContext<GroupOpenState | null>(null);

/** 開いた物の集まりを1つ切り替える */
export const toggledSet = (s: ReadonlySet<string>, key: string): ReadonlySet<string> => {
  const n = new Set(s);
  if (n.has(key)) n.delete(key);
  else n.add(key);
  return n;
};

/** 物1件・1組の欄の頭のまとまり（「▸ 詳しく」を付けられる）: 標準のまとまりで、名前があるか標準の欄がある。物の中の中枠（band）は頭にしない */
const isHead = (g: GroupDef): boolean => g.band !== true && g.level === "simple" && (g.title !== undefined || g.fields.some((f) => f.level === "simple"));

/**
 * 区画のまとまりを、物1件ごとに分ける（標準のときの「▸ 詳しく」の単位）。まとまりのキー → 属する頭のまとまりのキー。
 * 頭のまとまりは自分のキー。ほかのまとまり（金利の段階・繰上返済・資産の配分・保障の明細など）は、キーが「頭のキー/」で始まるいちばん近い頭に属する。
 * どの頭にも属さないまとまりは載せない（今のまま、詳細でだけ出る）
 */
export function groupUnits(groups: readonly GroupDef[]): Map<string, string> {
  const heads = groups.filter(isHead).map((g) => g.key);
  const out = new Map<string, string>();
  for (const g of groups) {
    if (heads.includes(g.key)) {
      out.set(g.key, g.key);
      continue;
    }
    const h = heads.filter((k) => g.key.startsWith(`${k}/`)).sort((a, b) => b.length - a.length)[0];
    if (h !== undefined) out.set(g.key, h);
  }
  return out;
}

/** 標準のときに隠れている中身（詳細の欄・ボタン・まとまり）があるか */
function hiddenIn(g: GroupDef, member: boolean): boolean {
  if (member && g.level === "detail") return g.fields.length > 0 || g.actions.length > 0;
  return g.fields.some((f) => f.level === "detail") || g.actions.some((a) => a.level === "detail") || (g.openFields ?? []).length > 0;
}

/** 頭のまとまりのキー → 「▸ 詳しく」で開く中身があるか（標準のときだけ使う） */
export function headsWithMore(groups: readonly GroupDef[]): Set<string> {
  const units = groupUnits(groups);
  const out = new Set<string>();
  for (const g of groups) {
    const h = units.get(g.key);
    if (h !== undefined && hiddenIn(g, h !== g.key)) out.add(h);
  }
  return out;
}

/** まとまりの「▸ 詳しく」の開け閉め（区画の中で使う。入力の画面が渡していなければ、区画の中で覚える） */
export function useGroupOpen(): GroupOpenState {
  const ctx = useContext(GroupOpen);
  const [local, setLocal] = useState<ReadonlySet<string>>(new Set());
  return ctx ?? { isOpen: (k) => local.has(k), toggle: (k) => setLocal((s) => toggledSet(s, k)) };
}

/**
 * 物1件の中のまとまり（1件 = 1つの枠）: まとまりのキー → それを中に描く、物の頭のまとまりのキー。
 * キーが直前の物のキー＋「/」で始まり、間が途切れずに続くまとまり（お金の行の課税の扱い・受け取る人など、ローンの金利の段階、保険の保障、
 * 物件の土地と建物・家賃収入・経費など）は、その物の枠の中に描く（枠を別に描くと、1件足しただけで何件も足したように見えるため）。
 * 渡す並びは見えているまとまりだけ。入れ子もそのまま（中のまとまりの中のまとまり）。1つずつ足して外せる物を同じ並びに置くときは ownBox で自分の枠にする。
 * キーの形が別の物を中に入れるときは partOf（直後に続けて並べる）
 */
export function entryParts(groups: readonly Pick<GroupDef, "key" | "ownBox" | "partOf">[]): Map<string, string> {
  const out = new Map<string, string>();
  const open: string[] = [];
  for (const g of groups) {
    // 自分の枠に描く物（ownBox）: 前の枠には入れず、続くまとまりも前の枠に戻さない（並びの順番を変えないため）
    if (g.ownBox === true) open.length = 0;
    // キーの形が別でも、partOf の物の中のまとまり（直後に続けて並べたときだけ）
    while (open.length > 0 && !g.key.startsWith(`${open[open.length - 1]!}/`) && g.partOf !== open[open.length - 1]) open.pop();
    const parent = open[open.length - 1];
    if (parent !== undefined) out.set(g.key, parent);
    open.push(g.key);
  }
  return out;
}

export function Section({ section, wh, level, onEdit }: { section: SectionDef; wh: WorkingHousehold; level: Level; onEdit: (w: WorkingHousehold) => void }) {
  const actions = section.actions.filter((a) => visible(level, a.level));
  const opened = useGroupOpen();
  // 標準のとき: 物1件ごとの「▸ 詳しく」。開いた物は、その物の詳細の欄・まとまりだけを出す
  const units = level === "simple" ? groupUnits(section.groups) : null;
  const withMore = level === "simple" ? headsWithMore(section.groups) : null;
  const headOpen = (g: GroupDef): string | null => {
    const h = units?.get(g.key);
    return h !== undefined && withMore?.has(h) === true && opened.isOpen(h) ? h : null;
  };
  const shownGroups = section.groups.filter((g) => groupShown(level, g) || headOpen(g) !== null);
  // 別のまとまりの中に描くまとまり（placeIn。例: 額の変化を行の額の近くに）: 置き先が見えていれば、その中に描く（見えていなければ今までどおり並べる）
  const shownKeys = new Set(shownGroups.map((g) => g.key));
  const insides = new Map<string, { group: GroupDef; placeIn: NonNullable<GroupDef["placeIn"]> }[]>();
  const placed = new Set<string>();
  for (const g of shownGroups) {
    const p = g.placeIn;
    if (p === undefined || p.group === g.key || !shownKeys.has(p.group)) continue;
    const host = shownGroups.find((x) => x.key === p.group);
    if (host === undefined || host.placeIn !== undefined) continue;
    insides.set(p.group, [...(insides.get(p.group) ?? []), { group: g, placeIn: p }]);
    placed.add(g.key);
  }
  const renderGroup = (g: GroupDef) => {
    const h = headOpen(g);
    return <Group key={g.key} group={g} wh={wh} level={h !== null ? "detail" : level} onEdit={onEdit} {...(h !== null ? { moreOf: h } : {})} nested />;
  };
  // 物1件の中のまとまり（entryParts）: 頭のまとまりの枠の中に、見出しだけで描く（枠を重ねない）
  const parts = entryParts(shownGroups.filter((g) => !placed.has(g.key)));
  const partsOf = new Map<string, GroupDef[]>();
  for (const g of shownGroups) {
    const p = parts.get(g.key);
    if (p !== undefined) partsOf.set(p, [...(partsOf.get(p) ?? []), g]);
  }
  const draw = (g: GroupDef, nested: boolean): ComponentChildren => {
    const h = headOpen(g);
    const inner = (insides.get(g.key) ?? []).map((x): InnerGroup => ({ ...x.placeIn, node: renderGroup(x.group) }));
    const subs = partsOf.get(g.key) ?? [];
    const sub = subs.map((x) => draw(x, true));
    // 頭のまとまり: 標準の欄の下に「▸ 詳しく」（中枠〔band〕に分けた物は、中枠の後の枠の最後に）。属するまとまり: 頭を開いているときだけ、詳細の中身まで出す
    if (withMore?.has(g.key) === true) return <Group key={g.key} group={g} wh={wh} level={level} onEdit={onEdit} more={{ open: h !== null, toggle: () => opened.toggle(g.key) }} inner={inner} sub={sub} nested={nested} moreLast={subs.some((x) => x.band === true)} />;
    return <Group key={g.key} group={g} wh={wh} level={h !== null ? "detail" : level} onEdit={onEdit} {...(h !== null ? { moreOf: h } : {})} inner={inner} sub={sub} nested={nested} />;
  };
  const link = useContext(SectionLinks)[section.key];
  const sn = splitNote(section.note);
  const sHelp = sn.help !== null ? <Help label={section.title}>{sn.help}</Help> : null;
  // 空の区画（お金の行などがまだ入らない置き場所）は出さない
  if (section.note === undefined && actions.length === 0 && shownGroups.length === 0) return null;
  return (
    <InSection.Provider value={true}>
      <section class="in-section" aria-label={section.title}>
        {link !== undefined ? (
          <div class="in-section-h">
            <h3>
              {section.title}
              {sHelp}
            </h3>
            {/* 押したときに欄からフォーカスを外さない（外すと、欄の値が入れ直されて「保存していない変更」になるため） */}
            <button type="button" class="link-btn in-section-link" onMouseDown={(e) => e.preventDefault()} onClick={link.onClick} {...(link.title !== undefined ? { title: link.title } : {})} data-section-link={section.key}>
              {link.label}
              <PopIcon />
            </button>
          </div>
        ) : (
          <h3>
            {section.title}
            {sHelp}
          </h3>
        )}
        {sn.state !== null ? <p class="in-note in-empty">{sn.state}</p> : null}
        {shownGroups.map((g) => (placed.has(g.key) || parts.has(g.key) ? null : draw(g, false)))}
        {actions.length > 0 ? <Actions actions={actions} wh={wh} onEdit={onEdit} /> : null}
      </section>
    </InSection.Provider>
  );
}

/** まとまりの中に描く、別のまとまり（GroupDef の placeIn。before の欄の前か after の欄の後。どちらも無ければ欄の並びの最後） */
interface InnerGroup {
  before?: string;
  after?: string;
  node: ComponentChildren;
}

/**
 * 欄の並びに、中に描くまとまりを差し込む（欄の並びを切って、その間に置く）。差し込めなかった物を返す
 */
function fieldsWithInner(list: readonly FieldDef[], inner: readonly InnerGroup[], wh: WorkingHousehold, onEdit: (w: WorkingHousehold) => void, keyHead: string): { nodes: ComponentChildren[]; rest: InnerGroup[] } {
  const used = new Set<InnerGroup>();
  const nodes: ComponentChildren[] = [];
  let run: FieldDef[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const fs = run;
    run = [];
    nodes.push(
      <div class="fields" key={`${keyHead}/f/${fs[0]!.key}`}>
        {fs.map((f) => (
          <Field key={f.key} f={f} wh={wh} onEdit={onEdit} />
        ))}
      </div>,
    );
  };
  const put = (pred: (x: InnerGroup) => boolean) => {
    const hit = inner.filter((x) => !used.has(x) && pred(x));
    if (hit.length === 0) return;
    flush();
    for (const x of hit) {
      used.add(x);
      nodes.push(x.node);
    }
  };
  for (const f of list) {
    put((x) => x.before === f.key);
    run.push(f);
    put((x) => x.after === f.key);
  }
  flush();
  return { nodes, rest: inner.filter((x) => !used.has(x)) };
}

/** まとまりの「▸ 詳しく」（頭のまとまりに渡す） */
interface GroupMore {
  open: boolean;
  toggle: () => void;
}

/** 「▸ 詳しく」を開いて入れ替えた欄の知らせ（標準だけの欄 simpleOnly の swapNote。開いていなければ無し） */
export function swapNotesOf(group: GroupDef, open: boolean): string[] {
  if (!open) return [];
  return [...new Set(group.fields.filter((f) => f.simpleOnly === true && f.swapNote !== undefined).map((f) => f.swapNote as string))];
}

/**
 * 「▸ 詳しく」の小さな文字のリンク。押した所は動かさず、開いた中身はこの下に出す（見えなければ見える所までスクロール）。
 * 押したときに欄からフォーカスを外さない（外すと、欄の値が入れ直されて「保存していない変更」になるため）
 */
export function MoreToggle({ groupKey, open, toggle, label, swapNotes = [] }: { groupKey: string; open: boolean; toggle: () => void; label?: string; swapNotes?: readonly string[] }) {
  return (
    <div class="grp-more">
      <button
        type="button"
        class="link-btn grp-more-btn"
        aria-expanded={open}
        {...(label !== undefined ? { "aria-label": `${label}を${open ? "閉じる" : "詳しく"}` } : {})}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          if (!open) revealOpened(e.currentTarget, groupKey);
          toggle();
        }}
        data-group-more={groupKey}
      >
        {open ? "▾ 詳しく（閉じる）" : "▸ 詳しく"}
      </button>
      {/* 欄を入れ替えた所は、何が変わったかを短い1行で（閉じると元に戻ることも） */}
      {open && swapNotes.length > 0 ? (
        <p class="grp-more-swap" data-more-of={groupKey} data-more-swap>
          {swapNotes.join("。")}（閉じると元に戻ります）
        </p>
      ) : null}
    </div>
  );
}

/**
 * まとまり1つ。sub は物1件の中のまとまり（entryParts。枠の最後に描く）。
 * nested は、ほかのまとまりの枠の中に描くまとまり（枠と地の色を付けず、見出しと薄い区切りの線だけ。1件 = 1つの枠）
 */
export function Group({ group, wh, level, onEdit, more, moreOf, inner = [], sub = [], nested = false, moreLast = false }: { group: GroupDef; wh: WorkingHousehold; level: Level; onEdit: (w: WorkingHousehold) => void; more?: GroupMore; moreOf?: string; inner?: readonly InnerGroup[]; sub?: readonly ComponentChildren[]; nested?: boolean; moreLast?: boolean }) {
  // 説明の欄（値ではなく説明の文）は、幅いっぱいの説明として描く（readLines.ts の infoNote）
  if (group.info !== undefined) return <InfoNote title={group.info.title} text={group.info.text} fold={group.info.fold} groupKey={group.key} />;
  // 詳細の欄が見えているとき（詳細、または標準で「▸ 詳しく」を開いたとき）は、標準だけの欄（simpleOnly）を出さない（代わりに詳細の欄を出す）
  const detailShown = level === "detail" || more?.open === true;
  const fields = group.fields.filter((f) => visible(level, f.level) && !(detailShown && f.simpleOnly === true));
  const actions = group.actions.filter((a) => visible(level, a.level));
  // 標準で「▸ 詳しく」を開いたときだけ出す欄・ボタン（詳細の欄と、詳細では別の所に出す欄 openFields）
  const extraFields = more?.open === true ? [...group.fields.filter((f) => !visible(level, f.level)), ...(group.openFields ?? [])] : [];
  const extraActions = more?.open === true ? group.actions.filter((a) => !visible(level, a.level)) : [];
  if (fields.length === 0 && actions.length === 0 && group.note === undefined && more === undefined && inner.length === 0 && sub.length === 0) return null;
  if (fields.length === 0 && group.title === undefined && inner.length === 0 && sub.length === 0) return <Actions actions={actions} wh={wh} onEdit={onEdit} note={group.note} />;
  // 中に描くまとまり: 見えている欄の前後に。見えていなければ「▸ 詳しく」で開いた欄の前後に。どちらにも無ければ見えている欄の並びの最後に
  const main = fieldsWithInner(fields, inner, wh, onEdit, group.key);
  const opened = fieldsWithInner(extraFields, main.rest, wh, onEdit, `${group.key}/more`);
  const mainNodes = opened.rest.length > 0 ? [...main.nodes, ...opened.rest.map((x) => x.node)] : main.nodes;
  // 名前の無いまとまりの説明は、欄の並びの前に「?」だけを置く
  const gn = splitNote(group.note);
  const noteHelp = gn.help !== null ? <Help label={group.title ?? "このまとまり"}>{gn.help}</Help> : null;
  const compact = group.band !== true && more?.open !== true && inner.length === 0 && sub.length === 0 && group.title !== undefined && fields.length > 0 && fields.length <= 3 && fields.every((f) => f.kind === "select" || f.kind === "bool");
  return (
    <div class={`in-group${nested ? " in-sub" : ""}${group.band === true ? " in-band" : ""}${compact ? " compact" : ""}`} data-group={group.key} {...(moreOf !== undefined ? { "data-more-of": moreOf } : {})}>
      {group.title !== undefined ? (
        <div class="in-group-h">
          <h4>
            {group.title}
            {noteHelp}
          </h4>
          <PlanGroupTag group={group} wh={wh} />
          <PinButton group={group} />
          {actions.filter((a) => a.danger === true).map((a) => (
            <HelpOf key={a.key} help={actionHelp(a)}>
              <button type="button" class="link-btn danger" onClick={() => onEdit(a.run(wh))}>
                {a.label}
              </button>
            </HelpOf>
          ))}
        </div>
      ) : null}
      {group.title === undefined ? <PlanGroupTag group={group} wh={wh} /> : null}
      {group.title === undefined && noteHelp !== null ? <div class="in-group-help">{noteHelp}</div> : null}
      {gn.state !== null ? <p class="in-note in-empty">{gn.state}</p> : null}
      {inner.length === 0 ? (
        <div class="fields">
          {fields.map((f) => (
            <Field key={f.key} f={f} wh={wh} onEdit={onEdit} />
          ))}
        </div>
      ) : (
        mainNodes
      )}
      {/* 中枠（band）は、中のまとまり（金利の段階など）を「＋」のボタンの前に（足した物の並びの後ろに、足すボタン） */}
      {group.band === true ? sub : null}
      {actions.some((a) => a.danger !== true) ? <Actions actions={actions.filter((a) => a.danger !== true)} wh={wh} onEdit={onEdit} /> : null}
      {moreLast && group.band !== true ? sub : null}
      {more !== undefined ? <MoreToggle groupKey={group.key} open={more.open} toggle={more.toggle} label={group.title ?? "この欄"} swapNotes={swapNotesOf(group, more.open)} /> : null}
      {more?.open === true && (extraFields.length > 0 || extraActions.length > 0) ? (
        <div class="grp-more-body" data-more-of={group.key}>
          {extraFields.length > 0 ? (
            inner.length === 0 ? (
              <div class="fields">
                {extraFields.map((f) => (
                  <Field key={f.key} f={f} wh={wh} onEdit={onEdit} />
                ))}
              </div>
            ) : (
              opened.nodes
            )
          ) : null}
          {extraActions.length > 0 ? <Actions actions={extraActions} wh={wh} onEdit={onEdit} /> : null}
        </div>
      ) : null}
      {moreLast || group.band === true ? null : sub}
    </div>
  );
}

/** ボタンの名前から頭の「＋」を外した物（読み上げの名前「〇〇の説明」に使う） */
const actionName = (label: string): string => label.replace(/^＋\s*/, "");

/**
 * ボタンの並び。ボタンの「?」は、そのボタンと1つのまとまり（HelpOf）にしてすぐ右に置く（間で折り返さない・次のボタンとの間を空ける）。
 * まとまりの説明（note）は、状態の言葉（「まだありません」）があればその右、無ければボタンの並び全体の右に置き、開いている間は並びのボタンを
 * 薄く強調する。説明の1行目に、どのボタンの説明かを出す（0077 の 2026-10-29 の追記。前はボタンの左に置いていて、どれの説明か分からなかった）
 */
function Actions({ actions, wh, onEdit, note }: { actions: ActionDef[]; wh: WorkingHousehold; onEdit: (w: WorkingHousehold) => void; note?: string | undefined }) {
  const sn = splitNote(note);
  const units = actionUnits(actions);
  const names = units.map((u) => (u.kind === "one" ? u.a.label : u.head.label));
  const noteHelp =
    sn.help !== null ? (
      <Help label={names.length > 0 ? names.map(actionName).join("・") : "この操作"} {...(sn.state === null && names.length > 1 ? { target: names.map((n) => `「${n}」`).join("") } : sn.state === null && names.length === 1 ? { target: names[0]! } : {})}>
        {sn.help}
      </Help>
    ) : null;
  const buttons = units.map((u) => (u.kind === "choice" ? <ChoiceAction key={u.head.key} head={u.head} items={u.list} wh={wh} onEdit={onEdit} /> : oneButton(u.a)));
  function oneButton(a: ActionDef) {
    return (
      <HelpOf key={a.key} help={actionHelp(a)}>
        <button
          type="button"
          class={a.danger === true ? "link-btn danger" : "add-btn"}
          onClick={(e) => {
            // 「＋」で足した物は、見える所へ動かして光らせ、最初の欄に移る（revealAdded）
            if (a.danger !== true && a.label.startsWith("＋")) revealAdded(e.currentTarget);
            onEdit(a.run(wh));
          }}
          data-action={a.key}
          {...(a.pressed !== undefined ? { "aria-pressed": a.pressed } : {})}
          {...(a.title !== undefined ? { title: a.title } : {})}
        >
          {a.label}
        </button>
      </HelpOf>
    );
  }
  return (
    <div class="in-actions">
      {sn.state !== null ? (
        <HelpOf help={noteHelp}>
          <span class="in-note in-empty">{sn.state}</span>
        </HelpOf>
      ) : null}
      {sn.state === null && noteHelp !== null && buttons.length > 0 ? (
        <HelpOf help={noteHelp} all>
          {buttons}
        </HelpOf>
      ) : (
        <>
          {sn.state === null ? noteHelp : null}
          {buttons}
        </>
      )}
    </div>
  );
}

/** ボタンの並びの1つ: ふつうのボタンか、選択肢をまとめた1つのボタン（ActionDef の choice。続いた同じ key の物） */
type ActionUnit = { kind: "one"; a: ActionDef } | { kind: "choice"; head: NonNullable<ActionDef["choice"]>; list: ActionDef[] };

export function actionUnits(actions: readonly ActionDef[]): ActionUnit[] {
  const out: ActionUnit[] = [];
  for (const a of actions) {
    const last = out.at(-1);
    if (a.choice === undefined) out.push({ kind: "one", a });
    else if (last?.kind === "choice" && last.head.key === a.choice.key) last.list.push(a);
    else out.push({ kind: "choice", head: a.choice, list: [a] });
  }
  return out;
}

/**
 * 選択肢をまとめた「＋」のボタン（0040 の 2026-10-29 の追記。例: 「＋ 月額の変化」）。押すとすぐ右に選択肢（「この年だけ」「この月から先」）と「やめる」を並べ、
 * 選ぶとその物を足して（足した物は見える所へ動かして光らせ、最初の欄に移る）選択肢を閉じる。「?」は1つ（選択肢の違いを書く）
 */
function ChoiceAction({ head, items, wh, onEdit }: { head: NonNullable<ActionDef["choice"]>; items: readonly ActionDef[]; wh: WorkingHousehold; onEdit: (w: WorkingHousehold) => void }) {
  const [open, setOpen] = useState(false);
  const help = head.help !== undefined && head.help !== "" ? <Help label={actionName(head.label)} target={head.label}>{head.help}</Help> : null;
  return (
    <span class="add-choice" data-choice={head.key}>
      <HelpOf help={help}>
        <button type="button" class="add-btn" aria-expanded={open} onClick={() => setOpen(!open)} data-action={head.key}>
          {head.label}
        </button>
      </HelpOf>
      {open ? (
        <span
          class="add-choice-opts"
          role="group"
          aria-label={`${actionName(head.label)}: どちらを足すか`}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          {items.map((a) => (
            <button
              type="button"
              key={a.key}
              class="add-btn add-choice-opt"
              onClick={(e) => {
                revealAdded(e.currentTarget);
                setOpen(false);
                onEdit(a.run(wh));
              }}
              data-action={a.key}
            >
              {a.label}
            </button>
          ))}
          <button type="button" class="link-btn" onClick={() => setOpen(false)} data-choice-cancel>
            やめる
          </button>
        </span>
      ) : null}
    </span>
  );
}

/** ボタンの横の「?」（ボタンの名前に書かない説明。0077 の追記）。説明が無ければ null。1行目にボタンの名前を出す */
export function actionHelp(action: ActionDef): ComponentChildren | null {
  if (action.help === undefined || action.help === "") return null;
  return (
    <Help label={actionName(action.label)} target={action.label}>
      {action.help}
    </Help>
  );
}

/** ボタンの横の「?」の部品の形（説明が無ければ何も出さない）。ボタンと並べるときは HelpOf に actionHelp を渡す */
export function ActionHelp({ action }: { action: ActionDef }) {
  return <>{actionHelp(action)}</>;
}

/** 割合の欄の範囲（min・max はパーセント）に入っているか。率は10進の文字列（"0.25" = 25%） */
function pctInRange(f: FieldDef, rate: string): boolean {
  if (f.kind !== "pct") return true;
  const pct = Number(rate) * 100;
  return (f.min === undefined || pct >= f.min - 1e-9) && (f.max === undefined || pct <= f.max + 1e-9);
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
    case "pct": {
      const r = rateFromPct(text);
      if (r === null) return "数字で入れてください（例: 1.5）";
      return pctInRange(f, r) ? null : `${f.min ?? ""}%〜${f.max ?? ""}%の範囲で入れてください`;
    }
    case "decimal":
      return /^\d+(\.\d+)?$/.test(t) ? null : "0 以上の数字で入れてください";
    case "ym":
      return parseYearMonth(text) === null ? "年月は「2041-06」「令和23年6月」のように、西暦か和暦の年と月で入れてください" : null;
    default:
      return null;
  }
}

/**
 * 数の欄の中に「この値にする」を置いたとき、値の文字に使える幅（em）。欄の幅（.fld-c input.num の 9.5em）から、ボタンの分の
 * 左の余白（app.css の input.has-fill の 5.4em）と右の余白・枠を引いた値（見えない Chrome で測って 3.6em。ボタンの右端と値の左端の間は 6px 以上）。
 * 収まらない値（円で見た大きな額など）は、ボタンを欄の横に出す（欄の値とボタンを重ねない）
 */
export const FILL_VALUE_ROOM = 3.6;

/** 推定の値を入れるボタンを、数の欄の中に置くか（値が見えていて、ボタンと重ならない長さのときだけ。0041 の追記） */
export const fillInside = (inputClass: string, shown: string): boolean => inputClass === "num" && shown !== "" && textEm(shown) <= FILL_VALUE_ROOM;

/**
 * 推定の値をそのまま欄に入れるボタン（値の状態の操作の確定と同じ。0041 の追記）。押しても欄のフォーカスを動かさない
 * （動かすと、欄の値が入れ直されて「保存していない変更」になるため）
 */
export function FillButton({ label, status, inside, onFill }: { label: string; status: ValueStatus; inside?: boolean; onFill: () => void }) {
  return (
    <button type="button" class={`fld-fill${inside === true ? " inside" : ""}`} title={fillTitle(status)} aria-label={`${label}: ${fillTitle(status)}`} onMouseDown={(e) => e.preventDefault()} onClick={onFill} data-op="confirm" data-fill-estimate>
      {FILL_LABEL}
    </button>
  );
}

/**
 * 欄の下の、値の状態の操作のリンク（推定に戻す・わからない・該当なし。0041 の 2026-10-29 の追記）。その欄でその状態で意味のある物だけを
 * 並べ、押せばすぐ変わる（前は「わからない・該当なしなど」を押して開く形だった）。「この値にする」は欄の横・中のボタン（FillButton）なので出さない。
 * 選んだ後は、印（わからない・該当なし）と、戻す操作（推定に戻す・この値にする）が同じ所に出る
 */
export function StateOpLinks({ f, ops, run, lead }: { f: FieldDef; ops: readonly StateOp[]; run: (op: StateOp) => void; lead?: ComponentChildren }) {
  const shown = ops.filter((o) => o !== "confirm");
  if (shown.length === 0 && (lead === undefined || lead === null)) return null;
  return (
    <div class="fld-ops" data-field-ops={f.key}>
      {lead}
      {shown.map((o) => (
        // 押したときに欄からフォーカスを外さない（外すと、欄の値が入れ直されて「保存していない変更」になるため）
        <button type="button" key={o} class="link-btn" title={OP_TITLES[o]} aria-label={`${f.label}: ${OP_LABELS[o]}`} onMouseDown={(e) => e.preventDefault()} onClick={() => run(o)} data-op={o}>
          {OP_LABELS[o]}
        </button>
      ))}
    </div>
  );
}

/** 欄を離れるときに書くか: 入ったときと同じ文字のまま離れたら書かない（欄に入って離れる・Tab で通るだけで、値も状態も変えない。0041） */
export const shouldCommitOnBlur = (startText: string | null, text: string): boolean => startText === null || text !== startText;

/** 欄1つ。打っている間は下書きの文字を持ち、読める値になったらすぐ世帯に入れる（計算は親が間引く） */
export function Field({ f, wh, onEdit }: { f: FieldDef; wh: WorkingHousehold; onEdit: (w: WorkingHousehold) => void }) {
  const state = f.get(wh);
  const sug = useContext(FieldSuggestions)[f.key];
  const inSection = useContext(InSection);
  const stateOps = useContext(FieldStateOps);
  const status = stateOps !== null ? fieldStatus(f, wh) : null;
  const ops = stateOps !== null && status !== null ? availableOps(f, wh, status) : [];
  const [draft, setDraft] = useState<string | null>(null);
  /** 欄に入ったときの文字（離れるときに同じ文字なら何も書かない。0041） */
  const [startText, setStartText] = useState<string | null>(null);
  /** 使えない文字のまま欄を離れたときの知らせ（前の値のままにしたこと）。次に打つまで出す */
  const [rejected, setRejected] = useState<string | null>(null);
  const [unit, setUnit] = useState<YenUnit>(f.kind === "yen" ? (f.unit ?? "man") : "man");
  const [period, setPeriod] = useState<YenPeriod>(f.kind === "yen" && f.basis === "annual" ? "annual" : "monthly");
  const id = fieldDomId(f.key);
  const commit = (v: Val) => onEdit(f.set(wh, v));
  /** 打って入れる（未入力の欄に打った値は、0円でも確定。valueState.ts の typeValue。0041 の追記） */
  const commitTyped = (v: Val) => onEdit(typeValue(f, wh, v));
  const runOp = (op: StateOp) => {
    if (stateOps === null) return;
    onEdit(stateOps(wh, f, op));
  };
  const shownStatus: ValueStatus | null = status !== null ? status.status : state.estimated != null || state.assumed != null ? "estimated" : null;
  const basisText = status?.basis ?? state.estimated ?? state.assumed ?? null;
  // 状態の印（根拠は印を押すと開く。0077）
  const badge =
    shownStatus !== null && shownStatus !== "confirmed" ? (
      <StateMark status={shownStatus} basis={shownStatus === "notApplicable" ? null : basisText} text={shownStatus === "estimated" && status === null && state.estimated == null ? "仮" : shownStatus === "missing" ? "未入力" : STATUS_LABELS[shownStatus]} label={f.label} />
    ) : state.partEstimated != null ? (
      // 欄の値は確定でも、内訳の一部が推定（年収〔賞与込み〕の賞与など）なら「推定」の印（押すと根拠。0077 の追記）
      <StateMark status="estimated" basis={state.partEstimated} text="推定" label={f.label} />
    ) : null;

  // 推定の値をそのまま入れる（値の状態の操作の確定と同じ）は、欄の横か中のボタン（0041 の追記）
  const canFill = ops.includes("confirm") && shownStatus !== null;
  const fill = (inside: boolean) => (canFill && shownStatus !== null ? <FillButton label={f.label} status={shownStatus} inside={inside} onFill={() => runOp("confirm")} /> : null);
  // ほかの操作（推定に戻す・わからない・該当なし）とプランの印は欄の下（時点の欄でも同じ。0041）
  const stateLines = (
    <>
      <PlanMarkLine f={f} wh={wh} />
      <StateOpLinks f={f} ops={ops} run={runOp} />
    </>
  );

  let control;
  /** 推定の値を入れるボタンを数の欄の中に置いたか（置かなければ、欄の横に出す） */
  let filledInside = false;
  /** 入れた文字を使えない理由（打っている間）か、使えないまま離れた知らせ */
  let problem: string | null = null;
  if (f.time !== undefined && f.readOnly === undefined && (f.kind === "when" || inSection)) {
    return <WhenField f={f} time={f.time} state={state.when ?? f.time.state(wh)} label={f.label} badge={badge} id={id} wh={wh} onEdit={onEdit} warn={state.warn ?? null} status={shownStatus} fill={fill(false)} extras={stateLines} />;
  }
  if (f.readOnly !== undefined) {
    // 円の欄は万円（か円）の書き方で、月額・年額を添える
    const roYen = (v: number, k: Extract<FieldDef, { kind: "yen" }>) => `${formatYen(v, k.unit ?? "man")}${(k.unit ?? "man") === "man" ? "万円" : "円"}${k.basis === "annual" ? "（年額）" : k.basis === "monthly" ? "（月額）" : ""}`;
    control = <span class="ro">{f.kind === "select" ? (f.options.find((o) => o.value === state.value)?.label ?? "") : state.value === null ? "—" : f.kind === "yen" && typeof state.value === "number" ? roYen(state.value, f) : String(state.value)}</span>;
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
    // 未入力（0円で計算中）の欄は空で見せる（印の0円を見せない。打てば確定になる）
    const missingNow = (status ?? fieldStatus(f, wh)).status === "missing";
    const shown = (() => {
      if (state.value === null || missingNow) return "";
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
      if (f.kind === "pct") {
        const r = rateFromPct(text);
        return r === null || !pctInRange(f, r) ? undefined : r;
      }
      if (f.kind === "decimal") {
        const t = normalizeNumberText(text);
        return /^\d+(\.\d+)?$/.test(t) ? t : undefined;
      }
      if (f.kind === "ym") return parseYearMonth(text) ?? undefined;
      return text;
    };
    const bad = draft !== null && parse(draft) === undefined;
    problem = bad ? (rejectReason(f, draft, unit) ?? "この値は入れられません") : rejected;
    const inputClass = f.kind === "text" ? "txt" : f.kind === "ym" ? "ym" : "num";
    filledInside = canFill && fillInside(inputClass, shown);
    const input = (
      <input
        id={id}
        type="text"
        inputMode={f.kind === "text" || f.kind === "ym" ? undefined : "decimal"}
        class={`${inputClass}${bad ? " bad" : ""}${filledInside ? " has-fill" : ""}`}
        value={draft ?? shown}
        placeholder={f.kind === "ym" ? "例: 2041-06" : f.kind === "text" ? fittingPlaceholder("txt", f.placeholder) : shownStatus === "notApplicable" ? "該当なし" : shownStatus === "missing" ? "未入力" : state.estimated != null ? "空欄＝推定" : ""}
        aria-invalid={bad ? true : undefined}
        aria-describedby={problem !== null ? `${id}-problem` : undefined}
        onFocus={() => {
          setDraft(shown);
          setStartText(shown);
        }}
        onInput={(e) => {
          const t = (e.currentTarget as HTMLInputElement).value;
          setDraft(t);
          setRejected(null);
          if (f.kind === "text") return;
          const v = parse(t);
          if (v !== undefined) commitTyped(v);
        }}
        onBlur={(e) => {
          const t = (e.currentTarget as HTMLInputElement).value;
          // 入ったときと同じ文字のまま離れたら、何も書かない（欄に入って離れる・Tab で通るだけで値も状態も変えない。0041）
          if (shouldCommitOnBlur(startText, t)) {
            const v = parse(t);
            if (v !== undefined) commitTyped(v);
            else setRejected(`「${t}」は入れられないため、前の値のままです。${rejectReason(f, t, unit) ?? ""}`);
          }
          setDraft(null);
          setStartText(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        }}
      />
    );
    // 数の欄は、灰色の推定の値の左（欄の中）に「この値にする」を置く。打ち始めると隠れる（app.css）
    control = filledInside ? (
      <span class="fld-box">
        {input}
        {fill(true)}
      </span>
    ) : (
      input
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
  // 年月の欄は、どれも欄に「2041-06」、横に和暦（今より後なら「今から○年後」も）。欄ごとの読み（生年月の年齢など）があればそちら
  const hint = state.hint ?? (f.kind === "ym" && typeof state.value === "string" ? readYearMonth(state.value, wh.request.input.baseMonth) : null);
  return (
    <div class={`fld${shownStatus === "estimated" ? " is-est" : shownStatus !== null && shownStatus !== "confirmed" ? ` is-${STATUS_CLASS[shownStatus]}` : ""}`} data-field={f.key}>
      <div class="fld-l">
        <label for={id}>
          {f.icon !== undefined ? <FieldIcon name={f.icon} /> : null}
          {f.label}
        </label>
        {/* 欄の説明の「?」は欄の名前のすぐ右（状態の印はその後ろ。0077 の 2026-10-29 の追記） */}
        {fieldHelp(f)}
        {badge}
      </div>
      <div class="fld-c">
        {control}
        {unitControls}
        {filledInside ? null : fill(false)}
        {hint !== null && BASIS_HINT.test(hint) && textEm(hint) > 12 ? (
          // 長い推定の根拠（「推定あり: …」）は印だけ出し、押すと開く（0077）
          <StateMark status="estimated" basis={hint.replace(BASIS_HINT, "")} text="推定" label={f.label} />
        ) : hint !== null ? (
          <span class="fld-hint">{hint}</span>
        ) : null}
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
      {stateLines}
    </div>
  );
}

/** 入れ方の選び方の並び（欄で使える入れ方だけ） */
const MODE_ORDER: readonly WhenMode[] = ["age", "ym", "event", "now"];
const PLACEHOLDER: Record<WhenMode, string> = { age: "例: 60歳", ym: "例: 2041-06", event: "例: 10年後・翌月", now: "例: 5年後" };

/** 時点の欄の読み取り（欄の決まりの範囲の確かめを含む） */
function readText(time: TimeView, wh: WorkingHousehold, ctx: WhenCtx, text: string): { tp: Timepoint | null } | { reason: string } {
  const r = parseWhen(text, ctx);
  if (!r.ok) return { reason: r.reason };
  const bad = time.when.check?.(wh, r.tp) ?? null;
  return bad !== null ? { reason: bad } : { tp: r.tp };
}

/**
 * 時点の部品（0038）: 1つの文字の欄に、年月・人の年齢・出来事から・今から のどれで打ってもよい。
 * 横の「入れ方」で見せ方を選び直せる（同じ月のまま形を変える）。読み替えた形と、読めない理由を欄の下に1行で出す。
 * 打っている間は世帯を変えず、欄を離れたとき（Enter）に入れる
 */
function WhenField({ f, time, state, label, badge, id, wh, onEdit, warn, status, fill, extras }: { f: FieldDef; time: TimeView; state: WhenState; label: string; badge: ComponentChildren; id: string; wh: WorkingHousehold; onEdit: (w: WorkingHousehold) => void; warn: string | null; status: ValueStatus | null; fill: ComponentChildren; extras: ComponentChildren }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [picked, setPicked] = useState<WhenMode | null>(null);
  // 出来事が正本の欄は、出来事の時点を見せて直す（出来事を指していることは下の行で知らせる）
  const shownRaw = state.linked?.at ?? state.raw;
  const mode = picked ?? modeOf(shownRaw, state.ctx);
  const ctx: WhenCtx = { ...state.ctx, mode, current: shownRaw };
  const shown = showWhen(shownRaw, ctx);
  const live = draft !== null && draft !== shown ? readText(time, wh, ctx, draft) : null;
  const problem = live !== null && "reason" in live ? live.reason : rejected;
  const reading = live !== null && "tp" in live ? `→ ${readWhen(live.tp, ctx, time.when.nullText)}` : state.read;
  const commit = (tp: Timepoint | null, how: "auto" | "this") => onEdit(time.setWhen(wh, tp, how));
  const modes = MODE_ORDER.filter((m) => state.ctx.modes.includes(m));
  const pickMode = (m: WhenMode) => {
    setRejected(null);
    setPicked(m);
    if (m === "event" || shownRaw === null) return;
    const next = convertWhen(shownRaw, m, state.ctx);
    if (next === null) {
      setRejected(m === "age" ? "この時点は年齢に直せません（生まれる前の月・家族の生年月が無いなど）" : "この入れ方には直せません");
      return;
    }
    // 出来事が正本の欄は、出来事の時点の形を変える（出来事を指したまま）。ほかの欄は、この欄だけ
    commit(next, state.linked !== null ? "auto" : "this");
  };
  const person = shownRaw?.memberAge?.member ?? state.ctx.person;
  const evId = mode === "event" ? state.raw?.event : undefined;
  const leave = (text: string) => {
    setDraft(null);
    if (text === shown) return;
    const r = readText(time, wh, ctx, text);
    if ("reason" in r) {
      setRejected(`「${text}」は入れられないため、前の値のままです。${r.reason}`);
      return;
    }
    setRejected(null);
    setPicked(null);
    commit(r.tp, "auto");
  };
  return (
    <div class={`fld when${status === "estimated" ? " is-est" : status !== null && status !== "confirmed" ? ` is-${STATUS_CLASS[status]}` : ""}`} data-when={f.key} data-field={f.key}>
      <div class="fld-l">
        <label for={id}>{label}</label>
        {fieldHelp(f, [state.raw !== null ? time.when.monthOnly : undefined, mode === "event" && state.ctx.events.length === 0 ? "出来事は、子の独立・持ち家の入居・年金の受け取り開始・介護の始まりや、家族の項目の「出来事」から選べます" : undefined])}
        {badge}
      </div>
      <div class="fld-c">
        <input
          id={id}
          type="text"
          class={`when-in${problem !== null && live !== null ? " bad" : ""}`}
          value={draft ?? shown}
          placeholder={fittingPlaceholder("when-in", state.raw === null && time.when.nullText !== undefined ? `空欄＝${time.when.nullText}` : null, PLACEHOLDER[mode])}
          aria-invalid={live !== null && "reason" in live ? true : undefined}
          aria-describedby={`${id}-read`}
          onFocus={() => setDraft(shown)}
          onInput={(e) => {
            setDraft((e.currentTarget as HTMLInputElement).value);
            setRejected(null);
          }}
          onBlur={(e) => leave((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          }}
        />
        {modes.length > 1 ? (
          <select class="when-mode" aria-label={`${label}の入れ方`} value={mode} onChange={(e) => pickMode((e.currentTarget as HTMLSelectElement).value as WhenMode)} data-when-mode>
            {modes.map((m) => (
              <option value={m} key={m}>
                {WHEN_MODE_LABEL[m]}
              </option>
            ))}
          </select>
        ) : null}
        {mode === "age" && state.ctx.people.length > 1 ? (
          <select class="when-who" aria-label={`${label}は誰の年齢で`} value={person ?? ""} onChange={(e) => commit(withPerson(shownRaw, (e.currentTarget as HTMLSelectElement).value, state.ctx), state.linked !== null ? "auto" : "this")} data-when-who>
            {person === null ? <option value="">（誰の年齢か）</option> : null}
            {state.ctx.people.map((p) => (
              <option value={p.id} key={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        ) : null}
        {mode === "event" ? (
          <select class="when-event" aria-label={`${label}の出来事`} value={evId ?? ""} onChange={(e) => {
              const v = (e.currentTarget as HTMLSelectElement).value;
              if (v !== "") commit({ event: v }, "this");
            }}
            data-when-event
          >
            {evId === undefined || !state.ctx.events.some((x) => x.id === evId) ? <option value="">（出来事を選ぶ）</option> : null}
            {state.ctx.events.map((x) => (
              <option value={x.id} key={x.id}>
                {x.label}
                {x.ym !== null ? `（${formatYearMonth(x.ym)}${x.candidate === true ? "・選ぶと出来事にします" : ""}）` : ""}
              </option>
            ))}
          </select>
        ) : null}
        {fill}
      </div>
      <div class="fld-help when-read" id={`${id}-read`} data-when-read={f.key}>
        {reading}
      </div>
      {mode === "event" && state.ctx.events.length === 0 ? <div class="fld-help">選べる出来事がまだありません</div> : null}
      {state.linked !== null ? (
        <div class="fld-help warn" data-when-linked>
          「{state.linked.label}」の出来事の時点です。ここを直すと出来事が動き、{state.linked.refs > 1 ? `この出来事を指すほかの${state.linked.refs - 1}件も一緒に動きます` : "この出来事を指す物も一緒に動きます"}
        </div>
      ) : null}
      {warn !== null ? (
        <div class="fld-help warn" data-field-warn>
          {warn}
        </div>
      ) : null}
      {problem !== null ? (
        <div class="fld-help bad" id={`${id}-problem`} role="alert" data-field-problem={f.key}>
          {problem}
        </div>
      ) : null}
      {extras}
    </div>
  );
}
