// ─── zotero ───────────────────────────────────────────────────────────────────

use std::time::Duration;

const ZOTERO_CAYW_URL: &str = "http://127.0.0.1:23119/better-bibtex/cayw";

#[tauri::command]
pub async fn zotero_cite() -> Result<serde_json::Value, String> {
    let url = format!("{}?format=pandoc&brackets=1", ZOTERO_CAYW_URL);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("zotero returned {}", response.status()));
    }
    let citation = response
        .text()
        .await
        .map_err(|e| e.to_string())?
        .trim()
        .to_string();
    if citation.is_empty() {
        return Ok(serde_json::json!({ "empty": true }));
    }
    Ok(serde_json::json!({ "citation": citation }))
}
