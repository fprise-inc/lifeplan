// 0006 の5: 入出力の検査。検査器はビルドの時にスキーマから作ったもの（実行環境ではコードを作らない）
import { EngineError, type ErrorCode } from "../errors.ts";
import { byKey } from "../generated/validators.js";

export interface ValidateFn {
  (data: unknown): boolean;
  errors?: readonly { instancePath: string; keyword: string }[] | null;
}

const VALIDATORS = byKey as Readonly<Record<string, ValidateFn>>;

export function hasSchema(key: string): boolean {
  return VALIDATORS[key] !== undefined;
}

/** 形が合わなければエラー。エラーには場所（欄の名前）と検査の種類だけを入れ、値は入れない */
export function check(key: string, data: unknown, code: ErrorCode, ids: readonly string[] = []): void {
  const v = VALIDATORS[key];
  if (v === undefined) throw new EngineError("E_ARGUMENT", ["schema", key]);
  if (!v(data)) {
    const e = v.errors?.[0];
    throw new EngineError(code, [...ids, `${e?.instancePath === "" ? "/" : (e?.instancePath ?? "/")}:${e?.keyword ?? "?"}`]);
  }
}
