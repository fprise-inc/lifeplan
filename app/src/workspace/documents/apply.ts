// 書類の候補を承認して現状に入れる（0148 の2）。確定は承認という明示の操作だけ（0041）:
// - 書類の値のまま承認: 状態 確定・出どころ 取り込み（AI の答えなら AI。ref は読み取りの記録の ID）・承認の記録 {by: fp, at, candidate}・確かさ 書類で確認
// - 今の値（確定）と同じ: 値と出どころはそのまま、確かさを「書類で確認」にするだけ（FP が入れた値を取り込みの値に書き換えない）
// - 直して入れた: 出どころ 手で入れた（ref は読み取りの記録の ID）・確かさ 書類で確認。直したことは読み取りの記録に残す（読み取りの成績に使う）
// - 入れない: 世帯は変えない。読み取りの記録に残す
// 書類待ち（状態 unknown）の欄は、承認で確定になるので書類待ちが消え、書類のお願いの一覧からも消える（0102 の決まりのまま）
import { buildStage } from "../input/stages/index.ts";
import { sameVal, type FieldDef, type Val } from "../input/form.ts";
import { mutate, type WorkingHousehold } from "../input/household.ts";
import { putRow, rowAt, type StateRow } from "../input/rows.ts";
import { parseInteger, parseYearMonth, rateFromPct, readYen } from "../input/units.ts";
import { fieldAddress, fieldStatus } from "../input/valueState.ts";
import { readAt } from "../store/readings.ts";
import { NEW_OBJECT_KINDS } from "./objects.ts";
import { memberIdOf } from "./resolve.ts";
import { roles } from "../roles.ts";
import type { CandidateValue, DocCandidate, DocumentReading } from "./types.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isBox = (v: unknown): v is Obj & { state: string; origin: Obj } => isObj(v) && typeof v.state === "string" && isObj(v.origin);
const input = (wh: WorkingHousehold): Obj => wh.request.input as unknown as Obj;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type Coerced = { ok: true; value: Val } | { ok: false; reason: string };

const bad = (reason: string): Coerced => ({ ok: false, reason });

/** 候補の値を欄の値の形にする（読めなければ理由） */
export function coerce(wh: WorkingHousehold, reading: Pick<DocumentReading, "holder">, f: FieldDef, v: CandidateValue): Coerced {
  switch (f.kind) {
    case "yen": {
      if (typeof v === "number") return Number.isSafeInteger(v) ? { ok: true, value: v } : bad("円の整数ではありません");
      if (typeof v !== "string") return bad("金額ではありません");
      const r = readYen(v, "yen");
      return r.ok ? { ok: true, value: r.yen } : bad("金額として読めません");
    }
    case "int": {
      const n = typeof v === "number" ? (Number.isSafeInteger(v) ? v : null) : typeof v === "string" ? parseInteger(v) : null;
      if (n === null && typeof v === "string" && parseYearMonth(v) !== null) return bad(`年月の値です。この欄は${f.suffix === "年" ? "年数" : f.suffix === "か月" ? "月数" : "数"}で入れるので、書類を見て直して入れてください`);
      if (n === null) return bad("整数として読めません");
      if (f.min !== undefined && n < f.min) return bad(`${f.min}より小さい値は入れられません`);
      if (f.max !== undefined && n > f.max) return bad(`${f.max}より大きい値は入れられません`);
      return { ok: true, value: n };
    }
    case "pct":
    case "decimal": {
      const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : null;
      if (s === null) return bad("率として読めません");
      if (f.kind === "pct" && /[%％]$/u.test(s)) {
        const r = rateFromPct(s.replace(/[%％]$/u, ""));
        return r === null ? bad("率として読めません") : { ok: true, value: r };
      }
      return /^-?\d+(\.\d+)?$/u.test(s) ? { ok: true, value: s } : bad("率として読めません");
    }
    case "select": {
      if (typeof v !== "string") return bad("選択肢として読めません");
      const byValue = f.options.find((o) => o.value === v) ?? f.options.find((o) => o.label === v);
      if (byValue !== undefined) return { ok: true, value: byValue.value };
      // 人を選ぶ欄（選択肢が構成員の ID）は、続柄の鍵・書類の名義でもよい
      if (f.options.length > 0 && f.options.every((o) => UUID.test(o.value))) {
        const m = memberIdOf(wh, reading, v);
        if (m !== null && f.options.some((o) => o.value === m)) return { ok: true, value: m };
        return bad(v === "holder" ? "書類の名義（どなたの書類か）を選んでください" : "当てる人がこの世帯にいません");
      }
      // 続柄の鍵を値に持つ選択の欄（ローンの名義の self・spouse など）は、書類の名義の人の続柄に当てる（0154 の4）
      if (v === "holder" && f.options.some((o) => o.value === "self")) {
        const m = memberIdOf(wh, reading, v);
        if (m === null) return bad("書類の名義（どなたの書類か）を選んでください");
        const key = roles(wh.request).find((x) => x.member.id === m)?.key;
        const opt = key === undefined ? undefined : f.options.find((o) => o.value === key);
        return opt !== undefined ? { ok: true, value: opt.value } : bad("書類の名義の人は、この欄の選択肢にありません");
      }
      return bad("欄の選択肢にありません");
    }
    case "ym": {
      const ym = typeof v === "string" ? parseYearMonth(v) : null;
      return ym === null ? bad("年月として読めません") : { ok: true, value: ym };
    }
    case "bool": {
      if (typeof v === "boolean") return { ok: true, value: v };
      if (v === "はい" || v === "true") return { ok: true, value: true };
      if (v === "いいえ" || v === "false") return { ok: true, value: false };
      return bad("はい・いいえとして読めません");
    }
    case "text":
      return typeof v === "string" ? { ok: true, value: v } : { ok: true, value: String(v) };
    case "when": {
      // 時点の欄は、書類の年月（決まった年月の時点）だけを入れる。年齢・出来事で決める入れ方は、欄を開いて直す（0154 の4）
      const ym = typeof v === "string" ? parseYearMonth(v) : null;
      return ym === null ? bad("時点の欄は、年月（YYYY-MM）だけを書類から入れられます") : { ok: true, value: ym };
    }
  }
}

/** 書類の額の期間が欄の期間と違うか（違えば直して入れる） */
export function periodMismatch(f: FieldDef, c: Pick<DocCandidate, "period">): string | null {
  if (f.kind !== "yen" || c.period === undefined || f.basis === c.period) return null;
  const word = (b: string) => (b === "monthly" ? "月額" : b === "annual" ? "年額" : "1回の額");
  return `書類の額は${word(c.period)}、欄は${word(f.basis)}です。欄の期間に直して入れてください`;
}

export interface WriteMeta {
  origin: { kind: "import" | "ai" | "manual"; ref: string; connector?: string };
  approval?: { by: "fp"; at: string; candidate: string };
}

/** 値の箱か値の状態の行の、今の印（出どころ・承認・確かさ） */
function metaOf(wh: WorkingHousehold, f: FieldDef): Obj | undefined {
  if (f.boxed !== undefined) {
    const b = f.boxed.read(wh);
    return isBox(b) ? b : undefined;
  }
  const a = fieldAddress(f, wh);
  return a === null ? undefined : (rowAt(input(wh), a) as Obj | undefined);
}

const withoutAssumed = (wh: WorkingHousehold, key: string): WorkingHousehold => (wh.assumed[key] === undefined ? wh : { ...wh, assumed: Object.fromEntries(Object.entries(wh.assumed).filter(([k]) => k !== key)) });

/**
 * 欄に書類の値を確定として書き、印を付ける。今の値が確定で同じ値なら、値と出どころはそのままで確かさだけを「書類で確認」にする。
 * 書けなかった（欄が値を受けない）ら同じ世帯を返す
 */
export function writeFromDocument(wh: WorkingHousehold, f: FieldDef, value: Val, meta: WriteMeta): WorkingHousehold {
  const st = fieldStatus(f, wh);
  const same = st.status === "confirmed" && sameVal(f.get(wh).value, value, f.kind);
  const w = same ? wh : (f.write ?? f.set)(wh, value);
  if (!same && !sameVal(f.get(w).value, value, f.kind)) return wh;
  const prev = same ? metaOf(w, f) : undefined;
  const marks: Obj =
    same && prev !== undefined
      ? { ...structuredClone(prev), certainty: "document" }
      : same
        ? { state: "confirmed", origin: { kind: "manual" }, certainty: "document" }
        : { state: "confirmed", origin: { ...meta.origin }, ...(meta.approval !== undefined ? { approval: { ...meta.approval } } : {}), certainty: "document" };
  if (f.boxed !== undefined) {
    const b = f.boxed.read(w);
    const v = isBox(b) && b.value !== undefined ? b.value : value;
    const { substitute: _s, value: _v, ...rest } = marks;
    void _s;
    void _v;
    return f.boxed.write(w, { value: v, ...rest, state: "confirmed" });
  }
  const a = fieldAddress(f, w);
  if (a === null) return w;
  const row: StateRow = { ...(marks as unknown as StateRow), state: "confirmed" };
  // 推定の根拠（「この値にする」で確定にしたときの estimate）は、書類の値にしたら外す
  if (!same) delete row.estimate;
  return mutate(withoutAssumed(w, f.key), (_h, req) => void putRow(req.input as unknown as Obj, a, row));
}

/** 値の箱か行が書類で確認の印を持つか（テスト・画面の確かめ用） */
export function certaintyOf(wh: WorkingHousehold, f: FieldDef): string | null {
  const m = metaOf(wh, f);
  return m !== undefined && typeof m.certainty === "string" ? m.certainty : null;
}

/** 欄に値があるか（当て先に値がある）。行だけ書く欄の確かめ用 */
export const hasValueAt = (wh: WorkingHousehold, f: FieldDef): boolean => {
  const a = fieldAddress(f, wh);
  return a !== null && readAt(input(wh), a) !== undefined;
};

/**
 * 新しい物を、その種類の「＋」のボタンと同じ形で足す（既定・推定の印もボタンと同じ）。足せなければ null
 */
export function createObject(wh: WorkingHousehold, kind: string): { wh: WorkingHousehold; id: string } | null {
  const k = NEW_OBJECT_KINDS[kind];
  if (k === undefined) return null;
  const stage = buildStage(k.stage, wh);
  const action = stage.sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]).find((a) => a.key === k.action);
  if (action === undefined) return null;
  const list = (wh: WorkingHousehold): Obj[] => {
    const v = (wh.request.input.household as unknown as Obj)[k.collection];
    return Array.isArray(v) ? v.filter(isObj) : [];
  };
  const before = new Set(list(wh).map((o) => o.id));
  const next = action.run(wh);
  const added = list(next).filter((o) => !before.has(o.id));
  if (added.length !== 1 || typeof added[0]?.id !== "string") return null;
  return { wh: next, id: added[0].id };
}

/** 候補の承認の印（読み取りの記録の出どころから） */
export function metaFor(reading: DocumentReading, c: DocCandidate, at: string, mode: "accept" | "correct"): WriteMeta {
  if (mode === "correct") return { origin: { kind: "manual", ref: reading.id } };
  const ai = reading.via === "ai" || reading.via === "paste";
  return {
    origin: ai ? { kind: "ai", ref: reading.id, ...(reading.ai !== undefined ? { connector: reading.ai.connector } : {}) } : { kind: "import", ref: reading.id },
    approval: { by: "fp", at, candidate: c.id },
  };
}
