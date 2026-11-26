// 事務所の既定値の画面「事務所の見た目と機能」の区画「事務所の見た目」（0121）: 事務所の名前・ロゴの画像・基調の色。
// - 変えるとすぐ画面に映す（見本として。パネルが onPreview を呼ぶ）。保存は、ほかの画面と同じく下の帯の「保存」でまとめて（0261。前は区画の
//   「この見た目にする」で別に保存していた）。保存しないで閉じると、前の見た目に戻る。
// - 基調の色は見本から選ぶか、自由に選ぶ。見やすさの足りない色は自動で濃さを直して知らせ、不足の赤・注意の橙・現状の灰と紛れる色は使えない。
// - ロゴの画像は本体のダイアログで選ぶ（PNG・JPEG だけ。本体が確かめる）。画面はバイトをキャンバスに描くだけ
import { useEffect, useState } from "preact/hooks";
import { LogoCanvas } from "../../presentation/LogoCanvas.tsx";
import { BASE_SAMPLES, checkBase, checkText, normalizeHex, STANDARD_BASE } from "../../presentation/theme.ts";
import { brandingErrorText, LOGO_MAX_BYTES, LOGO_MAX_SIDE, NAME_MAX_CHARS, type OfficeBranding, type OfficeLogo } from "./branding.ts";
import { fieldId, OfficeGroup, OfficeSection } from "./OfficeFields.tsx";

/** 本体の側の事務所の見た目（保存した見た目・見本を映す・保存する・ロゴを選ぶ） */
export interface OfficeBrandingHost {
  value: OfficeBranding;
  /** 変えている途中の見た目を画面に映す（null は保存した見た目に戻す） */
  onPreview: (b: OfficeBranding | null) => void;
  /** 保存する（本体が確かめて整えた値を返す） */
  onSave: (b: OfficeBranding) => Promise<OfficeBranding>;
  /** ロゴの画像を選ぶ（本体のダイアログ。選ばなかったら null） */
  onPickLogo: () => Promise<OfficeLogo | null>;
}

export interface BrandingSectionProps {
  /** 変えている途中の見た目 */
  draft: OfficeBranding;
  /** 保存した見た目（「元に戻す」で戻る先） */
  saved: OfficeBranding;
  onDraft: (b: OfficeBranding) => void;
  onPickLogo: () => Promise<OfficeLogo | null>;
  shared: boolean;
}

export function BrandingSection({ draft, saved, onDraft, onPickLogo, shared }: BrandingSectionProps) {
  const [hex, setHex] = useState(draft.color ?? STANDARD_BASE);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // 外から下書きが変わった（保存した・キャンセルした）ときは、番号の欄も合わせる
  useEffect(() => {
    if (normalizeHex(hex) !== (draft.color ?? STANDARD_BASE)) setHex(draft.color ?? STANDARD_BASE);
  }, [draft.color]);
  const color = draft.color ?? STANDARD_BASE;
  const check = checkBase(color);
  const notes = checkText(check);
  const pickColor = (c: string) => {
    // 番号の欄は6桁がそろったときだけ映す（打っている途中の3桁を色にしない）
    const n = /^#[0-9a-fA-F]{6}$/.test(c.trim()) ? c.trim().toLowerCase() : null;
    setHex(c);
    if (n === null) return;
    const { color: _old, ...rest } = draft;
    void _old;
    onDraft(n === STANDARD_BASE ? rest : { ...rest, color: n });
  };
  const setName = (t: string) => {
    const { name: _old, ...rest } = draft;
    void _old;
    onDraft(t.trim() === "" ? rest : { ...rest, name: t.slice(0, NAME_MAX_CHARS) });
  };
  const pickLogo = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const l = await onPickLogo();
      if (l !== null) onDraft({ ...draft, logo: l });
    } catch (e) {
      setMsg(brandingErrorText(typeof e === "string" ? e : e instanceof Error ? e.message : "E_STORE_LOGO"));
    } finally {
      setBusy(false);
    }
  };
  const removeLogo = () => {
    const { logo: _old, ...rest } = draft;
    void _old;
    onDraft(rest);
  };
  const changed = (draft.name ?? "") !== (saved.name ?? "") || (draft.color ?? STANDARD_BASE) !== (saved.color ?? STANDARD_BASE) || (draft.logo?.data ?? "") !== (saved.logo?.data ?? "");
  return (
    <OfficeSection
      id="os-brand"
      title="事務所の見た目"
      help={`左上に出す事務所の名前とロゴ、画面と提案書の基調の色です。選ぶとすぐ画面に映り、下の「保存」で決まります（保存しないで閉じると前の見た目に戻ります）。世帯には写さず、どの世帯にもすぐ効きます。不足の赤・推定の印の橙・済みの緑・グラフのプランごとの色・資産と負債の図の科目の色は、基調の色を変えても変わりません。${shared ? "事務所で共有していても、この PC の設定です。" : "この PC の設定です。"}`}
      lead="選ぶとすぐ画面に映ります（下の「保存」で決まります）。"
      data={{ "data-office-branding": "" }}
    >
      <OfficeGroup>
        <div class="os-fields os-cols2">
          <div class="fld">
            <div class="fld-l">
              <label for={fieldId("brandName")}>事務所の名前</label>
            </div>
            <div class="fld-c">
              <input id={fieldId("brandName")} type="text" class="txt os-brand-name" value={draft.name ?? ""} maxLength={NAME_MAX_CHARS} placeholder="入れなければ「ファイナンシア」" autocomplete="off" onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} data-branding-name />
            </div>
            <div class="fld-help">左上と提案書の表紙に出します（{NAME_MAX_CHARS}文字まで）</div>
          </div>
          <div class="fld">
            <div class="fld-l">
              <span>ロゴの画像</span>
            </div>
            <div class="fld-c os-brand-logo">
              {draft.logo !== undefined ? <LogoCanvas logo={draft.logo} height={32} maxWidth={180} label="選んだロゴ" class="os-logo-prev" /> : <span class="os-logo-none">なし</span>}
              <button type="button" class="btn small" disabled={busy} onClick={() => void pickLogo()} data-branding-logo-pick>
                画像を選ぶ
              </button>
              {draft.logo !== undefined ? (
                <button type="button" class="link-btn danger" disabled={busy} onClick={removeLogo} data-branding-logo-remove>
                  ロゴを外す
                </button>
              ) : null}
            </div>
            <div class="fld-help">
              PNG か JPEG（{LOGO_MAX_BYTES / 1024}KB まで・縦横 {LOGO_MAX_SIDE} 画素まで）。SVG は使えません
            </div>
          </div>
        </div>
        <div class="fld os-gap-top">
          <div class="fld-l">
            <span id="os-brand-colors-l">基調の色</span>
          </div>
          <div class="os-brand-colors" role="radiogroup" aria-labelledby="os-brand-colors-l" data-branding-colors>
            {BASE_SAMPLES.map((c) => (
              <button type="button" role="radio" key={c.color} class="os-swatch" aria-checked={color === c.color} onClick={() => pickColor(c.color)} title={c.name} data-branding-color={c.color}>
                <span class="os-swatch-c" style={{ background: c.color }} aria-hidden="true" />
                {c.name}
                {c.color === STANDARD_BASE ? "（標準）" : ""}
              </button>
            ))}
            <label class="os-swatch os-swatch-free">
              <input type="color" value={normalizeHex(hex) ?? color} onInput={(e) => pickColor((e.currentTarget as HTMLInputElement).value)} aria-label="色を自由に選ぶ" data-branding-color-free />
              <input type="text" class="os-hex" value={hex} maxLength={7} spellcheck={false} autocomplete="off" aria-label="色の番号（#RRGGBB）" onInput={(e) => pickColor((e.currentTarget as HTMLInputElement).value)} data-branding-color-hex />
            </label>
          </div>
        </div>
        {notes.length > 0 ? (
          <ul class={`os-brand-notes${check.ok ? "" : " bad"}`} role="status" data-branding-notes={check.ok ? "ok" : "refused"}>
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}
        {changed ? (
          <p class="os-acts">
            <button
              type="button"
              class="link-btn"
              onClick={() => {
                onDraft(saved);
                setHex(saved.color ?? STANDARD_BASE);
                setMsg(null);
              }}
              data-branding-revert
            >
              保存した見た目に戻す
            </button>
          </p>
        ) : null}
        {msg !== null ? (
          <p class="fld-help bad" role="alert" data-branding-msg>
            {msg}
          </p>
        ) : null}
      </OfficeGroup>
    </OfficeSection>
  );
}
