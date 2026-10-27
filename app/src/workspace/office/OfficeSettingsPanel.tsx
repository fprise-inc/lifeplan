// 事務所の既定値の画面（0073。世帯の一覧の「事務所の既定値」から開く中央のパネル）:
// カードの並びと最初の5枚・本人と配偶者の介護を最初から入れるか・受け取る予定の相続・贈与の見込みの既定・前提条件の標準値・
// 相続税の目安の不動産の評価の割合・FP顧問料の料金表。新しく作る世帯（料金表は新しく足す契約）に写す（作った世帯は変わらない。違うときは確かめの一覧に知らせが出る）
import { useEffect, useRef, useState } from "preact/hooks";
import { STAGE_ORDER } from "../input/stages/index.ts";
import { DEFAULT_LAYOUT } from "../input/items.ts";
import type { StageId } from "../input/form.ts";
import { today } from "../report/assemble.ts";
import { ASSUMPTION_LABELS, DEFAULT_OFFICE_SETTINGS, FEE_MAX, FEE_STEP_YEAR_MAX, layoutOf, OFFICE_ASSUMPTIONS, type FeeTable, type OfficeAssumption, type OfficeSettings } from "./settings.ts";

export interface OfficeSettingsPanelProps {
  value: OfficeSettings;
  /** 保存する（本体の事務所データへ） */
  onSave: (next: OfficeSettings) => Promise<void>;
  /** 事務所で共有しているか（今は PC ごとの設定であることを知らせる） */
  shared: boolean;
  onClose: () => void;
}

/** 「1.5」（%）→ "0.015"。空は null。読めない・範囲の外は undefined */
export function pctToRate(text: string, lo = -5, hi = 20): string | null | undefined {
  const t = text.trim().replace(/[％%]$/, "");
  if (t === "") return null;
  if (!/^-?\d{1,2}(\.\d{1,4})?$/.test(t)) return undefined;
  const v = Number(t);
  if (v < lo || v > hi) return undefined;
  return String(Number((v / 100).toFixed(6)));
}

/** "0.015" → 「1.5」 */
export const rateToPct = (rate: string | null | undefined): string => (rate === null || rate === undefined ? "" : String(Number((Number(rate) * 100).toFixed(4))));

/** 「12,000」（円）→ 12000。空・読めない・範囲の外は undefined */
export function yenFromText(text: string): number | undefined {
  const t = text.trim().replace(/[,，、円]/g, "").replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (!/^\d{1,8}$/.test(t)) return undefined;
  const v = Number(t);
  return v <= FEE_MAX ? v : undefined;
}

/** 料金表の欄の文字（額は円・段階は年目と額） */
interface FeeTexts {
  oneTime: string;
  amount: string;
  steps: { year: string; amount: string }[];
}

const feeTexts = (f: FeeTable): FeeTexts => ({ oneTime: String(f.oneTime), amount: String(f.amount), steps: f.steps.map((x) => ({ year: String(x.year), amount: String(x.amount) })) });

/** 料金表の文字から料金表（読めない欄があれば null） */
export function feeFromTexts(base: FeeTable, t: FeeTexts): FeeTable | null {
  const oneTime = yenFromText(t.oneTime);
  const amount = yenFromText(t.amount);
  if (oneTime === undefined || amount === undefined) return null;
  const steps: { year: number; amount: number }[] = [];
  for (const x of t.steps) {
    const year = Number(x.year.trim());
    const a = yenFromText(x.amount);
    if (!Number.isInteger(year) || year < 2 || year > FEE_STEP_YEAR_MAX || a === undefined || steps.some((y) => y.year === year)) return null;
    steps.push({ year, amount: a });
  }
  steps.sort((a, b) => a.year - b.year);
  return { ...base, oneTime, amount, steps };
}

const STANDARD_PCT: Readonly<Record<OfficeAssumption, string>> = { inflation: "1", wageGrowth: "1", investmentReturn: "1", pensionMacroSlide: "0.4" };

export function OfficeSettingsPanel({ value, onSave, shared, onClose }: OfficeSettingsPanelProps) {
  const [s, setS] = useState<OfficeSettings>(value);
  const [texts, setTexts] = useState<Record<string, string>>(() => ({ ...Object.fromEntries(OFFICE_ASSUMPTIONS.map((k) => [k, rateToPct(value.assumptions[k])])), realEstateRatio: rateToPct(value.realEstateRatio) }));
  const [fee, setFee] = useState<FeeTexts>(() => feeTexts(value.fee));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const layout = layoutOf(s);
  const order = [...layout.order, ...STAGE_ORDER.map((x) => x.id).filter((id) => !layout.order.includes(id))];
  const label = (id: StageId) => STAGE_ORDER.find((x) => x.id === id)?.label ?? id;
  const move = (i: number, d: -1 | 1) => {
    const next = [...order];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j] as StageId, next[i] as StageId];
    setS({ ...s, layout: { order: next, first: layout.first } });
  };
  const toggleFirst = (id: StageId, on: boolean) => {
    const first = on ? [...layout.first, id] : layout.first.filter((x) => x !== id);
    setS({ ...s, layout: { order, first: order.filter((x) => first.includes(x)) } });
  };
  const feeTable = feeFromTexts(s.fee, fee);
  const bad = [...OFFICE_ASSUMPTIONS.filter((k) => pctToRate(texts[k] ?? "") === undefined), ...(pctToRate(texts.realEstateRatio ?? "", 0, 100) === undefined ? ["realEstateRatio"] : []), ...(feeTable === null ? ["fee"] : [])];
  const per = s.fee.per === "month" ? "月" : "年";
  const save = async () => {
    const assumptions: OfficeSettings["assumptions"] = {};
    for (const k of OFFICE_ASSUMPTIONS) {
      const r = pctToRate(texts[k] ?? "");
      if (typeof r === "string") assumptions[k] = r;
    }
    const ratio = pctToRate(texts.realEstateRatio ?? "", 0, 100);
    const sameLayout = JSON.stringify(layout) === JSON.stringify(DEFAULT_LAYOUT);
    const next: OfficeSettings = { ...s, layout: sameLayout ? null : layout, assumptions, realEstateRatio: typeof ratio === "string" ? ratio : null, fee: feeTable ?? s.fee, changedOn: today() };
    setBusy(true);
    setMsg(null);
    try {
      await onSave(next);
      setS(next);
      setMsg({ ok: true, text: "保存しました。これから作る世帯に写します（作った世帯は変わりません）" });
    } catch (e) {
      setMsg({ ok: false, text: `保存できませんでした（${typeof e === "string" ? e : e instanceof Error ? e.message : "E_OFFICE_SETTINGS"}）` });
    } finally {
      setBusy(false);
    }
  };
  const pct = (key: string, lbl: string, placeholder: string, note: string) => (
    <label class="os-pct" key={key}>
      <span>{lbl}</span>
      <span class="os-in">
        <input inputMode="decimal" value={texts[key] ?? ""} placeholder={placeholder} aria-invalid={bad.includes(key)} onInput={(e) => setTexts({ ...texts, [key]: (e.currentTarget as HTMLInputElement).value })} data-office-setting={key} />%
      </span>
      <small>{note}</small>
    </label>
  );
  return (
    <>
      <div class="scrim" aria-hidden="true" onClick={onClose} />
      <div ref={panel} class="rk-panel os-panel" role="dialog" aria-modal="true" aria-labelledby="os-title" tabIndex={-1} data-office-settings>
        <h2 id="os-title">事務所の既定値</h2>
        <p class="pl-sub">
          新しく作る世帯に写す値と、入力のホームの並びです。写した値は「推定」の印（根拠「事務所の標準」）で入り、後で変えても作った世帯は黙って変わりません（違うときは確かめの一覧に「事務所の新しい値があります」と出ます）。
          {shared ? "事務所で共有していても、今はこの PC の設定です。" : "この PC の設定です。"}
        </p>
        <section class="os-sec" aria-labelledby="os-cards">
          <h3 id="os-cards">入力のホームのカードの並びと最初の5枚</h3>
          <ol class="os-cards">
            {order.map((id, i) => (
              <li key={id} data-office-card={id}>
                <span class="os-name">{label(id)}</span>
                <label class="os-first">
                  <input type="checkbox" checked={layout.first.includes(id)} onChange={(e) => toggleFirst(id, (e.currentTarget as HTMLInputElement).checked)} data-office-first={id} />
                  最初の5枚
                </label>
                <button type="button" class="link-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`${label(id)}を上へ`} data-office-up={id}>
                  ↑
                </button>
                <button type="button" class="link-btn" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label={`${label(id)}を下へ`}>
                  ↓
                </button>
              </li>
            ))}
          </ol>
          <p class="pl-sub">
            最初の5枚: {layout.first.length}枚（ざっくり入れる人に最初に案内するカード）。
            <button type="button" class="link-btn" onClick={() => setS({ ...s, layout: null })} data-office-layout-reset>
              標準の並びに戻す
            </button>
          </p>
        </section>
        <section class="os-sec" aria-labelledby="os-care">
          <h3 id="os-care">本人・配偶者の介護の費用</h3>
          <label class="os-radio">
            <input type="radio" name="os-care" checked={s.care.selfAndSpouse === "warn"} onChange={() => setS({ ...s, care: { selfAndSpouse: "warn" } })} data-office-care="warn" />
            自動では入れない（「未入力」にして「目安で入れる」の1押しを出す。標準）
          </label>
          <label class="os-radio">
            <input type="radio" name="os-care" checked={s.care.selfAndSpouse === "fill"} onChange={() => setS({ ...s, care: { selfAndSpouse: "fill" } })} data-office-care="fill" />
            新しい世帯では最初から目安で入れる（推定の印）
          </label>
        </section>
        <section class="os-sec" aria-labelledby="os-inherit">
          <h3 id="os-inherit">受け取る予定の相続・贈与の見込み</h3>
          <label class="os-radio">
            <input type="radio" name="os-inherit" checked={s.inheritLikelihood === "likely"} onChange={() => setS({ ...s, inheritLikelihood: "likely" })} data-office-inherit="likely" />
            確実（基本の計算に入れる。標準）
          </label>
          <label class="os-radio">
            <input type="radio" name="os-inherit" checked={s.inheritLikelihood === "uncertain"} onChange={() => setS({ ...s, inheritLikelihood: "uncertain" })} data-office-inherit="uncertain" />
            当てにしない（足した行を基本の計算に入れない。行ごとに直せます。相続で受け継ぐ借金も同じ）
          </label>
        </section>
        <section class="os-sec" aria-labelledby="os-assume">
          <h3 id="os-assume">前提条件の標準値</h3>
          <div class="os-grid">
            {OFFICE_ASSUMPTIONS.map((k) => pct(k, ASSUMPTION_LABELS[k], STANDARD_PCT[k], `空欄は FPライズの標準（${STANDARD_PCT[k]}%。仮の値）`))}
            {pct("realEstateRatio", "相続税の目安: 不動産の評価の割合（時価に掛ける）", "80", "空欄は時価の80%")}
          </div>
          <p class="pl-sub">長い期間の平均の目安です。根拠（出典・期間）は事務所で確かめてください。商品のおすすめではありません。</p>
        </section>
        <section class="os-sec" aria-labelledby="os-fee" data-office-fee>
          <h3 id="os-fee">FP顧問料の料金表</h3>
          <p class="pl-sub">FP顧問料の契約を足すときに写します（足した契約は、後で料金表を変えても変わりません）。額は税込。顧客の画面には額だけを出します（値上げの率は使いません）。</p>
          <div class="os-grid">
            <label class="os-pct">
              <span>単発の料金（相談料・プラン作成料）</span>
              <span class="os-in">
                <input inputMode="numeric" value={fee.oneTime} placeholder="300000" aria-invalid={yenFromText(fee.oneTime) === undefined} onInput={(e) => setFee({ ...fee, oneTime: (e.currentTarget as HTMLInputElement).value })} data-office-fee-one />円
              </span>
              <small>0円なら単発の料金を入れません</small>
            </label>
            <label class="os-pct">
              <span>継続の顧問料（{per}額）</span>
              <span class="os-in">
                <input inputMode="numeric" value={fee.amount} placeholder="10000" aria-invalid={yenFromText(fee.amount) === undefined} onInput={(e) => setFee({ ...fee, amount: (e.currentTarget as HTMLInputElement).value })} data-office-fee-amount />円
              </span>
              <small>単発の料金の12か月後（翌年の同じ月）から</small>
            </label>
          </div>
          <label class="os-radio">
            <input type="radio" name="os-fee-per" checked={s.fee.per === "month"} onChange={() => setS({ ...s, fee: { ...s.fee, per: "month" } })} data-office-fee-per="month" />
            月額（毎月払う。標準）
          </label>
          <label class="os-radio">
            <input type="radio" name="os-fee-per" checked={s.fee.per === "year"} onChange={() => setS({ ...s, fee: { ...s.fee, per: "year" } })} data-office-fee-per="year" />
            年額（毎年、始まりの月に払う）
          </label>
          <ol class="os-cards">
            {fee.steps.map((x, i) => (
              <li key={i} data-office-fee-step={i}>
                <span class="os-in">
                  <input inputMode="numeric" size={3} value={x.year} aria-label={`料金の段階 ${i + 1}: 何年目から`} onInput={(e) => setFee({ ...fee, steps: fee.steps.map((y, j) => (j === i ? { ...y, year: (e.currentTarget as HTMLInputElement).value } : y)) })} />
                  年目から{per}
                  <input inputMode="numeric" value={x.amount} aria-label={`料金の段階 ${i + 1}: 額`} onInput={(e) => setFee({ ...fee, steps: fee.steps.map((y, j) => (j === i ? { ...y, amount: (e.currentTarget as HTMLInputElement).value } : y)) })} />円
                </span>
                <button type="button" class="link-btn" onClick={() => setFee({ ...fee, steps: fee.steps.filter((_y, j) => j !== i) })}>
                  外す
                </button>
              </li>
            ))}
          </ol>
          <p class="pl-sub">
            <button
              type="button"
              class="link-btn"
              onClick={() => setFee({ ...fee, steps: [...fee.steps, { year: String(Math.max(1, ...fee.steps.map((y) => Number(y.year) || 1)) + 1), amount: fee.steps.at(-1)?.amount ?? fee.amount }] })}
              data-office-fee-add-step
            >
              ＋ 料金の段階（○年目から○円）
            </button>
          </p>
          <label class="os-radio">
            <input type="radio" name="os-fee-on" checked={s.fee.onContingency === "stop"} onChange={() => setS({ ...s, fee: { ...s.fee, onContingency: "stop" } })} data-office-fee-on="stop" />
            払う人などに万一があったら、継続の顧問料を止める（標準）
          </label>
          <label class="os-radio">
            <input type="radio" name="os-fee-on" checked={s.fee.onContingency === "continue"} onChange={() => setS({ ...s, fee: { ...s.fee, onContingency: "continue" } })} data-office-fee-on="continue" />
            万一のあとも続ける
          </label>
        </section>
        {bad.length > 0 ? <p class="fatal">数で入れてください（前提は -5〜20%、評価の割合は 0〜100%、料金表の額は円、段階は2〜{FEE_STEP_YEAR_MAX}年目で重ならないように）。</p> : null}
        {msg !== null ? (
          <p class={msg.ok ? "rp-note" : "fatal"} role="status" data-office-settings-msg>
            {msg.text}
          </p>
        ) : null}
        <div class="rp-actions">
          <button
            type="button"
            class="btn"
            onClick={() => {
              setS(DEFAULT_OFFICE_SETTINGS);
              setFee(feeTexts(DEFAULT_OFFICE_SETTINGS.fee));
              setTexts({ ...Object.fromEntries(OFFICE_ASSUMPTIONS.map((k) => [k, ""])), realEstateRatio: "" });
            }}
          >
            全部を標準に戻す
          </button>
          <button type="button" class="btn primary" disabled={busy || bad.length > 0} onClick={() => void save()} data-office-settings-save>
            保存
          </button>
          <button type="button" class="btn" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </>
  );
}
