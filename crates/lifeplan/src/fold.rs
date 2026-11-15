//! 検索の言葉と文のそろえ方（独立した点検の直し。0212 の追記）。全角・半角の英数字と記号（ＮＩＳＡ・ｉＤｅＣｏ・１２３）、半角のカナを
//! NFKC でそろえ、英字を小文字にする。検索の言葉と、探す側の文の両方に当ててから照らし合わせる（list_custom_texts・search_coverage・
//! get_regulation_value の query・list_sample_households の tags）

use unicode_normalization::UnicodeNormalization;

/// NFKC にそろえて小文字にした文
pub fn fold(s: &str) -> String {
    s.nfkc().flat_map(char::to_lowercase).collect()
}

#[cfg(test)]
mod tests {
    use super::fold;

    #[test]
    fn folds_width_and_case() {
        assert_eq!(fold("ＮＩＳＡ"), "nisa");
        assert_eq!(fold("ｉＤｅＣｏ　の受け取り"), "ideco の受け取り");
        assert_eq!(fold("ｶﾞｸﾋ"), "ガクヒ");
        assert_eq!(fold("１２３万円"), "123万円");
    }
}
