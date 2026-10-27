// 事務所の既定値の画面（0073。世帯の一覧の「事務所の既定値」から開く中央のパネル）:
// カードの並びと最初の5枚・本人と配偶者の介護を最初から入れるか・受け取る予定の相続・贈与の見込みの既定・前提条件の標準値・
// 相続税の目安の不動産の評価の割合。新しく作る世帯に写す（作った世帯は変わらない。違うときは確かめの一覧に知らせが出る）
import { useEffect, useRef, useState } from "preact/hooks";
import { STAGE_ORDER } from "../input/stages/index.ts";
import { DEFAULT_LAYOUT } from "../input/items.ts";
import type { StageId } from "../input/form.ts";
import { today } from "../report/assemble.ts";
import { ASSUMPTION_LABELS, DEFAULT_OFFICE_SETTINGS, layoutOf, OFFICE_ASSUMPTIONS, type OfficeAssumption, type OfficeSettings } from "./settings.ts";

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

const STANDARD_PCT: Readonly<Record<OfficeAssumption, string>> = { inflation: "1", wageGrowth: "1", investmentReturn: "1", pensionMacroSlide: "0.4" };

export function OfficeSettingsPanel({ value, onSave, shared, onClose }: OfficeSettingsPanelProps) {
  const [s, setS] = useState<OfficeSettings>(value);
  const [texts, setTexts] = useState<Record<string, string>>(() => ({ ...Object.fromEntries(OFFICE_ASSUMPTIONS.map((k) => [k, rateToPct(value.assumptions[k])])), realEstateRatio: rateToPct(value.realEstateRatio) }));
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
  const bad = [...OFFICE_ASSUMPTIONS.filter((k) => pctToRate(texts[k] ?? "") === undefined), ...(pctToRate(texts.realEstateRatio ?? "", 0, 100) === undefined ? ["realEstateRatio"] : [])];
  const save = async () => {
    const assumptions: OfficeSettings["assumptions"] = {};
    for (const k of OFFICE_ASSUMPTIONS) {
      const r = pctToRate(texts[k] ?? "");
      if (typeof r === "string") assumptions[k] = r;
    }
    const ratio = pctToRate(texts.realEstateRatio ?? "", 0, 100);
    const sameLayout = JSON.stringify(layout) === JSON.stringify(DEFAULT_LAYOUT);
    const next: OfficeSettings = { ...s, layout: sameLayout ? null : layout, assumptions, realEstateRatio: typeof ratio === "string" ? ratio : null, changedOn: today() };
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
            たぶん（基本の計算に入れる。標準）
          </label>
          <label class="os-radio">
            <input type="radio" name="os-inherit" checked={s.inheritLikelihood === "uncertain"} onChange={() => setS({ ...s, inheritLikelihood: "uncertain" })} data-office-inherit="uncertain" />
            不確か（足した行を基本の計算に入れない。行ごとに直せます。相続で受け継ぐ借金も同じ）
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
        {bad.length > 0 ? <p class="fatal">数で入れてください（前提は -5〜20%、評価の割合は 0〜100%）。</p> : null}
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
