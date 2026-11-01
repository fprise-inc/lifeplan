// 事務所の既定値の画面（0073。世帯の一覧の「事務所の既定値」から開く中央のパネル）:
// 入力項目の並び・新しい世帯で出す入力項目と開いたときの入れ方・対策に最初から出す項目（0084）・万一のときのタブの既定（0085。場面の帯・
// 開いたときの場面・想定の前提に最初から出す項目・必要保障額の数え方）・ご本人と配偶者の介護を最初から入れるか・受け取る予定の相続・贈与の見込みの既定・前提条件の標準値・
// 相続税の目安の不動産の評価の割合・FP顧問料の料金表・法人の顧問向けの機能（合算BS。0108）。新しく作る世帯（料金表は新しく足す契約）に写す（作った世帯は変わらない。違うときは確かめの一覧に知らせが出る）
import { useEffect, useRef, useState } from "preact/hooks";
import { STAGE_ORDER } from "../input/stages/index.ts";
import { DEFAULT_LAYOUT } from "../input/items.ts";
import type { Level, StageId } from "../input/form.ts";
import { ALWAYS_SHOWN, isHiddenIn, levelIn, withLevel, withShown } from "../input/itemChoice.ts";
import { today } from "../report/assemble.ts";
import { LEVER_KINDS, startsWith, withStart, type LeverKind } from "../plans/leverChoice.ts";
import { HORIZON_KINDS, PROTECTION_METHODS } from "../contingency/inputs.ts";
import { normalProtection, OPEN_SCENES, PREMISE_KINDS, premiseStarts, SCENE_KINDS, sceneShown, withPremiseStart, type OpenScene, type PremiseKind, type ProtectionSetting } from "../contingency/premiseChoice.ts";
import type { ScenarioKind } from "../contingency/requests.ts";
import { outOfRangeText, rangeText, type PctRange } from "../input/rateRanges.ts";
import { rateFromPct } from "../input/units.ts";
import { ASSUMPTION_LABELS, ASSUMPTION_RANGES, DEFAULT_OFFICE_SETTINGS, FEE_MAX, FEE_STEP_YEAR_MAX, layoutOf, OFFICE_ASSUMPTIONS, type FeeTable, type OfficeAssumption, type OfficeSettings } from "./settings.ts";
import { revealAdded } from "../../presentation/revealAdded.ts";

export interface OfficeSettingsPanelProps {
  value: OfficeSettings;
  /** 保存する（本体の事務所データへ） */
  onSave: (next: OfficeSettings) => Promise<void>;
  /** 事務所で共有しているか（今は PC ごとの設定であることを知らせる） */
  shared: boolean;
  onClose: () => void;
}

/** 「1.5」（%）→ "0.015"。空は null。読めない・範囲の外は undefined（整数の部分は3桁まで読む。評価の割合の 100% を入れられるように） */
export function pctToRate(text: string, lo = -5, hi = 20): string | null | undefined {
  const t = text.trim().replace(/[％%]$/, "");
  if (t === "") return null;
  if (!/^-?\d{1,3}(\.\d{1,4})?$/.test(t)) return undefined;
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
  const [texts, setTexts] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(OFFICE_ASSUMPTIONS.map((k) => [k, rateToPct(value.assumptions[k])])),
    realEstateRatio: rateToPct(value.realEstateRatio),
    horizonAge: String(value.protection.horizon?.age ?? 90),
    reverseAge: value.protection.protection?.reverseUntilAge !== undefined ? String(value.protection.protection.reverseUntilAge) : "",
  }));
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
    setS({ ...s, layout: { order: next } });
  };
  const setShown = (id: StageId, on: boolean) => setS((x) => ({ ...x, items: withShown(x.items, id, on) }));
  const setLevel = (id: StageId, l: Level) => setS((x) => ({ ...x, items: withLevel(x.items, id, l) }));
  const setStart = (k: LeverKind, on: boolean) => setS((x) => ({ ...x, levers: withStart(x.levers, k, on) }));
  const leverGroups = [...new Set(LEVER_KINDS.map((k) => k.group))];
  // 万一のときのタブ（0085）
  const setPremise = (k: PremiseKind, on: boolean) => setS((x) => ({ ...x, premises: withPremiseStart(x.premises, k, on) }));
  const setScene = (k: ScenarioKind, on: boolean) =>
    setS((x) => {
      const hidden = SCENE_KINDS.map((y) => y.kind as ScenarioKind).filter((y) => (y === k ? !on : !sceneShown(x.scenes, y)));
      const { hidden: _h, ...rest } = x.scenes;
      void _h;
      return { ...x, scenes: { ...rest, ...(hidden.length > 0 ? { hidden } : {}) } };
    });
  const setOpen = (o: OpenScene) =>
    setS((x) => {
      const { open: _o, ...rest } = x.scenes;
      void _o;
      return { ...x, scenes: { ...rest, ...(o !== "death:self" ? { open: o } : {}) } };
    });
  const shownScenes = SCENE_KINDS.filter((k) => sceneShown(s.scenes, k.kind));
  const prot = s.protection;
  const ageText = (t: string | undefined, empty: boolean): number | null | undefined => {
    const v = (t ?? "").trim();
    if (v === "") return empty ? null : undefined;
    if (!/^\d{2,3}$/.test(v) || Number(v) < 50 || Number(v) > 110) return undefined;
    return Number(v);
  };
  /** 文字の欄（年齢）を当てた数え方（読めない年齢は undefined） */
  const protectionFrom = (p: ProtectionSetting): ProtectionSetting | undefined => {
    const ha = p.horizon?.kind === "age" ? ageText(texts.horizonAge, false) : null;
    const ra = p.protection?.method === "reverse" ? ageText(texts.reverseAge, true) : null;
    if (ha === undefined || ra === undefined) return undefined;
    return normalProtection({
      ...(p.horizon !== undefined ? { horizon: { kind: p.horizon.kind, ...(ha !== null ? { age: ha } : {}) } } : {}),
      ...(p.protection?.method === "reverse" ? { protection: { method: "reverse", ...(ra !== null ? { reverseUntilAge: ra } : {}) } } : {}),
    });
  };
  const protNext = protectionFrom(prot);
  const feeTable = feeFromTexts(s.fee, fee);
  const bad = [...OFFICE_ASSUMPTIONS.filter((k) => pctToRate(texts[k] ?? "", ASSUMPTION_RANGES[k].min, ASSUMPTION_RANGES[k].max) === undefined), ...(pctToRate(texts.realEstateRatio ?? "", 0, 100) === undefined ? ["realEstateRatio"] : []), ...(feeTable === null ? ["fee"] : []), ...(protNext === undefined ? ["protection"] : [])];
  const per = s.fee.per === "month" ? "月" : "年";
  const save = async () => {
    const assumptions: OfficeSettings["assumptions"] = {};
    for (const k of OFFICE_ASSUMPTIONS) {
      const r = pctToRate(texts[k] ?? "", ASSUMPTION_RANGES[k].min, ASSUMPTION_RANGES[k].max);
      if (typeof r === "string") assumptions[k] = r;
    }
    const ratio = pctToRate(texts.realEstateRatio ?? "", 0, 100);
    const sameLayout = JSON.stringify(layout) === JSON.stringify(DEFAULT_LAYOUT);
    const next: OfficeSettings = { ...s, layout: sameLayout ? null : layout, assumptions, realEstateRatio: typeof ratio === "string" ? ratio : null, fee: feeTable ?? s.fee, protection: protNext ?? {}, changedOn: today() };
    setBusy(true);
    setMsg(null);
    try {
      await onSave(next);
      setS(next);
      setMsg({ ok: true, text: "保存しました。これから作る世帯に写します（作った世帯は変わりません。対策に最初から出す項目と、万一のときのタブの場面・想定の前提に最初から出す項目は、どの世帯にもすぐ効きます）" });
    } catch (e) {
      setMsg({ ok: false, text: `保存できませんでした（${typeof e === "string" ? e : e instanceof Error ? e.message : "E_OFFICE_SETTINGS"}）` });
    } finally {
      setBusy(false);
    }
  };
  const pct = (key: string, lbl: string, placeholder: string, note: string, range?: PctRange) => {
    // 範囲の外の数を入れたら、欄の下に越えた側の端を出す（「15%より大きい値は設定できません。」。入力の画面の欄と同じ。0098）
    const r = range === undefined ? null : rateFromPct((texts[key] ?? "").trim().replace(/[％%]$/, ""));
    const over = range === undefined || r === null ? null : outOfRangeText(r, range);
    return (
      <label class="os-pct" key={key}>
        <span>{lbl}</span>
        <span class="os-in">
          <input inputMode="decimal" value={texts[key] ?? ""} placeholder={placeholder} aria-invalid={bad.includes(key)} onInput={(e) => setTexts({ ...texts, [key]: (e.currentTarget as HTMLInputElement).value })} data-office-setting={key} />%
        </span>
        {over !== null ? (
          <span class="fld-help bad" role="alert" data-office-setting-problem={key}>
            {over}
          </span>
        ) : null}
        <small>{note}</small>
      </label>
    );
  };
  return (
    <>
      <div class="scrim" aria-hidden="true" onClick={onClose} />
      <div ref={panel} class="rk-panel os-panel" role="dialog" aria-modal="true" aria-labelledby="os-title" tabIndex={-1} data-office-settings>
        <h2 id="os-title">事務所の既定値</h2>
        <p class="pl-sub">
          新しく作る世帯に写す値と、入力のホームの並びです。写した値は「推定」の印（根拠「事務所の既定値」）で入り、後で変えても作った世帯は黙って変わりません（違うときは確かめの一覧に「事務所の新しい値があります」と出ます）。
          {shared ? "事務所で共有していても、今はこの PC の設定です。" : "この PC の設定です。"}
        </p>
        <section class="os-sec" aria-labelledby="os-cards">
          <h3 id="os-cards">入力のホームの入力項目の並び</h3>
          <ol class="os-cards">
            {order.map((id, i) => (
              <li key={id} data-office-card={id}>
                <span class="os-name">{label(id)}</span>
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
            <button type="button" class="link-btn" onClick={() => setS({ ...s, layout: null })} data-office-layout-reset>
              既定の並びに戻す
            </button>
          </p>
        </section>
        <section class="os-sec" aria-labelledby="os-items" data-office-items>
          <h3 id="os-items">新しい世帯で出す入力項目と、開いたときの入れ方</h3>
          <p class="pl-sub">新しく作る世帯に写します（作った世帯は、入力のホームの「入力項目を選ぶ」で世帯ごとに直せます。そこから、その世帯の選び方を事務所の既定にもできます）。出さない入力項目も、値が入ればホームに出ます。</p>
          <ol class="os-cards os-items">
            {order.map((id) => {
              const always = ALWAYS_SHOWN.includes(id);
              const lv = levelIn(s.items, id) ?? "simple";
              return (
                <li key={id} data-office-item={id}>
                  <label class="os-show">
                    <input type="checkbox" checked={always || !isHiddenIn(s.items, id)} disabled={always} onChange={(e) => setShown(id, (e.currentTarget as HTMLInputElement).checked)} data-office-show={id} {...(always ? { title: "いつも出します" } : {})} />
                    <span class="os-name">{label(id)}</span>
                  </label>
                  <span class="level-switch mini" role="group" aria-label={`${label(id)}を開いたときの入れ方`}>
                    <button type="button" class={lv === "simple" ? "on" : ""} aria-pressed={lv === "simple"} onClick={() => setLevel(id, "simple")} data-office-level={`${id}:simple`}>
                      標準
                    </button>
                    <button type="button" class={lv === "detail" ? "on" : ""} aria-pressed={lv === "detail"} onClick={() => setLevel(id, "detail")} data-office-level={`${id}:detail`}>
                      詳細
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
          <p class="pl-sub">
            <button type="button" class="link-btn" onClick={() => setS({ ...s, items: {} })} data-office-items-reset>
              既定に戻す（全部出す・全部「標準」で開く）
            </button>
          </p>
        </section>
        <section class="os-sec" aria-labelledby="os-levers" data-office-levers>
          <h3 id="os-levers">対策に最初から出す項目</h3>
          <p class="pl-sub">
            結果の画面の対策に、どの世帯でも最初から出す項目です。ほかの項目は、対策の「＋ 動かす項目を追加」でその場で足せます。外した項目も、プランで値を変えていれば出ます。
            ローン・口座ごとの項目は、その世帯のローン・口座すべてに出ます（該当する物が無い世帯には出ません）。FP顧問料を外しても、計算は変わりません。
          </p>
          {leverGroups.map((g) => (
            <div class="os-lever-group" key={g}>
              <h4>{g === "よく使う" ? "よく使う項目" : g}</h4>
              <ul class="os-cards os-items">
                {LEVER_KINDS.filter((k) => k.group === g).map((k) => (
                  <li key={k.kind} data-office-lever={k.kind}>
                    <label class="os-show">
                      <input type="checkbox" checked={startsWith(s.levers, k.kind)} onChange={(e) => setStart(k.kind, (e.currentTarget as HTMLInputElement).checked)} data-office-lever-show={k.kind} />
                      <span class="os-name">{k.label}</span>
                    </label>
                    {"note" in k ? <small class="os-note">{k.note}</small> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p class="pl-sub">
            <button type="button" class="link-btn" onClick={() => setS({ ...s, levers: {} })} data-office-levers-reset>
              既定に戻す
            </button>
          </p>
        </section>
        <section class="os-sec" aria-labelledby="os-cg" data-office-contingency>
          <h3 id="os-cg">万一のときのタブ</h3>
          <p class="pl-sub">場面の帯・開いたときの場面・想定の前提に最初から出す項目は、どの世帯にもすぐ効きます（世帯ごとには選びません）。必要保障額の数え方は、これから作る世帯に写します。</p>
          <div class="os-lever-group" data-office-scenes>
            <h4>場面の帯に並べる場面</h4>
            <ul class="os-cards os-items">
              {SCENE_KINDS.map((k) => {
                const on = sceneShown(s.scenes, k.kind);
                const last = on && shownScenes.length === 1;
                return (
                  <li key={k.kind} data-office-scene={k.kind}>
                    <label class="os-show">
                      <input type="checkbox" checked={on} disabled={last} onChange={(e) => setScene(k.kind, (e.currentTarget as HTMLInputElement).checked)} data-office-scene-show={k.kind} {...(last ? { title: "1つは並べます" } : {})} />
                      <span class="os-name">{k.label}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <label class="os-pct">
              <span>開いたときに選んでおく場面</span>
              <select value={s.scenes.open ?? "death:self"} onChange={(e) => setOpen((e.currentTarget as HTMLSelectElement).value as OpenScene)} data-office-open-scene>
                {OPEN_SCENES.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
              <small>その世帯で最後に見た場面があれば、そちらを出します。世帯に無い場面・並べない場面のときは、並べる場面の最初です</small>
            </label>
          </div>
          <div data-office-premises>
            <h4>想定の前提に最初から出す項目</h4>
            <p class="pl-sub">選んでいる場面の項目だけが出ます。ほかの項目は、想定の前提の「＋ 動かす項目を追加」でその場で足せます。外した項目も、値を変えていれば出ます。世帯に当てはまらない項目（配偶者がいない世帯の配偶者の働き方など）は出ません。</p>
            {SCENE_KINDS.map((g) => (
              <div class="os-lever-group" key={g.kind}>
                <h4>{g.label}</h4>
                <ul class="os-cards os-items">
                  {PREMISE_KINDS.filter((k) => k.scene === g.kind).map((k) => (
                    <li key={k.kind} data-office-premise={k.kind}>
                      <label class="os-show">
                        <input type="checkbox" checked={premiseStarts(s.premises, k.kind)} onChange={(e) => setPremise(k.kind, (e.currentTarget as HTMLInputElement).checked)} data-office-premise-show={k.kind} />
                        <span class="os-name">{k.label}</span>
                      </label>
                      {"note" in k ? <small class="os-note">{k.note}</small> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p class="pl-sub">
            <button type="button" class="link-btn" onClick={() => setS({ ...s, premises: {}, scenes: {} })} data-office-contingency-reset>
              場面と項目を既定に戻す
            </button>
          </p>
          <div class="os-lever-group" data-office-protection>
            <h4>必要保障額の数え方</h4>
            <div class="os-grid">
              <label class="os-pct">
                <span>いつまでの資金を数えるか</span>
                <select
                  value={prot.horizon?.kind ?? "lifeExpectancy"}
                  onChange={(e) => {
                    const kind = (e.currentTarget as HTMLSelectElement).value as NonNullable<ProtectionSetting["horizon"]>["kind"];
                    const { horizon: _h, ...rest } = prot;
                    void _h;
                    setS({ ...s, protection: kind === "lifeExpectancy" ? rest : { ...rest, horizon: { kind } } });
                  }}
                  data-office-horizon
                >
                  {HORIZON_KINDS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <small>既定は配偶者の平均余命まで（配偶者がいなければ末子の独立まで）</small>
              </label>
              {prot.horizon?.kind === "age" ? (
                <label class="os-pct">
                  <span>配偶者の年齢</span>
                  <span class="os-in">
                    <input inputMode="numeric" size={4} value={texts.horizonAge ?? ""} aria-invalid={ageText(texts.horizonAge, false) === undefined} onInput={(e) => setTexts({ ...texts, horizonAge: (e.currentTarget as HTMLInputElement).value })} data-office-horizon-age />歳
                  </span>
                  <small>50〜110歳</small>
                </label>
              ) : null}
              <label class="os-pct">
                <span>出し方</span>
                <select
                  value={prot.protection?.method ?? "accumulation"}
                  onChange={(e) => {
                    const m = (e.currentTarget as HTMLSelectElement).value;
                    const { protection: _p, ...rest } = prot;
                    void _p;
                    setS({ ...s, protection: m === "reverse" ? { ...rest, protection: { method: "reverse" } } : rest });
                  }}
                  data-office-method
                >
                  {PROTECTION_METHODS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <small>積み上げ方式は、遺族の支出から収入と一時の資金を引いた不足の累計。逆算方式は、遺族の資産が決めた年齢まで尽きないのに要る額</small>
              </label>
              {prot.protection?.method === "reverse" ? (
                <label class="os-pct">
                  <span>遺族が何歳になるまで資産が尽きないようにするか</span>
                  <span class="os-in">
                    <input inputMode="numeric" size={4} value={texts.reverseAge ?? ""} placeholder="平均余命" aria-invalid={ageText(texts.reverseAge, true) === undefined} onInput={(e) => setTexts({ ...texts, reverseAge: (e.currentTarget as HTMLInputElement).value })} data-office-reverse-age />歳
                  </span>
                  <small>入れなければ遺族の平均余命まで（遺族が子なら末子の独立まで）</small>
                </label>
              ) : null}
            </div>
            <p class="pl-sub">これから作る世帯の前提に写します。作った世帯はその世帯の値のまま計算し、事務所の値と違えば万一のときのタブの想定の前提の下に出ます（そこで事務所の値にできます）。</p>
          </div>
        </section>
        <section class="os-sec" aria-labelledby="os-care">
          <h3 id="os-care">ご本人・配偶者の介護の費用</h3>
          <label class="os-radio">
            <input type="radio" name="os-care" checked={s.care.selfAndSpouse === "warn"} onChange={() => setS({ ...s, care: { selfAndSpouse: "warn" } })} data-office-care="warn" />
            自動では入れない（「未入力」にして「推定で入れる」の1押しを出す。既定）
          </label>
          <label class="os-radio">
            <input type="radio" name="os-care" checked={s.care.selfAndSpouse === "fill"} onChange={() => setS({ ...s, care: { selfAndSpouse: "fill" } })} data-office-care="fill" />
            新しい世帯では最初から推定で入れる
          </label>
        </section>
        <section class="os-sec" aria-labelledby="os-inherit">
          <h3 id="os-inherit">受け取る予定の相続・贈与の見込み</h3>
          <label class="os-radio">
            <input type="radio" name="os-inherit" checked={s.inheritLikelihood === "likely"} onChange={() => setS({ ...s, inheritLikelihood: "likely" })} data-office-inherit="likely" />
            確実（基本の計算に入れる。既定）
          </label>
          <label class="os-radio">
            <input type="radio" name="os-inherit" checked={s.inheritLikelihood === "uncertain"} onChange={() => setS({ ...s, inheritLikelihood: "uncertain" })} data-office-inherit="uncertain" />
            当てにしない（足した行を基本の計算に入れない。行ごとに直せます。相続で受け継ぐ借金も同じ）
          </label>
        </section>
        <section class="os-sec" aria-labelledby="os-assume">
          <h3 id="os-assume">前提条件の既定値</h3>
          <div class="os-grid">
            {OFFICE_ASSUMPTIONS.map((k) => pct(k, ASSUMPTION_LABELS[k], STANDARD_PCT[k], `入れなければ既定の値（${STANDARD_PCT[k]}%。仮の値）。${rangeText(ASSUMPTION_RANGES[k])}`, ASSUMPTION_RANGES[k]))}
            {pct("realEstateRatio", "相続税の目安: 不動産の評価の割合（時価に掛ける）", "80", "入れなければ時価の80%")}
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
            月額（毎月払う。既定）
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
              onClick={(e) => {
                revealAdded(e.currentTarget);
                setFee({ ...fee, steps: [...fee.steps, { year: String(Math.max(1, ...fee.steps.map((y) => Number(y.year) || 1)) + 1), amount: fee.steps.at(-1)?.amount ?? fee.amount }] });
              }}
              data-office-fee-add-step
            >
              ＋ 料金の段階（○年目から○円）
            </button>
          </p>
          <label class="os-radio">
            <input type="radio" name="os-fee-on" checked={s.fee.onContingency === "stop"} onChange={() => setS({ ...s, fee: { ...s.fee, onContingency: "stop" } })} data-office-fee-on="stop" />
            払う人などに万一があったら、継続の顧問料を止める（既定）
          </label>
          <label class="os-radio">
            <input type="radio" name="os-fee-on" checked={s.fee.onContingency === "continue"} onChange={() => setS({ ...s, fee: { ...s.fee, onContingency: "continue" } })} data-office-fee-on="continue" />
            万一のあとも続ける
          </label>
        </section>
        <section class="os-sec" aria-labelledby="os-corp" data-office-features>
          <h3 id="os-corp">法人の顧問向けの機能</h3>
          <p class="pl-sub">会社を顧問先に持つ FP 向けの機能です。既定では使いません。使うと決めたときだけ、役員として働く人のいる世帯に出ます（ほかの世帯の画面は変わりません）。どれも見せ方だけで、計算の結果は変わりません。</p>
          <label class="os-radio">
            <input type="checkbox" checked={s.features.combinedBs} onChange={(e) => setS({ ...s, features: { ...s.features, combinedBs: (e.currentTarget as HTMLInputElement).checked } })} data-office-feature="combinedBs" />
            合算BS（経営者個人と会社のバランスシート）を使う
          </label>
          <p class="pl-sub">資産と負債のタブの「見るもの」に「合算BS」が加わり、会社の試算表の数字を入れて、経営者個人（家計）と会社のバランスシートを並べ・相殺し・合算できます。提案書にも章を選んで載せられます。試しの機能です。</p>
        </section>
        {bad.length > 0 ? <p class="fatal">数で入れてください（前提は欄の下の範囲〔物価・賃金は -10〜10%、運用利回りは -10〜15%、年金の調整率は 0〜5%〕、評価の割合は 0〜100%、料金表の額は円、段階は2〜{FEE_STEP_YEAR_MAX}年目で重ならないように、必要保障額の年齢は 50〜110歳）。</p> : null}
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
              setTexts({ ...Object.fromEntries(OFFICE_ASSUMPTIONS.map((k) => [k, ""])), realEstateRatio: "", horizonAge: "90", reverseAge: "" });
            }}
          >
            全部を既定に戻す
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
