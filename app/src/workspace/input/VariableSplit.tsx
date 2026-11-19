// 保険の入力項目の「変額保険: 続ける（A）と、解約して保障と運用に分ける（B）」の区画（0233）。変額保険の行の「解約して分けたら」で開き、
// 解約する年・掛け捨ての保険・運用の利回りを入れると、A と B の年ごとの小さな表（解約返戻金と運用残高・亡くなったときに家族に入る額）と
// 利回りの並び・必ず出す注意を見せる。「このプランを作る」で、見ているプランを元に B のプランを作る（現状の入力は変えない）。
// 計算は今のままの要求（万一の場面を外したもの）を A、B の要求を画面の側で1回ずつ計算して読む。おすすめは出さない（比較の試算）
import { useEffect, useMemo, useState } from "preact/hooks";
import type { EngineRequest, InsuranceContract, PreviewResult } from "../../engine/types.ts";
import { baseRequest } from "../contingency/requests.ts";
import type { WorkingHousehold } from "./household.ts";
import { contractLabel } from "./insuranceView.ts";
import {
  CLASS_OPTIONS,
  COVER_OPTIONS,
  defaultAmount,
  defaultSplit,
  isEstimate,
  lumpLine,
  needsSurrenderValue,
  newSplitIds,
  rateLines,
  rateOf,
  savingLine,
  shownYears,
  SPLIT_CAUTIONS,
  splitPlan,
  splitRequest,
  splitRows,
  splitTargets,
  splitUnavailable,
  surrenderYm,
  type CoverKind,
  type RateKind,
  type SplitOptions,
  type SplitRow,
} from "./variableSplit.ts";

type Compute = (req: EngineRequest) => Promise<PreviewResult | null>;

const man = (v: number) => `${Math.round(v / 10000).toLocaleString("ja-JP")}万円`;
const num = (e: Event): number | null => {
  const t = (e.currentTarget as HTMLInputElement).value.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
/** 百分率の入力 → 年率の10進の文字列（小数第3位の%まで） */
const rateFromPct = (pct: number | null): string | null => (pct === null || pct < -50 || pct > 50 ? null : String(Math.round(pct * 1000) / 100000));
const pctOf = (rate: string | null): string => (rate === null ? "" : String(Math.round(Number(rate) * 100000) / 1000));

export interface VariableSplitProps {
  /** 欄に見せている世帯（プランを直しているときはそのプランの中身） */
  wh: WorkingHousehold;
  computeOne?: Compute;
  /** 「このプランを作る」（渡さなければボタンを出さない） */
  onPlan?: (contract: string, o: SplitOptions) => void;
  /** 見ているプランの呼び名（現状は null） */
  planLabel?: string | null;
}

export function VariableSplit({ wh, computeOne, onPlan, planLabel = null }: VariableSplitProps) {
  const req = wh.request;
  const targets = splitTargets(req);
  const [open, setOpen] = useState<string | null>(null);
  if (targets.length === 0) return null;
  const list = req.input.household.insuranceContracts ?? [];
  const off = splitUnavailable(req);
  return (
    <section class="in-section vs" aria-label="変額保険を続けるか、解約して分けるか" data-variable-split>
      <p class="vs-h">
        <b>変額保険: 続ける（A）と、解約して保障と運用に分ける（B）の比較</b>
      </p>
      {targets.map((c) => (
        <div key={c.id} class="vs-row" data-variable-split-row={c.id}>
          <p class="vs-line">
            <span>{contractLabel(wh, c, list.indexOf(c))}</span>
            <button type="button" class="btn small" aria-expanded={open === c.id} data-action="ins/split" onClick={() => setOpen(open === c.id ? null : c.id)}>
              {open === c.id ? "閉じる" : "解約して分けたら"}
            </button>
          </p>
          {open === c.id ? off !== null ? <p class="in-note">{off}</p> : <SplitPanel key={c.id} req={req} c={c} label={contractLabel(wh, c, list.indexOf(c))} planLabel={planLabel} {...(computeOne !== undefined ? { computeOne } : {})} {...(onPlan !== undefined ? { onPlan } : {})} /> : null}
        </div>
      ))}
    </section>
  );
}

type ByYear = { year: number; object: string; deathBenefit: number };
const deathNow = (r: PreviewResult | null, c: InsuranceContract, year: number): number | undefined =>
  ((r?.summary as { insurance?: { byYear?: ByYear[] } } | null)?.insurance?.byYear ?? []).find((x) => x.object === c.id && x.year === year)?.deathBenefit;

export function SplitPanel({ req, c, label, computeOne, onPlan, planLabel }: { req: EngineRequest; c: InsuranceContract; label: string; computeOne?: Compute; onPlan?: (contract: string, o: SplitOptions) => void; planLabel: string | null }) {
  const baseYear = Number(req.input.baseMonth.slice(0, 4));
  const ids = useMemo(newSplitIds, []);
  const aReq = useMemo(() => baseRequest(req), [req]);
  const [aRes, setARes] = useState<PreviewResult | null>(null);
  const [o, setO] = useState<SplitOptions>(() => defaultSplit(req, c));
  /** 保障の額を FP が直したか（直していなければ、計算の結果の今の死亡保険金・種類に合わせて入れ直す） */
  const [amountOwn, setAmountOwn] = useState(false);
  useEffect(() => {
    if (computeOne === undefined) return;
    let alive = true;
    void computeOne(aReq)
      .catch(() => null)
      .then((r) => {
        if (alive) setARes(r);
      });
    return () => {
      alive = false;
    };
  }, [aReq, computeOne]);
  const nowDeath = deathNow(aRes, c, baseYear) ?? defaultSplit(req, c).amount;
  useEffect(() => {
    if (!amountOwn) setO((p) => ({ ...p, amount: defaultAmount(req, c, p.cover, p.year, p.endAge, nowDeath) }));
  }, [nowDeath, amountOwn, o.cover, o.year, o.endAge]);

  const ym = surrenderYm(req, o.year);
  const needs = needsSurrenderValue(c, ym);
  const rate = rateOf(req, c, o);
  const missing = [o.premium === null ? "掛け捨ての保険の保険料" : null, rate === null ? "運用の利回り" : null, needs && o.surrenderValue === null ? "解約返戻金" : null].filter((x): x is string => x !== null);
  const bReq = useMemo(() => (missing.length === 0 && rate !== null ? baseRequest(splitRequest(req, c.id, o, rate, ids)) : null), [req, c.id, o, rate, ids, missing.length]);
  const [bRes, setBRes] = useState<{ o: SplitOptions; res: PreviewResult | null } | null>(null);
  useEffect(() => {
    if (bReq === null || computeOne === undefined) return;
    let alive = true;
    const used = o;
    const t = setTimeout(() => {
      void computeOne(bReq)
        .catch(() => null)
        .then((r) => {
          if (alive) setBRes({ o: used, res: r });
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [bReq, computeOne]);
  const shown = bRes !== null && missing.length === 0 ? bRes : null;
  const rows: SplitRow[] = shown === null ? [] : splitRows(req, c, shown.o, ids, aRes, shown.res);
  const years = new Set(shown === null ? [] : shownYears(req, c, shown.o, rows));
  const plan = splitPlan(req, c, o);
  const put = (patch: Partial<SplitOptions>) => setO((p) => ({ ...p, ...patch }));
  const amountMan = o.cover === "term";
  const from = planLabel ?? "現状";

  return (
    <div class="vs-panel" data-split-panel={c.id}>
      <p class="in-note">比較の試算です。商品を選ぶものではありません。続ける（A）は今の契約のまま、分ける（B）は選んだ年に解約して、保障を掛け捨ての保険で買い直し、浮いた保険料と解約返戻金を NISA で運用します。</p>
      <div class="vs-fields">
        <label class="vs-f">
          解約する年 <input type="number" class="dd-n" min={baseYear} max={req.input.endYear} value={o.year} onInput={(e) => put({ year: Math.min(req.input.endYear, Math.max(baseYear, Math.round(num(e) ?? o.year))) })} data-split-field="year" /> 年
          <span class="vs-sub">（{Number(ym.slice(5))}月に解約）</span>
        </label>
        {needs ? (
          <label class="vs-f">
            解約返戻金（解約する時） <input type="number" class="dd-n" min={0} value={o.surrenderValue === null ? "" : o.surrenderValue / 10000} onInput={(e) => { const v = num(e); put({ surrenderValue: v === null ? null : Math.max(0, Math.round(v * 10000)) }); }} data-split-field="surrender" /> 万円
            <span class="vs-sub">（数表に、この年の解約返戻金がありません。設計書・解約返戻金の照会の額を入れてください）</span>
          </label>
        ) : null}
        <label class="vs-f">
          掛け捨ての保険{" "}
          <select value={o.cover} onChange={(e) => put({ cover: (e.currentTarget as HTMLSelectElement).value as CoverKind })} data-split-field="cover">
            {COVER_OPTIONS.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <label class="vs-f">
          保険料 月 <input type="number" class="dd-n vs-wide" min={0} value={o.premium === null ? "" : o.premium} onInput={(e) => { const v = num(e); put({ premium: v === null ? null : Math.max(0, Math.round(v)) }); }} data-split-field="premium" /> 円
          <span class="vs-sub">（見積もりの額を入れてください）</span>
        </label>
        <label class="vs-f">
          {amountMan ? "死亡保険金" : "年金月額"}{" "}
          <input type="number" class="dd-n vs-wide" min={0} value={o.amount / 10000} onInput={(e) => { const v = num(e); setAmountOwn(true); put({ amount: Math.max(0, Math.round((v ?? 0) * 10000)) }); }} data-split-field="amount" /> 万円{amountMan ? "" : "／月"}
          <span class="vs-sub">（既定は今の死亡保険金{amountMan ? "と同じ" : "を保障の終わりまでの月数で割った額"}）</span>
        </label>
        <label class="vs-f">
          保障の終わり <input type="number" class="dd-n" min={20} max={100} value={o.endAge} onInput={(e) => put({ endAge: Math.min(100, Math.max(20, Math.round(num(e) ?? o.endAge))) })} data-split-field="endAge" /> 歳
        </label>
        <fieldset class="vs-f vs-rate">
          <legend>B の運用の利回り（A と同じ前提にそろえると、保険と運用の違いだけを比較できます）</legend>
          <label>
            <input type="radio" name={`vs-rate-${c.id}`} checked={o.rateKind === "illustrated"} onChange={() => put({ rateKind: "illustrated" as RateKind })} />
            {isEstimate(c) ? (
              <>
                A の数表（設計書）と同じ 年 <input type="number" class="dd-n" step={0.1} value={pctOf(o.illustrated)} onInput={(e) => put({ illustrated: rateFromPct(num(e)), rateKind: "illustrated" })} data-split-field="illustrated" /> %
              </>
            ) : (
              "A の積立金と同じ利回り"
            )}
          </label>
          <label>
            <input type="radio" name={`vs-rate-${c.id}`} checked={o.rateKind === "class"} onChange={() => put({ rateKind: "class" })} />
            資産クラスの前提{" "}
            <select value={o.assetClass} onChange={(e) => put({ assetClass: (e.currentTarget as HTMLSelectElement).value, rateKind: "class" })} data-split-field="class">
              {CLASS_OPTIONS.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input type="radio" name={`vs-rate-${c.id}`} checked={o.rateKind === "custom"} onChange={() => put({ rateKind: "custom" })} />
            ほかの利回り 年 <input type="number" class="dd-n" step={0.1} value={pctOf(o.custom)} onInput={(e) => put({ custom: rateFromPct(num(e)), rateKind: "custom" })} data-split-field="custom" /> %
          </label>
        </fieldset>
      </div>
      <ul class="vs-rates" data-split-rates>
        {rateLines(req, c, o).map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      {missing.length > 0 ? (
        <p class="in-note" data-split-missing>
          {missing.join("・")}を入れると、A と B を並べます
        </p>
      ) : (
        <>
          <p class="in-note" data-split-saving>
            {savingLine(plan)}
          </p>
          <p class="in-note" data-split-lump>
            {lumpLine(plan)}
          </p>
          {computeOne === undefined ? null : shown === null || shown.res === null || aRes === null ? (
            <p class="in-note">{shown !== null && shown.res === null ? "計算できませんでした" : "計算しています…"}</p>
          ) : (
            <div class="vs-table-wrap">
              <table class="rt-table vs-table" data-split-table>
                <thead>
                  <tr>
                    <th scope="col">年（年齢）</th>
                    <th scope="col">A 解約返戻金</th>
                    <th scope="col">B 運用残高</th>
                    <th scope="col">A 亡くなったとき家族に</th>
                    <th scope="col">B 亡くなったとき家族に</th>
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .filter((r) => years.has(r.year))
                    .map((r) => (
                      <tr key={r.year} data-split-year={r.year}>
                        <th scope="row">
                          {r.year}年{r.age !== null ? `（${r.age}歳）` : ""}
                        </th>
                        <td>{r.aSurrender === null ? "—" : man(r.aSurrender)}</td>
                        <td>{man(r.bInvest)}</td>
                        <td>{man(r.aDeath)}</td>
                        <td>{man(r.bDeath)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <p class="vs-sub">
                年末の額。A の亡くなったときは死亡保険金（基本保険金額が最低保証）、B は掛け捨ての保険金（収入保障保険は残りの受け取りの合計）＋運用残高。B の運用残高は、NISA に入れる前で預金に置いている解約返戻金を含みます。家計が足りない年は、B の運用からも取り崩します（A の解約返戻金は取り崩しません）
                {o !== shown.o ? "（入れ直した値で計算し直しています）" : ""}
              </p>
            </div>
          )}
        </>
      )}
      <div class="vs-cautions" role="note" data-split-cautions>
        <p>
          <b>注意</b>
        </p>
        <ul>
          {SPLIT_CAUTIONS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
      {onPlan !== undefined ? (
        <p class="vs-act">
          <button type="button" class="btn small primary" disabled={missing.length > 0} onClick={() => onPlan(c.id, o)} data-action="ins/split/plan">
            このプランを作る
          </button>
          <span class="vs-sub">押すと、{from}を元に、{label}を解約して分けた新しいプラン（B）を作り、結果のタブで{from}と並べます（{from}の入力は変えません）</span>
        </p>
      ) : null}
    </div>
  );
}
