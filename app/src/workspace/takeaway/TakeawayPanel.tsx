// 提案書のタブの「持ち帰り用のレポート」（作業の層。0030）: 顧客に渡す HTML ファイル1つを作って保存する。
// - 左: 載せるプラン（現状＋FP の提案＋比べるプラン）・顧客が動かせるつまみ（既定は結果の画面の対策と同じ全部。外したいものを外す）・
//   載せる画面（グラフはいつも。資産と負債の図・キャッシュフロー表の要約）・宛名と事務所名（任意。保存しない）・開くときのパスワード（任意。保存しない）
// - 右: 顧客が開いたときと同じ画面の見本（同じ部品 TakeawayView。計算は画面側のエンジン）
// - 保存は本体の平文の書き出しの出口（0020 の5）。パスワードなしのときは毎回、平文の注意を出す。保存したら控え（きっかけ「持ち帰り用のレポート」）を残す
import { useContext, useEffect, useMemo, useState } from "preact/hooks";
import { OfficeNamesContext, rowNamesOf } from "../office/customTexts.ts";
import { webEngine, type HostApi, type SaveOutcome } from "../../engine/host.ts";
import type { MoneyThreeSettings } from "../../presentation/model.ts";
import type { TakeawayData, TakeawayLeverKey } from "../../takeaway/model.ts";
import { TakeawayView } from "../../takeaway/viewer/TakeawayView.tsx";
import type { WorkingHousehold } from "../input/household.ts";
import { hasAdvisoryFee } from "../levers.ts";
import { CURRENT } from "../plans/band.ts";
import type { Catalog } from "../plans/items.ts";
import type { Values } from "../plans/plans.ts";
import { today } from "../report/assemble.ts";
import type { SnapshotDraft } from "../snapshots/snapshots.ts";
import { buildPayload, dataSetLabel, type TakeawayChoice, type TakeawayKnob } from "./build.ts";
import { loadAssets, makeTakeawayFile } from "./file.ts";
import { DEFAULT_MONEY_THREE } from "../moneyThree.ts";

interface Props {
  host: HostApi;
  wh: WorkingHousehold;
  catalog: Catalog;
  band: string[];
  base: string;
  selected: string;
  valuesOf: (id: string) => Values;
  letterOf: (id: string) => { letter: string; name: string };
  targetAge: number;
  /** お金の3つの分け方の何か月分・何年先まで・呼び方（資産と負債のタブの表示の設定。0032） */
  moneyThree?: MoneyThreeSettings;
  onSnapshot?: (d: SnapshotDraft) => Promise<void>;
}

/** 事務所名（アプリを開いている間だけ覚える。事務所の設定ができたらそこから読む） */
const remembered = { office: "" };

/** パスワードの最低の長さ */
export const PASSWORD_MIN = 8;
/** 作るパスワードの文字（見間違えやすい 0/O・1/l/I は使わない） */
const PW_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";

/** 乱数のパスワード（4文字ずつ3つ。例: k7pr-mx3a-9tqe） */
export function makePassword(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const out: string[] = [];
  // 偏りが出ないように、文字の数の倍数に収まる値だけを使う
  const limit = 256 - (256 % PW_CHARS.length);
  while (out.length < 12) for (const b of random(16)) if (b < limit && out.length < 12) out.push(PW_CHARS[b % PW_CHARS.length] as string);
  return `${out.slice(0, 4).join("")}-${out.slice(4, 8).join("")}-${out.slice(8).join("")}`;
}

const KNOB_LABEL: Record<TakeawayKnob, string> = { retireAge: "働く最後の年齢", pensionAge: "年金の受け取り開始", nisaMonthly: "NISAの積立額", livingMonthly: "毎月の生活費", fee: "FP顧問料の入れる・入れない" };
const KB = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)}MB` : `${Math.round(n / 1024)}KB`);

type Status = { kind: "idle" } | { kind: "busy"; step: string } | { kind: "error"; code: string };

export function TakeawayPanel(p: Props) {
  const slots = [CURRENT, ...p.band];
  const firstProposal = p.selected !== CURRENT ? p.selected : (p.band[0] ?? CURRENT);
  const [proposal, setProposal] = useState(firstProposal);
  const [compare, setCompare] = useState<string[]>(slots);
  const [excluded, setExcluded] = useState<Set<TakeawayKnob>>(new Set());
  const [views, setViews] = useState({ balance: true, table: true, moneyThree: true });
  const m3 = p.moneyThree ?? DEFAULT_MONEY_THREE;
  const [addressee, setAddressee] = useState("");
  const [office, setOffice] = useState(remembered.office);
  const [usePw, setUsePw] = useState(false);
  const [password, setPassword] = useState("");
  const [dataSet, setDataSet] = useState<string | null>(null);
  const [packsJson, setPacksJson] = useState<string | null>(null);
  const [warn, setWarn] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [saved, setSaved] = useState<(SaveOutcome & { bytes: number; pruned: boolean }) | null>(null);
  const engine = webEngine();

  useEffect(() => {
    if (!slots.includes(proposal) || proposal === CURRENT) setProposal(firstProposal);
    setCompare((c) => c.filter((id) => slots.includes(id)));
  }, [p.band.join(","), p.selected]);
  useEffect(() => {
    let alive = true;
    void p.host.packs().then(async (j) => {
      if (!alive) return;
      setPacksJson(j);
      const label = await dataSetLabel(p.wh.request.input.baseMonth, j);
      if (alive) setDataSet(label);
    });
    return () => {
      alive = false;
    };
  }, [p.host, p.wh.request.input.baseMonth]);
  useEffect(() => {
    remembered.office = office;
  }, [office]);

  const knobs: TakeawayKnob[] = [...(["retireAge", "pensionAge", "nisaMonthly", "livingMonthly"] as TakeawayLeverKey[]).filter((k) => p.catalog.byKey.has(`lever:${k}`)), ...(hasAdvisoryFee(p.wh.request) && p.catalog.byKey.has("lever:fee") ? (["fee"] as const) : [])];
  // 表の行の事務所の名前（カスタム層。承認した物だけ）。持ち帰り用のレポートでも画面と同じ名前にする
  const rowNames = rowNamesOf(useContext(OfficeNamesContext));
  const choice: TakeawayChoice = { proposal, compare, base: p.base, band: p.band, excluded, views, moneyThree: m3, addressee, office, targetAge: p.targetAge, createdOn: today(), dataSet: dataSet ?? "", ...(rowNames !== undefined ? { names: rowNames } : {}) };
  const ctx = { wh: p.wh, catalog: p.catalog, valuesOf: p.valuesOf, letterOf: p.letterOf };
  const payload = useMemo(() => (proposal === CURRENT ? null : buildPayload(ctx, choice)), [p.wh, p.catalog, proposal, compare.join(","), p.base, p.band.join(","), [...excluded].join(","), views.balance, views.table, views.moneyThree, m3.months, m3.years, m3.wording, addressee, office, p.targetAge, dataSet, JSON.stringify(rowNames ?? null), ...slots.map((id) => JSON.stringify(p.valuesOf(id)))]);
  const preview: TakeawayData | null = useMemo(() => (payload === null || packsJson === null ? null : { payload, packs: JSON.parse(packsJson) as unknown[] }), [payload, packsJson]);
  const pwOk = !usePw || password.length >= PASSWORD_MIN;
  const busy = status.kind === "busy";
  const canSave = payload !== null && dataSet !== null && packsJson !== null && engine !== null && pwOk && !busy;

  const doSave = async () => {
    setWarn(false);
    if (payload === null || packsJson === null || engine === null) return;
    setSaved(null);
    try {
      setStatus({ kind: "busy", step: usePw ? "作成して暗号化しています…" : "作成しています…" });
      const f = await makeTakeawayFile({ payload, engine, packsJson, password: usePw ? password : null, assets: await loadAssets() });
      setStatus({ kind: "busy", step: "保存しています…" });
      const r = await p.host.takeaway.save(f.bytes, { exportedOn: payload.createdOn, encrypted: usePw });
      setSaved({ ...r, bytes: f.sizes.total, pruned: f.packs.pruned });
      setStatus({ kind: "idle" });
      if (r.saved && p.onSnapshot !== undefined) {
        const l = p.letterOf(proposal);
        await p
          .onSnapshot({
            trigger: "takeaway",
            memo: `持ち帰り用のレポート（プラン${payload.plans.length}つ${usePw ? "・パスワードつき" : ""}）`,
            plan: { id: proposal, letter: l.letter, name: l.name },
            takeaway: { plans: payload.plans.map((x) => ({ letter: x.letter, name: x.name })), proposal: payload.proposal, password: usePw, knobs: [...payload.levers.items.map((i) => i.key), ...(payload.levers.fee !== null ? ["fee"] : [])], views: ["chart", ...(views.balance ? ["balance"] : []), ...(views.moneyThree ? ["moneyThree"] : []), ...(views.table ? ["table"] : [])], createdOn: payload.createdOn, digest: r.digest },
          })
          .catch(() => undefined);
      }
    } catch (e) {
      setStatus({ kind: "error", code: typeof e === "string" ? e : e instanceof Error ? e.message : "E_TAKEAWAY" });
    }
  };
  const save = () => (usePw ? void doSave() : setWarn(true));

  return (
    <div class="rp" data-takeaway-tab>
      <section class="card rp-side" aria-label="持ち帰り用のレポートの設定">
        <div class="card-h">
          <h2>持ち帰り用のレポート</h2>
          <span class="aside">ブラウザで開くファイル1つ（.html）</span>
        </div>
        <p class="rp-note">顧客がオフラインで開き、グラフを見て、許したつまみを動かして試せます。データはファイルの中だけで、どこにも送りません。</p>
        <div class="rp-actions">
          <button type="button" class="btn primary" disabled={!canSave} onClick={save} data-takeaway-save>
            ファイルを保存
          </button>
        </div>
        {busy ? (
          <p class="rp-status" role="status" data-takeaway-busy>
            {status.step}
          </p>
        ) : null}
        {status.kind === "error" ? <p class="fatal">作れませんでした（{status.code === "E_EXPORT_FORBIDDEN_DIR" ? "データフォルダ・カスタム層の中には保存できません" : status.code}）</p> : null}
        {engine === null ? <p class="fatal">計算エンジンを読み込めていません。アプリを開き直してください。</p> : null}
        {warn ? (
          <div class="rp-warn" role="alertdialog" aria-label="保存の前の注意" data-export-warn>
            <p>このファイルは暗号化されません。顧客の個人情報（家族の生年月・収入・資産など、計算に使う入力の値）を含みます。送り方と保管は FP の責任です。</p>
            <p class="rp-note">開くときのパスワードを付けると、中身を暗号化します。保存先は書類のフォルダの「ファイナンシア書き出し」が既定です。</p>
            <div class="rp-actions">
              <button type="button" class="btn primary" onClick={() => void doSave()} data-export-ok>
                わかりました。保存する
              </button>
              <button type="button" class="btn" onClick={() => setWarn(false)}>
                キャンセル
              </button>
            </div>
          </div>
        ) : null}
        {saved !== null ? (
          <p class={`rp-note${saved.syncFolder ? " warn" : ""}`} role="status" data-takeaway-saved={saved.saved ? "1" : "0"}>
            {saved.saved
              ? `「${saved.fileName ?? ""}」を保存しました（${KB(saved.bytes)}${saved.pruned ? "" : "・制度データは全部"}）。${saved.syncFolder ? "同期フォルダの中です。共有の範囲に気をつけてください。" : ""}${usePw ? "パスワードは、ファイルとは別の方法（電話・別のメッセージなど）で伝えてください。" : ""}${p.onSnapshot !== undefined ? "この時点の控えを残しました。" : ""}`
              : "保存しませんでした。"}
          </p>
        ) : null}
        <fieldset class="rp-set">
          <legend>載せるプラン</legend>
          <label class="rp-row">
            <span>提案</span>
            <select value={proposal} onChange={(e) => setProposal((e.currentTarget as HTMLSelectElement).value)} data-takeaway-proposal>
              {p.band.map((id) => (
                <option value={id} key={id}>
                  プラン{p.letterOf(id).letter} {p.letterOf(id).name}
                </option>
              ))}
            </select>
          </label>
          <div class="rp-checks" role="group" aria-label="一緒に載せるプラン">
            <span class="rp-sub">一緒に載せるプラン（現状はいつも載せます）</span>
            {slots.map((id) => (
              <label key={id} class="rp-check">
                <input type="checkbox" checked={id === CURRENT || id === proposal || compare.includes(id)} disabled={id === CURRENT || id === proposal} onChange={(e) => setCompare((c) => ((e.currentTarget as HTMLInputElement).checked ? [...c, id] : c.filter((x) => x !== id)))} data-takeaway-compare={p.letterOf(id).letter} />
                プラン{p.letterOf(id).letter} {id === CURRENT ? "現状" : p.letterOf(id).name}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset class="rp-set">
          <legend>顧客が動かせるつまみ</legend>
          <p class="rp-note">結果の画面の対策と同じつまみです。動かしてほしくないものは外してください。</p>
          <div class="rp-checks" role="group" aria-label="顧客が動かせるつまみ">
            {knobs.map((k) => (
              <label key={k} class="rp-check">
                <input
                  type="checkbox"
                  checked={!excluded.has(k)}
                  onChange={(e) =>
                    setExcluded((s) => {
                      const n = new Set(s);
                      if ((e.currentTarget as HTMLInputElement).checked) n.delete(k);
                      else n.add(k);
                      return n;
                    })
                  }
                  data-takeaway-knob={k}
                />
                {KNOB_LABEL[k]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset class="rp-set">
          <legend>載せる画面</legend>
          <div class="rp-checks" role="group" aria-label="載せる画面">
            <label class="rp-check">
              <input type="checkbox" checked disabled />
              資産の推移・収支の推移のグラフ<small>（外せません）</small>
            </label>
            <label class="rp-check">
              <input type="checkbox" checked={views.balance} onChange={(e) => setViews({ ...views, balance: (e.currentTarget as HTMLInputElement).checked })} data-takeaway-view="balance" />
              資産と負債の図
            </label>
            <label class="rp-check">
              <input type="checkbox" checked={views.moneyThree} onChange={(e) => setViews({ ...views, moneyThree: (e.currentTarget as HTMLInputElement).checked })} data-takeaway-view="moneyThree" />
              お金の3つの分け方
              <small>
                （{m3.months}か月分・{m3.years}年先まで。資産と負債のタブの値）
              </small>
            </label>
            <label class="rp-check">
              <input type="checkbox" checked={views.table} onChange={(e) => setViews({ ...views, table: (e.currentTarget as HTMLInputElement).checked })} data-takeaway-view="table" />
              キャッシュフロー表の要約
            </label>
          </div>
        </fieldset>
        <fieldset class="rp-set">
          <legend>宛名と事務所名</legend>
          <label class="rp-row">
            <span>宛名</span>
            <input type="text" value={addressee} maxLength={40} autocomplete="off" placeholder="例: 見本 太郎" onInput={(e) => setAddressee((e.currentTarget as HTMLInputElement).value)} data-takeaway-addressee />
            <span class="rp-unit">様</span>
          </label>
          <label class="rp-row">
            <span>作成</span>
            <input type="text" value={office} maxLength={60} autocomplete="off" placeholder="事務所名（任意）" onInput={(e) => setOffice((e.currentTarget as HTMLInputElement).value)} data-takeaway-office />
          </label>
          <p class="rp-note">宛名と事務所名はファイルに入れるだけで、保存しません。担当の個人の氏名は入れない形をおすすめします。</p>
        </fieldset>
        <fieldset class="rp-set">
          <legend>開くときのパスワード</legend>
          <label class="rp-check">
            <input type="checkbox" checked={usePw} onChange={(e) => setUsePw((e.currentTarget as HTMLInputElement).checked)} data-takeaway-use-password />
            パスワードを付ける（中身を暗号化します。おすすめ）
          </label>
          {usePw ? (
            <>
              <div class="rp-actions">
                <input type="text" class="tk-pw-input" value={password} autocomplete="off" spellcheck={false} aria-label="パスワード" placeholder={`${PASSWORD_MIN}文字以上`} onInput={(e) => setPassword((e.currentTarget as HTMLInputElement).value)} data-takeaway-password-input />
                <button type="button" class="btn" onClick={() => setPassword(makePassword())} data-takeaway-password-make>
                  作る
                </button>
              </div>
              {!pwOk ? <p class="rp-note warn">{PASSWORD_MIN}文字以上にしてください。</p> : null}
              <p class="rp-note">パスワードはファイルにもアプリにも保存しません。忘れると開けません。ファイルとは別の方法（電話・別のメッセージなど）で顧客に伝えてください。</p>
            </>
          ) : null}
        </fieldset>
        <p class="rp-note">注意書き（試算であること・前提・作成日・制度データの版）は、提案書と同じ文をファイルの最後に載せます。</p>
      </section>
      <section class="card rp-view" aria-label="持ち帰り用のレポートの見本">
        {preview === null || engine === null ? (
          <div class="rp-blank">
            <p>{proposal === CURRENT ? "提案のプランを選んでください。" : "見本を用意しています…"}</p>
          </div>
        ) : (
          <div class="tk-frame" data-takeaway-preview>
            <TakeawayView data={preview} engine={engine} preview />
          </div>
        )}
      </section>
    </div>
  );
}
