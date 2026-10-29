// 取り崩しの計算（作業の層。対策の欄の中の小さな欄。0026）: 選んだプランで、
// ① 毎月○万円（定額）・毎年○%（定率）取り崩すと何歳まで持つか、② ○歳まで持たせるなら毎月いくらまで（毎年何%まで）取り崩せるか、を
// 本物のエンジンで計算する（②は額を半分ずつ絞り込む。1回ごとに一生分を計算する）。「対策に入れる」（①②とも）で対策の「取り崩しを始める年齢」と「毎月の取り崩し額」（定率は「毎年の取り崩し率」）に入れる。
// 押す前に入れる先（足す・変える）を小さく出し、押した後は入れた値を知らせ、対策の2つの項目を光らせる。
// 答えは計算に使った値を持ち、今の入力と食い違う答えは出さない（入力を変えたら古い答えとボタンは消える。0026 の 2026-10-29 の追記）
import { useState } from "preact/hooks";
import { revealChanged } from "../../presentation/revealAdded.ts";
import type { EngineRequest, PreviewResult } from "../../engine/types.ts";
import { drawdownOf, drawdownStartDefault, nextAgeOf, selfOf } from "../input/savings/model.ts";
import { ageReachedMonth } from "../levers.ts";
import { lastsAge } from "./present.ts";

export type Compute = (req: EngineRequest) => Promise<PreviewResult | null>;

/** その取り崩し方にした要求 */
export function withDrawdown(req: EngineRequest, d: { method: "fixed" | "rate"; startAge: number; monthly?: number; rate?: string }): EngineRequest {
  const self = selfOf(req.input.household);
  if (self === undefined) return req;
  const a = { ...(req.input.assumptions ?? { investmentReturn: { default: "0.01" } }) };
  a.investment = { ...(a.investment ?? {}), drawdown: { start: { at: ageReachedMonth(self, d.startAge) }, method: d.method, ...(d.method === "fixed" ? { monthly: d.monthly ?? 0 } : { rate: d.rate ?? "0" }) } };
  return { ...req, input: { ...req.input, assumptions: a } };
}

const rateOfPermille = (pm: number) => (pm <= 0 ? "0" : `0.${String(pm).padStart(3, "0")}`.replace(/0+$/, ""));

/**
 * ○歳まで持たせるなら、いくらまで取り崩せるか（定額は1万円、定率は0.1%の刻み）。いちばん少なくしても届かなければ null
 */
export async function maxDrawdown(compute: Compute, req: EngineRequest, years: readonly number[], method: "fixed" | "rate", startAge: number, targetAge: number): Promise<number | null> {
  const ok = async (v: number) => {
    const r = await compute(withDrawdown(req, method === "fixed" ? { method, startAge, monthly: v * 10000 } : { method, startAge, rate: rateOfPermille(v) }));
    const a = r === null ? null : lastsAge(req, r.table, years);
    return a !== null && a >= targetAge;
  };
  let lo = 0;
  let hi = method === "fixed" ? 100 : 150;
  if (!(await ok(lo))) return null;
  if (await ok(hi)) return hi;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

type Method = "fixed" | "rate";
/** 欄の今の入力（額は万円、率は0.1%刻みの千分率） */
export interface CalcInputs {
  method: Method;
  startAge: number;
  amount: number;
  permille: number;
  target: number;
}
/** ①の答え（計算に使った値をそのまま持つ）。age が null は計算できなかった */
export interface LastsAnswer {
  method: Method;
  startAge: number;
  amount: number;
  permille: number;
  age: number | null;
}
/** ②の答え。v が null は取り崩しを0にしても届かない */
export interface MaxAnswer {
  method: Method;
  startAge: number;
  target: number;
  v: number | null;
}
export type UseArg = { method: Method; value: number | string; startAge: number };

/** ①の答えが今の入力のものか（取り崩し方・始める年齢・その取り崩し方の額か率が同じ） */
export const lastsMatches = (a: LastsAnswer, i: CalcInputs): boolean => a.method === i.method && a.startAge === i.startAge && (a.method === "fixed" ? a.amount === i.amount : a.permille === i.permille);
/** ②の答えが今の入力のものか（取り崩し方・始める年齢・持たせる年齢が同じ） */
export const maxMatches = (a: MaxAnswer, i: CalcInputs): boolean => a.method === i.method && a.startAge === i.startAge && a.target === i.target;
/** ①の「対策に入れる」で入れる値（答えに使った額か率と始める年齢） */
export const useOfLasts = (a: LastsAnswer): UseArg => ({ method: a.method, value: a.method === "fixed" ? a.amount * 10000 : rateOfPermille(a.permille), startAge: a.startAge });
/** ②の「対策に入れる」で入れる値。届かないときは null */
export const useOfMax = (a: MaxAnswer): UseArg | null => (a.v === null ? null : { method: a.method, value: a.method === "fixed" ? a.v * 10000 : rateOfPermille(a.v), startAge: a.startAge });
const valueTextOf = (method: Method, amount: number, permille: number) => (method === "fixed" ? `毎月${amount}万円` : `毎年${(permille / 10).toFixed(1)}%`);
/** ①の答えの文 */
export const lastsText = (a: LastsAnswer): string => (a.age === null ? "計算できませんでした" : `${a.startAge}歳から${valueTextOf(a.method, a.amount, a.permille)}取り崩すと、金融資産は ${a.age}歳 まで持ちます`);

/** 「対策に入れる」で入れる対策の項目（キーと名前。plans/items.ts の対策の項目と同じ） */
export const USE_TARGETS = {
  start: { key: "inv:wStart", label: "取り崩しを始める年齢" },
  fixed: { key: "inv:wAmt", label: "毎月の取り崩し額" },
  rate: { key: "inv:wRate", label: "毎年の取り崩し率" },
} as const;
/** 入れる先の対策の項目のキー（始める年齢と、取り崩し方の額か率） */
export const useTargetKeys = (method: Method): [string, string] => [USE_TARGETS.start.key, USE_TARGETS[method].key];

/**
 * 押す前に出す、入れる先の説明。対策にもう出ている項目は「変えます」、まだ無い項目は「足します」
 * （例: 「押すと、対策の「取り崩しを始める年齢」と「毎月の取り崩し額」を足します」）
 */
export function useTargetText(method: Method, inPlan: (key: string) => boolean): string {
  const items = [USE_TARGETS.start, USE_TARGETS[method]].map((t) => ({ label: `「${t.label}」`, has: inPlan(t.key) }));
  const [a, b] = items as [{ label: string; has: boolean }, { label: string; has: boolean }];
  if (a.has === b.has) return `押すと、対策の${a.label}と${b.label}を${a.has ? "変えます" : "足します"}`;
  return `押すと、対策の${a.label}を${a.has ? "変え" : "足し"}、${b.label}を${b.has ? "変えます" : "足します"}`;
}

/** 押した後の知らせ（入れた値。例: 「対策に入れました: 取り崩しを始める年齢 65歳・毎月の取り崩し額 15万円」） */
export function usedText(u: UseArg): string {
  const v = u.method === "fixed" ? `${Number(u.value) / 10000}万円` : `${(Number(u.value) * 100).toFixed(1)}%`;
  return `対策に入れました: ${USE_TARGETS.start.label} ${u.startAge}歳・${USE_TARGETS[u.method].label} ${v}`;
}

const sameUse = (a: UseArg, b: UseArg) => a.method === b.method && a.startAge === b.startAge && String(a.value) === String(b.value);

export interface DrawdownCalcProps {
  req: EngineRequest;
  years: readonly number[];
  compute: Compute;
  locked: boolean;
  /** 対策に入れる（定額は円、定率は10進の率） */
  onUse: (d: { method: "fixed" | "rate"; value: number | string; startAge: number }) => void;
  /** 対策にもう出ている項目か（押す前の説明の「足します／変えます」に使う） */
  inPlan?: (key: string) => boolean;
  initialOpen?: boolean;
}

export function DrawdownCalc(p: DrawdownCalcProps) {
  const now = drawdownOf(p.req);
  const [open, setOpen] = useState(p.initialOpen === true);
  const [method, setMethod] = useState<"fixed" | "rate">(now.method === "rate" ? "rate" : "fixed");
  // 初めの値は過ぎた年齢にしない（75歳の世帯で65歳から、にならない）
  const [start, setStart] = useState(drawdownStartDefault(p.req));
  const minStart = nextAgeOf(p.req) ?? 40;
  const [target, setTarget] = useState(95);
  const [amount, setAmount] = useState(now.method === "fixed" ? Math.round(now.monthly / 10000) : 15);
  const [permille, setPermille] = useState(now.method === "rate" ? Math.round(Number(now.rate) * 1000) : 40);
  const [busy, setBusy] = useState(false);
  const [lastsAns, setLasts] = useState<LastsAnswer | null>(null);
  const [maxAns, setMax] = useState<MaxAnswer | null>(null);
  // 押した行と入れた値（その行の今の答えと同じときだけ知らせを出す）
  const [used, setUsed] = useState<{ row: "lasts" | "max"; arg: UseArg } | null>(null);
  if (!open)
    return (
      <div class="dd-calc closed">
        <button type="button" class="add-item-btn" onClick={() => setOpen(true)} data-calc-open>
          取り崩しの計算を開く
        </button>
        <span class="dd-hint">何歳まで持つか・○歳まで持たせるなら毎月いくらまでか</span>
      </div>
    );
  // 今の入力と食い違う答えは出さない（計算中に入力を変えたときも、入力を変えて押し直す前も）
  const inputs: CalcInputs = { method, startAge: start, amount, permille, target };
  const lasts = lastsAns !== null && lastsMatches(lastsAns, inputs) ? lastsAns : null;
  const max = maxAns !== null && maxMatches(maxAns, inputs) ? maxAns : null;
  const lastsUse = lasts === null || lasts.age === null ? null : useOfLasts(lasts);
  const maxUse = max === null ? null : useOfMax(max);
  const inPlan = p.inPlan ?? (() => false);
  const useBtn = (row: "lasts" | "max", arg: UseArg) => {
    const done = used !== null && used.row === row && sameUse(used.arg, arg);
    return (
      <span class="dd-use">
        <button
          type="button"
          class="btn primary sm"
          disabled={p.locked}
          onClick={(e) => {
            revealChanged(e.currentTarget, useTargetKeys(arg.method).map((k) => `[data-added="${k}"]`).join(", "));
            p.onUse(arg);
            setUsed({ row, arg });
          }}
          data-calc-use={row}
        >
          対策に入れる
        </button>
        <small class="dd-use-to" data-calc-use-to={row}>
          {done ? usedText(arg) : useTargetText(arg.method, inPlan)}
        </small>
      </span>
    );
  };
  const runLasts = async () => {
    setBusy(true);
    const at = { method, startAge: start, amount, permille };
    const r = await p.compute(withDrawdown(p.req, method === "fixed" ? { method, startAge: start, monthly: amount * 10000 } : { method, startAge: start, rate: rateOfPermille(permille) }));
    setLasts({ ...at, age: r === null ? null : lastsAge(p.req, r.table, p.years) });
    setBusy(false);
  };
  const runMax = async () => {
    setBusy(true);
    const at = { method, startAge: start, target };
    const v = await maxDrawdown(p.compute, p.req, p.years, method, start, target);
    setMax({ ...at, v });
    setBusy(false);
  };
  return (
    <div class="dd-calc" data-calc>
      <div class="dd-h">
        <b>取り崩しの計算</b>
        <span class="dd-hint">選んだプランで計算します（入力は変えません）</span>
        <button type="button" class="link-btn" onClick={() => setOpen(false)}>
          閉じる
        </button>
      </div>
      <div class="dd-row">
        <span class="seg-g sm" role="group" aria-label="取り崩し方">
          <button type="button" aria-pressed={method === "fixed"} onClick={() => setMethod("fixed")}>
            定額（毎月）
          </button>
          <button type="button" aria-pressed={method === "rate"} onClick={() => setMethod("rate")}>
            定率（残高の○%）
          </button>
        </span>
        <label>
          始める年齢 <input type="number" class="dd-n" min={minStart} max={Math.max(90, start)} value={start} onInput={(e) => setStart(Number((e.currentTarget as HTMLInputElement).value) || start)} /> 歳
        </label>
      </div>
      <div class="dd-row">
        <label>
          {method === "fixed" ? (
            <>
              毎月 <input type="number" class="dd-n" min={0} max={200} value={amount} onInput={(e) => setAmount(Math.max(0, Number((e.currentTarget as HTMLInputElement).value) || 0))} /> 万円
            </>
          ) : (
            <>
              毎年 <input type="number" class="dd-n" min={0} max={15} step={0.1} value={permille / 10} onInput={(e) => setPermille(Math.max(0, Math.round(Number((e.currentTarget as HTMLInputElement).value) * 10) || 0))} /> %
            </>
          )}
        </label>
        <button type="button" class="btn" disabled={busy} onClick={() => void runLasts()} data-calc-lasts>
          何歳まで持つか
        </button>
        {lasts !== null ? (
          <span class="dd-out" data-calc-lasts-result>
            {lastsText(lasts)}
            {lastsUse !== null ? useBtn("lasts", lastsUse) : null}
          </span>
        ) : null}
      </div>
      <div class="dd-row">
        <label>
          <input type="number" class="dd-n" min={60} max={110} value={target} onInput={(e) => setTarget(Number((e.currentTarget as HTMLInputElement).value) || target)} /> 歳まで持たせるなら
        </label>
        <button type="button" class="btn" disabled={busy} onClick={() => void runMax()} data-calc-max>
          {method === "fixed" ? "毎月いくらまで" : "毎年何%まで"}
        </button>
        {busy ? <span class="dd-out">計算しています…</span> : null}
        {max !== null && !busy ? (
          <span class="dd-out" data-calc-result>
            {max.v === null ? `${max.target}歳までは、取り崩しを0にしても持ちません` : max.method === "fixed" ? `毎月 ${max.v}万円まで（${max.target}歳まで持ちます）` : `毎年 ${(max.v / 10).toFixed(1)}%まで（${max.target}歳まで持ちます）`}
            {maxUse !== null ? useBtn("max", maxUse) : null}
          </span>
        ) : null}
      </div>
      <p class="dd-note">収支の不足（年金などで足りない分）を含めて、金融資産から使う額です。不足のほうが大きい年は、不足の分を取り崩します。{p.locked ? "「対策に入れる」は、動かせるプランを選ぶと使えます。" : ""}</p>
    </div>
  );
}
