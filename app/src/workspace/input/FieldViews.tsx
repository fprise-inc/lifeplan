// 入力の欄の部品（作業の層）: 区画・まとまり・欄。欄は段階の定義（form.ts・stages/）だけを見て描く。
// 値を変えるたびに世帯を作り直して onEdit に渡す（入力のパネルでは下書きに、万一の画面では世帯にそのまま入れる）。
// 0077: 欄の説明（help・読むだけの理由・ほかへの影響）と区画・まとまりの説明は、名前の横の「?」の中へ。推定の根拠は状態の印を押したときに開く。
// 灰色の入力例は欄の幅に収まる物だけ（placeholder.ts）。欄は、離れたとき（か Enter）に値を決める（打っている途中の空や読めない文字で物を消さない）
import { createContext, type ComponentChildren } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";
import { Help, HelpOf } from "../../presentation/Help.tsx";
import { PopIcon } from "../../presentation/icons.tsx";
import { FieldIcon } from "./fieldIcons.tsx";
import { InfoNote } from "./InfoNote.tsx";
import { FoldClose, FoldedGroup, useFold } from "./FoldedGroup.tsx";
import { blankLineFor, fittingPlaceholder, textEm } from "./placeholder.ts";
import { enterInput, noteRejected, type Settled } from "./pendingInput.ts";
import type { Timepoint } from "../../engine/types.ts";
import { groupShown, type ActionDef, type FieldDef, type FieldState, type GroupDef, type Level, type Option, type SectionDef, type TimeView, type Val, type WhenState } from "./form.ts";
import type { WorkingHousehold } from "./household.ts";
import { availableOps, fieldStatus, hasFieldValue, FILL_LABEL, fillTitle, OP_LABELS, opTitle, STATUS_LABELS, substituteText, confirmTyped, typeFromAge, typeValue, type StateOp, type ValueStatus } from "./valueState.ts";
import { amountWarning, formatYearMonth, formatYen, fromPeriod, normalizeNumberText, parseDatedYearMonth, parseInteger, parseYearMonth, pctFromRate, rateFromPct, readYen, toPeriod, type YenPeriod, type YenUnit } from "./units.ts";
import { outOfRangeText, rateInRange } from "./rateRanges.ts";
import { revealAdded, revealOpened } from "../../presentation/revealAdded.ts";
import { applyOfficeName, applyOfficeText, arrangeFields, officeLabel, OfficeFieldsContext, OfficeNamesContext, OfficeTextsContext, type OfficeTextEntry } from "../office/customTexts.ts";
import { estimateTextId, estimateValueText, ESTIMATE_OFFICIAL, fieldTextId } from "./textIds.ts";
import { fillName } from "../../../../report/src/rowNames.ts";
import { ageExample, birthFromAge, convertWhen, endBeforeStart, eventOptionText, modeOf, parseWhen, readWhen, readYearMonth, showWhen, strictShown, typingCtx, WHEN_MODE_LABEL, withPerson, type WhenCtx, type WhenMode } from "./when.ts";
import { isOfficeBasisText } from "../../../../hearing/src/statistics.ts";
import type { OfficeSourceView } from "./officeSource.ts";
import { readableDoc } from "../documents/start.ts";

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
 * 値の状態の操作（0041）: 欄の「この値にする」「推定に戻す」「書類で確かめる」「該当なし」を押したときに、世帯（かプランの差分）を直す関数。
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
  // どのプランにも共通の欄（表の最後の年など）: プランを直している間は、プランの差分にならないことを一言で出す（0043 の追記 2026-11-05）
  if (marks !== null && f.planShared !== undefined)
    return (
      <div class="fld-plan shared" data-plan-shared>
        <span>{f.planShared}</span>
      </div>
    );
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

/**
 * 書類待ちの欄の「この書類を読む」（0154 の3）: 欄のキーを渡すと、その欄の書類（書類のお願いの1通）の読み取りへ進む。読める書類（保険証券。0159）の欄だけに出す。
 * 入力のパネルが置く（プランの編集中・読み取りの入口の無い画面では null で、ボタンを出さない）
 */
export const DocReadContext = createContext<((fieldKey: string) => void) | null>(null);

/** 欄の DOM の ID（確かめの一覧から欄へ移るときにも使う） */
export const fieldDomId = (key: string): string => `fld-${key.replace(/[^A-Za-z0-9_-]/g, "_")}`;

/** 状態の印の CSS の名前 */
const STATUS_CLASS: Record<ValueStatus, string> = { estimated: "est", unknown: "unk", notApplicable: "na", confirmed: "", missing: "missing" };

/**
 * 状態の印（推定・仮・書類待ち・該当なし・未入力）。根拠（推定の出どころ・代わりの値・0円の理由）があれば、印を押すと根拠が開く（0077）。
 * 書類待ちは、確かめる書類（欄の定義の docCheck）を添える。確定の欄には何も出さない
 */
export function StateMark({ status, basis, text, label, fieldKey, doc, docKey, estimate, office }: { status: ValueStatus; basis: string | null; text: string; label: string; fieldKey?: string; doc?: string | undefined; docKey?: string; estimate?: { id: string | null; value: string }; office?: OfficeSourceView | undefined }) {
  const texts = useContext(OfficeTextsContext);
  const readDoc = useContext(DocReadContext);
  const readKey = docKey ?? fieldKey;
  // 事務所の推定の値から作った推定（値の箱の印。0111 の追記 2026-11-03）は、印の文字を変えずに点線の下線だけ足す（顧客と見る画面を重くしない）
  const fromOffice = office !== undefined && (status === "estimated" || status === "unknown");
  const cls = `badge ${STATUS_CLASS[status]}${fromOffice ? " office" : ""}`;
  const data: Record<string, string> = { "data-state": status, ...(fieldKey !== undefined ? { "data-state-of": fieldKey } : {}), ...(fromOffice ? { "data-est-source": office.changed.length > 0 ? "office-changed" : "office" } : {}) };
  // 推定の根拠の文の事務所の文（説明の一覧の estimate:…。消せない。公式の文は {basis} に入る。0016 の 2026-11-02 の追記）。
  // 事務所の推定の値（事務所の既定値の画面で変えた値。0111）から作った推定は、その根拠の文（事務所の文と変えた年月）をそのまま出し、カスタム層の文を当てない。
  // 見分けは値の箱の印（形式 0.54 から。根拠の文を後で書き換えても見分けられる）と、印の無い推定の根拠の文が今の事務所の文とまったく同じか
  const est = status === "estimated" && basis !== null && estimate !== undefined && texts.size > 0 && office === undefined && !isOfficeBasisText(basis) ? officeEstimate(texts.get(estimate.id ?? ""), basis, estimate.value) : null;
  const body =
    status === "estimated" && basis !== null
      ? `推定: ${est?.text ?? basis}`
      : status === "unknown"
        ? `書類待ち（${doc !== undefined ? `${doc}で確かめるまで、` : ""}${substituteText(basis ?? "推定")}）`
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
      {fromOffice ? (
        <p class="est-office" data-est-office={office.changed.length > 0 ? "changed" : "current"}>
          {office.changed.length > 0 ? OFFICE_SOURCE_CHANGED : OFFICE_SOURCE_NOTE}
        </p>
      ) : null}
      {est !== null && basis !== null ? <OfficeTextMark entry={est.office} official={`推定: ${basis}`} /> : null}
      {status === "unknown" && readDoc !== null && readKey !== undefined && doc !== undefined && readableDoc(doc) ? (
        <p>
          <button type="button" class="link-btn" onClick={() => readDoc(readKey)} data-state-read-doc={readKey} title="この書類の読み取り（AI の答えの貼り付け）へ進みます。読んだ値は確かめて承認したものだけが入ります">
            この書類を読む
          </button>
        </p>
      ) : null}
    </Help>
  );
}

/** 事務所の推定の値から作った推定の、根拠の下の1行（FP 向けの「?」の中だけ） */
export const OFFICE_SOURCE_NOTE = "事務所の推定の値（事務所の既定値）から作った推定です。";
/** 作った後に事務所の推定の値を変えた・公式に戻したときの1行 */
export const OFFICE_SOURCE_CHANGED = "事務所の推定の値から作った推定です。作った後に事務所の値を変えたので、この欄は前の値のままです（確かめの一覧に出ます）。";

/** 推定の根拠の文に事務所の文を当てる（書き換え・足すだけ。消す行は本体が承認しない。差し込みの印は {basis} と {value}） */
export function officeEstimate(e: OfficeTextEntry | undefined, basis: string, value: string): { text: string; office: OfficeTextEntry } | null {
  if (e === undefined || e.text === null || e.official !== ESTIMATE_OFFICIAL || (e.do !== "replace" && e.do !== "append")) return null;
  const mine = fillName(e.text, { basis, value });
  return { text: e.do === "append" ? `${basis}\n${mine}` : mine, office: e };
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

/**
 * 「?」の中の説明の文を段落と箇条書きにする（0106）。改行（\n）で区切った行のうち「・」で始まる行は続けて1つの箇条書きに、ほかの行は段落にする。
 * 改行の無い文は今までどおり1つの段落
 */
export function helpBlocks(text: string, key = "h"): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  let items: string[] = [];
  const flush = () => {
    if (items.length === 0) return;
    out.push(
      <ul key={`${key}-${out.length}`}>
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>,
    );
    items = [];
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("・")) {
      items.push(line.slice(1));
      continue;
    }
    flush();
    if (line.trim() !== "") out.push(<p key={`${key}-${out.length}`}>{line}</p>);
  }
  flush();
  return out;
}

/**
 * 事務所の文の札と、公式の文を開く所（カスタム層の説明の文の差し替え。0016 の追記）。FP 向けの「?」の箱の中だけに出す
 * （提示層・持ち帰り用のレポートには出さない）
 */
export function OfficeTextMark({ entry, official }: { entry: OfficeTextEntry; official: string }) {
  return (
    <details class="help-office" data-help-office={entry.id}>
      <summary>{officeLabel(entry)}・公式の文を見る</summary>
      {helpBlocks(official, "official")}
    </details>
  );
}

/** 欄の説明（「?」の中に入れる文）。承認した事務所の文があれば当てる（読むだけの理由には当てない）。無ければ null */
function FieldHelp({ f, wh, extra = [] }: { f: FieldDef; wh: WorkingHousehold; extra?: readonly (string | null | undefined)[] }) {
  const texts = useContext(OfficeTextsContext);
  const help = f.readOnly === undefined && f.help !== undefined && f.help !== "" ? f.help : null;
  const ap = help !== null && texts.size > 0 ? applyOfficeText(texts, fieldTextId(f, wh), help) : { text: f.readOnly ?? f.help ?? null, office: null };
  const lines = [ap.text, f.sideEffects, ...extra].filter((x): x is string => x !== undefined && x !== null && x !== "");
  // 事務所の名前を当てた欄は、「?」でいつでも公式の名前を見られる（説明が無い欄でも「?」を出す）
  if (lines.length === 0 && f.officialLabel === undefined) return null;
  return (
    <Help label={f.label}>
      {lines.flatMap((l, i) => helpBlocks(l, String(i)))}
      {ap.office !== null && help !== null ? <OfficeTextMark entry={ap.office} official={help} /> : null}
      {f.officialLabel !== undefined ? (
        <p class="help-official-name" data-official-name={f.officialLabel}>
          公式の名前: {f.officialLabel}（事務所の名前で出しています）
        </p>
      ) : null}
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
 * 頭のまとまりは自分のキー。ほかのまとまり（金利の段階・繰上返済・資産の配分・保障の明細など）は、キーが「頭のキー/」で始まるいちばん近い頭に属する
 * （unitOf で頭を名指ししたまとまりは、その頭）。
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
    // 属する頭を名指ししたまとまり（unitOf。キーの形は別でも、その頭の「▸」で開く）
    if (g.unitOf !== undefined && heads.includes(g.unitOf)) {
      out.set(g.key, g.unitOf);
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
  const sHelp = sn.help !== null ? <Help label={section.title}>{helpBlocks(sn.help)}</Help> : null;
  // 空の区画（お金の行などがまだ入らない置き場所）は出さない
  if (section.note === undefined && actions.length === 0 && shownGroups.length === 0) return null;
  return (
    <InSection.Provider value={true}>
      <section class="in-section" aria-label={section.title} data-section={section.key}>
        {link !== undefined ? (
          <div class="in-section-h">
            <h3>
              {section.title}
              {section.summary !== undefined ? <small class="in-sum">{section.summary}</small> : null}
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
            {section.summary !== undefined ? <small class="in-sum">{section.summary}</small> : null}
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

/** 文を「・」の後ろで折り返せるようにする（言葉の途中で折り返さない。CSS の word-break: keep-all と組み合わせる） */
function withBreaks(text: string): ComponentChildren {
  const parts = text.split("・");
  return parts.flatMap((p, i) => (i < parts.length - 1 ? [`${p}・`, <wbr key={i} />] : [p]));
}

/** 「▸ 続きを見る」の文が無い所（まとまりの moreLabel・口座の種類の文が無い所。新しく足す物の受け皿）の文 */
export const MORE_DEFAULT = "続きを見る";

/**
 * 「▸ 続きを見る」の読み上げ用の名前（0078 の追記 2026-11-01）: 見えている文そのものに、物の名前を括弧で添える
 * （「呼び名・性別などを入れる（配偶者）」「閉じる（配偶者）」）。開け閉めの状態は aria-expanded で伝える
 */
export function moreAriaLabel(text: string | undefined, label: string, open: boolean): string {
  return `${open ? "閉じる" : (text ?? MORE_DEFAULT)}（${label}）`;
}

/**
 * 「▸ 詳しく」の小さな文字のリンク。押した所は動かさず、開いた中身はこの下に出す（見えなければ見える所までスクロール）。
 * 押したときに欄からフォーカスを外さない（外すと、欄の値が入れ直されて「保存していない変更」になるため）。
 * text は閉じているときの文（「呼び名・性別などを入れる」。頭の「▸」は付けない。無ければ「続きを見る」）。
 * 文が長くて折り返すときも、2行目は「▸」の後ろにそろえる（表の行の中など幅が狭い所で崩れないように）
 */
export function MoreToggle({ groupKey, open, toggle, label, text, swapNotes = [] }: { groupKey: string; open: boolean; toggle: () => void; label?: string; text?: string | undefined; swapNotes?: readonly string[] }) {
  return (
    <div class="grp-more">
      <button
        type="button"
        class="link-btn grp-more-btn"
        aria-expanded={open}
        {...(label !== undefined ? { "aria-label": moreAriaLabel(text, label, open) } : {})}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          if (!open) revealOpened(e.currentTarget, groupKey);
          toggle();
        }}
        data-group-more={groupKey}
      >
        <span class="grp-more-mark" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span class="grp-more-text">{open ? "閉じる" : withBreaks(text ?? MORE_DEFAULT)}</span>
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
  // 事務所の欄の見せ方（カスタム層の隠す・並べ替え。見せ方だけで、世帯の値と計算は変えない。値の入った欄は隠さない）
  const layout = useContext(OfficeFieldsContext);
  const arrange = (fs: readonly FieldDef[]) => arrangeFields(fs, (f) => fieldTextId(f, wh), (f) => hasFieldValue(f, wh), layout);
  // ふだんは閉じておくまとまり（folded。FoldedGroup.tsx）: 閉じている間は説明と開くボタンだけ
  const fold = useFold(group, useGroupOpen());
  if (fold?.open === false) return <FoldedGroup group={group} onOpen={fold.toggle} nested={nested} />;
  // 説明の欄（値ではなく説明の文）は、幅いっぱいの説明として描く（readLines.ts の infoNote）
  if (group.info !== undefined) return <InfoNote title={group.info.title} text={group.info.text} fold={group.info.fold} groupKey={group.key} />;
  // 詳細の欄が見えているとき（詳細、または標準で「▸ 詳しく」を開いたとき）は、標準だけの欄（simpleOnly）を出さない（代わりに詳細の欄を出す）
  const detailShown = level === "detail" || more?.open === true;
  const fields = arrange(group.fields.filter((f) => visible(level, f.level) && !(detailShown && f.simpleOnly === true)));
  const actions = group.actions.filter((a) => visible(level, a.level));
  // 標準で「▸ 詳しく」を開いたときだけ出す欄・ボタン（詳細の欄と、詳細では別の所に出す欄 openFields）
  const extraFields = more?.open === true ? arrange([...group.fields.filter((f) => !visible(level, f.level)), ...(group.openFields ?? [])]) : [];
  const extraActions = more?.open === true ? group.actions.filter((a) => !visible(level, a.level)) : [];
  if (fields.length === 0 && actions.length === 0 && group.note === undefined && more === undefined && inner.length === 0 && sub.length === 0) return null;
  if (group.chips === true) return <Chips group={group} actions={actions} wh={wh} onEdit={onEdit} />;
  if (fields.length === 0 && group.title === undefined && inner.length === 0 && sub.length === 0) return <Actions actions={actions} wh={wh} onEdit={onEdit} note={group.note} />;
  // 中に描くまとまり: 見えている欄の前後に。見えていなければ「▸ 詳しく」で開いた欄の前後に。どちらにも無ければ見えている欄の並びの最後に
  const main = fieldsWithInner(fields, inner, wh, onEdit, group.key);
  const opened = fieldsWithInner(extraFields, main.rest, wh, onEdit, `${group.key}/more`);
  const mainNodes = opened.rest.length > 0 ? [...main.nodes, ...opened.rest.map((x) => x.node)] : main.nodes;
  // 名前の無いまとまりの説明は、欄の並びの前に「?」だけを置く
  const gn = splitNote(group.note);
  const noteHelp = gn.help !== null ? <Help label={group.title ?? "このまとまり"}>{helpBlocks(gn.help)}</Help> : null;
  const compact = group.band !== true && more?.open !== true && inner.length === 0 && sub.length === 0 && group.title !== undefined && fields.length > 0 && fields.length <= 3 && fields.every((f) => f.kind === "select" || f.kind === "bool");
  return (
    <div class={`in-group${nested ? " in-sub" : ""}${group.band === true ? " in-band" : ""}${compact ? " compact" : ""}`} data-group={group.key} {...(moreOf !== undefined ? { "data-more-of": moreOf } : {})}>
      {group.title !== undefined ? (
        <div class="in-group-h">
          <h4>
            {group.title}
            {group.summary !== undefined ? <small class="in-sum">{group.summary}</small> : null}
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
      {fold?.closable === true ? <FoldClose groupKey={group.key} label={group.title ?? group.folded?.name ?? "この欄"} onClose={fold.toggle} /> : null}
      {more !== undefined ? <MoreToggle groupKey={group.key} open={more.open} toggle={more.toggle} label={group.title ?? "この欄"} text={group.moreLabel} swapNotes={swapNotesOf(group, more.open)} /> : null}
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

/**
 * ひな形の小さなボタンの並び（0068 の追記 2026-10-31）: 上に1行の案内（まとまりの title）、ボタンの chip の group ごとに1行で、小さな見出しの後に
 * ボタンを並べる。足したひな形はボタンの横に「入れた（…）」の小さな字（押せるまま）。足す相手がいないボタンは押せない
 */
function Chips({ group, actions, wh, onEdit }: { group: GroupDef; actions: ActionDef[]; wh: WorkingHousehold; onEdit: (w: WorkingHousehold) => void }) {
  const rows: { head: string; list: ActionDef[] }[] = [];
  for (const a of actions) {
    const head = a.chip?.group ?? "";
    const last = rows.at(-1);
    if (last?.head === head) last.list.push(a);
    else rows.push({ head, list: [a] });
  }
  return (
    <div class={`in-group in-chips${group.chipsFull === true ? " full" : ""}`} data-chips={group.key}>
      {group.title !== undefined ? <p class="in-chips-lead">{group.title}</p> : null}
      {rows.map((r) => (
        <div class="in-chips-row" key={r.head}>
          {r.head !== "" ? <span class="in-chips-h">{r.head}</span> : null}
          <div class="in-chips-list">
            {r.list.map((a) => (
              <span class="in-chip" key={a.key}>
                <HelpOf help={actionHelp(a)}>
                  <button
                    type="button"
                    class={group.chipsFull === true ? "add-btn" : "add-btn chip-btn"}
                    data-action={a.key}
                    disabled={a.chip?.disabled === true}
                    onClick={(e) => {
                      if (a.label.startsWith("＋")) revealAdded(e.currentTarget);
                      onEdit(a.run(wh));
                    }}
                  >
                    {a.label}
                  </button>
                </HelpOf>
                {a.chip?.added !== undefined ? <span class="in-chip-added">{a.chip.added}</span> : null}
              </span>
            ))}
          </div>
        </div>
      ))}
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

/** 見出しのある選択肢の一覧の組（「よく使う」を先頭に、続いた同じ見出しの物を1組。0055 の追記 2026-11-02）。見出しが無ければ null */
export const FREQUENT_HEADING = "よく使う";
export function choiceSections(items: readonly ActionDef[]): { heading: string; list: ActionDef[] }[] | null {
  if (!items.some((a) => a.choice?.group !== undefined)) return null;
  const frequent = items.filter((a) => a.choice?.frequent === true);
  const out: { heading: string; list: ActionDef[] }[] = [];
  for (const a of items) {
    const heading = a.choice?.group ?? "そのほか";
    const last = out.at(-1);
    if (last?.heading === heading) last.list.push(a);
    else out.push({ heading, list: [a] });
  }
  return frequent.length > 0 ? [{ heading: FREQUENT_HEADING, list: frequent }, ...out] : out;
}

/**
 * 選択肢をまとめた「＋」のボタン（0040 の 2026-10-29 の追記。例: 「＋ 月額の変化」）。押すとすぐ右に選択肢（「この年だけ」「この月から先」）と「キャンセル」を並べ、
 * 選ぶとその物を足して（足した物は見える所へ動かして光らせ、最初の欄に移る）選択肢を閉じる。「?」は1つ（選択肢の違いを書く）。
 * 選択肢が見出しを持つとき（「＋ 保険契約を足す」。0055 の追記 2026-11-02）は、ボタンの下に見出しごとの一覧を開いて最初の選択肢に移る。
 * Esc か「キャンセル」で閉じて、元のボタンに戻る（選び直しの取りやめは「キャンセル」。0130）
 */
function ChoiceAction({ head, items, wh, onEdit }: { head: NonNullable<ActionDef["choice"]>; items: readonly ActionDef[]; wh: WorkingHousehold; onEdit: (w: WorkingHousehold) => void }) {
  const [open, setOpen] = useState(false);
  const headRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sections = choiceSections(items);
  const listed = sections !== null;
  useEffect(() => {
    if (open && listed) listRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open, listed]);
  const close = () => {
    setOpen(false);
    headRef.current?.focus();
  };
  const help = head.help !== undefined && head.help !== "" ? <Help label={actionName(head.label)} target={head.label}>{head.help}</Help> : null;
  const option = (a: ActionDef, key: string) => (
    <button
      type="button"
      key={key}
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
  );
  const cancel = (
    <button type="button" class="link-btn" onClick={close} data-choice-cancel>
      キャンセル
    </button>
  );
  // Esc は選択肢だけを閉じる（入力項目の画面まで閉じない）
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    close();
  };
  return (
    <span class={listed ? "add-choice add-choice-listed" : "add-choice"} data-choice={head.key}>
      <HelpOf help={help}>
        <button type="button" class="add-btn" ref={headRef} aria-expanded={open} onClick={() => setOpen(!open)} data-action={head.key}>
          {head.label}
        </button>
      </HelpOf>
      {open && sections !== null ? (
        <div class="add-choice-list" role="group" ref={listRef} aria-label={`${actionName(head.label)}: どれを足すか`} onKeyDown={onKeyDown}>
          {sections.map((sec) => (
            <div class="add-choice-sec" key={sec.heading} role="group" aria-label={sec.heading} data-choice-heading={sec.heading}>
              <div class="add-choice-head" aria-hidden="true">
                {sec.heading}
              </div>
              <div class="add-choice-items">{sec.list.map((a) => option(a, `${sec.heading}/${a.key}`))}</div>
            </div>
          ))}
          <div class="add-choice-foot">{cancel}</div>
        </div>
      ) : open ? (
        <span class="add-choice-opts" role="group" aria-label={`${actionName(head.label)}: どちらを足すか`} onKeyDown={onKeyDown}>
          {items.map((a) => option(a, a.key))}
          {cancel}
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

/** 割合の欄の範囲（min・max はパーセント）に入っているか。率は10進の文字列（"0.25" = 25%。0098） */
function pctInRange(f: FieldDef, rate: string): boolean {
  return f.kind !== "pct" || rateInRange(rate, f);
}

/** 年月の欄の範囲（earliest・latest）の外なら、その理由（0162）。生年月は今月まで（これから生まれる子は別の足し方）・120歳まで */
function ymOutOfRange(f: FieldDef, ym: string): string | null {
  if (f.kind !== "ym") return null;
  if (f.latest !== undefined && ym > f.latest) return `${formatYearMonth(f.latest)}より後の年月は入れられません${f.ageInput === true ? "（これから生まれる子は、家族の「＋ これから生まれる子」で足します）" : ""}`;
  if (f.earliest !== undefined && ym < f.earliest) return `${formatYearMonth(f.earliest)}より前の年月は入れられません`;
  return null;
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
      const r = readYen(text, unit);
      if (!r.ok) return r.reason;
      return r.yen < 0 ? "マイナスの額は入れられません。0 以上の額を入れてください" : null;
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
      // 範囲の外は、越えた側の端を出す（「15%より大きい値は設定できません。」。0098）
      return pctInRange(f, r) ? null : (outOfRangeText(r, f) ?? "この値は入れられません");
    }
    case "decimal":
      return /^\d+(\.\d+)?$/.test(t) ? null : "0 以上の数字で入れてください";
    case "ym": {
      const ym = parseYearMonth(text);
      if (ym !== null) return ymOutOfRange(f, ym);
      // 日つき（1980-02-29・昭和55年2月29日）は日を落として年月で入れる。ありえない日は止める（0162）
      const dated = parseDatedYearMonth(text);
      if (dated !== null) return "reason" in dated ? dated.reason : ymOutOfRange(f, dated.ym);
      if (f.ageInput === true) return birthFromAge(text, "2000-01") !== null ? null : "年月は「1988-05」「昭和63年5月」のように、西暦か和暦の年と月で入れてください（年齢しか分からなければ「38歳」）";
      return "年月は「2020-04」「令和2年4月」のように、西暦か和暦の年と月で入れてください";
    }
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
 * 欄の下の、値の状態の操作のリンク（推定に戻す・書類で確かめる・該当なし。0041 の 2026-10-29 の追記）。その欄でその状態で意味のある物だけを
 * 並べ、押せばすぐ変わる（前は「わからない・該当なしなど」を押して開く形だった。「わからない」は 2026-10-31 に「書類で確かめる」にした）。「この値にする」は欄の横・中のボタン（FillButton）なので出さない。
 * 選んだ後は、印（書類待ち・該当なし）と、戻す操作（推定に戻す・この値にする）が同じ所に出る
 */
export function StateOpLinks({ f, ops, run, lead }: { f: FieldDef; ops: readonly StateOp[]; run: (op: StateOp) => void; lead?: ComponentChildren }) {
  const shown = ops.filter((o) => o !== "confirm");
  if (shown.length === 0 && (lead === undefined || lead === null)) return null;
  return (
    <div class="fld-ops" data-field-ops={f.key}>
      {lead}
      {shown.map((o) => (
        // 押したときに欄からフォーカスを外さない（外すと、欄の値が入れ直されて「保存していない変更」になるため）
        <button type="button" key={o} class="link-btn" title={opTitle(f, o)} aria-label={`${f.label}: ${OP_LABELS[o]}`} onMouseDown={(e) => e.preventDefault()} onClick={() => run(o)} data-op={o}>
          {OP_LABELS[o]}
        </button>
      ))}
    </div>
  );
}

/**
 * ほかの入力と合わないときの知らせ（欄の下の1行）。直し方（FieldState.warnFix）があれば、その横にボタン（押したときだけ直す。0070 で確かめの一覧の
 * 注意の行に出していた物を、欄の下にも出す。段4の確かめで、購入の時期の「購入の時期に合わせる」が入力のパネルに出ていなかった）
 */
function WarnLine({ f, text, fix, wh, onEdit }: { f: FieldDef; text: string; fix: FieldState["warnFix"] | null; wh: WorkingHousehold; onEdit: (w: WorkingHousehold) => void }) {
  return (
    <div class="fld-help warn" data-field-warn>
      {text}
      {fix != null ? (
        <>
          {" "}
          <button type="button" class="link-btn" aria-label={`${f.label}: ${fix.label}`} onClick={() => onEdit(fix.run(wh))} data-warn-fix={f.key}>
            {fix.label}
          </button>
        </>
      ) : null}
    </div>
  );
}

/** 欄を離れるときに書くか: 入ったときと同じ文字のまま離れたら書かない（欄に入って離れる・Tab で通るだけで、値も状態も変えない。0041） */
export const shouldCommitOnBlur = (startText: string | null, text: string): boolean => startText === null || text !== startText;

/**
 * 打ったら同じ文字でも書く欄の状態か（推定・書類待ち。仮の値も推定の状態で読む）。欄に入ってから文字を打ったなら、入ったときと同じ文字に
 * 戻っても書く（打った値は推定と同じでも確定。0041 の追記 2026-11-07）。打たずに離れたら shouldCommitOnBlur のとおり書かない
 */
export const typedStateful = (s: { status: ValueStatus }): boolean => s.status === "estimated" || s.status === "unknown";

/**
 * 打った文字を欄の値として読んだ結果。note は読み替えの知らせ（「15万円（150,000円）として入れました」）、warn は桁の確かめ、
 * fromAge は年齢から出した値の確定の根拠（「38歳」と打った生年月。確定にし、確かさは「年齢から」と残す。0041 の追記 2026-11-07）
 */
export interface FieldRead {
  v: Val;
  note: string | null;
  warn: string | null;
  fromAge: string | null;
}

/**
 * 打った文字を欄の値として読む（読めない・入れられない文字は undefined）。円の欄は見せている単位（unit）と期間（period）で読み、保存の期間の額にする。
 * 生年月の欄（ageInput）は年齢でも読み、生まれた年月の幅のまん中を年齢から出した確定の値にする（根拠は「年齢から」）
 */
export function readField(f: FieldDef, text: string, o: { unit: YenUnit; period: YenPeriod; baseMonth: string }): FieldRead | undefined {
  const plainRead = (v: Val): FieldRead => ({ v, note: null, warn: null, fromAge: null });
  if (normalizeNumberText(text) === "") return f.optional === true ? plainRead(null) : undefined;
  switch (f.kind) {
    case "yen": {
      const r = readYen(text, o.unit);
      if (!r.ok || r.yen < 0) return undefined;
      const stored = fromPeriod(r.yen, f.basis, o.period);
      return { v: stored, note: r.note, warn: amountWarning(r, o.unit, { basis: f.basis, stored, typicalMax: f.typicalMax, text }), fromAge: null };
    }
    case "int": {
      const v = parseInteger(text);
      if (v === null) return undefined;
      if ((f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max)) return undefined;
      return plainRead(v);
    }
    case "pct": {
      const r = rateFromPct(text);
      return r === null || !pctInRange(f, r) ? undefined : plainRead(r);
    }
    case "decimal": {
      const t = normalizeNumberText(text);
      return /^\d+(\.\d+)?$/.test(t) ? plainRead(t) : undefined;
    }
    case "ym": {
      const ym = parseYearMonth(text);
      if (ym !== null) return ymOutOfRange(f, ym) === null ? plainRead(ym) : undefined;
      const dated = parseDatedYearMonth(text);
      if (dated !== null) {
        if ("reason" in dated || ymOutOfRange(f, dated.ym) !== null) return undefined;
        const first = dated.day === 1 && f.ageInput === true ? "1日生まれなら、詳細の「1日生まれ」をオンにしてください" : "日は入れません";
        return { v: dated.ym, note: `${formatYearMonth(dated.ym)}として入れました（${first}）`, warn: null, fromAge: null };
      }
      const b = f.ageInput === true ? birthFromAge(text, o.baseMonth) : null;
      if (b === null || ymOutOfRange(f, b.ym) !== null) return undefined;
      return { v: b.ym, note: `${b.age}歳（${formatYearMonth(b.ym)}生まれとして入れました。月が分かれば直してください）`, warn: null, fromAge: `年齢から（${b.age}歳と聞いて出した生年月）` };
    }
    default:
      return plainRead(text);
  }
}

/** 選ぶ欄の選択肢。見出し（group）のある選択肢は、同じ見出しが続く所を optgroup にまとめる */
export function optionNodes(options: readonly Option[]): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  let i = 0;
  while (i < options.length) {
    const head = options[i]?.group;
    if (head === undefined) {
      const o = options[i] as Option;
      out.push(
        <option value={o.value} key={o.value}>
          {o.label}
        </option>,
      );
      i++;
      continue;
    }
    const list: Option[] = [];
    while (i < options.length && options[i]?.group === head) list.push(options[i++] as Option);
    out.push(
      <optgroup label={head} key={`g:${head}:${list[0]?.value ?? ""}`}>
        {list.map((o) => (
          <option value={o.value} key={o.value}>
            {o.label}
          </option>
        ))}
      </optgroup>,
    );
  }
  return out;
}

/**
 * 欄1つ。打っている間は下書きの文字を持ち、欄を離れたとき（Enter）に読んで世帯に入れる（打っている途中の空や読めない文字・途中の数で
 * 物を消したり、関連する値を動かしたりしない。時点の欄と同じ）。読めない文字は、打っている間から欄の下に理由を出す
 */
export function Field({ f: given, wh, onEdit }: { f: FieldDef; wh: WorkingHousehold; onEdit: (w: WorkingHousehold) => void }) {
  // 事務所の名前（カスタム層の名前の差し替え。承認した物だけ）: 欄の名前・読み上げの名前・「?」の見出しのどこでも同じ名前にする
  const names = useContext(OfficeNamesContext);
  const named = names.size > 0 ? applyOfficeName(names, fieldTextId(given, wh), given.label) : null;
  const f: FieldDef = named !== null && named.office !== null ? { ...given, label: named.name, officialLabel: given.label } : given;
  const state = f.get(wh);
  const sug = useContext(FieldSuggestions)[f.key];
  const inSection = useContext(InSection);
  const stateOps = useContext(FieldStateOps);
  const status = stateOps !== null ? fieldStatus(f, wh) : null;
  const ops = stateOps !== null && status !== null ? availableOps(f, wh, status) : [];
  const [draft, setDraft] = useState<string | null>(null);
  /** 欄に入ったときの文字（離れるときに同じ文字なら何も書かない。0041）。打ちかけの値を決めたら、決めた文字にする */
  const startText = useRef<string | null>(null);
  /** 欄に入ってから文字を打ったか（打っていれば、同じ文字に戻っても推定の欄は確定にする。打つのは明示の操作。0041 の追記 2026-11-07） */
  const typed = useRef(false);
  const inputEl = useRef<HTMLInputElement>(null);
  /** 打ちかけの値の登録を外す（pendingInput.ts。入っている間だけ持つ） */
  const leaveInput = useRef<(() => void) | null>(null);
  /** 打ちかけの値を決める（画面を変える操作の前に pendingInput.ts から呼ぶ。描くたびに今の下書きの読み方にする） */
  const settleNow = useRef<() => Settled>(() => "none");
  // 欄が消えたら登録だけ外す（消えた欄から値は書かない。消える前の操作が決めている）
  useEffect(
    () => () => {
      leaveInput.current?.();
      leaveInput.current = null;
    },
    [],
  );
  /** 使えない文字のまま欄を離れたときの知らせ（前の値のままにしたこと）。次に打つまで出す */
  const [rejected, setRejected] = useState<string | null>(null);
  /** 入れたときの知らせ（読み替え・桁の確かめ）。次に欄に入るまで出す */
  const [told, setTold] = useState<{ note: string | null; warn: string | null } | null>(null);
  const [unit, setUnit] = useState<YenUnit>(f.kind === "yen" ? (f.unit ?? "man") : "man");
  const [period, setPeriod] = useState<YenPeriod>(f.kind === "yen" && f.basis === "annual" ? "annual" : "monthly");
  const id = fieldDomId(f.key);
  const commit = (v: Val) => onEdit(f.set(wh, v));
  /**
   * 打って入れる（未入力の欄に打った値は0円でも、推定と同じ値でも確定。valueState.ts の typeValue。0041 の追記）。
   * 年齢から出した生年月は、根拠「年齢から」を残した確定（typeFromAge）
   */
  const commitTyped = (r: FieldRead) => onEdit(r.fromAge !== null ? typeFromAge(f, wh, r.v, r.fromAge) : typeValue(f, wh, r.v));
  const runOp = (op: StateOp) => {
    if (stateOps === null) return;
    onEdit(stateOps(wh, f, op));
  };
  const shownStatus: ValueStatus | null = status !== null ? status.status : state.estimated != null || state.assumed != null ? "estimated" : null;
  const basisText = status?.basis ?? state.estimated ?? state.assumed ?? null;
  // 状態の印（根拠は印を押すと開く。0077）
  const badge =
    shownStatus !== null && shownStatus !== "confirmed" ? (
      <StateMark status={shownStatus} basis={shownStatus === "notApplicable" ? null : basisText} text={shownStatus === "estimated" && status === null && state.estimated == null ? "仮" : shownStatus === "missing" ? "未入力" : STATUS_LABELS[shownStatus]} label={f.label} doc={f.docCheck} docKey={f.key} estimate={{ id: estimateTextId(f, wh), value: estimateValueText(f, wh) }} office={status?.office} />
    ) : null;
  // 欄の値は確定でも、内訳の一部が推定（年収〔賞与込み〕の賞与など）: 欄の名前の横の札は出さない（札は欄の値そのものが推定のときだけ。
  // 通しの確かめ。0150）。内訳の行（「うち賞与 108.1万円（推定）」）の後ろに小さな「推定」の印を置き、押すと推定の部分の根拠
  const partLine = shownStatus === "confirmed" || shownStatus === null ? (state.partEstimated ?? null) : null;

  // 推定の値をそのまま入れる（値の状態の操作の確定と同じ）は、欄の横か中のボタン（0041 の追記）
  const canFill = ops.includes("confirm") && shownStatus !== null;
  const fill = (inside: boolean) => (canFill && shownStatus !== null ? <FillButton label={f.label} status={shownStatus} inside={inside} onFill={() => runOp("confirm")} /> : null);
  // ほかの操作（推定に戻す・書類で確かめる・該当なし）とプランの印は欄の下（時点の欄でも同じ。0041）
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
  /** 空欄の意味が欄に収まらなかったときの、欄の下の1行（「空欄なら: ○○」） */
  let blankLine: string | null = null;
  if (f.time !== undefined && f.readOnly === undefined && (f.kind === "when" || inSection)) {
    return <WhenField f={f} time={f.time} state={state.when ?? f.time.state(wh)} label={f.label} badge={badge} id={id} wh={wh} onEdit={onEdit} warn={state.warn ?? null} warnFix={state.warnFix ?? null} status={shownStatus} fill={fill(false)} extras={stateLines} />;
  }
  if (f.readOnly !== undefined) {
    // 円の欄は万円（か円）の書き方で、月額・年額を添える
    const roYen = (v: number, k: Extract<FieldDef, { kind: "yen" }>) => `${formatYen(v, k.unit ?? "man")}${(k.unit ?? "man") === "man" ? "万円" : "円"}${k.basis === "annual" ? "（年額）" : k.basis === "monthly" ? "（月額）" : ""}`;
    control = <span class="ro">{f.kind === "select" ? (f.options.find((o) => o.value === state.value)?.label ?? "") : state.value === null ? "—" : f.kind === "yen" && typeof state.value === "number" ? roYen(state.value, f) : String(state.value)}</span>;
  } else if (f.kind === "select") {
    control = (
      <select id={id} value={state.value === null ? "" : String(state.value)} onChange={(e) => commit((e.currentTarget as HTMLSelectElement).value)}>
        {state.value === null || !f.options.some((o) => o.value === state.value) ? <option value="">（選ぶ）</option> : null}
        {optionNodes(f.options)}
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
    const readOpts = { unit, period, baseMonth: wh.request.input.baseMonth };
    /** 読めてもほかの入力と合わず書けない理由（欄の refuse。0161） */
    const refused = (text: string): string | null => {
      if (f.refuse === undefined) return null;
      const r = readField(f, text, readOpts);
      return r === undefined ? null : f.refuse(wh, r.v);
    };
    const parse = (text: string): FieldRead | undefined => {
      const r = readField(f, text, readOpts);
      return r !== undefined && f.refuse?.(wh, r.v) != null ? undefined : r;
    };
    /** 打った文字を決める（入ったときと同じ文字なら何もしない。読めれば書いて知らせを出す。読めなければ書かない） */
    const decide = (t: string): Settled => {
      if (!shouldCommitOnBlur(startText.current, t) && !(typed.current && typedStateful(status ?? fieldStatus(f, wh)))) return "none";
      const r = parse(t);
      if (r === undefined) return "rejected";
      commitTyped(r);
      startText.current = t;
      typed.current = false;
      setTold(r.note !== null || r.warn !== null ? { note: r.note, warn: r.warn } : null);
      return "committed";
    };
    // 欄を離れずに画面を変える操作の前（pendingInput.ts）: 今の下書きを決める。読めなければ欄に残して止める（理由は下書きから欄の下に出ている）
    settleNow.current = () => decide(inputEl.current?.value ?? draft ?? shown);
    const bad = draft !== null && parse(draft) === undefined;
    problem = bad ? (refused(draft) ?? rejectReason(f, draft, unit) ?? "この値は入れられません") : rejected;
    const inputClass = f.kind === "text" ? "txt" : f.kind === "ym" ? "ym" : "num";
    filledInside = canFill && fillInside(inputClass, shown);
    // 灰色の入力例: 空欄に意味のある欄は「空欄＝○○」を先に（収まらなければ欄の下の1行）、次に欄ごとの例。年月の欄の共通の例は過去の年月
    const blankMeans = f.blankMeans ?? (state.estimated != null ? "推定" : null);
    const blankText = blankMeans !== null ? `空欄＝${blankMeans}` : null;
    const example = f.example ?? (f.kind === "ym" ? (f.ageInput === true ? "例: 1988-05" : "例: 2020-04") : null);
    const placeholder =
      f.kind === "text"
        ? fittingPlaceholder("txt", f.placeholder, example)
        : shownStatus === "notApplicable"
          ? "該当なし"
          : shownStatus === "missing"
            ? "未入力"
            : fittingPlaceholder(inputClass, blankText, example);
    blankLine = (draft ?? shown) === "" && f.blankMeans !== undefined ? blankLineFor(inputClass, f.blankMeans) : null;
    const input = (
      <input
        ref={inputEl}
        id={id}
        type="text"
        inputMode={f.kind === "text" || f.kind === "ym" ? undefined : "decimal"}
        class={`${inputClass}${bad ? " bad" : ""}${filledInside ? " has-fill" : ""}`}
        value={draft ?? shown}
        placeholder={placeholder}
        aria-invalid={bad ? true : undefined}
        aria-describedby={problem !== null ? `${id}-problem` : undefined}
        onFocus={() => {
          setDraft(shown);
          startText.current = shown;
          typed.current = false;
          setTold(null);
          leaveInput.current = enterInput({ settle: () => settleNow.current(), focus: () => inputEl.current?.focus() });
        }}
        onInput={(e) => {
          // 打っている間は下書きだけ（世帯は変えない）。読めない文字の理由は下書きから欄の下に出す
          setDraft((e.currentTarget as HTMLInputElement).value);
          typed.current = true;
          setRejected(null);
          setTold(null);
        }}
        onBlur={(e) => {
          leaveInput.current?.();
          leaveInput.current = null;
          const t = (e.currentTarget as HTMLInputElement).value;
          // 入ったときと同じ文字のまま離れたら、何も書かない（欄に入って離れる・Tab で通るだけで値も状態も変えない。0041）
          if (decide(t) === "rejected") {
            setRejected(`「${t}」は入れられないため、前の値のままです。${refused(t) ?? rejectReason(f, t, unit) ?? ""}`);
            noteRejected(() => inputEl.current?.focus());
          }
          setDraft(null);
          startText.current = null;
          typed.current = false;
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
        <FieldHelp f={f} wh={wh} />
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
        {partLine !== null ? <StateMark status="estimated" basis={partLine} text="推定" label={`${f.label}の内訳`} /> : null}
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
      {blankLine !== null ? (
        <div class="fld-help" data-field-blank={f.key}>
          {blankLine}
        </div>
      ) : null}
      {told?.note != null ? (
        <div class="fld-help" role="status" data-field-read-note={f.key}>
          {told.note}
        </div>
      ) : null}
      {told?.warn != null ? (
        <div class="fld-help warn" role="status" data-field-size-warn={f.key}>
          {told.warn}
        </div>
      ) : null}
      {state.derived != null ? <div class="fld-help warn">{state.derived}</div> : null}
      {state.warn != null ? <WarnLine f={f} text={state.warn} fix={state.warnFix ?? null} wh={wh} onEdit={onEdit} /> : null}
      {stateLines}
    </div>
  );
}

/** 入れ方の選び方の並び（欄で使える入れ方だけ） */
const MODE_ORDER: readonly WhenMode[] = ["age", "ym", "event", "now"];
/** 入れ方ごとの灰色の入力例（年齢は物差しの人で変える。when.ts の ageExample） */
const PLACEHOLDER: Record<WhenMode, string> = { age: "例: 65歳", ym: "例: 2041-06", event: "例: 10年後・翌月", now: "例: 5年後" };
/** 空の欄で入れ方を選んだときに、欄の下に出す打ち方（出来事からは横の選択肢で選ぶ） */
const PICK_HINT: Record<Exclude<WhenMode, "event">, string> = { age: "年齢を打ってください（例: 60 と打つと60歳）", ym: "年月を打ってください（例: 2041-06・令和23年6月）", now: "何年後かを打ってください（例: 5 と打つと今から5年後）" };

/** 時点の欄の読み取り（欄の決まりの範囲の確かめを含む） */
function readText(time: TimeView, wh: WorkingHousehold, ctx: WhenCtx, text: string): { tp: Timepoint | null } | { reason: string } {
  const r = parseWhen(text, ctx);
  if (!r.ok) return { reason: r.reason };
  // 終わりの欄は、始まりより前の終わりを止める（このままでは0か月の期間になる。0162）
  const bad = endBeforeStart(ctx, r.tp) ?? time.when.check?.(wh, r.tp) ?? null;
  return bad !== null ? { reason: bad } : { tp: r.tp };
}

/**
 * 時点の部品（0038）: 1つの文字の欄に、年月・人の年齢・出来事から・○年後 のどれで打ってもよい（○年後を入れ方に出すのは、それが既定の欄だけ）。
 * 横の「入れ方」で見せ方を選び直せる（同じ月のまま形を変える）。読み替えた形と、読めない理由を欄の下に1行で出す。
 * 打っている間は世帯を変えず、欄を離れたとき（Enter）に入れる
 */
function WhenField({ f, time, state, label, badge, id, wh, onEdit, warn, warnFix, status, fill, extras }: { f: FieldDef; time: TimeView; state: WhenState; label: string; badge: ComponentChildren; id: string; wh: WorkingHousehold; onEdit: (w: WorkingHousehold) => void; warn: string | null; warnFix: FieldState["warnFix"]; status: ValueStatus | null; fill: ComponentChildren; extras: ComponentChildren }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [picked, setPicked] = useState<WhenMode | null>(null);
  const input = useRef<HTMLInputElement>(null);
  /** 欄に入ってから文字を打ったか（推定の欄は、同じ文字に戻っても確定にする。0041 の追記 2026-11-07） */
  const typed = useRef(false);
  /** 打ったが同じ時点の文字のまま: 推定・書類待ちの欄なら、その値のまま打った確定にする（valueState.ts の confirmTyped） */
  const sameTyped = (text: string, wasTyped: boolean): boolean => text === shown && wasTyped && status !== null && typedStateful({ status });
  /**
   * 打った時点を書く。書いた後も推定・書類待ちのまま（空欄に灰色で見せている推定と同じ時点を打ったなど）なら、打った確定にする
   * （0041 の追記 2026-11-07。「70」と打っても推定のままだった）
   */
  const commitTypedWhen = (tp: Timepoint | null, wasTyped: boolean) => {
    const next = time.setWhen(wh, tp, "auto");
    onEdit(wasTyped && tp !== null && typedStateful(fieldStatus(f, next)) ? confirmTyped(f, next) : next);
  };
  /** 打ちかけの値の登録を外す（pendingInput.ts） */
  const leaveInput = useRef<(() => void) | null>(null);
  const settleNow = useRef<() => Settled>(() => "none");
  useEffect(
    () => () => {
      leaveInput.current?.();
      leaveInput.current = null;
    },
    [],
  );
  // 出来事が正本の欄は、出来事の時点を見せて直す（出来事を指していることは下の行で知らせる）
  const actualRaw = state.linked?.at ?? state.raw;
  // 使える入れ方だけで見せる欄は、ほかの形の前の値を同じ月の既定の入れ方で見せる（直すとその形で書く。0101）
  const strict = time.when.strictModes === true ? strictShown(actualRaw, state.ctx) : null;
  const shownRaw = strict?.tp ?? actualRaw;
  const mode = picked ?? modeOf(shownRaw, state.ctx);
  const ctx: WhenCtx = { ...state.ctx, mode, current: shownRaw };
  // 打った文字は、横の「誰の年齢で」に見せている人の年齢として読む（when.ts の typingCtx。0162）
  const typing = typingCtx(state.ctx, shownRaw, mode);
  const shown = showWhen(shownRaw, ctx);
  const live = draft !== null && draft !== shown ? readText(time, wh, typing, draft) : null;
  const problem = live !== null && "reason" in live ? live.reason : rejected;
  const reading = live !== null && "tp" in live ? `→ ${readWhen(live.tp, ctx, time.when.nullText)}` : state.read;
  const commit = (tp: Timepoint | null, how: "auto" | "this") => onEdit(time.setWhen(wh, tp, how));
  const modes = MODE_ORDER.filter((m) => state.ctx.modes.includes(m));
  const pickMode = (m: WhenMode) => {
    setRejected(null);
    setPicked(m);
    if (m === "event") return;
    // 空の欄は、選んだ入れ方で打てるように欄へ移る（打ち方は欄の中と下に出す）
    if (shownRaw === null) {
      input.current?.focus();
      return;
    }
    const next = convertWhen(shownRaw, m, state.ctx);
    if (next === null) {
      setRejected(m === "age" ? "この時点は年齢に直せません（生まれる前の月・家族の生年月が無いなど）" : "この入れ方には直せません");
      return;
    }
    // 出来事が正本の欄は、出来事の時点の形を変える（出来事を指したまま）。ほかの欄は、この欄だけ
    commit(next, state.linked !== null ? "auto" : "this");
  };
  const person = typing.person;
  const evId = mode === "event" ? state.raw?.event : undefined;
  const leave = (text: string) => {
    leaveInput.current?.();
    leaveInput.current = null;
    setDraft(null);
    const wasTyped = typed.current;
    typed.current = false;
    if (sameTyped(text, wasTyped)) {
      onEdit(confirmTyped(f, wh));
      return;
    }
    if (text === shown) return;
    const r = readText(time, wh, typing, text);
    if ("reason" in r) {
      setRejected(`「${text}」は入れられないため、前の値のままです。${r.reason}`);
      noteRejected(() => input.current?.focus());
      return;
    }
    setRejected(null);
    setPicked(null);
    commitTypedWhen(r.tp, wasTyped);
  };
  // 欄を離れずに画面を変える操作の前（pendingInput.ts）: 打ちかけの時点を決める。読めなければ欄に残して止める（理由は欄の下に出ている）
  settleNow.current = () => {
    const text = input.current?.value ?? draft ?? shown;
    const wasTyped = typed.current;
    typed.current = false;
    if (sameTyped(text, wasTyped)) {
      onEdit(confirmTyped(f, wh));
      return "committed";
    }
    if (text === shown) return "none";
    const r = readText(time, wh, typing, text);
    if ("reason" in r) return "rejected";
    setRejected(null);
    setPicked(null);
    commitTypedWhen(r.tp, wasTyped);
    setDraft(null);
    return "committed";
  };
  return (
    <div class={`fld when${status === "estimated" ? " is-est" : status !== null && status !== "confirmed" ? ` is-${STATUS_CLASS[status]}` : ""}`} data-when={f.key} data-field={f.key}>
      <div class="fld-l">
        <label for={id}>{label}</label>
        <FieldHelp f={f} wh={wh} extra={[state.raw !== null ? time.when.monthOnly : undefined, mode === "event" && state.ctx.events.length === 0 ? "出来事は、子の独立・持ち家の入居・年金の受け取り開始・介護の始まりや、家族の項目の「出来事」から選べます" : undefined]} />
        {badge}
      </div>
      <div class="fld-c">
        <input
          ref={input}
          id={id}
          type="text"
          class={`when-in${problem !== null && live !== null ? " bad" : ""}`}
          value={draft ?? shown}
          placeholder={fittingPlaceholder("when-in", picked === null && state.raw === null && time.when.nullText !== undefined ? `空欄＝${time.when.nullText}` : null, f.example, mode === "age" ? ageExample({ h: state.ctx.h, person }) : PLACEHOLDER[mode])}
          aria-invalid={live !== null && "reason" in live ? true : undefined}
          aria-describedby={`${id}-read`}
          onFocus={() => {
            setDraft(shown);
            typed.current = false;
            leaveInput.current = enterInput({ settle: () => settleNow.current(), focus: () => input.current?.focus() });
          }}
          onInput={(e) => {
            setDraft((e.currentTarget as HTMLInputElement).value);
            typed.current = true;
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
        {mode === "age" && state.ctx.people.length > 1 && state.ctx.personFixed !== true ? (
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
                {eventOptionText(x)}
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
      {picked !== null && picked !== "event" && shownRaw === null && (draft ?? "") === "" ? (
        <div class="fld-help" data-when-pick-hint>
          {PICK_HINT[picked]}
        </div>
      ) : null}
      {strict !== null ? (
        <div class="fld-help" data-when-strict>
          {strict.note}
        </div>
      ) : null}
      {state.linked !== null ? (
        <div class="fld-help warn" data-when-linked>
          「{state.linked.label}」の出来事の時点です。ここを直すと出来事が動き、{state.linked.refs > 1 ? `この出来事を指すほかの${state.linked.refs - 1}件も一緒に動きます` : "この出来事を指す物も一緒に動きます"}
        </div>
      ) : null}
      {warn !== null ? <WarnLine f={f} text={warn} fix={warnFix ?? null} wh={wh} onEdit={onEdit} /> : null}
      {problem !== null ? (
        <div class="fld-help bad" id={`${id}-problem`} role="alert" data-field-problem={f.key}>
          {problem}
        </div>
      ) : null}
      {extras}
    </div>
  );
}
