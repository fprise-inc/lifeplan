// 事務所の既定値の画面「結果と万一の画面」（0261）: 対策に最初から出す項目（0084）・結果のタブと資産と負債のタブの表示の設定（0213 の段C・0216）・
// 万一のときのタブ（0085。場面の帯・開いたときの場面・想定の前提に最初から出す項目・必要保障額の数え方）。
// AI からの表示の設定の案（0215）も、この画面のいちばん上に出す
import type { ComponentChildren } from "preact";
import { HORIZON_KINDS, PROTECTION_METHODS } from "../contingency/inputs.ts";
import { OPEN_SCENES, PREMISE_KINDS, premiseStarts, SCENE_KINDS, sceneShown, withPremiseStart, type OpenScene, type PremiseKind, type ProtectionSetting } from "../contingency/premiseChoice.ts";
import type { ScenarioKind } from "../contingency/requests.ts";
import { LEVER_KINDS, startsWith, withStart, type LeverKind } from "../plans/leverChoice.ts";
import { officeDisplayOf } from "../settings.ts";
import { DisplayDefaultsSection } from "./DisplayDefaultsSection.tsx";
import { protectionAge } from "./formText.ts";
import { CheckField, NumField, OfficeGroup, OfficeSection, SelectField } from "./OfficeFields.tsx";
import { withOfficeDisplay, type OfficeSettings } from "./settings.ts";

export interface ResultsPageProps {
  s: OfficeSettings;
  texts: Readonly<Record<string, string>>;
  onS: (f: (s: OfficeSettings) => OfficeSettings) => void;
  onText: (key: string, v: string) => void;
  /** AI からの表示の設定の案（あれば、いちばん上） */
  proposals?: ComponentChildren;
}

export function ResultsPage({ s, texts, onS, onText, proposals }: ResultsPageProps) {
  const setStart = (k: LeverKind, on: boolean) => onS((x) => ({ ...x, levers: withStart(x.levers, k, on) }));
  const leverGroups = [...new Set(LEVER_KINDS.map((k) => k.group))];
  const setPremise = (k: PremiseKind, on: boolean) => onS((x) => ({ ...x, premises: withPremiseStart(x.premises, k, on) }));
  const setScene = (k: ScenarioKind, on: boolean) =>
    onS((x) => {
      const hidden = SCENE_KINDS.map((y) => y.kind as ScenarioKind).filter((y) => (y === k ? !on : !sceneShown(x.scenes, y)));
      const { hidden: _h, ...rest } = x.scenes;
      void _h;
      return { ...x, scenes: { ...rest, ...(hidden.length > 0 ? { hidden } : {}) } };
    });
  const setOpen = (o: OpenScene) =>
    onS((x) => {
      const { open: _o, ...rest } = x.scenes;
      void _o;
      return { ...x, scenes: { ...rest, ...(o !== "death:self" ? { open: o } : {}) } };
    });
  const shownScenes = SCENE_KINDS.filter((k) => sceneShown(s.scenes, k.kind));
  const prot = s.protection;
  const setProt = (p: ProtectionSetting) => onS((x) => ({ ...x, protection: p }));
  return (
    <>
      {proposals}
      <OfficeSection
        id="os-levers"
        title="対策に最初から出す項目"
        help="ほかの項目は、対策の「＋ 動かす項目を追加」でその場で足せます。外した項目も、プランで値を変えていれば出ます。ローン・口座ごとの項目は、その世帯のローン・口座すべてに出ます（該当する物が無い世帯には出ません）。FP顧問料は、既定では出しません。ここで選ぶと、契約がある世帯に出ます（出さなくても計算は変わらず、プランで入れていれば顧問料は入ります）。"
        lead="結果の画面の対策に、どの世帯でも最初から出す項目です（どの世帯にもすぐ効きます）。"
        data={{ "data-office-levers": "" }}
      >
        {leverGroups.map((g) => (
          <OfficeGroup key={g} title={g === "よく使う" ? "よく使う項目" : g} class="os-lever-group">
            <div class="os-checks">
              {LEVER_KINDS.filter((k) => k.group === g).map((k) => (
                <CheckField key={k.kind} name={`lever.${k.kind}`} label={k.label} checked={startsWith(s.levers, k.kind)} onChange={(on) => setStart(k.kind, on)} note={"note" in k ? k.note : null} data={{ "data-office-lever-show": k.kind }} wrapData={{ "data-office-lever": k.kind }} />
              ))}
            </div>
          </OfficeGroup>
        ))}
        <p class="os-acts">
          <button type="button" class="link-btn" onClick={() => onS((x) => ({ ...x, levers: {} }))} data-office-levers-reset>
            既定に戻す
          </button>
        </p>
      </OfficeSection>
      <DisplayDefaultsSection value={officeDisplayOf(s.display)} onChange={(d) => onS((x) => withOfficeDisplay(x, d))} />
      <OfficeSection
        id="os-cg"
        title="万一のときのタブ"
        help="場面の帯・開いたときの場面・想定の前提に最初から出す項目は、どの世帯にもすぐ効きます（世帯ごとには選びません）。必要保障額の数え方は、これから作る世帯に写します。"
        lead="場面と最初から出す項目はどの世帯にもすぐ効き、必要保障額の数え方はこれから作る世帯に写します。"
        data={{ "data-office-contingency": "" }}
      >
        <OfficeGroup title="場面の帯に並べる場面" data={{ "data-office-scenes": "" }}>
          <div class="os-checks">
            {SCENE_KINDS.map((k) => {
              const on = sceneShown(s.scenes, k.kind);
              const last = on && shownScenes.length === 1;
              return <CheckField key={k.kind} name={`scene.${k.kind}`} label={k.label} checked={on} disabled={last} onChange={(v) => setScene(k.kind, v)} {...(last ? { title: "1つは並べます" } : {})} data={{ "data-office-scene-show": k.kind }} wrapData={{ "data-office-scene": k.kind }} />;
            })}
          </div>
          <div class="os-fields os-cols2 os-gap-top">
            <SelectField
              name="openScene"
              label="開いたときに選んでおく場面"
              value={(s.scenes.open ?? "death:self") as OpenScene}
              options={OPEN_SCENES.map((o) => ({ value: o.key as OpenScene, label: o.label }))}
              onPick={setOpen}
              help="その世帯で最後に見た場面があれば、そちらを出します。世帯に無い場面・並べない場面のときは、並べる場面の最初です。"
              data={{ "data-office-open-scene": "" }}
            />
          </div>
        </OfficeGroup>
        <OfficeGroup title="想定の前提に最初から出す項目" help="選んでいる場面の項目だけが出ます。ほかの項目は、想定の前提の「＋ 動かす項目を追加」でその場で足せます。外した項目も、値を変えていれば出ます。世帯に合わない項目（配偶者がいない世帯の配偶者の働き方など）は出ません。" data={{ "data-office-premises": "" }}>
          {SCENE_KINDS.map((g) => (
            <div class="os-check-group" key={g.kind}>
              <h6 class="os-sub-h">{g.label}</h6>
              <div class="os-checks">
                {PREMISE_KINDS.filter((k) => k.scene === g.kind).map((k) => (
                  <CheckField key={k.kind} name={`premise.${k.kind}`} label={k.label} checked={premiseStarts(s.premises, k.kind)} onChange={(on) => setPremise(k.kind, on)} note={"note" in k ? k.note : null} data={{ "data-office-premise-show": k.kind }} wrapData={{ "data-office-premise": k.kind }} />
                ))}
              </div>
            </div>
          ))}
          <p class="os-acts">
            <button type="button" class="link-btn" onClick={() => onS((x) => ({ ...x, premises: {}, scenes: {} }))} data-office-contingency-reset>
              場面と項目を既定に戻す
            </button>
          </p>
        </OfficeGroup>
        <OfficeGroup title="必要保障額の数え方" help="これから作る世帯の前提に写します。作った世帯はその世帯の値のまま計算し、事務所の値と違えば万一のときのタブの想定の前提の下に出ます（そこで事務所の値にできます）。" data={{ "data-office-protection": "" }}>
          <div class="os-fields os-cols2">
            <SelectField
              name="horizon"
              label="いつまでの資金を数えるか"
              value={prot.horizon?.kind ?? "lifeExpectancy"}
              options={HORIZON_KINDS.map((o) => ({ value: o.value, label: o.label }))}
              onPick={(kind) => {
                const { horizon: _h, ...rest } = prot;
                void _h;
                setProt(kind === "lifeExpectancy" ? rest : { ...rest, horizon: { kind: kind as NonNullable<ProtectionSetting["horizon"]>["kind"] } });
              }}
              help="既定は配偶者の平均余命まで（配偶者がいなければ末子の独立まで）です。"
              data={{ "data-office-horizon": "" }}
            />
            {prot.horizon?.kind === "age" ? (
              <NumField
                name="horizonAge"
                label="配偶者の年齢"
                value={texts.horizonAge ?? ""}
                onInput={(v) => onText("horizonAge", v)}
                suffix="歳"
                numeric
                help="50〜110歳で入れます。"
                problem={protectionAge(texts.horizonAge, false) === undefined ? "50〜110歳の整数で入れてください" : null}
                data={{ "data-office-horizon-age": "" }}
              />
            ) : null}
            <SelectField
              name="method"
              label="出し方"
              value={prot.protection?.method ?? "accumulation"}
              options={PROTECTION_METHODS.map((o) => ({ value: o.value, label: o.label }))}
              onPick={(m) => {
                const { protection: _p, ...rest } = prot;
                void _p;
                setProt(m === "reverse" ? { ...rest, protection: { method: "reverse" } } : rest);
              }}
              help="積み上げ方式は、遺族の支出から収入と一時の資金を引いた不足の累計。逆算方式は、遺族の資産が決めた年齢まで尽きないのに要る額です。"
              data={{ "data-office-method": "" }}
            />
            {prot.protection?.method === "reverse" ? (
              <NumField
                name="reverseAge"
                label="遺族が何歳になるまで資産が尽きないようにするか"
                value={texts.reverseAge ?? ""}
                onInput={(v) => onText("reverseAge", v)}
                suffix="歳"
                placeholder="平均余命"
                numeric
                help="入れなければ遺族の平均余命まで（遺族が子なら末子の独立まで）です。50〜110歳で入れます。"
                note="空欄: 平均余命まで"
                problem={protectionAge(texts.reverseAge, true) === undefined ? "50〜110歳の整数で入れてください" : null}
                data={{ "data-office-reverse-age": "" }}
              />
            ) : null}
          </div>
        </OfficeGroup>
      </OfficeSection>
    </>
  );
}
