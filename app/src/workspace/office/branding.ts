// 事務所の見た目（0121）: 事務所の名前・ロゴの画像・基調の色と、画面の明るさ（暗い画面は個別のカスタマイズからだけ）。
// - 事務所データの別の欄（本体の office_branding_get・office_branding_put）に持つ。事務所の既定値（defaults）とは分ける:
//   画像のバイトを持つので大きく、本体が PNG・JPEG かを確かめるため（0016）。事務所で共有していても、この PC の設定（0073 と同じ）。
// - 世帯には写さない（見せ方だけ。変えるとどの世帯にもすぐ効く）。
// - 基調の色から画面の色の決め事を導くのは presentation/theme.ts。ここは読み書きの形と、画面への当て方。
// - ロゴの画像は img の URL にしない（CSP の img-src 'self' を変えない。data: の URI も使わない）。バイトからキャンバスに描く（presentation/LogoCanvas.tsx）
import { checkBase, normalizeHex, STANDARD_BASE, themeVars } from "../../presentation/theme.ts";

/**
 * 画面の明るさ。利用者の判断（0121 の追記 2026-11-05）で、画面には選ぶ所を出さず、標準は明るい画面だけ（OS の設定でも暗くしない）。
 * 暗い画面（app.css の html.dark）は、個別のカスタマイズ（カスタム層・AI 経由）で事務所データに `dark` を入れたときだけ使う
 */
export type Appearance = "light" | "dark" | "system";

/** ロゴの画像（本体が確かめた種類・縦横の画素と、base64 の文字のバイト） */
export interface OfficeLogo {
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
  data: string;
}

export interface OfficeBranding {
  /** 事務所の名前（左上と提案書の表紙に出す） */
  name?: string;
  /** 基調の色（選んだ色。#rrggbb） */
  color?: string;
  /** 画面の明るさ（`dark` のときだけ暗い画面。無い・`light`・`system` は明るい画面。画面からは選べない） */
  appearance?: Appearance;
  logo?: OfficeLogo;
}

export const EMPTY_BRANDING: OfficeBranding = {};

/** 本体の上限と同じ（household-store の branding.rs） */
export const LOGO_MAX_BYTES = 256 * 1024;
export const LOGO_MAX_SIDE = 2000;
export const LOGO_MIN_SIDE = 8;
export const NAME_MAX_CHARS = 40;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 読んだ値から見た目（読めない欄は無し） */
export function readBranding(v: unknown): OfficeBranding {
  if (!isObj(v)) return EMPTY_BRANDING;
  const out: OfficeBranding = {};
  if (typeof v.name === "string" && v.name.trim() !== "") out.name = v.name.trim().slice(0, NAME_MAX_CHARS);
  const c = typeof v.color === "string" ? normalizeHex(v.color) : null;
  if (c !== null) out.color = c;
  if (v.appearance === "light" || v.appearance === "dark" || v.appearance === "system") out.appearance = v.appearance;
  const l = v.logo;
  if (isObj(l) && (l.mime === "image/png" || l.mime === "image/jpeg") && typeof l.data === "string" && l.data !== "" && Number.isInteger(l.width) && Number.isInteger(l.height))
    out.logo = { mime: l.mime, width: l.width as number, height: l.height as number, data: l.data };
  return out;
}

/** 基調の色が標準（ファイナンシアの藍）か。決めていない・使えない色も標準として扱う */
export function usesStandardColor(b: OfficeBranding): boolean {
  if (b.color === undefined || b.color === STANDARD_BASE) return true;
  return !checkBase(b.color).ok;
}

/** 今の明るさ（`dark` を入れたときだけ暗い画面。OS の設定には合わせない） */
export const resolveMode = (a: Appearance | undefined): "light" | "dark" => (a === "dark" ? "dark" : "light");

/** 画面の色の決め事のうち、上書きするもの（明るい画面の標準の色なら何も上書きしない＝ app.css のまま） */
export function lookVars(b: OfficeBranding, mode: "light" | "dark"): Record<string, string> {
  if (usesStandardColor(b)) return {};
  return themeVars(b.color as string, mode);
}

/** 上書きする変数の名前（外すときに使う） */
const VAR_NAMES = ["--prop", "--prop-ink", "--prop-bg"];

/** 画面に当てる（html の class と style の変数。style は CSSOM で書く: CSP の style-src に触れない） */
export function applyLook(root: HTMLElement, b: OfficeBranding, mode: "light" | "dark"): void {
  root.classList.toggle("dark", mode === "dark");
  const vars = lookVars(b, mode);
  for (const k of VAR_NAMES) {
    const v = vars[k];
    if (v === undefined) root.style.removeProperty(k);
    else root.style.setProperty(k, v);
  }
}

/** 提案書・持ち帰り用のレポートのアクセントの色（明るい画面の基調の色。標準なら null＝帳票の標準の色） */
export const reportAccent = (b: OfficeBranding): string | null => (usesStandardColor(b) ? null : checkBase(b.color as string).light);

/** 左上に出す物（名前もロゴも無ければ null＝今のまま「ファイナンシア」） */
export function brandOf(b: OfficeBranding): { name: string | null; logo: OfficeLogo | null } | null {
  const name = b.name ?? null;
  const logo = b.logo ?? null;
  return name === null && logo === null ? null : { name, logo };
}

/** base64 の文字からバイト */
export function logoBytes(logo: OfficeLogo): Uint8Array {
  const bin = atob(logo.data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** バイトから base64 の文字 */
export function base64Of(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * ロゴの画像の見出しを読む（PNG・JPEG の種類と縦横の画素。本体の branding.rs と同じ決まり。開発用のサーバーの代わりと、画面の知らせに使う）。
 * 合わなければ符号（E_STORE_LOGO・E_STORE_LOGO_TOO_LARGE）
 */
export function readLogoHeader(b: Uint8Array): { mime: OfficeLogo["mime"]; width: number; height: number } | string {
  if (b.length > LOGO_MAX_BYTES) return "E_STORE_LOGO_TOO_LARGE";
  let r: { mime: OfficeLogo["mime"]; width: number; height: number } | null = null;
  const be32 = (i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
  const be16 = (i: number) => (b[i]! << 8) | b[i + 1]!;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length >= 33 && sig.every((x, i) => b[i] === x) && be32(8) === 13 && String.fromCharCode(...b.subarray(12, 16)) === "IHDR") r = { mime: "image/png", width: be32(16), height: be32(20) };
  else if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 4 <= b.length && r === null) {
      if (b[i] !== 0xff) break;
      const m = b[i + 1]!;
      if (m === 0xff) {
        i += 1;
        continue;
      }
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        i += 2;
        continue;
      }
      if (m === 0xd9 || m === 0xda) break;
      const len = be16(i + 2);
      if (len < 2 || i + 2 + len > b.length) break;
      const sof = (m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf);
      if (sof) {
        if (len < 7) break;
        r = { mime: "image/jpeg", width: be16(i + 7), height: be16(i + 5) };
      }
      i += 2 + len;
    }
  }
  if (r === null) return "E_STORE_LOGO";
  if (r.width < LOGO_MIN_SIDE || r.height < LOGO_MIN_SIDE) return "E_STORE_LOGO";
  if (r.width > LOGO_MAX_SIDE || r.height > LOGO_MAX_SIDE) return "E_STORE_LOGO_TOO_LARGE";
  return r;
}

/** 失敗の符号の文 */
export function brandingErrorText(code: string): string {
  if (code === "E_STORE_LOGO_TOO_LARGE") return `画像が大きすぎます（${LOGO_MAX_BYTES / 1024}KB まで・縦横 ${LOGO_MAX_SIDE} 画素まで）。小さくしてから選んでください。`;
  if (code === "E_STORE_LOGO") return "PNG か JPEG の画像を選んでください（SVG などは使えません。壊れた画像も使えません）。";
  if (code === "E_STORE_BRANDING") return `事務所の名前（${NAME_MAX_CHARS}文字まで）か色の形が合いません。`;
  return `保存できませんでした（${code}）`;
}

// ---- 今の見た目（アプリが開いている間。提案書の色を決める所などがここを読む）----

let now: OfficeBranding = EMPTY_BRANDING;
export const brandingNow = (): OfficeBranding => now;
export function setBrandingNow(b: OfficeBranding): void {
  now = b;
}
