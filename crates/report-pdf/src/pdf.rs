//! 出力した PDF の後処理: 文字の抜き出し（刻印と必須の記載の確かめ。0009 の6）と、
//! 印刷されない内部情報（XMP）の追記（0009 の7）。

use lopdf::{Document, Object, Stream};

use crate::{Internal, Stamp, XMP_NAMESPACE};

/// 抜き出しで読む展開後の大きさの上限（壊れた・悪意のある PDF で止まらないように）
const MAX_DECOMPRESSED: usize = 64 * 1024 * 1024;

/// PDF の各ページの文字を抜き出す（ページの順）
pub fn extract_text(pdf: &[u8]) -> Result<Vec<String>, String> {
    let doc = Document::load_mem(pdf).map_err(|e| e.to_string())?;
    let pages: Vec<u32> = doc.get_pages().keys().copied().collect();
    pages
        .iter()
        .map(|n| {
            doc.extract_text_with_limit(&[*n], MAX_DECOMPRESSED)
                .map_err(|e| e.to_string())
        })
        .collect()
}

fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// 内部情報の XMP の記述（rdf:Description 1つ）
fn description(stamp: &Stamp, internal: &Internal) -> String {
    let mut s = format!(
        "<rdf:Description rdf:about=\"\" xmlns:lp=\"{XMP_NAMESPACE}\">\
<lp:baseMonth>{}</lp:baseMonth><lp:dataSetLabel>{}</lp:dataSetLabel>",
        escape_xml(&stamp.base_month),
        escape_xml(&stamp.data_set_label)
    );
    if let Some(id) = &internal.snapshot_id {
        s.push_str(&format!("<lp:snapshot>{}</lp:snapshot>", escape_xml(id)));
    }
    if let Some(id) = &internal.data_set_id {
        s.push_str(&format!("<lp:dataSet>{}</lp:dataSet>", escape_xml(id)));
    }
    s.push_str(&format!(
        "<lp:custom>{}</lp:custom>",
        !internal.custom_digests.is_empty()
    ));
    if !internal.custom_digests.is_empty() {
        s.push_str("<lp:customDigests><rdf:Seq>");
        for d in &internal.custom_digests {
            s.push_str(&format!("<rdf:li>{}</rdf:li>", escape_xml(d)));
        }
        s.push_str("</rdf:Seq></lp:customDigests>");
    }
    s.push_str("</rdf:Description>");
    s
}

/// 文書の XMP（カタログの /Metadata）に内部情報の記述を足す。XMP が無ければ作る
pub fn add_internal_xmp(pdf: &[u8], stamp: &Stamp, internal: &Internal) -> Result<Vec<u8>, String> {
    let mut doc = Document::load_mem(pdf).map_err(|e| e.to_string())?;
    let desc = description(stamp, internal);
    let catalog_id = doc
        .trailer
        .get(b"Root")
        .and_then(Object::as_reference)
        .map_err(|e| e.to_string())?;
    let meta_ref = doc
        .get_dictionary(catalog_id)
        .map_err(|e| e.to_string())?
        .get(b"Metadata")
        .and_then(Object::as_reference)
        .ok();
    match meta_ref {
        Some(id) => {
            let stream = doc
                .get_object_mut(id)
                .and_then(Object::as_stream_mut)
                .map_err(|e| e.to_string())?;
            let xml = if stream.dict.get(b"Filter").is_ok() {
                stream.decompressed_content().map_err(|e| e.to_string())?
            } else {
                stream.content.clone()
            };
            let xml = String::from_utf8(xml).map_err(|e| e.to_string())?;
            let Some(pos) = xml.rfind("</rdf:RDF>") else {
                return Err("XMP に rdf:RDF が無い".into());
            };
            let mut out = String::with_capacity(xml.len() + desc.len());
            out.push_str(&xml[..pos]);
            out.push_str(&desc);
            out.push_str(&xml[pos..]);
            stream.dict.remove(b"Filter");
            stream.dict.remove(b"DecodeParms");
            stream.set_content(out.into_bytes());
        }
        None => {
            let xml = format!(
                "<?xpacket begin=\"\u{feff}\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>\
<x:xmpmeta xmlns:x=\"adobe:ns:meta/\"><rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">{desc}</rdf:RDF></x:xmpmeta>\
<?xpacket end=\"w\"?>"
            );
            let mut dict = lopdf::Dictionary::new();
            dict.set("Type", Object::Name(b"Metadata".to_vec()));
            dict.set("Subtype", Object::Name(b"XML".to_vec()));
            let id = doc.add_object(Stream::new(dict, xml.into_bytes()));
            doc.get_dictionary_mut(catalog_id)
                .map_err(|e| e.to_string())?
                .set("Metadata", Object::Reference(id));
        }
    }
    let mut out = Vec::new();
    doc.save_to(&mut out).map_err(|e| e.to_string())?;
    Ok(out)
}
