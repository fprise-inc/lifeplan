// 公式部品の一覧。部品の中身の指紋はビルドの時にソースから作る（src/generated/build-info.json）
import buildInfo from "../generated/build-info.json" with { type: "json" };
import { EngineError } from "../errors.ts";
import type { ComponentDefinition } from "../registry/define.ts";
import type { OfficialComponent } from "../registry/assemble.ts";
import balance from "./test.sample.balance/index.ts";
import lumpSum from "./test.sample.lumpSum/index.ts";
import monthlyFlow from "./test.sample.monthlyFlow/index.ts";

const HASHES = buildInfo.components as Readonly<Record<string, string>>;

function official(def: ComponentDefinition<never, unknown>): OfficialComponent {
  const hash = HASHES[def.id];
  if (hash === undefined) throw new EngineError("E_COMPONENT_DEFINITION", [def.id, "hash"]);
  return { def: def as ComponentDefinition, hash };
}

export const OFFICIAL_COMPONENTS: readonly OfficialComponent[] = [official(monthlyFlow), official(lumpSum), official(balance)];

/** 計算のはじめに呼ぶ部品（土台では見本の残高の積み上げ） */
export const ROOT_COMPONENT = "test.sample.balance";
