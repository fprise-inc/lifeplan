// 欄の名前の左に付ける小さな線のアイコン（基本生活費の内訳の行など）。
// 入力のホームのカードの絵に合わせ、黒い線（文字の色）に差し色をごく一部だけ使う。ファイナンシアのために描いたもの（リポジトリの MIT）。
// 飾りなので読み上げない（aria-hidden）。名前は欄の label のまま読む。大きさは文字に合わせて em で決める（文字の大きさ「大」でも崩れない）
import type { JSX } from "preact";

/** 差し色（基本生活費のカードの色） */
const ACCENT = "#C99A30";

const ICONS: Readonly<Record<string, JSX.Element>> = {
  // 食費: ご飯の茶わんと箸
  food: (
    <>
      <path d="M7 11.5a5 2.6 0 0 1 10 0" fill={ACCENT} />
      <path d="M3.5 11.5h17c0 4.3-3.8 7.5-8.5 7.5s-8.5-3.2-8.5-7.5z" />
      <path d="M9.5 21h5" />
      <path d="M13.5 3.5l5.5 6.5M16.5 2.8l3.6 6.2" />
    </>
  ),
  // 水道・光熱費: 電球
  utilities: (
    <>
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2V17h5v-1c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z" fill={ACCENT} />
      <path d="M9.5 20h5M10.5 22h3" />
    </>
  ),
  // 日用品: 手提げの袋
  furniture: (
    <>
      <path d="M5 8h14l-1 12.5H6z" />
      <path d="M9 10.5V7a3 3 0 0 1 6 0v3.5" />
      <path d="M8.5 14h7" stroke={ACCENT} stroke-width="2.4" />
    </>
  ),
  // 被服・美容: シャツ
  clothing: (
    <>
      <path d="M9 4l-5 3 2 3.5 2-1V20h8V9.5l2 1L20 7l-5-3" />
      <path d="M9 4a3 2.2 0 0 0 6 0" fill={ACCENT} />
    </>
  ),
  // 通信費: スマートフォン
  communication: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.2" />
      <path d="M9 5.5h6v11H9z" fill={ACCENT} />
      <path d="M11 19h2" />
    </>
  ),
  // 交通費: 電車の前の形（前の分け方の交通・通信費も同じ絵）
  transit: (
    <>
      <rect x="5.5" y="3" width="13" height="14" rx="3" />
      <path d="M7.5 6.5h9v4h-9z" fill={ACCENT} />
      <path d="M9 14h.01M15 14h.01" stroke-width="2.4" />
      <path d="M8 17l-2 4M16 17l2 4" />
    </>
  ),
  // 交通・通信費（前の分け方）: 電車の前の形
  transport: (
    <>
      <rect x="5.5" y="3" width="13" height="14" rx="3" />
      <path d="M7.5 6.5h9v4h-9z" fill={ACCENT} />
      <path d="M9 14h.01M15 14h.01" stroke-width="2.4" />
      <path d="M8 17l-2 4M16 17l2 4" />
    </>
  ),
  // 趣味・娯楽: スーツケース
  recreation: (
    <>
      <rect x="4" y="7" width="16" height="12" rx="2" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M9.5 7v12M14.5 7v12" />
      <path d="M10.2 11.5h3.6v3h-3.6z" fill={ACCENT} stroke="none" />
    </>
  ),
  // 医療費: 救急箱
  health: (
    <>
      <rect x="3.5" y="7" width="17" height="12.5" rx="2" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
      <path d="M10.5 10h3v2.5H16v3h-2.5V18h-3v-2.5H8v-3h2.5z" fill={ACCENT} />
    </>
  ),
  // こづかい・交際費: 財布
  pocketAndSocial: (
    <>
      <path d="M4 8h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M4 8l11-3.5V8" />
      <path d="M15 12h5v4h-5a2 2 0 0 1 0-4z" fill={ACCENT} />
    </>
  ),
  // その他: 箱
  other: (
    <>
      <path d="M3.5 8.5L12 4.5l8.5 4v9L12 21.5l-8.5-4z" />
      <path d="M3.5 8.5L12 12.5l8.5-4M12 12.5v9" />
      <path d="M7.7 6.5l8.5 4v3" stroke={ACCENT} stroke-width="2.2" />
    </>
  ),
  // その他の消費（前の分け方。こづかい・交際費など）: 湯気の立つカップ
  otherConsumption: (
    <>
      <path d="M4.5 10h12v4.5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5z" />
      <path d="M5 12.5h11" stroke={ACCENT} stroke-width="2.4" />
      <path d="M16.5 11.5h1.2a2.3 2.3 0 0 1 0 4.6h-1.6" />
      <path d="M8.5 3.5c-.8 1 .8 2 0 3M12.5 3.5c-.8 1 .8 2 0 3" />
    </>
  ),
  // 仕送り: 封筒
  allowance: (
    <>
      <rect x="3.5" y="6" width="17" height="12.5" rx="1.8" />
      <path d="M3.5 7.5l8.5 6 8.5-6" />
      <circle cx="17.5" cy="15.5" r="2" fill={ACCENT} />
    </>
  ),
};

/** アイコンの名前（欄の icon に書く） */
export type FieldIconName = keyof typeof ICONS;

export function hasFieldIcon(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(ICONS, name);
}

/** 欄の名前の左のアイコン。名前が無ければ何も出さない */
export function FieldIcon({ name }: { name: string }) {
  if (!hasFieldIcon(name)) return null;
  return (
    <svg class="fld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" data-icon={name}>
      {ICONS[name]}
    </svg>
  );
}
