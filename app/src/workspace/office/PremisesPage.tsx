// 事務所の既定値の画面「前提条件の既定値」（0214・0252・0261）: 計算の期間・経済の前提・資産運用の利回り・資産配分の割合と目安・不動産の評価・相続税の目安。
// これから作る世帯に写す値（資産配分の割合と目安は、割合をまだ入れていない世帯が使う）。土地の割合など3つと、資産の種類の信託報酬・期待リターンの目安は
// 置き場所が事務所の推定の値（0111）だが、変えるのはこの画面だけ（推定の値の画面では読むだけ。0261）
import { officialPreset } from "../../../../hearing/src/presets.ts";
import { END_AGES, STANDARD_END_AGE } from "../input/household.ts";
import { PREMISE_DEFS, premiseText, type PremiseDef } from "../input/premiseDefaults.ts";
import { FEE_RANGE, outOfRangeText, rangeText, RETURN_RANGE } from "../input/rateRanges.ts";
import { CLASSES, GPIF_MIX } from "../input/savings/model.ts";
import { rateFromPct } from "../input/units.ts";
import { feeKey, feePreset, hasReturnPreset, mixKey, mixTotalPct, officeMixFromTexts, pctToRate, premiseFromText, premisePlaceholder, premiseTextKey, rateToPct, retKey, retPreset } from "./formText.ts";
import { fieldId, NumField, OfficeGroup, OfficeSection, SelectField } from "./OfficeFields.tsx";
import type { OfficeSettings } from "./settings.ts";

export interface PremisesPageProps {
  s: OfficeSettings;
  texts: Readonly<Record<string, string>>;
  onText: (key: string, v: string) => void;
  onEndAge: (age: number) => void;
}

/** 画面の欄の名前（世帯の欄と同じ言葉。「（年）」は外す。運用の利回りは使い道の名前にする。0261） */
const NAMES: Readonly<Record<string, string>> = {
  investmentReturn: "配分も利回りも入れていない運用の口座",
  "assetReturns.realEstate": "不動産",
  "realEstateValuation.saleCostRate": "売却の費用",
};
export const premiseName = (d: PremiseDef): string =>
  NAMES[d.id] ??
  (d.officeLabel ?? d.label)
    .replace(/^耐用年数: /, "")
    .replace(/（年）$/, "")
    .replace(/・年）$/, "）");

/** 欄の「?」の中（空欄のときの値と、入れられる範囲。長い説明は区画の「?」） */
const HELPS: Readonly<Record<string, string>> = {
  investmentReturn:
    "NISA・課税口座・iDeCo・企業型DC・持株会・財形・まとめた金融資産などで、口座ごとの利回りも資産の配分も入れていない口座を、この率で伸ばします。資産の種類ごとの利回りを空欄にした種類と、必要保障額の逆算方式で遺族の資金を伸ばす率にも使います（前の名前は「運用利回り」）。",
  "assetReturns.realEstate": "貸していない不動産（空き家・土地・別荘）の値動きです。持ち家・収益不動産は、下の不動産の評価（土地の上昇率と建物の耐用年数）で動きます。",
  "realEstateValuation.saleCostRate": "売却価格に対する割合です。",
  "realEstateValuation.landShare": "物件の価格のうち土地の割合です。",
  "realEstateValuation.residualFloor": "建物の価値は耐用年数で下がりますが、この割合より下げません。",
};

const blankText = (d: PremiseDef, short: boolean): string => (d.standard !== null ? `${premiseText(d, d.standard)}${short ? "" : "（提供元の既定）"}` : (d.follows?.text ?? ""));

/** 欄の下の知らせ（範囲の外・読めない文字。読めれば null） */
function problemOf(d: PremiseDef, text: string): string | null {
  if (premiseFromText(d, text) !== undefined) return null;
  if (d.kind === "int") return `${d.min}〜${d.max}年の整数で入れてください`;
  const r = rateFromPct(text.trim().replace(/[％%]$/, ""));
  return (r !== null ? outOfRangeText(r, d) : null) ?? `数で入れてください（${rangeText(d)}）`;
}

const def = (id: string): PremiseDef => PREMISE_DEFS.find((d) => d.id === id) as PremiseDef;

export function PremisesPage({ s, texts, onText, onEndAge }: PremisesPageProps) {
  const t = (k: string) => texts[k] ?? "";
  /** 率・年数の欄（compact は4列の並びの欄。欄の下の1行を短くする） */
  const field = (d: PremiseDef, o: { compact?: boolean; placeholder?: string; note?: string | null } = {}) => {
    const key = premiseTextKey(d);
    const problem = problemOf(d, t(key));
    const blank = blankText(d, o.compact === true);
    const help = `${HELPS[d.id] ?? ""}${d.kind === "pct" ? `${rangeText(d)}の範囲で入れます。` : `${d.min}〜${d.max}年で入れます。`}`;
    return (
      <NumField
        key={key}
        name={key}
        label={premiseName(d)}
        value={t(key)}
        onInput={(v) => onText(key, v)}
        suffix={d.kind === "int" ? "年" : "%"}
        placeholder={o.placeholder ?? premisePlaceholder(d)}
        help={help}
        note={o.note !== undefined ? o.note : blank !== "" ? `空欄: ${blank}` : null}
        problem={problem}
        numeric={d.kind === "int"}
        data={{ "data-office-setting": key }}
        problemData={{ "data-office-setting-problem": key }}
      />
    );
  };
  // 資産の種類ごとの利回りの空欄の薄い数: 預金の種類は預金の利回り、不動産は0、ほかは「配分も利回りも入れていない運用の口座」の率（今の欄の値か既定）
  const shown = (id: string): string => {
    const d = def(id);
    const r = premiseFromText(d, t(premiseTextKey(d)));
    return typeof r === "string" ? rateToPct(r) : premisePlaceholder(d);
  };
  const classPlaceholder = (d: PremiseDef): string => (d.id === "assetReturns.realEstate" ? "0" : d.id.startsWith("assetReturns.cash.") ? shown("depositReturn") : shown("investmentReturn"));
  const officeMix = officeMixFromTexts(texts);
  const mixRows = CLASSES.map((c) => {
    const feeBad = pctToRate(t(feeKey(c.key)), FEE_RANGE.min, FEE_RANGE.max) === undefined;
    const retBad = hasReturnPreset(c.key) && pctToRate(t(retKey(c.key)), RETURN_RANGE.min, RETURN_RANGE.max) === undefined;
    return (
      <tr key={c.key} data-office-mix-class={c.key}>
        <th scope="row" class="l">
          {c.name}
        </th>
        <td>
          <span class="fld-in">
            <input id={fieldId(mixKey(c.key))} type="text" class={`num${officeMix === undefined ? " bad" : ""}`} inputMode="decimal" value={t(mixKey(c.key))} placeholder={officeMix === null ? rateToPct(GPIF_MIX.find((m) => m.assetClass === c.key)?.share ?? null) || "0" : "0"} aria-label={`${c.name}の割合`} aria-invalid={officeMix === undefined} onInput={(e) => onText(mixKey(c.key), (e.currentTarget as HTMLInputElement).value)} data-office-setting={mixKey(c.key)} />
            <span class="suffix">%</span>
          </span>
        </td>
        <td>
          {hasReturnPreset(c.key) ? (
            <span class="fld-in">
              <input id={fieldId(retKey(c.key))} type="text" class={`num${retBad ? " bad" : ""}`} inputMode="decimal" value={t(retKey(c.key))} placeholder={rateToPct(String(officialPreset(retPreset(c.key))))} aria-label={`${c.name}の期待リターンの目安`} aria-invalid={retBad} onInput={(e) => onText(retKey(c.key), (e.currentTarget as HTMLInputElement).value)} data-office-setting={retKey(c.key)} />
              <span class="suffix">%</span>
            </span>
          ) : (
            <span class="os-muted" title="外貨預金は預金の利回りで計算します">預金の利回り</span>
          )}
        </td>
        <td>
          <span class="fld-in">
            <input id={fieldId(feeKey(c.key))} type="text" class={`num${feeBad ? " bad" : ""}`} inputMode="decimal" value={t(feeKey(c.key))} placeholder={rateToPct(String(officialPreset(feePreset(c.key))))} aria-label={`${c.name}の信託報酬`} aria-invalid={feeBad} onInput={(e) => onText(feeKey(c.key), (e.currentTarget as HTMLInputElement).value)} data-office-setting={feeKey(c.key)} />
            <span class="suffix">%</span>
          </span>
        </td>
      </tr>
    );
  });
  const mixTable = (
    <table class="os-mix" data-office-mix>
      <thead>
        <tr>
          <th scope="col" class="l">
            資産の種類
          </th>
          <th scope="col">割合</th>
          <th scope="col">期待リターン（目安）</th>
          <th scope="col">信託報酬（年）</th>
        </tr>
      </thead>
      <tbody>{mixRows}</tbody>
    </table>
  );
  const ECONOMY = ["inflation", "wageGrowth", "depositReturn", "educationInflation", "pensionMacroSlide", "pensionMacroSlideEmployee"];
  const realEstate = PREMISE_DEFS.filter((d) => d.section === "realEstate");
  const lives = realEstate.filter((d) => d.kind === "int");
  return (
    <>
      <OfficeSection id="os-assume-span" title="計算の期間">
        <OfficeGroup>
          <div class="os-fields os-cols2">
            <SelectField
              name="endAge"
              label="表を何歳まで見るか"
              value={String(s.endAge ?? STANDARD_END_AGE)}
              options={END_AGES.map((a) => ({ value: String(a), label: `若い方が${a}歳になる年まで${a === STANDARD_END_AGE ? "（既定）" : ""}` }))}
              onPick={(v) => onEndAge(Number(v))}
              help="ご本人・配偶者のうち若い方の年齢です。これから作る世帯の表の最後の年に写し、前提条件の欄の「既定」もこの年齢にします。"
              note="これから作る世帯の表の最後の年に写します"
              data={{ "data-office-end-age": "" }}
            />
          </div>
        </OfficeGroup>
      </OfficeSection>
      <OfficeSection id="os-assume-economy" title="経済の前提" help="空欄は提供元の既定の値（仮の値）です。長い期間の平均の目安で入れます。">
        <OfficeGroup data={{ "data-office-premises": "economy" }}>
          <div class="os-fields os-cols3">{ECONOMY.map((id) => field(def(id)))}</div>
        </OfficeGroup>
      </OfficeSection>
      <OfficeSection
        id="os-assume-invest"
        title="資産運用の利回り"
        help="資産配分を入れた口座は資産の種類ごとの利回りで、口座に利回りを入れた口座はその利回りで計算します。どれも入れていない運用の口座は「配分も利回りも入れていない運用の口座」の率で計算します。長い期間の平均の目安です。根拠（出典・期間）は事務所で確認してください。商品のおすすめではありません。"
        lead="資産の配分を入れた口座は種類ごとの利回り、配分も利回りも入れていない運用の口座は下の1つの率で計算します。"
      >
        <OfficeGroup title="資産の種類ごとの利回り（信託報酬を引く前）" help="資産配分の種類ごとの利回り（信託報酬などを引く前の年率）です。空欄は、預金・外貨預金は預金の利回り、不動産は0%、ほかは下の「配分も利回りも入れていない運用の口座」の率で計算します。" data={{ "data-office-premises": "assetReturns" }}>
          <div class="os-fields os-cols4">{PREMISE_DEFS.filter((d) => d.section === "assetReturns").map((d) => field(d, { compact: true, placeholder: classPlaceholder(d), note: d.id.startsWith("assetReturns.cash.") ? "空欄: 預金の利回り" : d.id === "assetReturns.realEstate" ? "空欄: 0%" : null }))}</div>
          <div class="os-fields os-cols2 os-sep" data-office-premises="investmentReturn">
            {field(def("investmentReturn"))}
          </div>
        </OfficeGroup>
        <OfficeGroup
          title="資産配分の割合と目安（割合をまだ入れていない世帯が使う）"
          help="資産配分の入れ方で、割合をまだ入れていない世帯が使う割合と、種類ごとの目安です。割合が空欄なら、GPIF の基本ポートフォリオ（国内債券・先進国債券・国内株式・先進国株式を25%ずつ）。割合を入れるときは合計を100%にします。期待リターンの目安は、資産の種類ごとの利回りがまだ無い種類に推定で入れます。信託報酬は、世帯の「＋ 資産の種類を足す」で足した種類にも入れます。期待リターンと信託報酬の目安は「推定の値（統計・目安）」にも読むだけで出ます。"
          data={{ "data-office-premises": "assetMix" }}
        >
          <div class="os-mix-wrap">{mixTable}</div>
          <p class={`os-note-line${officeMix === undefined ? " bad" : ""}`} data-office-mix-total>
            割合の合計: {officeMix === null ? "空欄（GPIF の基本ポートフォリオ）" : `${mixTotalPct(texts)}%`}
          </p>
          {officeMix === undefined ? (
            <div class="fld-help bad" role="alert" data-office-setting-problem="assetMix">
              割合は0〜100%の数で入れ、合計を100%にしてください（今は{mixTotalPct(texts)}%）
            </div>
          ) : null}
          {CLASSES.some((c) => hasReturnPreset(c.key) && pctToRate(t(retKey(c.key)), RETURN_RANGE.min, RETURN_RANGE.max) === undefined) ? (
            <div class="fld-help bad" role="alert" data-office-setting-problem="assetReturn">
              期待リターンは{RETURN_RANGE.min}〜{RETURN_RANGE.max}%の数で入れてください
            </div>
          ) : null}
          {CLASSES.some((c) => pctToRate(t(feeKey(c.key)), FEE_RANGE.min, FEE_RANGE.max) === undefined) ? (
            <div class="fld-help bad" role="alert" data-office-setting-problem="assetFee">
              信託報酬は{FEE_RANGE.min}〜{FEE_RANGE.max}%の数で入れてください
            </div>
          ) : null}
        </OfficeGroup>
      </OfficeSection>
      <OfficeSection id="os-assume-estate" title="不動産の評価（持ち家・収益不動産など）" help="持ち家・収益不動産の評価に使います（物件ごとに入れた値があればそちら）。空欄は提供元の既定の値（土地の上昇率は物価上昇率と同じ）。">
        <OfficeGroup data={{ "data-office-premises": "realEstate" }}>
          <div class="os-fields os-cols2">{realEstate.filter((d) => d.kind === "pct").map((d) => field(d, { compact: true }))}</div>
          <h6 class="os-sub-h">耐用年数</h6>
          <div class="os-fields os-cols4">{lives.map((d) => field(d, { compact: true, note: null }))}</div>
        </OfficeGroup>
      </OfficeSection>
      <OfficeSection id="os-assume-tax" title="相続税の目安">
        <OfficeGroup>
          <div class="os-fields os-cols2">
            <NumField
              name="realEstateRatio"
              label="不動産の評価の割合（時価に掛ける）"
              value={t("realEstateRatio")}
              onInput={(v) => onText("realEstateRatio", v)}
              suffix="%"
              placeholder="80"
              help="相続税の目安で、不動産の時価に掛ける割合です。0〜100%で入れます。"
              note="空欄: 80%"
              problem={pctToRate(t("realEstateRatio"), 0, 100) === undefined ? "0〜100%の数で入れてください" : null}
              data={{ "data-office-setting": "realEstateRatio" }}
              problemData={{ "data-office-setting-problem": "realEstateRatio" }}
            />
          </div>
        </OfficeGroup>
      </OfficeSection>
    </>
  );
}
