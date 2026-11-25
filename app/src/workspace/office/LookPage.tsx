// 事務所の既定値の画面「事務所の見た目と機能」（0261）: 事務所の見た目（0121）・法人経営者向けの機能（0107）・機能を有効にするコード（0110・0015 の追記）。
// 見た目と「合算BS を使う」の印は、ほかの画面と同じく下の帯の「保存」でまとめて保存する。コードを入れる・外す・AI からの候補を入れるは、
// 押すとすぐ効く（コードの確かめは本体。事務所の既定値の欄ではないので、保存のボタンは要らない）
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { BrandingSection } from "./BrandingSection.tsx";
import type { OfficeBranding, OfficeLogo } from "./branding.ts";
import { candidateChange, checkText, codeFor, enabledLine, expiredText, expiresLabel, FEATURE_LABELS, featureErrorText, featureOn, NOTICE_FADE_TEXT, noticeCodes, receivedAtText, renewText, type FeatureId, type FeatureStatus } from "./featureCodes.ts";
import { CheckField, OfficeGroup, OfficeSection } from "./OfficeFields.tsx";

export interface CodeActions {
  /** コードを入れる（本体が確かめる。断るときは E_FEATURE_CODE_… の符号）。入れるとすぐ効く */
  onAddCode?: (code: string) => Promise<FeatureStatus>;
  /** コードを外す（ref は状態の印） */
  onRemoveCode?: (ref: string) => Promise<FeatureStatus>;
  /** 期限の切れた・止めたコードの知らせを閉じる（ref は状態の印。コードは外さない） */
  onDismissNotice?: (ref: string) => Promise<FeatureStatus>;
  /** 提供元が止めたコードの一覧を今すぐ確かめる（0110 の追記） */
  onCheckCodes?: () => Promise<FeatureStatus>;
  /** AIから届いたコードの候補を入れる（accept）か捨てる（0015 の追記の2段目） */
  onDecideCandidate?: (id: string, accept: boolean) => Promise<FeatureStatus>;
}

export interface LookPageProps extends CodeActions {
  /** 事務所の見た目（無ければ区画を出さない） */
  brand: { draft: OfficeBranding; saved: OfficeBranding; onDraft: (b: OfficeBranding) => void; onPickLogo: () => Promise<OfficeLogo | null> } | null;
  shared: boolean;
  features: FeatureStatus;
  /** 「合算BS を使う」の印（保存前の値） */
  combinedBs: boolean;
  onCombinedBs: (on: boolean) => void;
}

/** 区画の頭の1文（ほかの区画と同じ形） */
const Lead = ({ children }: { children: ComponentChildren }) => <p class="os-lead">{children}</p>;

export function LookPage(p: LookPageProps) {
  const { features } = p;
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeText, setCodeText] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeMsg, setCodeMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const combinedCode = codeFor(features, "combinedBs");
  const addCode = async () => {
    setCodeBusy(true);
    setCodeMsg(null);
    try {
      if (p.onAddCode === undefined) return;
      const st = await p.onAddCode(codeText);
      const added = (Object.keys(FEATURE_LABELS) as FeatureId[]).filter((f) => featureOn(st, f) && !featureOn(features, f));
      // 新しく使えるようになった機能は、印も付けた状態で区画を出す（印は区画の中で外せる。App が事務所データにも書く）
      if (added.includes("combinedBs")) p.onCombinedBs(true);
      const c = codeFor(st, "combinedBs");
      setCodeText("");
      setCodeOpen(false);
      setCodeMsg({ ok: true, text: c !== null ? `コードを入れました。${FEATURE_LABELS.combinedBs}を使えます（${enabledLine(c)}）。上の区画に出ています（保存は要りません）。` : "コードを入れました。" });
    } catch (e) {
      setCodeMsg({ ok: false, text: featureErrorText(e) });
    } finally {
      setCodeBusy(false);
    }
  };
  const decideCandidate = async (id: string, accept: boolean) => {
    setCodeBusy(true);
    setCodeMsg(null);
    try {
      if (p.onDecideCandidate === undefined) return;
      const st = await p.onDecideCandidate(id, accept);
      if (accept && featureOn(st, "combinedBs") && !featureOn(features, "combinedBs")) p.onCombinedBs(true);
      const c = codeFor(st, "combinedBs");
      setCodeMsg({ ok: true, text: !accept ? "AIからの候補を捨てました（コードは入れていません）。" : c !== null ? `AIからの候補のコードを入れました。${FEATURE_LABELS.combinedBs}を使えます（${enabledLine(c)}）。上の区画に出ています（保存は要りません）。` : "AIからの候補のコードを入れました。" });
    } catch (e) {
      setCodeMsg({ ok: false, text: featureErrorText(e) });
    } finally {
      setCodeBusy(false);
    }
  };
  const checkCodes = async () => {
    setCodeBusy(true);
    try {
      if (p.onCheckCodes !== undefined) await p.onCheckCodes();
      setCodeMsg({ ok: true, text: "提供元が止めたコードの一覧を確かめに行きました。結果は少しあとに、この下に出ます。" });
    } catch (e) {
      setCodeMsg({ ok: false, text: featureErrorText(e) });
    } finally {
      setCodeBusy(false);
    }
  };
  const removeCode = async (ref: string) => {
    setCodeBusy(true);
    setCodeMsg(null);
    try {
      if (p.onRemoveCode === undefined) return;
      await p.onRemoveCode(ref);
      setRemoving(null);
      setCodeMsg({ ok: true, text: "コードを外しました。世帯に入れたデータは消していません。" });
    } catch (e) {
      setCodeMsg({ ok: false, text: featureErrorText(e) });
    } finally {
      setCodeBusy(false);
    }
  };
  const dismissNotice = async (ref: string) => {
    setCodeBusy(true);
    setCodeMsg(null);
    try {
      if (p.onDismissNotice !== undefined) await p.onDismissNotice(ref);
    } catch (e) {
      setCodeMsg({ ok: false, text: featureErrorText(e) });
    } finally {
      setCodeBusy(false);
    }
  };
  return (
    <>
      {p.brand !== null ? <BrandingSection draft={p.brand.draft} saved={p.brand.saved} onDraft={p.brand.onDraft} onPickLogo={p.brand.onPickLogo} shared={p.shared} /> : null}
      {featureOn(features, "combinedBs") ? (
        <OfficeSection
          id="os-corp"
          title="法人経営者向けの機能"
          help="法人を顧問先に持つ FP 向けの機能です。既定では使いません。使うと決めたときだけ、役員として働く人のいる世帯に出ます（ほかの世帯の画面は変わりません）。どれも見せ方だけで、計算の結果は変わりません。資産と負債のタブの「見るもの」に「合算BS」が加わり、会社の試算表の数字を入れて、経営者個人（家計）と会社のバランスシートを並べ・相殺し・合算できます。提案書にも章を選んで載せられます。試しの機能です。"
          lead="使うと決めたときだけ、役員として働く人のいる世帯に出ます。"
          data={{ "data-office-features": "" }}
        >
          <OfficeGroup>
            <div class="os-checks os-checks-wide">
              <CheckField name="combinedBs" label="合算BS（経営者個人と会社のバランスシート）を使う" checked={p.combinedBs} onChange={p.onCombinedBs} data={{ "data-office-feature": "combinedBs" }} />
            </div>
            {combinedCode !== null ? (
              <p class="os-feat-on" data-feature-enabled="combinedBs">
                {enabledLine(combinedCode)}
                {removing === combinedCode.ref ? null : (
                  <button type="button" class="link-btn" onClick={() => setRemoving(combinedCode.ref)} data-feature-remove-ask>
                    コードを外す
                  </button>
                )}
              </p>
            ) : null}
            {combinedCode !== null && removing === combinedCode.ref ? (
              <p class="rp-note os-ask" data-feature-remove-confirm>
                <span>外すと、この区画と合算BS の画面・提案書の章は出なくなります（世帯に入れた会社の数字は消しません。コードを入れ直すと戻ります）。</span>
                <span class="os-ask-acts">
                  <button type="button" class="link-btn danger" disabled={codeBusy} onClick={() => void removeCode(combinedCode.ref)} data-feature-remove-go>
                    外す
                  </button>
                  <button type="button" class="link-btn" onClick={() => setRemoving(null)} data-feature-remove-cancel>
                    やめる
                  </button>
                </span>
              </p>
            ) : null}
            {combinedCode !== null && renewText(combinedCode) !== null ? (
              <p class="rp-note os-feat-renew" role="status" data-feature-renew="combinedBs">
                {renewText(combinedCode)}
              </p>
            ) : null}
          </OfficeGroup>
        </OfficeSection>
      ) : null}
      {p.onAddCode !== undefined ? (
        <OfficeSection
          id="os-code"
          title="機能を有効にするコード"
          help="受け取ったコードを入れると、その機能が使えるようになります。本物か・期限内かは、この PC の中で確かめます。入れるとすぐ効きます（保存のボタンは押さなくてかまいません）。コードを入れている間は、提供元が止めたコードかどうかを、起動したときと1日1回、配信元の一覧で確かめます（送るのは一覧を取る依頼だけで、コード・お名前・世帯の情報は送りません。つながらないときは今のまま使えます）。"
          data={{ "data-feature-code-area": "" }}
        >
          <Lead>入れるとすぐ効きます（保存は要りません）。</Lead>
          <div class="os-code">
            {(features.candidates ?? []).map((c) => (
              <div class="os-code-cand" key={c.id} role="group" aria-label="AIからの、機能を有効にするコードの候補" data-feature-candidate={c.id}>
                <p class="os-code-cand-title">
                  <b>AIからの候補: 機能を有効にするコードを入れる</b>
                  <span class="pl-sub">
                    {receivedAtText(c.receivedAt)} に届きました{c.connector !== null ? `（AIのアプリの名乗り: ${c.connector}。確かめられない参考の情報です）` : ""}
                  </span>
                </p>
                {c.ok ? (
                  <>
                    <p class="pl-sub">
                      {c.name}さん向け・{expiresLabel(c.expires)}
                      {c.replaces > 0 ? `。入れると、今のコード（更新の前のもの）${c.replaces}件は外れます` : ""}
                    </p>
                    <table class="os-code-diff" data-feature-candidate-diff>
                      <thead>
                        <tr>
                          <th scope="col">機能</th>
                          <th scope="col">今</th>
                          <th scope="col">入れた後</th>
                        </tr>
                      </thead>
                      <tbody>
                        {candidateChange(c).map((d) => (
                          <tr key={d.feature}>
                            <th scope="row">{d.feature}</th>
                            <td>{d.before ? "使える" : "使えない"}</td>
                            <td class={d.before !== d.after ? "os-code-diff-new" : undefined}>{d.after ? "使える" : "使えない"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p class="pl-sub">AIが出したのは候補だけです。中身を確かめて、入れてよいときだけ押してください（世帯のデータは変わりません）。</p>
                  </>
                ) : (
                  <p class="fatal" data-feature-candidate-error>
                    このコードは入れられません。{featureErrorText(c.error ?? "")}
                  </p>
                )}
                <div class="rp-actions">
                  {c.ok ? (
                    <button type="button" class="btn primary" disabled={codeBusy} onClick={() => void decideCandidate(c.id, true)} data-feature-candidate-accept>
                      このコードを入れる
                    </button>
                  ) : null}
                  <button type="button" class="btn" disabled={codeBusy} onClick={() => void decideCandidate(c.id, false)} data-feature-candidate-reject>
                    捨てる
                  </button>
                </div>
              </div>
            ))}
            {noticeCodes(features).map((c) => (
              <div class="pl-sub os-code-expired" key={c.ref} data-feature-expired={c.ref} {...(c.state === "revoked" ? { "data-feature-revoked": c.ref } : {})}>
                <p>
                  {expiredText(c)}
                  {NOTICE_FADE_TEXT}
                </p>
                <span class="os-code-expired-actions">
                  {p.onDismissNotice !== undefined ? (
                    <button type="button" class="link-btn" disabled={codeBusy} onClick={() => void dismissNotice(c.ref)} data-feature-notice-dismiss={c.ref}>
                      閉じる
                    </button>
                  ) : null}
                  <button type="button" class="link-btn" disabled={codeBusy} onClick={() => void removeCode(c.ref)}>
                    このコードを外す
                  </button>
                </span>
              </div>
            ))}
            {features.invalid.map((c) => (
              <p class="pl-sub os-code-expired" key={c.ref} data-feature-invalid={c.ref}>
                このアプリでは確かめられないコードが入っています（{c.error}）。新しいコードを受け取って入れ直してください。
                <button type="button" class="link-btn" disabled={codeBusy} onClick={() => void removeCode(c.ref)}>
                  このコードを外す
                </button>
              </p>
            ))}
            {codeMsg !== null ? (
              <p class={codeMsg.ok ? "rp-note" : "fatal"} role="status" data-feature-code-msg>
                {codeMsg.text}
              </p>
            ) : null}
            {features.codes.length > 0 && checkText(features.check) !== null ? (
              <p class="pl-sub os-code-check" data-feature-check={features.check?.result ?? "none"}>
                {checkText(features.check)}
                {p.onCheckCodes !== undefined ? (
                  <button type="button" class="link-btn" disabled={codeBusy} onClick={() => void checkCodes()} data-feature-check-now>
                    今すぐ確かめる
                  </button>
                ) : null}
              </p>
            ) : null}
            {codeOpen ? (
              <div class="os-code-form">
                <div class="fld">
                  <div class="fld-l">
                    <label for="os-f-featureCode">機能を有効にするコード</label>
                  </div>
                  <textarea id="os-f-featureCode" class="os-code-text" rows={3} value={codeText} spellcheck={false} autoComplete="off" onInput={(e) => setCodeText((e.currentTarget as HTMLTextAreaElement).value)} data-feature-code-input />
                  <div class="fld-help">受け取ったコードを、そのまま貼り付けてください（途中に改行が入っていてもかまいません）</div>
                </div>
                <div class="rp-actions">
                  <button type="button" class="btn primary" disabled={codeBusy || codeText.trim() === ""} onClick={() => void addCode()} data-feature-code-add>
                    確かめて入れる
                  </button>
                  <button
                    type="button"
                    class="btn"
                    onClick={() => {
                      setCodeOpen(false);
                      setCodeText("");
                    }}
                    data-feature-code-cancel
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            ) : (
              <p class="os-acts">
                <button
                  type="button"
                  class="add-btn"
                  onClick={() => {
                    setCodeOpen(true);
                    setCodeMsg(null);
                  }}
                  data-feature-code-open
                >
                  機能を有効にするコードを入れる
                </button>
              </p>
            )}
          </div>
        </OfficeSection>
      ) : null}
    </>
  );
}
