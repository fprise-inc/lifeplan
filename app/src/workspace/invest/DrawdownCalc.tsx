// 取り崩しの計算（作業の層。対策の欄の中の小さな欄。0026）: 選んだプランで、
// ① 毎月○万円（定額）・毎年○%（定率）取り崩すと何歳まで持つか、② ○歳まで持たせるなら毎月いくらまで（毎年何%まで）取り崩せるか、を
// 本物のエンジンで計算する（②は額を半分ずつ絞り込む。1回ごとに一生分を計算する）。「この額を使う」で対策の「毎月の取り崩し額」に入れる
import { useState } from "preact/hooks";
import type { EngineRequest, PreviewResult } from "../../engine/types.ts";
import { drawdownOf, retireAgeOf, selfOf } from "../input/savings/model.ts";
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

export interface DrawdownCalcProps {
  req: EngineRequest;
  years: readonly number[];
  compute: Compute;
  locked: boolean;
  /** 対策に入れる（定額は円、定率は10進の率） */
  onUse: (d: { method: "fixed" | "rate"; value: number | string; startAge: number }) => void;
  initialOpen?: boolean;
}

export function DrawdownCalc(p: DrawdownCalcProps) {
  const now = drawdownOf(p.req);
  const retire = retireAgeOf(p.req) ?? 65;
  const [open, setOpen] = useState(p.initialOpen === true);
  const [method, setMethod] = useState<"fixed" | "rate">(now.method === "rate" ? "rate" : "fixed");
  const [start, setStart] = useState(now.method === "none" ? Math.max(65, retire) : now.startAge);
  const [target, setTarget] = useState(95);
  const [amount, setAmount] = useState(now.method === "fixed" ? Math.round(now.monthly / 10000) : 15);
  const [permille, setPermille] = useState(now.method === "rate" ? Math.round(Number(now.rate) * 1000) : 40);
  const [busy, setBusy] = useState(false);
  const [lasts, setLasts] = useState<string | null>(null);
  const [max, setMax] = useState<{ v: number | null; target: number; method: "fixed" | "rate" } | null>(null);
  if (!open)
    return (
      <div class="dd-calc closed">
        <button type="button" class="add-item-btn" onClick={() => setOpen(true)} data-calc-open>
          取り崩しの計算を開く
        </button>
        <span class="dd-hint">何歳まで持つか・○歳まで持たせるなら毎月いくらまでか</span>
      </div>
    );
  const valueText = method === "fixed" ? `毎月${amount}万円` : `毎年${(permille / 10).toFixed(1)}%`;
  const runLasts = async () => {
    setBusy(true);
    const r = await p.compute(withDrawdown(p.req, method === "fixed" ? { method, startAge: start, monthly: amount * 10000 } : { method, startAge: start, rate: rateOfPermille(permille) }));
    const a = r === null ? null : lastsAge(p.req, r.table, p.years);
    setLasts(a === null ? "計算できませんでした" : `${start}歳から${valueText}取り崩すと、金融資産は ${a}歳 まで持ちます`);
    setBusy(false);
  };
  const runMax = async () => {
    setBusy(true);
    const v = await maxDrawdown(p.compute, p.req, p.years, method, start, target);
    setMax({ v, target, method });
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
          始める年齢 <input type="number" class="dd-n" min={40} max={90} value={start} onInput={(e) => setStart(Number((e.currentTarget as HTMLInputElement).value) || start)} /> 歳
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
        {lasts !== null ? <span class="dd-out">{lasts}</span> : null}
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
            {max.v !== null ? (
              <button type="button" class="btn primary sm" disabled={p.locked} onClick={() => p.onUse({ method: max.method, value: max.method === "fixed" ? (max.v as number) * 10000 : rateOfPermille(max.v as number), startAge: start })} data-calc-use>
                この額を使う
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      <p class="dd-note">収支の不足（年金などで足りない分）を含めて、金融資産から使う額です。不足のほうが大きい年は、不足の分を取り崩します。{p.locked ? "「この額を使う」は、動かせるプランを選ぶと使えます。" : ""}</p>
    </div>
  );
}
