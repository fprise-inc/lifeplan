import type { ESLint, Linter } from "eslint";

declare const plugin: ESLint.Plugin;
export default plugin;
export declare const engineRules: Linter.RulesRecord;
export declare function componentRules(componentsDir: string, sdkDir: string): Linter.RulesRecord;
