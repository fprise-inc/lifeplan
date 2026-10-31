// 入力の「貯蓄・運用」のパネルの中身（作業の層。0026）: 入れ方（合計／口座／資産配分）・口座ごとの残高と期間を分けた積立と利回り・
// NISA の枠の知らせ・資産配分・iDeCo と企業型DC の受け取り・運用の期間（積立をやめる年・取り崩し）。値を変えるたびに onEdit に新しい世帯を渡す
import { Fragment } from "preact";
import { useState } from "preact/hooks";
import type { Account, EngineRequest } from "../../../engine/types.ts";
import { Help, HelpOf } from "../../../presentation/Help.tsx";
import { DonutPair, type DonutItem, type DonutPane } from "../../../presentation/Donut.tsx";
import { ageAt } from "../../levers.ts";
import { actionHelp, Field, fieldDomId, Group, MoreToggle, Section, shouldCommitOnBlur, useGroupOpen, visible } from "../FieldViews.tsx";
import { FieldStateBadge, FieldStateLine } from "../FieldStateLine.tsx";
import { allFields, type FieldDef, type GroupDef, type Level, type SectionDef } from "../form.ts";
import { mutate, type WorkingHousehold } from "../household.ts";
import { memberLabel, memberOptions } from "../labels.ts";
import { buildStage } from "../stages/index.ts";
import { MAIN_ADD_KINDS } from "../stages/savings.ts";
import { revealAdded } from "../../../presentation/revealAdded.ts";
import { formatYen, normalizeNumberText, parseInteger, parseYen, pctFromRate, rateFromPct } from "../units.ts";
import {
  accountMonthlyAt,
  accountsOf,
  CLASSES,
  classRows,
  DC_KINDS,
  defaultPayoutAge,
  drawdownOf,
  drawdownStartDefault,
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
  returnShiftNote,
  accountName,
  payoutAgeOf,
  payoutEstimate,
  pooledOf,
  PAYOUT_METHODS,
  portfolioOf,
  rateOf,
  selfOf,
  setDrawdown,
  resetWithdrawOrder,
  setInvestment,
  setStopAge,
  setWithdrawOrder,
  stepsOf,
  stopAgeOf,
  stopAgeOrEstimate,
  stopEstimateOf,
  switchMethod,
  RATE_PRESETS,
  totalViewOf,
  unallocatedOf,
  valueOf,
  withdrawViewOf,
  writeSteps,
  type DrawdownView,
  type Method,
  type Step,
  type StopEstimate,
  type Tranche,
} from "./model.ts";

const WITH_COST = new Set(["taxable", "nisa", "legacyNisa", "juniorNisa", "childNisa"]);
const man1 = (yen: number) => {
  const v = Math.round(yen / 1000) / 10;
  return Number.isInteger(v) ? v.toLocaleString("ja-JP") : v.toFixed(1);
};
const pct1 = (r: number) => (Math.round(r * 1000) / 10).toFixed(1);

type Unit = "man" | "pct" | "age" | "num";

/**
 * 数の欄: 打っている間は下書きの文字を持ち、読める値になったらすぐ入れる。空欄は null（optional のとき）。
 * 入ったときと同じ文字のまま離れたら書かない（欄に入って離れる・Tab で通るだけで、値も状態も変えない。0041）
 */
function NumBox(p: { value: number | string | null; unit: Unit; onCommit: (v: number | string | null) => void; optional?: boolean; placeholder?: string; est?: boolean; label: string; size?: "s" | "xs"; data?: string; id?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [start, setStart] = useState<string | null>(null);
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
      {...(p.id !== undefined ? { id: p.id } : {})}
      onFocus={() => {
        setDraft(shown);
        setStart(shown);
      }}
      onInput={(e) => {
        const t = (e.currentTarget as HTMLInputElement).value;
        setDraft(t);
        const v = parse(t);
        if (v !== undefined && t.trim() !== "") p.onCommit(v);
      }}
      onBlur={(e) => {
        const t = (e.currentTarget as HTMLInputElement).value;
        if (shouldCommitOnBlur(start, t)) {
          const v = parse(t);
          if (v !== undefined) p.onCommit(v);
        }
        setDraft(null);
        setStart(null);
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
          <div class={`sv-st${past ? " past" : ""}`} key={j} data-reveal-item>
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
        onClick={(e) => {
          revealAdded(e.currentTarget);
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

/** 段階の定義の欄をキーで引く（専用の部品に値の状態の印・操作を添えるため） */
export type FieldMap = ReadonlyMap<string, FieldDef>;

/** 口座の表で入れる欄（口座ごとの詳細の区画には出さない） */
const IN_TABLE = /\/(kind|owner|value|monthly|rate|cost|payout|payoutAge|payoutDest|payoutAt|payoutYears|lumpShare|enrolled)$/;

export function SavingsPanel({ wh, level, onEdit }: SavingsPanelProps) {
  const req = wh.request;
  const h = req.input.household;
  const base = req.input.baseMonth;
  const method = methodOf(req);
  const [carry, setCarry] = useState<{ from: Method; to: Method } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [moreKinds, setMoreKinds] = useState(false);
  const self = selfOf(h);
  const now = self === undefined ? 0 : ageAt(self, base);
  const stopAge = stopAgeOf(h);
  const estimate = stopEstimateOf(req);
  const stopShown = stopAge ?? estimate.age;
  // 結果のタブの「運用の利回り」で動かした前提の書き換え（口座の利回りの欄には出ないので、ここで知らせる）
  const shiftNote = returnShiftNote(req);

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
  /**
   * 欄の定義で書く。数の欄は打ったとき（と、文字を変えて離れたとき）だけ呼ぶので、同じ値でも書く（未入力の0円に0を打つと確定。0041 の2）。
   * まだ分けていない分が0になったら外す
   */
  const editField = (f: FieldDef | undefined, v: number | string | null) => {
    if (f === undefined) return;
    const next = (f.write ?? f.set)(wh, v);
    if (next === wh) return;
    let dropped = false;
    const out = mutate(next, (hh, r) => {
      dropped = dropDoneUnallocated(hh, r);
    });
    if (dropped) setNote("合計をすべて口座に分けました（「まだ分けていない」の行が消えます）");
    onEdit(dropped ? out : next);
  };
  const find = (hh: typeof h, id: string) => (hh.accounts ?? []).find((a) => a.id === id) as Account;
  const stage = buildStage("savings", wh);
  const fields: FieldMap = new Map(allFields(stage).map((f) => [f.key, f]));
  const sectionOf = (key: string) => stage.sections.find((x) => x.key === key);
  const accountsSec = sectionOf("sav/accounts");
  const addActions = (accountsSec?.actions ?? []).filter((a) => visible(level, a.level) || (moreKinds && !MAIN_ADD_KINDS.has(a.key.replace("sav/add/", ""))));
  const others = sectionOf("sav/others");
  // 利回りの段階・例外の年（詳細。0040）
  const returns = sectionOf("sav/returns");
  const flow = sectionOf("sav/flow");
  // 口座ごとの詳細（表で入れる欄を除いた、残高の時点・運用の費用・積立の終わり・引き出せない期間・旧NISA の内訳・資産の配分）
  const details: SectionDef | null =
    method === "total" || accountsSec === undefined
      ? null
      : {
          key: "sav/details",
          title: "口座ごとの詳細",
          note: "残高の時点・積立の終わり・引き出せない期間・資産の配分など。空欄なら、残高は今月の時点、積立は退職の年まで続く形で計算します",
          level: "detail",
          groups: accountsSec.groups
            .filter((g) => !g.key.startsWith("sav/period") && !g.key.endsWith("/addMix") && !/\/mix\/\d+$/.test(g.key) && !(h.accounts ?? []).some((a) => a.kind === "pooled" && g.key === `sav/${a.id}`))
            .map((g): GroupDef => ({ ...g, fields: g.fields.filter((f) => !IN_TABLE.test(f.key)), actions: g.actions.filter((a) => !a.key.endsWith("/remove") || /\/lot\/\d+\/remove$/.test(a.key)) }))
            .flatMap((g) => {
              const id = g.key.match(/^sav\/([^/]+)$/)?.[1];
              if (id === undefined) return [g];
              // 口座の資産の配分は、その口座のまとまりの後ろに並べる（資産配分の入れ方の運用する口座は、共通の割合を使うので出さない）
              const acc = (h.accounts ?? []).find((a) => a.id === id);
              const mixes = method === "allocation" && acc !== undefined && INVEST_KINDS.has(acc.kind) ? [] : accountsSec.groups.filter((x) => x.key.startsWith(`sav/${id}/mix/`) || x.key === `sav/${id}/addMix`);
              return [g, ...mixes];
            }),
          actions: [],
        };

  // 標準のときの口座1つごとの「▸ 詳しく」: その口座の詳細（口座ごとの詳細のまとまりと資産の配分・利回りの段階）だけを表の下の行に開く（0078 の追記）
  const moreOf =
    level === "simple" && details !== null
      ? (id: string): GroupDef[] => {
          const mine = (g: GroupDef) => g.key === `sav/${id}` || g.key.startsWith(`sav/${id}/`);
          return [...details.groups.filter(mine).map((g) => (g.key === `sav/${id}` ? { ...g, title: undefined } : g)), ...(returns?.groups ?? []).filter(mine)].filter((g) => g.fields.length > 0 || g.actions.length > 0);
        }
      : undefined;
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
        <Help label="入れ方">
          {METHODS.map((m) => (
            <p key={m.id}>
              <b>{m.label}</b>: {m.lead}
            </p>
          ))}
        </Help>
      </div>
      {method !== "total" && (h.accounts ?? []).every((a) => !isFinancialShown(a)) ? (
        <p class="sv-note" data-total-hint>
          合計だけでも入れられます
          <Help label="合計の入れ方">合計しか分からないときは「合計」（金融資産の合計の1欄）で入れられます。</Help>
        </p>
      ) : null}
      {carry !== null ? <CarryNote req={req} carry={carry} /> : null}
      {shiftNote !== null ? (
        <p class="sv-note" role="note" data-return-shifts>
          {shiftNote}
        </p>
      ) : null}
      {note !== null ? (
        <div class="sv-carry" role="status">
          {note}
        </div>
      ) : null}

      {method === "total" ? (
        <TotalSection wh={wh} level={level} fields={fields} onEdit={onEdit} />
      ) : (
        <section class="sv-sec" aria-label="口座ごとの残高・積立額・利回り">
          <h3>
            口座ごとの残高・積立額{method === "accounts" ? "・利回り" : ""}
            <Help label="口座ごとの残高・積立額">
              残高は今の時価。{method === "accounts" ? "利回りは1年あたりの見込みを、信託報酬などの費用を引いた後で入れます。空欄なら、前提条件の目安の利回りで計算します（費用を別に入れる形は詳細で）。" : "運用する口座の利回りは、下の資産の割合から計算します。"}年齢で積立額を変えるときは「＋期間を追加」。
            </Help>
          </h3>
          <AccountsTable wh={wh} level={level} method={method} stopAge={stopAge} editAcc={editAcc} editField={editField} find={find} fields={fields} onEdit={onEdit} {...(moreOf !== undefined ? { moreOf } : {})} />
          <div class="sv-add">
            {addActions.map((a) => (
              <HelpOf key={a.key} help={actionHelp(a)}>
                <button type="button" class="add-btn" onClick={(e) => { if (a.label.startsWith("＋")) revealAdded(e.currentTarget); onEdit(a.run(wh)); }} data-action={a.key}>
                  {a.label}
                </button>
              </HelpOf>
            ))}
            {level === "simple" ? (
              <button type="button" class="link-btn" aria-expanded={moreKinds} onClick={() => setMoreKinds(!moreKinds)} data-more-kinds>
                {moreKinds ? "そのほかを閉じる" : "そのほか ▾（財形・企業型DC・外貨預金・持株会・小規模企業共済・旧NISA など）"}
              </button>
            ) : null}
          </div>
          <NisaNote wh={wh} onEdit={onEdit} />
        </section>
      )}

      {details !== null && visible(level, details.level) ? <Section section={details} wh={wh} level={level} onEdit={onEdit} /> : null}
      {method === "allocation" ? <AllocationSection wh={wh} onEdit={onEdit} /> : null}
      {method !== "total" ? <PayoutSection wh={wh} level={level} fields={fields} onEdit={onEdit} /> : null}

      <section class="sv-sec" aria-label="運用の期間">
        <h3>
          運用の期間
          <Help label="運用の期間">結果の画面のグラフの上の帯と同じです（帯の切れ目をドラッグしても、プランごとに動かせます）。</Help>
        </h3>
        <PeriodSection wh={wh} level={level} onEdit={onEdit} now={now} stopAge={stopAge} stopShown={stopShown} estimate={estimate} fields={fields} />
      </section>

      {method !== "total" ? <FlowSection wh={wh} level={level} flow={flow} onEdit={onEdit} /> : (
        <p class="sv-note" data-flow-total>
          取り崩す順番・預金に残しておく額などのお金の行き先は、合計の入れ方では使いません（口座の入れ方に戻すと効きます）。
        </p>
      )}
      {others !== undefined && visible(level, others.level) ? <Section section={others} wh={wh} level={level} onEdit={onEdit} /> : null}
      {returns !== undefined && visible(level, returns.level) && returns.groups.length > 0 ? <Section section={returns} wh={wh} level={level} onEdit={onEdit} /> : null}
    </div>
  );
}

/** 口座の表に出す金融資産か（まとめた器・不動産・その他の資産・保険を除く） */
const isFinancialShown = (a: Account) => !["pooled", "realEstate", "otherAsset", "insurance"].includes(a.kind);

/** 区画「お金の行き先」: 簡易は札と1文、詳細は取り崩す順番（口座ごとの並べ替えと取り崩さない）・決済口座・預金に残しておく額 */
function FlowSection({ wh, level, flow, onEdit }: { wh: WorkingHousehold; level: Level; flow: SectionDef | undefined; onEdit: (w: WorkingHousehold) => void }) {
  const req = wh.request;
  const h = req.input.household;
  const v = withdrawViewOf(req);
  const name = (a: Account) => accountName(a, memberLabel(wh, a.owner));
  const min = req.input.assumptions?.withdrawal?.minimumDeposit;
  const summary = `取り崩す順番: ${v.settlement !== undefined ? `${name(v.settlement)}［収支が入る口座］ → ` : ""}${v.included.map(name).join(" → ") || "なし"}${v.standard ? "（標準）" : ""}${v.excluded.length > 0 ? `。取り崩さない: ${v.excluded.map(name).join("・")}` : ""}${min !== undefined && min > 0 ? `。預金に残しておく額 ${(min / 10000).toLocaleString("ja-JP")}万円` : ""}`;
  if (level === "simple")
    return (
      <section class="sv-sec" aria-label="お金の行き先">
        <h3>
          お金の行き先 <span class="sv-est">詳細あり</span>
        </h3>
        <p class="sv-note" data-flow-summary>
          {summary}。「詳細」で直せます。
        </p>
      </section>
    );
  const write = (ids: string[]) => onEdit(mutate(wh, (_h, r) => setWithdrawOrder(r, ids)));
  const ids = v.included.map((a) => a.id);
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j] as string, next[i] as string];
    write(next);
  };
  return (
    <section class="sv-sec" aria-label="お金の行き先" data-flow>
      <h3>
        お金の行き先
        <Help label="お金の行き先">収支が足りない年に、どの口座から取り崩すか。iDeCo・企業型DC・小規模企業共済は、受け取り方に沿って預金に入ります（順番には入れません）。まだ口座に分けていない分は、収支が入る口座の次に取り崩します。</Help>
      </h3>
      <div class="sv-fld top">
        <span class="lbl">取り崩す順番</span>
        <ol class="sv-order acc" data-withdraw-order>
          {v.settlement !== undefined ? (
            <li class="settle" data-settlement>
              <span class="k">−</span>
              {name(v.settlement)}
              <small>収支が入る口座（ここが足りなくなると、下の順に取り崩します）</small>
            </li>
          ) : null}
          {v.included.map((a, i) => (
            <li key={a.id} data-order-account={a.id}>
              <span class="k">{i + 1}</span>
              {name(a)}
              <button type="button" aria-label={`${name(a)}を前へ`} disabled={i === 0} onClick={() => move(i, -1)}>
                ▲
              </button>
              <button type="button" aria-label={`${name(a)}を後ろへ`} disabled={i === ids.length - 1} onClick={() => move(i, 1)}>
                ▼
              </button>
              <label class="sv-keep">
                <input type="checkbox" checked={false} onChange={() => write(ids.filter((x) => x !== a.id))} data-keep={a.id} />
                取り崩さない
              </label>
            </li>
          ))}
          {v.excluded.map((a) => (
            <li key={a.id} class="off" data-order-account={a.id}>
              <span class="k">−</span>
              {name(a)}
              <label class="sv-keep">
                <input type="checkbox" checked={true} onChange={() => write([...ids, a.id])} data-keep={a.id} />
                取り崩さない
              </label>
            </li>
          ))}
        </ol>
        <p class="help">
          {v.standard ? "標準の順番（預金→外貨預金→財形→課税口座→持株会→旧NISA→NISA）です。" : v.byAccount ? "口座ごとの順番です。後から足した口座は最後に取り崩します。" : "口座の種類の順番です。口座を動かすと、口座ごとの順番になります。"}
          「取り崩さない」にした口座は、残高が残っていても取り崩しに使いません（使う年が決まっている取り置きなど）。こどもNISA・ジュニアNISA は標準では取り崩しません。
        </p>
        {!v.standard ? (
          <button type="button" class="link-btn" onClick={() => onEdit(mutate(wh, (_h, r) => resetWithdrawOrder(r)))} data-order-reset>
            標準の順番に戻す
          </button>
        ) : null}
      </div>
      {flow !== undefined
        ? flow.groups.map((g) => (
            <div class="in-group" key={g.key}>
              <div class="fields">
                {g.fields.map((f) => (
                  <Field key={f.key} f={f} wh={wh} onEdit={onEdit} />
                ))}
              </div>
              {g.actions.length > 0 ? (
                <div class="in-actions">
                  {g.actions.map((a) => (
                    <HelpOf key={a.key} help={actionHelp(a)}>
                      <button type="button" class="add-btn" onClick={(e) => { if (a.label.startsWith("＋")) revealAdded(e.currentTarget); onEdit(a.run(wh)); }} data-action={a.key} {...(a.pressed !== undefined ? { "aria-pressed": a.pressed } : {})} {...(a.title !== undefined ? { title: a.title } : {})}>
                        {a.label}
                      </button>
                    </HelpOf>
                  ))}
                </div>
              ) : null}
            </div>
          ))
        : null}
      {(h.accounts ?? []).filter((a) => a.kind === "deposit").length === 0 ? <p class="sv-note">預金の口座が無いときは、名義の無い預金（0円から）に収支が入ります。</p> : null}
    </section>
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

/** 利回りの選び方（model.ts。前提条件の運用利回りと同じ値の表） */
export { RATE_PRESETS };

function TotalSection({ wh, level, fields, onEdit }: { wh: WorkingHousehold; level: Level; fields: FieldMap; onEdit: (w: WorkingHousehold) => void }) {
  const req = wh.request;
  const t = totalViewOf(req);
  const sumAcc = accountsOf(req.input.household).reduce((s, a) => s + valueOf(a), 0);
  const p = pooledOf(req.input.household);
  const fValue = p === undefined ? undefined : fields.get(`sav/${p.id}/value`);
  const fRate = p === undefined ? undefined : fields.get(`sav/${p.id}/rate`);
  const fUn = p === undefined ? undefined : fields.get(`sav/${p.id}/uninvested`);
  const preset = RATE_PRESETS.find((x) => sameRateText(x.rate, t.rate));
  const [byRate, setByRate] = useState(false);
  const showRate = level === "detail" || byRate || preset === undefined;
  const setRate = (rate: string) => (fRate !== undefined ? onEdit(fRate.set(wh, rate)) : onEdit(editTotal(wh, { rate })));
  return (
    <section class="sv-sec" aria-label="金融資産">
      <h3>
        金融資産
        <Help label="金融資産">預金・NISA・iDeCo・企業型DC・課税口座などを、すべて足した額で入れます。</Help>
      </h3>
      <div class="sv-fld">
        <span class="lbl">
          金融資産の合計
          <FieldStateBadge f={fValue} wh={wh} />
        </span>
        <div class="ctl">
          <NumBox value={t.value} unit="man" label="金融資産の合計" data="total-value" {...(fValue !== undefined ? { id: fieldDomId(fValue.key) } : {})} onCommit={(v) => typeof v === "number" && (fValue !== undefined ? onEdit((fValue.write ?? fValue.set)(wh, v)) : onEdit(editTotal(wh, { value: v })))} />
          <span class="u">万円</span>
        </div>
        <FieldStateLine f={fValue} wh={wh} onEdit={onEdit} />
        {sumAcc > 0 ? <p class="help">口座ごとに入れた値（合計 {man1(sumAcc)}万円）は残っています。合計を増やした分は、口座の入れ方で「まだ分けていない」に入ります。</p> : null}
      </div>
      <div class="sv-fld top">
        <span class="lbl">毎月の積立額</span>
        <StepsEditor steps={t.steps} now={t.steps[0]?.fromAge ?? 0} stopAge={stopAgeOrEstimate(req)} label="合計" onChange={(steps) => onEdit(editTotal(wh, { steps }))} />
        <p class="help">預金への積立も含めます（会社が出す企業型DC の掛金は含めません）。空欄（0円）なら積み立てず、黒字は預金に貯まります。年齢で額を変えるときは「＋期間を追加」。</p>
      </div>
      <div class="sv-fld">
        <span class="lbl">利回りの選び方</span>
        <div class="ctl">
          <span class="seg-g sm" role="group" aria-label="利回りの選び方">
            {RATE_PRESETS.map((x) => (
              <button type="button" key={x.id} aria-pressed={preset?.id === x.id && !byRate} onClick={() => {
                  setByRate(false);
                  setRate(x.rate);
                }} data-rate-preset={x.id}>
                {x.label}（{pct1(Number(x.rate))}%）
              </button>
            ))}
            <button type="button" aria-pressed={byRate || preset === undefined} onClick={() => setByRate(true)} data-rate-preset="own">
              率で入れる
            </button>
          </span>
        </div>
        <p class="help">長い期間の平均の年率の目安です（事務所の標準の値。いまは仮の値）。商品のおすすめではありません。</p>
      </div>
      {showRate ? (
        <div class="sv-fld">
          <span class="lbl">
            平均の利回り（年）
            <FieldStateBadge f={fRate} wh={wh} />
          </span>
          <div class="ctl">
            <NumBox value={t.rate} unit="pct" size="s" label="平均の利回り" data="total-rate" {...(fRate !== undefined ? { id: fieldDomId(fRate.key) } : {})} onCommit={(v) => typeof v === "string" && setRate(v)} />
            <span class="u">%</span>
          </div>
          <FieldStateLine f={fRate} wh={wh} onEdit={onEdit} />
          <p class="help">{t.uninvested !== null ? "運用しない分を除いた、運用する分の平均。" : "預金も含めた全体の平均。迷ったら、預金が多いほど低めに。"}</p>
        </div>
      ) : null}
      {level === "detail" ? (
        <div class="sv-fld">
          <span class="lbl">
            運用しない分（金額）
            <FieldStateBadge f={fUn} wh={wh} />
          </span>
          <div class="ctl">
            <NumBox value={t.uninvested} unit="man" optional placeholder="0" label="運用しない分" data="total-uninvested" {...(fUn !== undefined ? { id: fieldDomId(fUn.key) } : {})} onCommit={(v) => (v === null || typeof v === "number") && onEdit(editTotal(wh, { uninvested: v }))} />
            <span class="u">万円</span>
          </div>
          <FieldStateLine f={fUn} wh={wh} onEdit={onEdit} />
          <p class="help">
            預金のまま置いておくお金など。この額には平均の利回りをかけず、預金の利回り（前提条件の「現金・預金」の利回り）で計算します。空欄なら全部に平均の利回り。
          </p>
        </div>
      ) : null}
    </section>
  );
}

/** 率の文字（10進）が同じか */
const sameRateText = (a: string, b: string) => Math.abs(Number(a) - Number(b)) < 1e-9;

function AccountsTable(p: {
  wh: WorkingHousehold;
  level: Level;
  method: Method;
  stopAge: number | null;
  editAcc: (fn: (h: EngineRequest["input"]["household"], r: EngineRequest) => void) => void;
  editField: (f: FieldDef | undefined, v: number | string | null) => void;
  find: (h: EngineRequest["input"]["household"], id: string) => Account;
  fields: FieldMap;
  onEdit: (w: WorkingHousehold) => void;
  /** 標準のとき: 口座の「▸ 詳しく」で開くまとまり（無ければ「▸ 詳しく」を出さない） */
  moreOf?: (id: string) => GroupDef[];
}) {
  const { wh, level, method, stopAge, editAcc, editField, find, fields, onEdit, moreOf } = p;
  const opened = useGroupOpen();
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
      stopAge={stopAgeOrEstimate(req)}
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
            const moreKey = `sav/${a.id}`;
            const more = moreOf?.(a.id) ?? [];
            const open = more.length > 0 && opened.isOpen(moreKey);
            return (
              <Fragment key={a.id}>
              <tr data-account={a.kind}>
                <td class="l">
                  <span class="nm">
                    <i class="sw" style={{ background: info.color }} />
                    {name}
                  </span>
                  <span class="memo">{info.memo}</span>
                  <span class="own">
                    {/* 預貯金の名義は詳細で選ぶ（標準は読むだけ。0078） */}
                    {multiOwner && (level === "detail" || a.kind !== "deposit") ? (
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
                  {more.length > 0 ? <MoreToggle groupKey={moreKey} open={open} toggle={() => opened.toggle(moreKey)} label={name} /> : null}
                </td>
                <td>
                  <NumBox value={valueOf(a)} unit="man" label={`${name}の残高`} data={`bal-${a.kind}`} id={fieldDomId(`sav/${a.id}/value`)} onCommit={(v) => typeof v === "number" && editField(fields.get(`sav/${a.id}/value`), v)} /> 万円
                  <FieldStateBadge f={fields.get(`sav/${a.id}/value`)} wh={wh} />
                  <FieldStateLine f={fields.get(`sav/${a.id}/value`)} wh={wh} onEdit={onEdit} compact />
                  {(level === "detail" || open) && WITH_COST.has(a.kind) ? (
                    <div class="sv-sub">
                      取得価額 <NumBox value={a.costBasis?.value ?? null} unit="man" size="s" optional placeholder="時価" label={`${name}の取得価額`} id={fieldDomId(`sav/${a.id}/cost`)} onCommit={(v) => editField(fields.get(`sav/${a.id}/cost`), v)} /> 万円
                      <FieldStateBadge f={fields.get(`sav/${a.id}/cost`)} wh={wh} />
                      <FieldStateLine f={fields.get(`sav/${a.id}/cost`)} wh={wh} onEdit={onEdit} compact />
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
                      <NumBox value={a.expectedReturn ?? null} unit="pct" size="s" optional placeholder={pctFromRate(rateOf(req, { ...a, expectedReturn: undefined } as Account))} label={`${name}の利回り`} data={`rate-${a.kind}`} id={fieldDomId(`sav/${a.id}/rate`)} onCommit={(v) =>
                          fields.has(`sav/${a.id}/rate`)
                            ? editField(fields.get(`sav/${a.id}/rate`), v)
                            : editAcc((hh) => {
                                const x = find(hh, a.id);
                                if (v === null) delete x.expectedReturn;
                                else if (typeof v === "string") x.expectedReturn = v;
                              })
                        }
                      /> %
                      <FieldStateBadge f={fields.get(`sav/${a.id}/rate`)} wh={wh} />
                      <FieldStateLine f={fields.get(`sav/${a.id}/rate`)} wh={wh} onEdit={onEdit} compact />
                    </>
                  )}
                </td>
              </tr>
              {open ? (
                <tr class="sv-more-row" data-more-of={moreKey}>
                  <td colSpan={4} class="l">
                    {more.map((g) => (
                      <Group key={g.key} group={g} wh={wh} level="detail" onEdit={onEdit} />
                    ))}
                  </td>
                </tr>
              ) : null}
              </Fragment>
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
        <h3>
          資産の種類ごとの割合
          <Help label="資産の種類ごとの割合">運用する口座（NISA・iDeCo・企業型DC・課税口座）に共通の、資産の種類ごとの割合です。預金は現金のまま。商品は選ばず、資産の種類で入れます。期待リターンと値動きの大きさの空欄は、事務所の標準の値で計算します。</Help>
        </h3>
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
          <Help label="資産の割合の見せ方">結果の画面では、プランAと選んだプランを同じ年で並べます。</Help>
        </div>
        <DonutPair panes={panes} />
      </section>
      <section class="sv-sec" aria-label="課税口座の税・リバランス">
        <h3>課税口座の税・リバランス</h3>
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

function PayoutSection({ wh, level, fields, onEdit }: { wh: WorkingHousehold; level: Level; fields: FieldMap; onEdit: (w: WorkingHousehold) => void }) {
  const req = wh.request;
  const h = req.input.household;
  const dcs = accountsOf(h).filter((a) => DC_KINDS.has(a.kind));
  const aids = accountsOf(h).filter((a) => a.kind === "smallBusinessMutualAid");
  if (dcs.length === 0 && aids.length === 0) return null;
  /** 欄の定義で描く欄（受け取りの詳細・小規模企業共済） */
  const generic = (a: Account, keys: readonly string[]) => (
    <div class="fields">
      {keys
        .map((k) => fields.get(`sav/${a.id}/${k}`))
        .filter((f): f is FieldDef => f !== undefined && visible(level, f.level))
        .map((f) => (
          <Field key={f.key} f={f} wh={wh} onEdit={onEdit} />
        ))}
    </div>
  );
  const edit = (id: string, patch: Parameters<typeof editPayout>[2]) => onEdit(mutate(wh, (hh) => editPayout(hh, (hh.accounts ?? []).find((a) => a.id === id) as Account, patch)));
  return (
    <section class="sv-sec" aria-label="iDeCo・企業型DC・小規模企業共済の受け取り方">
      <h3>
        {aids.length > 0 ? "iDeCo・企業型DC・小規模企業共済の受け取り方" : "iDeCo・企業型DC の受け取り方"}
        <Help label="受け取り方">
          {dcs.length > 0 ? <p>空欄は「退職の年（60〜65歳）に一時金」で計算します（推定）。受け取ったお金は、預金に入れるか、運用を続けるかを選べます。年金で受け取る年数（空欄は10年）・併用の一時金の割合（空欄は半分）は詳細で。</p> : null}
          {aids.length > 0 ? <p>小規模企業共済は、受け取りを始める時期（廃業・退職など）を入れると、その月に受け取ります。空欄なら受け取らずに残高のまま持ちます。一括は退職所得、分割は公的年金等の雑所得として税を計算します。</p> : null}
        </Help>
      </h3>
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
                <NumBox value={payoutAgeOf(h, a)} unit="age" size="s" optional est={ageEst} placeholder={String(defaultPayoutAge(req, a))} label={`${name}の受け取りを始める年齢`} id={fieldDomId(`sav/${a.id}/payoutAge`)} onCommit={(v) => edit(a.id, { age: typeof v === "number" ? Math.min(75, Math.max(60, v)) : null })} />
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
            {level === "detail" ? generic(a, ["payoutYears", "lumpShare", "enrolled"]) : null}
          </div>
        );
      })}
      {aids.map((a) => (
        <div class="sv-dc" key={a.id} data-payout={a.kind}>
          <h4>{`${KIND_INFO[a.kind]?.name ?? ""}（${memberLabel(wh, a.owner)}）`}</h4>
          {generic(a, ["payout", "payoutAt", "payoutYears", "lumpShare", "enrolled"])}
        </div>
      ))}
    </section>
  );
}

function PeriodSection(p: { wh: WorkingHousehold; level: Level; onEdit: (w: WorkingHousehold) => void; now: number; stopAge: number | null; stopShown: number; estimate: StopEstimate; fields: FieldMap }) {
  const { wh, level, onEdit, now, stopAge, stopShown, estimate, fields } = p;
  const req = wh.request;
  const dd = drawdownOf(req);
  const wOn = dd.method !== "none";
  // 予定なしから定額・定率にしたときの始める年齢は、65歳か退職の遅い方（過ぎていれば次に迎える年齢。0026 の追記）
  const setDd = (v: Partial<DrawdownView>) => onEdit(mutate(wh, (_h, r) => setDrawdown(r, { ...dd, ...(dd.method === "none" && v.method !== undefined && v.method !== "none" ? { startAge: drawdownStartDefault(req) } : {}), ...v })));
  const est = stopAge === null;
  return (
    <>
      <div class="sv-per">
        <div class="per-c acc">
          <div class="pt">↑ 積み立てる</div>
          <div class="pv">
            今（{now}歳）〜{" "}
            {/* 積立をやめる年齢は詳細で直す（標準は読むだけ。空欄は退職の年まで・推定。0078） */}
            {level === "detail" ? (
              <NumBox
                value={stopAge}
                unit="age"
                size="s"
                optional
                est={est}
                placeholder={String(estimate.age)}
                label="積立をやめる年齢"
                data="stop-age"
                id={fieldDomId("sav/stopAge")}
                onCommit={(v) =>
                  onEdit(
                    mutate(wh, (hh, r) => {
                      const age = typeof v === "number" ? Math.max(now + 1, Math.min(90, v)) : null;
                      setStopAge(hh, r.input.baseMonth, age);
                      dropDoneUnallocated(hh, r);
                    }),
                  )
                }
              />
            ) : (
              <b data-stop-age-read>{stopAge ?? estimate.age}</b>
            )}{" "}
            歳でやめる
          </div>
          {est ? (
            <div class="pv">
              <EstTag text={estimate.retired ? `推定あり: 退職はもう過ぎているので、${estimate.until}まで` : `推定あり: ${estimate.until}まで`} />
            </div>
          ) : null}
          {level === "detail" ? <FieldStateLine f={fields.get("sav/stopAge")} wh={wh} onEdit={onEdit} noBasis /> : null}
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
        <p class="help">予定なしは、収支が足りない年だけ取り崩します（順番は「お金の行き先」。標準は預金→課税口座→NISA）。定額・定率は、その額を金融資産から使います（収支の不足のほうが大きい年は不足の分）。</p>
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

