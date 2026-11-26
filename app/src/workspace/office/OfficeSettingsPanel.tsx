// 事務所の既定値の画面（0073。上の帯のカバンの印〔FP のメニュー〕・世帯の一覧の「事務所の既定値」から開く中央のパネル）。
// 7つの画面に分け、左の目次（画面の名前と今の値の要約・保存していない画面の印）で行き来する（0261）:
// 前提条件の既定値／FP顧問料の料金表／推定の値（統計・目安）／入力の画面／結果と万一の画面／事務所の見た目と機能／カスタム層。
// - 保存は全部の画面をまとめて1つ（下の帯の「保存」）。どの画面で変えた所も画面を移っても残り、1回の保存で事務所データ（defaults）と
//   事務所の見た目（branding）に書く。「キャンセル」で全部戻す。保存していない変更があるのに閉じるときは、下の帯で確かめる
// - 押すとすぐ効く物は今のまま: 機能を有効にするコード（本体が確かめる）・AI からの案の「反映する」「ひな形として保存する」・カスタム層の承認
// - アプリの幅が狭いときは、左の目次を上の1行（選ぶ欄）にたたむ（app.css の .os-nav-row）
// 新しく作る世帯（料金表は新しく足す契約）に写す値は、作った世帯を変えない（違うときは確かめの一覧に知らせが出る。0073 の3）。
// 事務所データの形・置き場所は変えない（画面の分け方と保存の仕方だけ）
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { CloseX, useEscClose } from "../../presentation/CloseX.tsx";
import { Help, HelpOf } from "../../presentation/Help.tsx";
import { today } from "../report/assemble.ts";
import { guardPanel } from "../input/pendingInput.ts";
import { STANDARD_END_AGE } from "../input/household.ts";
import type { AiDisplayCandidate, CustomHost, CustomTextsStatus } from "../../engine/host.ts";
import type { ProposableDisplayId } from "../../connector/displayCatalog.ts";
import type { OfficeBrandingHost } from "./BrandingSection.tsx";
import type { OfficeBranding } from "./branding.ts";
import { CustomTextsSection } from "./CustomTextsSection.tsx";
import { DisplayProposalsSection } from "./DisplayProposalsSection.tsx";
import { carryDisplayValue } from "./displayProposals.ts";
import { EstimatesSection } from "./EstimatesSection.tsx";
import { officialUpdates } from "./estimates.ts";
import type { PreviewRow } from "./estimatePreview.ts";
import { featureOn, NO_FEATURES, type FeatureStatus } from "./featureCodes.ts";
import { FeePage } from "./FeePage.tsx";
import { feeFromTexts, feeTexts } from "./formText.ts";
import { HearingTemplateProposals, type HearingTemplateProposalsProps } from "./HearingTemplateProposals.tsx";
import { InputPage } from "./InputPage.tsx";
import { LookPage, type CodeActions } from "./LookPage.tsx";
import { fieldId } from "./OfficeFields.tsx";
import { draftOf, OFFICE_PAGES, OFFICE_PAGES_TOP, openingPage, pageChanges, pageProblems, pagesText, pageSummary, rememberOfficePage, sameBranding, settingsToSave, type OfficeDraft, type OfficePageId } from "./pages.ts";
import { PremisesPage } from "./PremisesPage.tsx";
import { ResultsPage } from "./ResultsPage.tsx";
import { DEFAULT_OFFICE_SETTINGS, withHearingTemplates, type OfficeSettings } from "./settings.ts";

// 前の版から使っている欄の読み方（テスト・ほかの画面が読む）。中身は formText.ts
export { feeFromTexts, feeYenFromText, officeMixFromTexts, pctToRate, premiseFromText, rateToPct, yenFromText } from "./formText.ts";
// 分けた画面（並び・名前・覚えた画面）
export { OFFICE_PAGES, type OfficePageId } from "./pages.ts";

export interface OfficeSettingsPanelProps extends CodeActions {
  value: OfficeSettings;
  /** 出していないセットの見本を直した版の数（コードの知らせに「消していません」を足す。0247 の7） */
  keptSamples?: readonly { name: string; count: number }[];
  /** 保存する（本体の事務所データへ） */
  onSave: (next: OfficeSettings) => Promise<void>;
  /** 事務所で共有しているか（今は PC ごとの設定であることを知らせる） */
  shared: boolean;
  onClose: () => void;
  /** 開く画面（AI の案・知らせから開いたとき）。無ければ前回の画面（初めては前提条件の既定値） */
  initialPage?: OfficePageId;
  /** 機能を有効にするコードの状態（0110。本体が確かめる）。コードの入っていない機能の区画は出さない */
  features?: FeatureStatus;
  /**
   * カスタム層の説明の文・名前・入力の欄の見せ方（0016 の追記 2026-11-02）。本体が確かめた状態と命令。押した結果はすぐ効く（保存は要らない）。
   * 無ければ「カスタム層」の画面を出さない。terms・fields は無ければ区画を出さない
   */
  custom?: { host: CustomHost; status: CustomTextsStatus | null; onStatus: (st: CustomTextsStatus) => void; terms?: CustomTextsStatus | null; fields?: CustomTextsStatus | null; onKindStatus?: (st: CustomTextsStatus) => void };
  /** 事務所の推定の値（0111）の画面を出す（代表の世帯で差を見る道があれば渡す）。無ければ「推定の値」の画面を出さない */
  estimates?: { preview?: (before: OfficeEstimatesValue, after: OfficeEstimatesValue) => Promise<PreviewRow[]> };
  /** 事務所の見た目（0121。名前・ロゴ・基調の色）。無ければ区画を出さない */
  branding?: OfficeBrandingHost;
  /**
   * AIからの表示の設定の案（0215。接続口の propose_display_settings）と、その判断。反映・前の値に戻すは、すぐ事務所データに保存して保存した設定を返す
   * （パネルの「保存」は要らない）。無ければ区画を出さない（前の値があれば、前の値に戻すだけを出す）
   */
  display?: {
    candidates: readonly AiDisplayCandidate[];
    onApply: (candidate: string, id: ProposableDisplayId, value: unknown) => Promise<OfficeSettings>;
    onDiscard: (candidate: string, id: string) => Promise<void>;
    onRestore: (id: ProposableDisplayId, index: number) => Promise<OfficeSettings>;
  };
  /** AIからの Web のヒアリングのひな形の案（0222。接続口の propose_hearing_template）。保存はすぐ事務所データへ。無ければ区画を出さない */
  hearingTemplates?: Omit<HearingTemplateProposalsProps, "templates" | "onSave"> & { onSave: (candidateId: string, name: string, selection: Parameters<HearingTemplateProposalsProps["onSave"]>[2]) => Promise<OfficeSettings> };
}

type OfficeEstimatesValue = NonNullable<OfficeSettings["estimates"]>;

/** 画面の頭の1文と「?」の中（長い説明） */
const PAGE_TEXT: Readonly<Record<OfficePageId, { lead: string; help?: string }>> = {
  premises: {
    lead: "これから作る世帯に写します。世帯では「事務所の既定値」として入り、世帯ごとに直すと「この世帯だけ」になります。",
    help: "空欄は提供元の既定の値です。後で変えても、作った世帯は黙って変わりません（違うときは確かめの一覧に「事務所の既定値が変わりました」と出て、1押しでその世帯に反映できます）。資産配分の割合と目安は、割合をまだ入れていない世帯が使います。",
  },
  fee: { lead: "FP顧問料の契約を足すときに写します（足した契約は、後で料金表を変えても変わりません）。" },
  estimates: {
    lead: "空欄・「わからない」を補う推定の元の値です。変えた値は、保存するとこれから入れる推定と計算の目安に、どの世帯にもすぐ効きます。",
    help: "推定の元になる統計の値（基本生活費・給与・退職金・学校の費用・介護の費用と期間・ローンの金利・平均余命など）と、出典の無いよくある額・割合の目安（家賃・物件の価格・車の費用・遺族の生活費の割合・ボタンで足すときの初めの値など）を、事務所の値に変えられます。世帯に入れてある推定のままの値は、その世帯の入力を直したときに新しい値で入れ直します（FP が入れた値・確定にした値は変わりません。世帯ごとに直せます）。税・社会保険・年金など法令で決まる値は変えられません。",
  },
  input: { lead: "入力のホームの並びと、新しい世帯での入力項目の出し方・入れ方です。" },
  results: { lead: "結果の画面の対策・表示の設定と、万一のときのタブの既定です。" },
  look: { lead: "左上の事務所の名前とロゴ・基調の色と、法人経営者向けの機能です。" },
  custom: { lead: "説明の文・名前・入力の欄の見せ方を、カスタム層のフォルダのファイルで事務所の言い方にします。承認するとすぐ画面に使います（保存は要りません）。" },
};

/** 「保存」の「?」の中（保存すると何が起きるか） */
const SAVE_HELP =
  "どの画面で変えた所も、1回の「保存」でまとめて保存します。前提条件の既定値・新しい世帯で出す入力項目・介護の費用・相続と贈与の見込み・必要保障額の数え方は、これから作る世帯に写します（作った世帯は変わりません）。FP顧問料の料金表は、これから足す契約に写します。入力のホームの並び・基本生活費の内訳の並べ方・対策に最初から出す項目・万一のときの場面と項目・推定の値・事務所の見た目は、どの世帯にもすぐ効きます。結果のタブ・資産と負債のタブの表示の設定は、事務所の既定値に従う世帯にすぐ効きます。";

const total = (c: Readonly<Record<OfficePageId, number>>): number => Object.values(c).reduce((a, b) => a + b, 0);

export function OfficeSettingsPanel(p: OfficeSettingsPanelProps) {
  const { value, onSave, shared, onClose, features = NO_FEATURES, custom, branding, display, hearingTemplates } = p;
  const brandSaved = branding?.value ?? null;
  // 保存した値から作った、変えていない状態（保存していない変更はこれと比較して数える）
  const base = useMemo(() => draftOf(value, brandSaved), [value, brandSaved]);
  const [d, setD] = useState<OfficeDraft>(base);
  // 開いている間に事務所の既定値を読み直した・AI の案を反映したとき: まだ何も変えていなければ新しい値で作り直す
  // （変えた後は、FP の入れた値を上書きしない。AI の案を反映した設定とひな形は、下の onApply・onSave で下書きにも写す）
  const prevBase = useRef(base);
  useEffect(() => {
    const prev = prevBase.current;
    if (prev === base) return;
    prevBase.current = base;
    setD((x) => (total(pageChanges(prev, x)) === 0 ? base : x.brand === prev.brand ? { ...x, brand: base.brand } : x));
  }, [base]);
  const changes = pageChanges(base, d);
  const problems = pageProblems(d);
  const dirty = total(changes) > 0;
  const bad = total(problems) > 0;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // 画面（左の目次）。出す画面は、渡された物で決める（推定の値・カスタム層は本体があるときだけ）
  const shownPages = OFFICE_PAGES.filter((x) => (x.id !== "estimates" || p.estimates !== undefined) && (x.id !== "custom" || custom !== undefined) && (x.id !== "look" || branding !== undefined || p.onAddCode !== undefined || featureOn(features, "combinedBs")));
  const shownIds = shownPages.map((x) => x.id);
  const [page, setPageState] = useState<OfficePageId>(() => openingPage(p.initialPage, shownIds));
  const main = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => rememberOfficePage(page), [page]);
  const goPage = (id: OfficePageId, focus?: string) => {
    setPageState(id);
    // 移った画面は頭から（欄を指したときは、その欄へ）
    requestAnimationFrame(() => {
      const el = focus !== undefined ? document.getElementById(fieldId(focus)) : null;
      if (el !== null) {
        el.scrollIntoView({ block: "center" });
        (el as HTMLElement).focus({ preventScroll: true });
      } else main.current?.scrollTo({ top: 0 });
    });
  };

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  /** 保存していない変更があるのに閉じようとした（下の帯で確かめる） */
  const [leaving, setLeaving] = useState(false);

  const setS = (f: (s: OfficeSettings) => OfficeSettings) => {
    setMsg(null);
    setD((x) => ({ ...x, s: f(x.s) }));
  };
  const setText = (key: string, v: string) => {
    setMsg(null);
    setD((x) => ({ ...x, texts: { ...x.texts, [key]: v } }));
  };
  const setBrand = (b: OfficeBranding) => {
    setMsg(null);
    setD((x) => ({ ...x, brand: b }));
    if (branding !== undefined) branding.onPreview(sameBranding(b, branding.value) ? null : b);
  };

  /** 変えた所を捨てて閉じる（見た目の見本も保存した見た目に戻す） */
  const discard = () => {
    branding?.onPreview(null);
    onClose();
  };
  /** × ・Esc・背景を押したとき: 保存していない変更があれば下の帯で確かめる（確かめを出しているときの Esc は、変更を捨てて閉じる） */
  const tryClose = () => {
    if (!dirtyRef.current) return onClose();
    if (leaving) return discard();
    setLeaving(true);
  };
  useEscClose(tryClose);
  // 世帯を切り替える・アプリを閉じる前にも、保存していない変更があれば下の帯で知らせて止める（入力項目のパネルと同じ。0131）
  useEffect(() => guardPanel({ unsaved: () => dirtyRef.current, warn: () => setLeaving(true) }), []);
  // パネルへ移すのは開いたときの1回だけ。描き直しのたびに移すと、事務所の名前など打っている欄から選択が外れる
  // （名前は打つたびに左上の見本を描き直すので、呼ぶ側が描き直す）
  useEffect(() => {
    panel.current?.focus();
    document.documentElement.classList.add("panel-open");
    return () => document.documentElement.classList.remove("panel-open");
  }, []);
  // 確かめを出したら、その中のボタンに移る
  useEffect(() => {
    if (leaving) panel.current?.querySelector<HTMLElement>("[data-office-leave-back]")?.focus();
  }, [leaving]);
  useEffect(() => {
    if (!dirty) setLeaving(false);
  }, [dirty]);

  const save = async (): Promise<boolean> => {
    if (bad || busy) return false;
    const brandChanged = d.brand !== null && branding !== undefined && !sameBranding(d.brand, branding.value);
    const defaultsChanged = changes.premises + changes.fee + changes.estimates + changes.input + changes.results > 0 || d.s.features.combinedBs !== base.s.features.combinedBs;
    const names = pagesText(changes).replace(/（\d+か所）/g, "");
    setBusy(true);
    setMsg(null);
    try {
      let savedValue = value;
      if (defaultsChanged) {
        savedValue = settingsToSave(d, today());
        await onSave(savedValue);
      }
      let savedBrand = brandSaved;
      if (brandChanged && branding !== undefined && d.brand !== null) savedBrand = await branding.onSave({ ...d.brand, ...(d.brand.name !== undefined ? { name: d.brand.name.trim() } : {}) });
      const next = draftOf(savedValue, savedBrand);
      prevBase.current = next;
      setD(next);
      setLeaving(false);
      setMsg({ ok: true, text: `保存しました（${names}）。` });
      return true;
    } catch (e) {
      setMsg({ ok: false, text: `保存できませんでした（${typeof e === "string" ? e : e instanceof Error ? e.message : "E_OFFICE_SETTINGS"}）` });
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** 目次の印（AI の案・公式の値の更新・承認待ち） */
  const badge = (id: OfficePageId): string | null => {
    if (id === "results" && (display?.candidates.length ?? 0) > 0) return `AIからの提案 ${display?.candidates.length}件`;
    if (id === "input" && (hearingTemplates?.candidates.length ?? 0) > 0) return `AIからの提案 ${hearingTemplates?.candidates.length}件`;
    if (id === "look" && (features.candidates ?? []).length > 0) return `AIからの候補 ${(features.candidates ?? []).length}件`;
    if (id === "estimates" && officialUpdates(d.est).length > 0) return `公式の更新 ${officialUpdates(d.est).length}件`;
    if (id === "custom" && [custom?.status, custom?.terms, custom?.fields].some((st) => st !== undefined && st !== null && (st.state === "pending" || st.updates.length > 0))) return "承認待ち";
    return null;
  };

  /**
   * 「この画面を既定に戻す」: その画面の欄を提供元の既定にする（保存を押すと決まる）。前提条件の既定値の画面は、置き場所が推定の値の欄
   * （土地の割合など・資産の種類の目安）も空欄（公式の値）にする
   */
  const resetPage = (id: OfficePageId) => {
    setMsg(null);
    setD((x) => {
      if (id === "premises") {
        const texts = { ...x.texts };
        for (const k of Object.keys(texts)) if (k !== "horizonAge" && k !== "reverseAge") texts[k] = "";
        const { endAge: _e, ...rest } = x.s;
        void _e;
        return { ...x, s: rest, texts };
      }
      if (id === "fee") return { ...x, s: { ...x.s, fee: DEFAULT_OFFICE_SETTINGS.fee }, fee: feeTexts(DEFAULT_OFFICE_SETTINGS.fee) };
      if (id === "input") {
        const { living: _l, ...rest } = x.s;
        void _l;
        return { ...x, s: { ...rest, layout: null, items: {}, care: DEFAULT_OFFICE_SETTINGS.care, inheritLikelihood: DEFAULT_OFFICE_SETTINGS.inheritLikelihood } };
      }
      if (id === "results") {
        const { display: _d, ...rest } = x.s;
        void _d;
        return { ...x, s: { ...rest, levers: {}, scenes: {}, premises: {}, protection: {} }, texts: { ...x.texts, horizonAge: "90", reverseAge: "" } };
      }
      return x;
    });
  };
  const RESETTABLE: readonly OfficePageId[] = ["premises", "fee", "input", "results"];

  const pageBody = (id: OfficePageId) => {
    switch (id) {
      case "premises":
        return <PremisesPage s={d.s} texts={d.texts} onText={setText} onEndAge={(age) => setS((x) => {
          const { endAge: _old, ...rest } = x;
          void _old;
          return age === STANDARD_END_AGE ? rest : { ...rest, endAge: age };
        })} />;
      case "fee":
        return <FeePage table={d.s.fee} fee={d.fee} ok={feeFromTexts(d.s.fee, d.fee) !== null} onFee={(f) => {
          setMsg(null);
          setD((x) => ({ ...x, fee: f }));
        }} onTable={(t) => setS((x) => ({ ...x, fee: t }))} />;
      case "estimates":
        return (
          <EstimatesSection
            value={d.est}
            saved={base.est}
            onChange={(n) => {
              setMsg(null);
              setD((x) => ({ ...x, est: n }));
            }}
            {...(p.estimates?.preview !== undefined ? { preview: p.estimates.preview } : {})}
            today={today}
            onGoPremise={(field) => goPage("premises", field)}
          />
        );
      case "input":
        return (
          <InputPage
            s={d.s}
            onS={setS}
            proposals={
              hearingTemplates !== undefined ? (
                <HearingTemplateProposals
                  candidates={hearingTemplates.candidates}
                  templates={value.hearingTemplates ?? []}
                  // 保存したひな形を、編集中の欄にも写す（パネルの「保存」で消えないように）
                  onSave={async (c, name, sel) => {
                    const saved = await hearingTemplates.onSave(c, name, sel);
                    setD((x) => ({ ...x, s: withHearingTemplates(x.s, saved.hearingTemplates ?? []) }));
                  }}
                  onDiscard={hearingTemplates.onDiscard}
                />
              ) : undefined
            }
          />
        );
      case "results":
        return (
          <ResultsPage
            s={d.s}
            texts={d.texts}
            onS={setS}
            onText={setText}
            proposals={
              display !== undefined ? (
                <DisplayProposalsSection
                  value={value}
                  candidates={display.candidates}
                  // 反映した設定と前の値だけを、編集中の欄にも写す（ほかの編集中の欄はそのまま。パネルの「保存」で消えないように）
                  onApply={async (c, id, v) => {
                    const saved = await display.onApply(c, id, v);
                    setD((x) => ({ ...x, s: carryDisplayValue(x.s, saved, id) }));
                    return saved;
                  }}
                  onDiscard={display.onDiscard}
                  onRestore={async (id, i) => {
                    const saved = await display.onRestore(id, i);
                    setD((x) => ({ ...x, s: carryDisplayValue(x.s, saved, id) }));
                    return saved;
                  }}
                />
              ) : undefined
            }
          />
        );
      case "look":
        return (
          <LookPage
            brand={branding !== undefined && d.brand !== null ? { draft: d.brand, saved: branding.value, onDraft: setBrand, onPickLogo: branding.onPickLogo } : null}
            shared={shared}
            features={features}
            combinedBs={d.s.features.combinedBs}
            keptSamples={p.keptSamples ?? []}
            onCombinedBs={(on) => setS((x) => ({ ...x, features: { ...x.features, combinedBs: on } }))}
            {...(p.onAddCode !== undefined ? { onAddCode: p.onAddCode } : {})}
            {...(p.onRemoveCode !== undefined ? { onRemoveCode: p.onRemoveCode } : {})}
            {...(p.onDismissNotice !== undefined ? { onDismissNotice: p.onDismissNotice } : {})}
            {...(p.onCheckCodes !== undefined ? { onCheckCodes: p.onCheckCodes } : {})}
            {...(p.onDecideCandidate !== undefined ? { onDecideCandidate: p.onDecideCandidate } : {})}
          />
        );
      case "custom":
        return custom !== undefined ? (
          <>
            <CustomTextsSection host={custom.host} status={custom.status} onStatus={custom.onStatus} />
            {custom.terms !== undefined ? <CustomTextsSection kind="terms" host={custom.host} status={custom.terms} onStatus={custom.onKindStatus ?? custom.onStatus} /> : null}
            {custom.fields !== undefined ? <CustomTextsSection kind="fields" host={custom.host} status={custom.fields} onStatus={custom.onKindStatus ?? custom.onStatus} /> : null}
          </>
        ) : null;
    }
  };

  const unsavedText = pagesText(changes);
  const problemPages = shownPages.filter((x) => problems[x.id] > 0);
  return (
    <>
      <div class="scrim" aria-hidden="true" onClick={tryClose} />
      <div ref={panel} class="ipanel os-panel type-scale" role="dialog" aria-modal="true" aria-labelledby="os-title" tabIndex={-1} data-office-settings data-office-page-now={page}>
        <div class="ip-band" />
        <div class="os-head">
          <h2 id="os-title">
            事務所の既定値
            <Help label="事務所の既定値" id="office-defaults">
              事務所全体で使う既定です。前提条件・FP顧問料・新しい世帯で出す入力項目などはこれから作る世帯に写し、作った世帯は黙って変わりません。入力のホームの並び・対策・表示の設定などの見せ方は、どの世帯にもすぐ効きます。どの画面で変えた所も、下の「保存」でまとめて保存します。
            </Help>
          </h2>
          <CloseX onClose={tryClose} what="事務所の既定値" />
          <p class="os-head-lead">
            事務所全体で使う既定です。{shared ? "事務所で共有していても、今はこの PC の設定です。" : "この PC の設定です。"}
          </p>
        </div>
        <div class="os-wrap">
          <nav class="os-nav" aria-label="事務所の既定値の画面" data-office-toc>
            <ul>
              {shownPages.map((x, i) => {
                const b = badge(x.id);
                return (
                  <li key={x.id} class={i === OFFICE_PAGES_TOP && shownPages.length > OFFICE_PAGES_TOP ? "os-nav-sep" : undefined}>
                    <button type="button" class={`os-nav-item${x.id === page ? " on" : ""}`} aria-current={x.id === page ? "page" : undefined} onClick={() => goPage(x.id)} data-office-page-link={x.id} {...(changes[x.id] > 0 ? { "data-office-page-unsaved": "" } : {})}>
                      <span class="os-nav-name">
                        {x.name}
                        {problems[x.id] > 0 ? (
                          <span class="os-dot bad" title="直す所があります" data-office-page-problem={x.id}>
                            <span class="vh">（直す所があります）</span>
                          </span>
                        ) : changes[x.id] > 0 ? (
                          <span class="os-dot" title="保存していない変更があります">
                            <span class="vh">（保存していない変更があります）</span>
                          </span>
                        ) : null}
                      </span>
                      <small class="os-nav-sum" data-office-page-summary={x.id}>
                        {pageSummary(x.id, d)}
                      </small>
                      {b !== null ? <small class="os-nav-badge">{b}</small> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div class="os-nav-row" data-office-toc-row>
            <label for="os-page-pick">画面</label>
            <select id="os-page-pick" value={page} onChange={(e) => goPage((e.currentTarget as HTMLSelectElement).value as OfficePageId)} data-office-page-pick>
              {shownPages.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                  {problems[x.id] > 0 ? "（直す所あり）" : changes[x.id] > 0 ? "（保存していない変更あり）" : ""}
                </option>
              ))}
            </select>
          </div>
          <div class="os-main" ref={main}>
            {shownPages.map((x) => (
              <div key={x.id} class="os-page" role="region" aria-labelledby={`os-page-${x.id}`} hidden={x.id !== page} data-office-page={x.id}>
                <div class="os-page-h">
                  <h3 id={`os-page-${x.id}`} class="os-page-title">
                    {x.name}
                    {PAGE_TEXT[x.id].help !== undefined ? <Help label={x.name}>{PAGE_TEXT[x.id].help}</Help> : null}
                  </h3>
                  <p class="os-lead">{PAGE_TEXT[x.id].lead}</p>
                </div>
                {pageBody(x.id)}
                {RESETTABLE.includes(x.id) ? (
                  <p class="os-page-reset">
                    <button type="button" class="link-btn" onClick={() => resetPage(x.id)} data-office-page-reset={x.id}>
                      この画面を既定に戻す
                    </button>
                    <span class="os-note">（提供元の既定。下の「保存」で決まります）</span>
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
        <div class="ip-foot os-foot" role={leaving ? "alert" : undefined} data-office-foot={leaving ? "leaving" : "normal"}>
          {leaving ? (
            <>
              <p class="ip-note warn" data-office-leave>
                保存していない変更があります（{unsavedText}）。閉じると、この変更は消えます。
              </p>
              <button type="button" class="btn" onClick={() => setLeaving(false)} data-office-leave-back>
                設定を続ける
              </button>
              <button type="button" class="btn danger" onClick={discard} data-office-discard>
                変更を捨てて閉じる
              </button>
              <button
                type="button"
                class="btn primary"
                disabled={bad || busy}
                onClick={() =>
                  void save().then((ok) => {
                    if (ok) onClose();
                  })
                }
                data-office-save-close
              >
                保存して閉じる
              </button>
            </>
          ) : (
            <>
              {problemPages.length > 0 ? (
                <p class="ip-note warn" role="alert" data-office-problems>
                  直す所があります:{" "}
                  {problemPages.map((x, i) => (
                    <span key={x.id}>
                      {i > 0 ? "・" : ""}
                      <button type="button" class="link-btn" onClick={() => goPage(x.id)} data-office-problem-page={x.id}>
                        {x.name}（{problems[x.id]}か所）
                      </button>
                    </span>
                  ))}
                </p>
              ) : msg !== null && !dirty ? (
                <p class={`ip-note${msg.ok ? "" : " warn"}`} role={msg.ok ? "status" : "alert"} data-office-settings-msg>
                  {msg.text}
                </p>
              ) : (
                <p class="ip-note" data-office-unsaved={dirty ? "" : undefined}>
                  {msg !== null && !msg.ok ? <span class="os-foot-bad" role="alert" data-office-settings-msg>{msg.text}</span> : null}
                  {dirty ? `保存していない変更: ${unsavedText}` : "どの画面で変えた所も、「保存」でまとめて保存します。"}
                </p>
              )}
              <button type="button" class="btn" onClick={dirty ? discard : onClose} data-office-cancel>
                {dirty ? "キャンセル" : "閉じる"}
              </button>
              <HelpOf
                help={
                  <Help label="保存" id="office-save" target="保存">
                    {SAVE_HELP}
                  </Help>
                }
              >
                <button type="button" class="btn primary" disabled={!dirty || bad || busy} onClick={() => void save()} data-office-settings-save>
                  保存
                </button>
              </HelpOf>
            </>
          )}
        </div>
      </div>
    </>
  );
}
