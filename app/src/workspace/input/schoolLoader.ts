// 学校の一覧（src/generated/schools.data.js）を遅れて読む仕組みを登録する（画面だけ。0217）。初めの読み込みに入れず、学校名の欄を開いたときに読む
import { setSchoolLoader } from "./schools.ts";

setSchoolLoader(() => import("../../generated/schools.data.js").then((m) => m.default));
