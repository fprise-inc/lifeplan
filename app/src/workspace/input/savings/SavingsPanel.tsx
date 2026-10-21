// 入力の「貯蓄・運用」のパネルの中身（作業の層。0026）: 入れ方（合計／口座／資産配分）・口座ごとの残高と期間を分けた積立と利回り・
// NISA の枠の知らせ・資産配分・iDeCo と企業型DC の受け取り・運用の期間（積立をやめる年・取り崩し）。値を変えるたびに onEdit に新しい世帯を渡す
import { useState } from "preact/hooks";
import type { Account, EngineRequest } from "../../../engine/types.ts";
import { DonutPair, type DonutItem, type DonutPane } from "../../../presentation/Donut.tsx";
import { ageAt } from "../../levers.ts";
import { reserveOf } from "../../surplus.ts";
import { Section, visible } from "../FieldViews.tsx";
import type { Level } from "../form.ts";
import { confirmedBox, mutate, type WorkingHousehold } from "../household.ts";
import { memberLabel, memberOptions } from "../labels.ts";
import { savingsStage } from "../stages/savings.ts";
import { formatYen, normalizeNumberText, parseInteger, parseYen, pctFromRate, rateFromPct } from "../units.ts";
import {
  accountMonthlyAt,
  accountsOf,
  CLASSES,
  classRows,
  DC_KINDS,
  defaultPayoutAge,
  drawdownOf,
  dropDoneUnallocated,
  editAllocation,
  editPayout,
  editTotal,
  hasUnallocated,
  investmentOf,
  INVEST_KINDS,
  KIND_INFO,
  methodOf,
  METHODS,
  mixFromWeights,
  monthlyAt,
  nisaHitOf,
  ORDER_GROUPS,
  orderOf,
  payoutAgeOf,
  payoutEstimate,
  PAYOUT_METHODS,
  portfolioOf,
  rateOf,
  retireAgeOf,
  selfOf,
  setDrawdown,
  setInvestment,
  setOrder,
  setStopAge,
  stepsOf,
  stopAgeOf,
  switchMethod,
  totalViewOf,
  unallocatedOf,
  valueOf,
  writeSteps,
  type DrawdownView,
  type Method,
  type Step,
  type Tranche,
} from "./model.ts";

const WITH_COST = new Set(["taxable", "nisa", "legacyNisa", "juniorNisa", "childNisa"]);
const man1 = (yen: number) => {
  const v = Math.round(yen / 1000) / 10;
  return Number.isInteger(v) ? v.toLocaleString("ja-JP") : v.toFixed(1);
};
const pct1 = (r: number) => (Math.round(r * 1000) / 10).toFixed(1);

type Unit = "man" | "pct" | "age" | "num";

/** 数の欄: 打っている間は下書きの文字を持ち、読める値になったらすぐ入れる。空欄は null（optional のとき） */
function NumBox(p: { value: number | string | null; unit: Unit; onCommit: (v: number | string | null) => void; optional?: boolean; placeholder?: string; est?: boolean; label: string; size?: "s" | "xs"; data?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = p.value === null ? "" : p.unit === "man" ? formatYen(p.value as number, "man") : p.unit === "pct" ? pctFromRate(String(p.value)) : String(p.value);
  const parse = (t: string): number | string | null | undefined => {
    if (normalizeNumberText(t) === "") return p.optional === true ? null : undefined;
    if (p.unit === "man") {
      const v = parseYen(t, "man");
      return v === null || v < 0 ? undefined : v;
    }
    if (p.unit === "pct") return rateFromPct(t) ?? undefined;
    if (p.unit === "age") {
      const v = parseInteger(t);
      return v === null || v < 0 || v > 110 ? undefined : v;
    }
    const v = Number(normalizeNumberText(t));
    return Number.isFinite(v) && v >= 0 ? v : undefined;
  };
  const bad = draft !== null && parse(draft) === undefined;
  return (
    <input
      type="text"
      inputMode="decimal"
      class={`sv-n${p.size !== undefined ? ` ${p.size}` : ""}${p.est === true ? " est" : ""}${bad ? " bad" : ""}`}
      value={draft ?? shown}
      placeholder={p.placeholder ?? ""}
      aria-label={p.label}
      aria-invalid={bad ? true : undefined}
      data-sv={p.data}
      onFocus={() => setDraft(shown)}
      onInput={(e) => {
        const t = (e.currentTarget as HTMLInputElement).value;
        setDraft(t);
        const v = parse(t);
        if (v !== undefined && t.trim() !== "") p.onCommit(v);
      }}
      onBlur={(e) => {
        const v = parse((e.currentTarget as HTMLInputElement).value);
        if (v !== undefined) p.onCommit(v);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
      }}
    />
  );
}

const EstTag = ({ text }: { text: string }) => <span class="sv-est">{text}</span>;

/** 期間を分けた積立: 「45 〜49歳 月[3]万円」を並べ、「＋期間を追加」で足す */
function StepsEditor(p: { steps: Step[]; now: number; stopAge: number | null; label: string; onChange: (s: Step[]) => void; noStop?: boolean }) {
  const stop = p.noStop === true ? null : p.stopAge;
  const steps = p.steps.length > 0 ? p.steps : [{ fromAge: p.now, monthly: 0 }];
  return (
    <div class="sv-steps">
      {steps.map((s, j) => {
        const next = steps[j + 1];
        const to = next !== undefined ? next.fromAge - 1 : stop !== null ? stop - 1 : null;
        const past = stop !== null && s.fromAge >= stop;
        return (
          <div class={`sv-st${past ? " past" : ""}`} key={j}>
            {j === 0 ? (
              <span class="sv-st-from">{s.fromAge}</span>
            ) : (
              <NumBox
                value={s.fromAge}
                unit="age"
                size="xs"
                label={`${p.label}の${j + 1}つ目の期間の始まりの年齢`}
                onCommit={(v) => {
                  if (typeof v !== "number") return;
                  const lo = (steps[j - 1]?.fromAge ?? 0) + 1;
                  const hi = (steps[j + 1]?.fromAge ?? 100) - 1;
                  if (v < lo || v > hi) return;
                  p.onChange(steps.map((x, k) => (k === j ? { ...x, fromAge: v } : x)));
                }}
              />
            )}
            <span class="sv-st-to">{to === null ? "歳〜" : `〜${Math.max(s.fromAge, to)}歳`}</span>
            <span>月</span>
            <NumBox value={s.monthly} unit="man" size="s" label={`${p.label}の${j + 1}つ目の期間の毎月の積立`} onCommit={(v) => typeof v === "number" && p.onChange(steps.map((x, k) => (k === j ? { ...x, monthly: v } : x)))} />
            <span>万円</span>
            {j > 0 ? (
              <button type="button" class="sv-st-del" aria-label={`${p.label}の${j + 1}つ目の期間を消す`} title="この期間を消す" onClick={() => p.onChange(steps.filter((_, k) => k !== j))}>
                ×
              </button>
            ) : null}
          </div>
        );
      })}
      <button
        type="button"
        class="sv-st-add"
        onClick={() => {
          const last = steps.at(-1) as Step;
          const limit = stop ?? 100;
          const from = Math.min(limit - 1, last.fromAge + 5);
          if (from <= last.fromAge) return;
          p.onChange([...steps, { fromAge: from, monthly: last.monthly }]);
        }}
      >
        ＋期間を追加
      </button>
    </div>
  );
}

export interface SavingsPanelProps {
  wh: WorkingHousehold;
  level: Level;
  onEdit: (next: WorkingHousehold) => void;
}

export function SavingsPanel({ wh, level, onEdit }: SavingsPanelProps) {
  const req = wh.request;
  const h = req.input.household;
  const base = req.input.baseMonth;
  const method = methodOf(req);
  const [carry, setCarry] = useState<{ from: Method; to: Method } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const self = selfOf(h);
  const now = self === undefined ? 0 : ageAt(self, base);
  const stopAge = stopAgeOf(h);
  const retire = retireAgeOf(req);
  const stopShown = stopAge ?? retire ?? 65;

  /** 口座の入れ方の編集: 書き換えた後に、まだ分けていない分が0になったら外して知らせる */
  const editAcc = (fn: (hh: typeof h, r: EngineRequest) => void) => {
    let dropped = false;
    const next = mutate(wh, (hh, r) => {
      fn(hh, r);
      dropped = dropDoneUnallocated(hh, r);
    });
    if (dropped) setNote("合計をすべて口座に分けました（「まだ分けていない」の行が消えます）");
    onEdit(next);
  };
  const find = (hh: typeof h, id: string) => (hh.accounts ?? []).find((a) => a.id === id) as Account;
  const stage = savingsStage(wh);
  const addActions = stage.sections[0]?.actions ?? [];
  const others = stage.sections[1];

  return (
    <div class="sv" data-savings>
      <div class="sv-howto">
        <span class="k">入れ方</span>
        <span class="seg-g" role="radiogroup" aria-label="入れ方">
          {METHODS.map((m) => (
            <button
              type="button"
              key={m.id}
              role="radio"
              aria-checked={method === m.id}
              aria-pressed={method === m.id}
              data-method={m.id}
              {...(method === m.id ? { "data-autofocus": true } : {})}
              onClick={() => {
                if (m.id === method) return;
                setCarry({ from: method, to: m.id });
                setNote(null);
                onEdit(switchMethod(wh, m.id));
              }}
            >
              {m.label}
            </button>
          ))}
        </span>
        <span class="d">{METHODS.find((m) => m.id === method)?.lead}</span>
      </div>
      {carry !== null ? <CarryNote req={req} carry={carry} /> : null}
      {note !== null ? (
        <div class="sv-carry" role="status">
          {note}
        </div>
      ) : null}

      {method === "total" ? (
        <TotalSection wh={wh} onEdit={onEdit} stopAge={stopAge} />
      ) : (
        <section class="sv-sec" aria-label="口座ごとの残高・積立額・利回り">
          <h3>口座ごとの残高・積立額{method === "accounts" ? "・利回り" : ""}</h3>
          <p class="sv-note">残高は今の時価。{method === "accounts" ? "利回りは年の見込み（FPが入れる値。空欄は前提条件の利回り）。" : "運用する口座の利回りは、下の資産の割合から計算します。"}年齢で積立額を変えるときは「＋期間を追加」。</p>
          <AccountsTable wh={wh} level={level} method={method} stopAge={stopAge} editAcc={editAcc} find={find} />
          <div class="sv-add">
            {addActions
              .filter((a) => visible(level, a.level))
              .map((a) => (
                <button type="button" class="add-btn" key={a.key} onClick={() => onEdit(a.run(wh))} data-action={a.key}>
                  {a.label}
                </button>
              ))}
          </div>
          <NisaNote wh={wh} onEdit={onEdit} />
        </section>
      )}

      {method === "allocation" ? <AllocationSection wh={wh} onEdit={onEdit} /> : null}
      {method !== "total" ? <PayoutSection wh={wh} onEdit={onEdit} /> : null}

      <section class="sv-sec" aria-label="運用の期間">
        <h3>運用の期間</h3>
        <p class="sv-note">結果の画面のグラフの上の帯と同じです（帯の切れ目をドラッグしても、プランごとに動かせます）。</p>
        <PeriodSection wh={wh} onEdit={onEdit} now={now} stopAge={stopAge} stopShown={stopShown} retire={retire} />
      </section>

      {others !== undefined && visible(level, others.level) ? <Section section={others} wh={wh} level={level} onEdit={onEdit} /> : null}
    </div>
  );
}

function CarryNote({ req, carry }: { req: EngineRequest; carry: { from: Method; to: Method } }) {
  const un = unallocatedOf(req);
  const t = totalViewOf(req);
  const p = portfolioOf(req);
  const name = (m: Method) => METHODS.find((x) => x.id === m)?.label ?? "";
  let body: string;
  if (carry.to === "total") body = `口座ごとの値を足して、合計にしています。合計 ${man1(t.value)}万円・毎月 ${man1(t.steps[0]?.monthly ?? 0)}万円・平均の利回り ${pct1(Number(t.rate))}%。口座ごとの入力は消さずに残しています。`;
  else if (carry.from === "total")
    body = hasUnallocated(un)
      ? `合計の入力を引き継いでいます。まだ口座に分けていない ${man1(un?.value ?? 0)}万円（毎月 ${man1(un?.steps[0]?.monthly ?? 0)}万円）は、表の「まだ分けていない」の行にあります。口座に入れると、その分だけ減ります（0になると行が消えます）。`
      : `口座ごとの入力をそのまま使います。口座ごとの合計 ${man1(t.value)}万円は、合計の入れ方の値と同じです。`;
  else if (carry.to === "allocation") body = `口座ごとの入力をそのまま使います。残高・積立額・期間・取り崩し方は変わりません。運用する口座の利回りだけ、下の資産の割合から計算した年${pct1(p.net)}%（期待リターン${pct1(p.expected)}%−信託報酬${(p.fee * 100).toFixed(2)}%）に置き換わります。口座ごとの利回りは消さずに残しています。`;
  else body = `${name(carry.from)}の入力は消さずに残しています。この入れ方では使わないだけで、${name(carry.from)}に戻すとそのまま使われます。`;
  return (
    <div class="sv-carry" role="status" data-carry>
      {body}
    </div>
  );
}

function TotalSection({ wh, onEdit, stopAge }: { wh: WorkingHousehold; onEdit: (w: WorkingHousehold) => void; stopAge: number | null }) {
  const req = wh.request;
  const t = totalViewOf(req);
  const sumAcc = accountsOf(req.input.household).reduce((s, a) => s + valueOf(a), 0);
  return (
    <section class="sv-sec" aria-label="金融資産">
      <h3>金融資産</h3>
      <p class="sv-note">預金・NISA・iDeCo・企業型DC・課税口座などを、すべて足した額で入れます。</p>
      <div class="sv-fld">
        <span class="lbl">金融資産の合計</span>
        <div class="ctl">
          <NumBox value={t.value} unit="man" label="金融資産の合計" data="total-value" onCommit={(v) => typeof v === "number" && onEdit(editTotal(wh, { value: v }))} />
          <span class="u">万円</span>
        </div>
        {sumAcc > 0 ? <p class="help">口座ごとに入れた値（合計 {man1(sumAcc)}万円）は残っています。合計を増やした分は、口座の入れ方で「まだ分けていない」に入ります。</p> : null}
      </div>
      <div class="sv-fld top">
        <span class="lbl">毎月の積立額</span>
        <StepsEditor steps={t.steps} now={t.steps[0]?.fromAge ?? 0} stopAge={stopAge ?? retireAgeOf(req)} label="合計" onChange={(steps) => onEdit(editTotal(wh, { steps }))} />
        <p class="help">預金への積立も含めます（会社が出す企業型DC の掛金は含めません）。年齢で額を変えるときは「＋期間を追加」。</p>
      </div>
      <div class="sv-fld">
        <span class="lbl">平均の利回り（年）</span>
        <div class="ctl">
          <NumBox value={t.rate} unit="pct" size="s" label="平均の利回り" data="total-rate" onCommit={(v) => typeof v === "string" && onEdit(editTotal(wh, { rate: v }))} />
          <span class="u">%</span>
        </div>
        <p class="help">{t.uninvested !== null ? "運用しない分を除いた、運用する分の平均。" : "預金も含めた全体の平均。迷ったら、預金が多いほど低めに。"}</p>
      </div>
      <div class="sv-fld">
        <span class="lbl">運用しない分（金額）</span>
        <div class="ctl">
          <NumBox value={t.uninvested} unit="man" optional placeholder="0" label="運用しない分" data="total-uninvested" onCommit={(v) => (v === null || typeof v === "number") && onEdit(editTotal(wh, { uninvested: v }))} />
          <span class="u">万円</span>
        </div>
        <p class="help">
          預金のまま置いておくお金など。この額には平均の利回りをかけず、預金の利回り（前提条件の「現金・預金」の利回り）で計算します。空欄なら全部に平均の利回り。
          {reserveOf(req) !== undefined ? "前提条件の生活防衛資金は、この中から分けて取り崩さないお金にします（運用しない分の内に数えます）。" : "生活防衛資金（取り崩さないお金）は前提条件で入れます。"}
        </p>
      </div>
    </section>
  );
}

function AccountsTable(p: { wh: WorkingHousehold; level: Level; method: Method; stopAge: number | null; editAcc: (fn: (h: EngineRequest["input"]["household"], r: EngineRequest) => void) => void; find: (h: EngineRequest["input"]["household"], id: string) => Account }) {
  const { wh, level, method, stopAge, editAcc, find } = p;
  const req = wh.request;
  const h = req.input.household;
  const base = req.input.baseMonth;
  const list = accountsOf(h);
  const un = unallocatedOf(req);
  const showUn = hasUnallocated(un);
  const owners = memberOptions(wh);
  const multiOwner = owners.length > 1;
  const self = selfOf(h);
  const now = self === undefined ? 0 : ageAt(self, base);
  const totalMonthly = list.reduce((s, a) => s + accountMonthlyAt(h, base, a, now), 0) + (un !== null ? monthlyAt(un.steps, now) : 0);
  const portfolio = portfolioOf(req);
  const steps = (a: Account, t: Tranche, label: string) => (
    <StepsEditor
      steps={stepsOf(h, base, a, t)}
      now={now}
      stopAge={stopAge ?? retireAgeOf(req)}
      noStop={DC_KINDS.has(a.kind)}
      label={label}
      onChange={(s) => editAcc((hh) => writeSteps(hh, base, find(hh, a.id), t, s, stopAge))}
    />
  );
  return (
    <div class="sv-tw">
      <table class="sv-acc">
        <thead>
          <tr>
            <th class="l">口座</th>
            <th>残高</th>
            <th class="l">毎月の積立</th>
            <th>利回り（年）</th>
          </tr>
        </thead>
        <tbody>
          {showUn && un !== null ? (
            <tr class="un" data-unallocated>
              <td class="l">
                <span class="nm">
                  <i class="sw" style={{ background: KIND_INFO.pooled?.color }} />
                  まだ分けていない
                </span>
                <span class="memo">{KIND_INFO.pooled?.memo}</span>
              </td>
              <td class="ro num">{man1(un.value)} 万円</td>
              <td class="ro l">
                {un.steps
                  .filter((s) => s.monthly > 0 || un.steps.length === 1)
                  .map((s, j, arr) => (
                    <span class="stx" key={j}>
                      {arr.length > 1 ? <small>{s.fromAge}歳〜 </small> : null}月{man1(s.monthly)}万円
                    </span>
                  ))}
              </td>
              <td class="ro num">{pct1(Number(un.rate))}%</td>
            </tr>
          ) : null}
          {list.map((a) => {
            const info = KIND_INFO[a.kind] ?? { name: "口座", memo: "", color: "#ccc" };
            const name = `${info.name}${a.kind === "nisa" ? "" : ""}`;
            const allocCalc = method === "allocation" && INVEST_KINDS.has(a.kind);
            return (
              <tr key={a.id} data-account={a.kind}>
                <td class="l">
                  <span class="nm">
                    <i class="sw" style={{ background: info.color }} />
                    {name}
                  </span>
                  <span class="memo">{info.memo}</span>
                  <span class="own">
                    {multiOwner ? (
                      <select aria-label={`${name}の名義`} value={a.owner} onChange={(e) => editAcc((hh) => void (find(hh, a.id).owner = (e.currentTarget as HTMLSelectElement).value))}>
                        {owners.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span>{memberLabel(wh, a.owner)}</span>
                    )}
                    <button type="button" class="link-btn danger" onClick={() => editAcc((hh) => void (hh.accounts = (hh.accounts ?? []).filter((x) => x.id !== a.id)))}>
                      外す
                    </button>
                  </span>
                </td>
                <td>
                  <NumBox value={valueOf(a)} unit="man" label={`${name}の残高`} data={`bal-${a.kind}`} onCommit={(v) => typeof v === "number" && editAcc((hh) => void (find(hh, a.id).marketValue = confirmedBox(v)))} /> 万円
                  {level === "detail" && WITH_COST.has(a.kind) ? (
                    <div class="sv-sub">
                      取得価額 <NumBox value={a.costBasis?.value ?? null} unit="man" size="s" optional placeholder="時価" label={`${name}の取得価額`} onCommit={(v) => editAcc((hh) => {
                        const x = find(hh, a.id);
                        if (v === null) delete x.costBasis;
                        else if (typeof v === "number") x.costBasis = confirmedBox(v);
                      })} /> 万円
                    </div>
                  ) : null}
                </td>
                <td class="l">
                  {a.kind === "nisa" ? (
                    <>
                      <div class="sv-tr">つみたて投資枠</div>
                      {steps(a, "tsumitate", "NISA つみたて投資枠")}
                      {stepsOf(h, base, a, "growth").length > 0 ? (
                        <>
                          <div class="sv-tr">成長投資枠</div>
                          {steps(a, "growth", "NISA 成長投資枠")}
                        </>
                      ) : (
                        <button type="button" class="sv-st-add" onClick={() => editAcc((hh) => writeSteps(hh, base, find(hh, a.id), "growth", [{ fromAge: now, monthly: 10000 }], stopAge))}>
                          ＋成長投資枠の積立
                        </button>
                      )}
                    </>
                  ) : (
                    steps(a, "all", name)
                  )}
                  {a.kind === "corporateDc" ? <span class="memo">会社の掛金（給与からの上乗せを含む）。退職まで</span> : a.kind === "ideco" ? <span class="memo">加入できる年齢まで</span> : null}
                </td>
                <td>
                  {allocCalc ? (
                    <span class="calc">
                      {pct1(portfolio.net)}%<small>割合から計算（口座の値 {pct1(Number(rateOf(req, a)))}%）</small>
                    </span>
                  ) : (
                    <>
                      <NumBox value={a.expectedReturn ?? null} unit="pct" size="s" optional placeholder={pctFromRate(rateOf(req, { ...a, expectedReturn: undefined } as Account))} label={`${name}の利回り`} data={`rate-${a.kind}`} onCommit={(v) => editAcc((hh) => {
                        const x = find(hh, a.id);
                        if (v === null) delete x.expectedReturn;
                        else if (typeof v === "string") x.expectedReturn = v;
                      })} /> %
                    </>
                  )}
                </td>
              </tr>
            );
          })}
          {list.length === 0 && !showUn ? (
            <tr>
              <td colSpan={4} class="l none">
                まだ口座がありません。下の「＋」で足します。
              </td>
            </tr>
          ) : null}
        </tbody>
        <tfoot>
          <tr>
            <th class="l">合計</th>
            <td class="num" data-total-balance>
              {man1(list.reduce((s, a) => s + valueOf(a), 0) + (showUn ? (un?.value ?? 0) : 0))} 万円
            </td>
            <td class="l num">今 月{man1(totalMonthly)}万円</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function NisaNote({ wh, onEdit }: { wh: WorkingHousehold; onEdit: (w: WorkingHousehold) => void }) {
  const hit = nisaHitOf(wh.request);
  const over = investmentOf(wh.request).nisaOverflow ?? "deposit";
  if (hit === null) return null;
  return (
    <div class="sv-nisa" role="status" data-nisa-note>
      <div class="nt">
        {hit.kind === "lifetime" ? <b>{hit.year}年に NISA の枠を使い切ります。</b> : <b>{hit.year}年から NISA の年間の枠を超えます。</b>}
        <small>
          {hit.age !== null ? `${hit.age}歳。` : ""}
          {hit.kind === "lifetime" ? "生涯の枠1,800万円（成長投資枠は1,200万円まで）を使い切り、その後の積立は NISA に入りません（見込み。売った分の枠の復活は数えていません）" : `つみたて投資枠 年120万円・成長投資枠 年240万円。年${man1(hit.over)}万円が枠に入りません`}
        </small>
      </div>
      <div class="nc">
        超えた分は
        <span class="seg-g sm" role="group" aria-label="NISA の枠を超えた分の扱い">
          <button type="button" aria-pressed={over === "deposit"} onClick={() => onEdit(mutate(wh, (_h, r) => setInvestment(r, { nisaOverflow: undefined })))}>
            預金に残す（既定）
          </button>
          <button type="button" aria-pressed={over === "taxable"} onClick={() => onEdit(mutate(wh, (_h, r) => setInvestment(r, { nisaOverflow: "taxable" })))} data-nisa-over="taxable">
            課税口座で続ける
          </button>
        </span>
      </div>
    </div>
  );
}

/** 今の資産の内訳（口座ごと・資産の種類ごと） */
export function currentMix(req: EngineRequest, by: "account" | "class"): DonutItem[] {
  const h = req.input.household;
  const list = accountsOf(h);
  const un = unallocatedOf(req);
  if (by === "account") {
    const items: DonutItem[] = list.map((a) => ({ label: KIND_INFO[a.kind]?.name ?? "口座", amount: valueOf(a), color: KIND_INFO[a.kind]?.color ?? "#ccc" }));
    if (un !== null && un.value > 0) items.push({ label: "まだ分けていない", amount: un.value, color: KIND_INFO.pooled?.color ?? "#ddd" });
    // 同じ名前（2人の NISA など）は足す
    const merged = new Map<string, DonutItem>();
    for (const x of items) {
      const m = merged.get(x.label);
      merged.set(x.label, m === undefined ? { ...x } : { ...m, amount: m.amount + x.amount });
    }
    return [...merged.values()];
  }
  const rows = classRows(req);
  const total = rows.reduce((s, r) => s + r.weight, 0) || 1;
  const invest = list.filter((a) => INVEST_KINDS.has(a.kind)).reduce((s, a) => s + valueOf(a), 0) + (un?.value ?? 0);
  const cash = list.filter((a) => !INVEST_KINDS.has(a.kind)).reduce((s, a) => s + valueOf(a), 0);
  return rows.map((r) => ({ label: r.name, amount: Math.round((invest * r.weight) / total) + (r.key === "cash.deposit" ? cash : 0), color: r.color }));
}

function AllocationSection({ wh, onEdit }: { wh: WorkingHousehold; onEdit: (w: WorkingHousehold) => void }) {
  const req = wh.request;
  const rows = classRows(req);
  const sumW = rows.reduce((s, r) => s + r.weight, 0);
  const port = portfolioOf(req);
  const inv = investmentOf(req);
  const order = orderOf(req);
  const [by, setBy] = useState<"account" | "class">("class");
  const edit = (fn: (r: EngineRequest) => void) => onEdit(mutate(wh, (_h, r) => fn(r)));
  const setWeight = (key: string, w: number) => edit((r) => editAllocation(r, { mix: mixFromWeights(classRows(r).map((x) => ({ key: x.key, weight: x.key === key ? w : x.weight }))) }));
  const setSeries = (field: "assetReturns" | "assetVolatility", key: string, v: string | null) =>
    edit((r) => {
      const a = (r.input.assumptions ??= { investmentReturn: { default: "0.01" } });
      if (field === "assetReturns") {
        const m = { ...(a.assetReturns ?? {}) };
        if (v === null) delete m[key];
        else m[key] = { default: v };
        if (Object.keys(m).length === 0) delete a.assetReturns;
        else a.assetReturns = m;
      } else {
        const m = { ...(a.assetVolatility ?? {}) };
        if (v === null) delete m[key];
        else m[key] = v;
        if (Object.keys(m).length === 0) delete a.assetVolatility;
        else a.assetVolatility = m;
      }
    });
  const panes: DonutPane[] = [{ title: "今の内訳", sub: by === "account" ? "口座ごと" : "資産の種類ごと（運用する口座は下の割合）", items: currentMix(req, by) }];
  return (
    <>
      <section class="sv-sec" aria-label="資産の種類ごとの割合">
        <h3>資産の種類ごとの割合</h3>
        <p class="sv-note">運用する口座（NISA・iDeCo・企業型DC・課税口座）に共通の割合です。預金は現金のまま。期待リターンと値動きの大きさは、FPが根拠を持って入れる値です（空欄は事務所の標準値。いまは仮の値）。商品は選ばず、資産の種類で入れます。</p>
        <div class="sv-tw">
          <table class="sv-cls">
            <thead>
              <tr>
                <th class="l">資産の種類</th>
                <th>割合</th>
                <th>
                  期待リターン（年）<span class="fp">FPが入れる値</span>
                </th>
                <th>
                  値動きの大きさ（年）<span class="fp">FPが入れる値</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.key} data-class={c.key}>
                  <td class="l">
                    <span class="nm">
                      <i class="sw" style={{ background: c.color }} />
                      {c.name}
                    </span>
                  </td>
                  <td>
                    <NumBox value={c.weight} unit="num" size="s" label={`${c.name}の割合`} onCommit={(v) => typeof v === "number" && setWeight(c.key, v)} /> %
                  </td>
                  <td>
                    <NumBox value={c.muOwn ? c.mu : null} unit="pct" size="s" optional placeholder={pctFromRate(CLASSES.find((x) => x.key === c.key)?.mu ?? "0")} label={`${c.name}の期待リターン`} onCommit={(v) => setSeries("assetReturns", c.key, typeof v === "string" ? v : null)} /> %
                  </td>
                  <td>
                    <NumBox value={c.sdOwn ? c.sd : null} unit="pct" size="s" optional placeholder={pctFromRate(CLASSES.find((x) => x.key === c.key)?.sd ?? "0")} label={`${c.name}の値動きの大きさ`} onCommit={(v) => setSeries("assetVolatility", c.key, typeof v === "string" ? v : null)} /> %
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th class="l">合計</th>
                <td class={Math.abs(sumW - 100) > 0.05 ? "sum-ng" : ""}>
                  {Math.round(sumW * 10) / 10}%{Math.abs(sumW - 100) > 0.05 ? "（計算は割合で按分）" : ""}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
        <div class="sv-allocbar" aria-hidden="true">
          {rows.map((c) => (
            <i key={c.key} style={{ width: `${(c.weight / (sumW || 1)) * 100}%`, background: c.color }} />
          ))}
        </div>
        <div class="sv-port" data-portfolio>
          <span>
            組み合わせた期待リターン <b class="num">{pct1(port.expected)}%</b>
          </span>
          <span>
            信託報酬を引くと <b class="num">{pct1(port.net)}%</b>
          </span>
          <span>
            値動きの大きさ <b class="num">{pct1(port.sd)}%</b>
          </span>
          <span>
            株などの割合 <b class="num">{Math.round(port.risky * 100)}%</b>
          </span>
        </div>
        <div class="sv-fld">
          <span class="lbl">信託報酬（年・平均）</span>
          <div class="ctl">
            <NumBox value={inv.allocation?.fee ?? null} unit="pct" size="s" optional placeholder={pctFromRate("0.0025")} label="信託報酬" onCommit={(v) => edit((r) => editAllocation(r, { fee: typeof v === "string" ? v : "0.0025" }))} />
            <span class="u">%</span>
          </div>
          <p class="help">持っている投資信託の平均。商品名からは選ばず、FPが入れます。期待リターンから差し引きます。値動きの大きさは計算には使わず、目減りの扱いは期待リターンに含めて入れる前提です。</p>
        </div>
      </section>
      <section class="sv-sec" aria-label="資産の内訳">
        <h3>資産の内訳</h3>
        <div class="sv-mixh">
          <span class="seg-g sm" role="group" aria-label="内訳の分け方">
            <button type="button" aria-pressed={by === "account"} onClick={() => setBy("account")}>
              口座ごと
            </button>
            <button type="button" aria-pressed={by === "class"} onClick={() => setBy("class")}>
              資産の種類ごと
            </button>
          </span>
          <span class="sv-note">結果の画面では、プランAと選んだプランを同じ年で並べます。</span>
        </div>
        <DonutPair panes={panes} />
      </section>
      <section class="sv-sec" aria-label="取り崩しの順番・税・リバランス">
        <h3>取り崩しの順番・税・リバランス</h3>
        <div class="sv-fld">
          <span class="lbl">取り崩す口座の順番</span>
          <ol class="sv-order">
            {order.map((k, i) => (
              <li key={k}>
                <span class="k">{i + 1}</span>
                {ORDER_GROUPS[k]?.name}
                <button type="button" aria-label={`${ORDER_GROUPS[k]?.name}を前へ`} disabled={i === 0} onClick={() => edit((r) => setOrder(r, order.map((x, j) => (j === i - 1 ? k : j === i ? (order[i - 1] as string) : x))))}>
                  ◀
                </button>
                <button type="button" aria-label={`${ORDER_GROUPS[k]?.name}を後ろへ`} disabled={i === order.length - 1} onClick={() => edit((r) => setOrder(r, order.map((x, j) => (j === i + 1 ? k : j === i ? (order[i + 1] as string) : x))))}>
                  ▶
                </button>
              </li>
            ))}
          </ol>
          <p class="help">まだ口座に分けていない分は、預金の次に取り崩します。iDeCo・企業型DCは、受け取り方に沿って預金に入ります（順番には入れません）。</p>
        </div>
        <div class="sv-fld">
          <span class="lbl">課税口座の税</span>
          <span class="seg-g sm" role="group" aria-label="課税口座の税">
            <button type="button" aria-pressed={(inv.taxableTax ?? "onSale") === "onSale"} onClick={() => edit((r) => setInvestment(r, { taxableTax: undefined }))}>
              売るときに利益の約20%
            </button>
            <button type="button" aria-pressed={inv.taxableTax === "annual"} onClick={() => edit((r) => setInvestment(r, { taxableTax: "annual" }))}>
              毎年の値上がりに約20%（控えめ）
            </button>
          </span>
        </div>
        <div class="sv-fld">
          <span class="lbl">リバランス</span>
          <span class="seg-g sm" role="group" aria-label="リバランス">
            <button type="button" aria-pressed={inv.allocation?.rebalance !== false} onClick={() => edit((r) => editAllocation(r, { rebalance: true }))}>
              する（年1回、元の割合に戻す）
            </button>
            <button type="button" aria-pressed={inv.allocation?.rebalance === false} onClick={() => edit((r) => editAllocation(r, { rebalance: false }))}>
              しない
            </button>
          </span>
        </div>
      </section>
    </>
  );
}

function PayoutSection({ wh, onEdit }: { wh: WorkingHousehold; onEdit: (w: WorkingHousehold) => void }) {
  const req = wh.request;
  const h = req.input.household;
  const dcs = accountsOf(h).filter((a) => DC_KINDS.has(a.kind));
  if (dcs.length === 0) return null;
  const edit = (id: string, patch: Parameters<typeof editPayout>[2]) => onEdit(mutate(wh, (hh) => editPayout(hh, (hh.accounts ?? []).find((a) => a.id === id) as Account, patch)));
  return (
    <section class="sv-sec" aria-label="iDeCo・企業型DC の受け取り方">
      <h3>iDeCo・企業型DC の受け取り方</h3>
      <p class="sv-note">空欄は「退職の年（60〜65歳）に一時金」で計算します（推定）。受け取ったお金は、預金に入れるか、運用を続けるかを選べます。</p>
      {dcs.map((a) => {
        const est = a.payout === undefined;
        const ageEst = payoutAgeOf(h, a) === null;
        const e = payoutEstimate(req, a);
        const name = `${KIND_INFO[a.kind]?.name ?? ""}（${memberLabel(wh, a.owner)}）`;
        const dest = a.payout?.destination ?? "deposit";
        return (
          <div class="sv-dc" key={a.id} data-payout={a.kind}>
            <h4>{name}</h4>
            <div class="sv-fld">
              <span class="lbl">受け取り方</span>
              <div class="ctl">
                <span class="seg-g sm" role="group" aria-label={`${name}の受け取り方`}>
                  {PAYOUT_METHODS.map((m) => (
                    <button type="button" key={m.id} aria-pressed={!est && a.payout?.method === m.id} onClick={() => edit(a.id, { method: m.id })}>
                      {m.label}
                    </button>
                  ))}
                </span>
                {est ? (
                  <EstTag text="推定あり: 退職の年に一時金" />
                ) : (
                  <button type="button" class="link-btn" onClick={() => edit(a.id, { method: null })}>
                    空欄に戻す
                  </button>
                )}
              </div>
            </div>
            <div class="sv-fld">
              <span class="lbl">受け取りを始める年齢</span>
              <div class="ctl">
                <NumBox value={payoutAgeOf(h, a)} unit="age" size="s" optional est={ageEst} placeholder={String(defaultPayoutAge(req, a))} label={`${name}の受け取りを始める年齢`} onCommit={(v) => edit(a.id, { age: typeof v === "number" ? Math.min(75, Math.max(60, v)) : null })} />
                <span class="u">歳</span>
                {ageEst ? <EstTag text={`推定あり: 退職の年（${defaultPayoutAge(req, a)}歳）`} /> : null}
              </div>
            </div>
            <div class="sv-fld">
              <span class="lbl">受け取ったお金</span>
              <div class="ctl">
                <span class="seg-g sm" role="group" aria-label={`${name}の受け取ったお金の行き先`}>
                  <button type="button" aria-pressed={dest === "deposit"} onClick={() => edit(a.id, { destination: "deposit" })}>
                    預金に入れる（既定）
                  </button>
                  <button type="button" aria-pressed={dest === "invest"} onClick={() => edit(a.id, { destination: "invest" })} data-dest="invest">
                    運用を続ける
                  </button>
                </span>
              </div>
              <p class="help">{dest === "invest" ? "受け取った年に NISA の枠の残りへ入れ、枠を超えた分は課税口座で運用します。" : "預金に入り、足りないときに取り崩します。"}</p>
            </div>
            <div class="sv-fld">
              <span class="lbl">受け取る額（概算）</span>
              <div class="sv-recv">
                {(a.payout?.method ?? "lumpSum") === "lumpSum"
                  ? `${e.age}歳で一時金 約${man1(e.lump)}万円（税は退職所得の控除の範囲なら0）`
                  : a.payout?.method === "annuity"
                    ? `${e.age}〜${e.age + e.years - 1}歳に 毎年 約${man1(e.annual)}万円（税は概算で5%）`
                    : `${e.age}歳で一時金 約${man1(e.lump)}万円 ＋ ${e.age}〜${e.age + e.years - 1}歳に 毎年 約${man1(e.annual)}万円`}
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function PeriodSection(p: { wh: WorkingHousehold; onEdit: (w: WorkingHousehold) => void; now: number; stopAge: number | null; stopShown: number; retire: number | null }) {
  const { wh, onEdit, now, stopAge, stopShown, retire } = p;
  const req = wh.request;
  const dd = drawdownOf(req);
  const wOn = dd.method !== "none";
  const setDd = (v: Partial<DrawdownView>) => onEdit(mutate(wh, (_h, r) => setDrawdown(r, { ...dd, ...v })));
  const est = stopAge === null;
  return (
    <>
      <div class="sv-per">
        <div class="per-c acc">
          <div class="pt">↑ 積み立てる</div>
          <div class="pv">
            今（{now}歳）〜{" "}
            <NumBox
              value={stopAge}
              unit="age"
              size="s"
              optional
              est={est}
              placeholder={String(retire ?? 65)}
              label="積立をやめる年齢"
              data="stop-age"
              onCommit={(v) =>
                onEdit(
                  mutate(wh, (hh, r) => {
                    const age = typeof v === "number" ? Math.max(now + 1, Math.min(90, v)) : null;
                    setStopAge(hh, r.input.baseMonth, age);
                    dropDoneUnallocated(hh, r);
                  }),
                )
              }
            />{" "}
            歳でやめる
          </div>
          {est ? (
            <div class="pv">
              <EstTag text={`推定あり: 退職の年（${retire ?? 65}歳）まで`} />
            </div>
          ) : null}
        </div>
        <div class={`per-c ${wOn ? "hold" : "off"}`}>
          <div class="pt">→ 据え置く</div>
          <div class="pv">
            <b>{!wOn ? "取り崩しの予定なし" : stopShown >= dd.startAge ? "なし" : `${stopShown}〜${dd.startAge - 1}歳`}</b>
          </div>
        </div>
        <div class={`per-c ${wOn ? "wd" : "off"}`}>
          <div class="pt">↓ 取り崩す</div>
          <div class="pv">
            {wOn ? (
              <>
                <NumBox value={dd.startAge} unit="age" size="s" label="取り崩しを始める年齢" onCommit={(v) => typeof v === "number" && v > now && setDd({ startAge: Math.min(95, v) })} /> 歳から
              </>
            ) : (
              "予定なし（足りないときだけ取り崩す）"
            )}
          </div>
        </div>
      </div>
      <div class="sv-fld">
        <span class="lbl">取り崩し方</span>
        <div class="ctl">
          <span class="seg-g sm" role="group" aria-label="取り崩し方">
            <button type="button" aria-pressed={dd.method === "none"} onClick={() => setDd({ method: "none" })}>
              予定なし
            </button>
            <button type="button" aria-pressed={dd.method === "fixed"} onClick={() => setDd({ method: "fixed" })} data-dd="fixed">
              定額（毎月同じ額）
            </button>
            <button type="button" aria-pressed={dd.method === "rate"} onClick={() => setDd({ method: "rate" })}>
              定率（残高の○%）
            </button>
          </span>
        </div>
        <p class="help">予定なしは、収支が足りない年だけ預金→課税口座→NISA の順に取り崩します。定額・定率は、その額を金融資産から使います（収支の不足のほうが大きい年は不足の分）。</p>
      </div>
      {dd.method === "fixed" ? (
        <div class="sv-fld">
          <span class="lbl">毎月の取り崩し額</span>
          <div class="ctl">
            <NumBox value={dd.monthly} unit="man" size="s" label="毎月の取り崩し額" onCommit={(v) => typeof v === "number" && setDd({ monthly: v })} />
            <span class="u">万円</span>
          </div>
          <p class="help">年金などで足りない生活費の分を含めた、金融資産から使う額。結果の画面の「取り崩しの計算」で逆算もできます。</p>
        </div>
      ) : dd.method === "rate" ? (
        <div class="sv-fld">
          <span class="lbl">毎年の取り崩し率</span>
          <div class="ctl">
            <NumBox value={dd.rate} unit="pct" size="s" label="毎年の取り崩し率" onCommit={(v) => typeof v === "string" && setDd({ rate: v })} />
            <span class="u">%（その年の初めの金融資産に対して）</span>
          </div>
        </div>
      ) : null}
    </>
  );
}

