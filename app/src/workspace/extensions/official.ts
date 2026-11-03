// 同梱の公式の拡張（0114 の1。段1 で動かすのはこれだけ）。
// - 提供元が作り、アプリの配布物に入れて配る束。アプリの更新の署名（0017）で守られて届くので、承認の対象にしない（0114 の8）
// - 束の正本は sdk/examples/extensions/<束>/（SDK の見本と同じファイル）。ここは読み込んで、外から読む束と同じ確かめ（manifest.ts）を通すだけ
// - 作業の層の中でアプリのコードとして呼ぶ（外から読む束は段2 で隔離実行の中で呼ぶ。0114 の1）
import combinedBsManifest from "../../../../sdk/examples/extensions/combined-bs/manifest.json";
import combinedBsCompany from "../../../../sdk/examples/extensions/combined-bs/fields/company.json";
import * as combinedBs from "../../../../sdk/examples/extensions/combined-bs/index.ts";
import type { ExtFieldsDecl, ExtManifest } from "../../../../report/src/index.ts";
import { checkExtension, type LoadedExtension } from "./manifest.ts";

/** 同梱の束（manifest・入力欄の宣言・入口の関数） */
const BUNDLED: { manifest: unknown; fields: unknown[]; parts: Record<string, unknown> }[] = [{ manifest: combinedBsManifest, fields: [combinedBsCompany], parts: combinedBs }];

/** 同梱の束の確かめの結果（誤りのある束は読み込まない。テストが誤りの無いことを確かめる） */
export const OFFICIAL_CHECKS: { id: string; errors: string[] }[] = BUNDLED.map((b) => ({
  id: (b.manifest as { id?: string }).id ?? "",
  errors: checkExtension(b.manifest, b.fields, b.parts, { official: true }),
}));

/** 同梱の公式の拡張（確かめを通ったものだけ） */
export const OFFICIAL_EXTENSIONS: readonly LoadedExtension[] = BUNDLED.filter((_, i) => OFFICIAL_CHECKS[i]?.errors.length === 0).map((b) => ({
  manifest: b.manifest as ExtManifest,
  fields: b.fields as ExtFieldsDecl[],
  parts: b.parts as LoadedExtension["parts"],
  official: true,
}));

/** 合算BS の束の id（0107・0114 の9） */
export const COMBINED_BS_EXTENSION = "ext.official.combinedBs";
