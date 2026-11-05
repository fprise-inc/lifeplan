// 事務所の既定値のパネルの区画「事務所の見た目」（0121）: 事務所の名前・ロゴの画像・基調の色。
// - 変えるとすぐ画面に映す（見本として。onPreview）。区画の「この見た目にする」で事務所データへ保存する（パネルの「保存」とは別。
//   保存しないでパネルを閉じると、前の見た目に戻る）。
// - 基調の色は見本から選ぶか、自由に選ぶ。見やすさの足りない色は自動で濃さを直して知らせ、不足の赤・注意の橙・現状の灰と紛れる色は使えない。
// - ロゴの画像は本体のダイアログで選ぶ（PNG・JPEG だけ。本体が確かめる）。画面はバイトをキャンバスに描くだけ
import { useState } from "preact/hooks";
import { LogoCanvas } from "../../presentation/LogoCanvas.tsx";
import { BASE_SAMPLES, checkBase, checkText, normalizeHex, STANDARD_BASE } from "../../presentation/theme.ts";
import { brandingErrorText, LOGO_MAX_BYTES, LOGO_MAX_SIDE, NAME_MAX_CHARS, type OfficeBranding, type OfficeLogo } from "./branding.ts";

export interface BrandingSectionProps {
  value: OfficeBranding;
  /** 変えている途中の見た目を画面に映す（null は保存した見た目に戻す） */
  onPreview: (b: OfficeBranding | null) => void;
  /** 保存する（本体が確かめて整えた値を返す） */
  onSave: (b: OfficeBranding) => Promise<OfficeBranding>;
  /** ロゴの画像を選ぶ（本体のダイアログ。選ばなかったら null） */
  onPickLogo: () => Promise<OfficeLogo | null>;
  shared: boolean;
}

const same = (a: OfficeBranding, b: OfficeBranding) => (a.name ?? "") === (b.name ?? "") && (a.color ?? STANDARD_BASE) === (b.color ?? STANDARD_BASE) && (a.logo?.data ?? "") === (b.logo?.data ?? "");

export function BrandingSection({ value, onPreview, onSave, onPickLogo, shared }: BrandingSectionProps) {
  const [draft, setDraft] = useState<OfficeBranding>(value);
  const [hex, setHex] = useState(value.color ?? STANDARD_BASE);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const put = (next: OfficeBranding) => {
    setDraft(next);
    setMsg(null);
    onPreview(same(next, value) ? null : next);
  };
  const color = draft.color ?? STANDARD_BASE;
  const check = checkBase(color);
  const notes = checkText(check);
  const pickColor = (c: string) => {
    // 番号の欄は6桁がそろったときだけ当てる（打っている途中の3桁を色にしない）
    const n = /^#[0-9a-fA-F]{6}$/.test(c.trim()) ? c.trim().toLowerCase() : null;
    setHex(c);
    if (n === null) return;
    const { color: _old, ...rest } = draft;
    void _old;
    put(n === STANDARD_BASE ? rest : { ...rest, color: n });
  };
  const setName = (t: string) => {
    const { name: _old, ...rest } = draft;
    void _old;
    put(t.trim() === "" ? rest : { ...rest, name: t.slice(0, NAME_MAX_CHARS) });
  };
  const pickLogo = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const l = await onPickLogo();
      if (l !== null) put({ ...draft, logo: l });
    } catch (e) {
      setMsg({ ok: false, text: brandingErrorText(typeof e === "string" ? e : e instanceof Error ? e.message : "E_STORE_LOGO") });
    } finally {
      setBusy(false);
    }
  };
  const removeLogo = () => {
    const { logo: _old, ...rest } = draft;
    void _old;
    put(rest);
  };
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const saved = await onSave({ ...draft, ...(draft.name !== undefined ? { name: draft.name.trim() } : {}) });
      setDraft(saved);
      setHex(saved.color ?? STANDARD_BASE);
      setMsg({ ok: true, text: "この見た目にしました。左上と画面の色、これから作る提案書の色と表紙に使います（世帯には写しません）。" });
    } catch (e) {
      setMsg({ ok: false, text: brandingErrorText(typeof e === "string" ? e : e instanceof Error ? e.message : "E_STORE_BRANDING") });
    } finally {
      setBusy(false);
    }
  };
  const revert = () => {
    setDraft(value);
    setHex(value.color ?? STANDARD_BASE);
    setMsg(null);
    onPreview(null);
  };
  const changed = !same(draft, value);
  return (
    <section class="os-sec" aria-labelledby="os-brand" data-office-branding>
      <h3 id="os-brand">事務所の見た目</h3>
      <p class="pl-sub">
        左上に出す事務所の名前とロゴ、画面と提案書の基調の色です。選ぶとすぐ画面に映ります（「この見た目にする」で保存します）。世帯には写さず、どの世帯にもすぐ効きます。
        {shared ? "事務所で共有していても、この PC の設定です。" : "この PC の設定です。"}
      </p>
      <div class="os-grid">
        <label class="os-pct">
          <span>事務所の名前</span>
          <span class="os-in">
            <input type="text" class="os-brand-name" value={draft.name ?? ""} maxLength={NAME_MAX_CHARS} placeholder="入れなければ「ファイナンシア」" autocomplete="off" onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} data-branding-name />
          </span>
          <small>左上と提案書の表紙に出します（{NAME_MAX_CHARS}文字まで）。</small>
        </label>
        <div class="os-pct">
          <span>ロゴの画像</span>
          <span class="os-brand-logo">
            {draft.logo !== undefined ? <LogoCanvas logo={draft.logo} height={32} maxWidth={180} label="選んだロゴ" class="os-logo-prev" /> : <span class="os-logo-none">なし</span>}
            <button type="button" class="btn small" disabled={busy} onClick={() => void pickLogo()} data-branding-logo-pick>
              画像を選ぶ
            </button>
            {draft.logo !== undefined ? (
              <button type="button" class="link-btn" disabled={busy} onClick={removeLogo} data-branding-logo-remove>
                ロゴを外す
              </button>
            ) : null}
          </span>
          <small>
            PNG か JPEG（{LOGO_MAX_BYTES / 1024}KB まで・縦横 {LOGO_MAX_SIDE} 画素まで）。SVG は使えません。横長のロゴは高さをそろえて縮めます。
          </small>
        </div>
      </div>
      <div class="os-brand-colors" role="radiogroup" aria-label="基調の色" data-branding-colors>
        <span class="os-brand-k">基調の色</span>
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
      {notes.length > 0 ? (
        <ul class={`os-brand-notes${check.ok ? "" : " bad"}`} role="status" data-branding-notes={check.ok ? "ok" : "refused"}>
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      <p class="pl-sub">不足の赤・推定の印の橙・済みの緑・グラフのプランごとの色・資産と負債の図の科目の色は、基調の色を変えても変わりません。</p>
      <div class="rp-actions">
        <button type="button" class="btn primary" disabled={busy || !changed || !check.ok} onClick={() => void save()} data-branding-save>
          この見た目にする
        </button>
        {changed ? (
          <button type="button" class="btn" disabled={busy} onClick={revert} data-branding-revert>
            元に戻す
          </button>
        ) : null}
      </div>
      {msg !== null ? (
        <p class={msg.ok ? "rp-note" : "fatal"} role="status" data-branding-msg>
          {msg.text}
        </p>
      ) : null}
    </section>
  );
}
