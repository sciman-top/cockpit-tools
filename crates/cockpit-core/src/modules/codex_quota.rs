use crate::models::codex::{CodexAccount, CodexQuota, CodexQuotaErrorInfo};
use crate::modules::{codex_account, logger};
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION};
use serde::{Deserialize, Serialize};
use serde_json::json;

// 使用 wham/usage 端点（Quotio 使用的）
const USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const WEEKLY_WINDOW_MINUTES_THRESHOLD: i64 = 6 * 24 * 60;

fn get_header_value(headers: &HeaderMap, name: &str) -> String {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("-")
        .to_string()
}

fn extract_detail_code_from_body(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;

    if let Some(code) = value
        .get("detail")
        .and_then(|detail| detail.get("code"))
        .and_then(|code| code.as_str())
    {
        return Some(code.to_string());
    }

    if let Some(code) = value
        .get("error")
        .and_then(|error| error.get("code"))
        .and_then(|code| code.as_str())
    {
        return Some(code.to_string());
    }

    if let Some(code) = value.get("code").and_then(|code| code.as_str()) {
        return Some(code.to_string());
    }

    None
}

fn extract_error_code_from_message(message: &str) -> Option<String> {
    let marker = "[error_code:";
    let start = message.find(marker)?;
    let code_start = start + marker.len();
    let end = message[code_start..].find(']')?;
    Some(message[code_start..code_start + end].to_string())
}

fn extract_i64_marker_from_message(message: &str, marker: &str) -> Option<i64> {
    let start = message.find(marker)?;
    let value_start = start + marker.len();
    let end = message[value_start..].find(']')?;
    message[value_start..value_start + end].parse::<i64>().ok()
}

fn normalize_unix_timestamp_seconds(value: i64) -> i64 {
    if value > 1_000_000_000_000 {
        value / 1000
    } else {
        value
    }
}

fn first_i64_field<'a>(
    value: &'a serde_json::Value,
    keys: impl IntoIterator<Item = &'a str>,
) -> Option<i64> {
    keys.into_iter().find_map(|key| {
        value.get(key).and_then(|item| {
            item.as_i64()
                .or_else(|| item.as_u64().and_then(|v| i64::try_from(v).ok()))
        })
    })
}

fn extract_quota_reset_hint_from_body(body: &str, now: i64) -> Option<(Option<i64>, Option<i64>)> {
    let root: serde_json::Value = serde_json::from_str(body).ok()?;
    let candidates = [
        Some(&root),
        root.get("error"),
        root.get("detail"),
        root.get("data"),
    ];

    for candidate in candidates.into_iter().flatten() {
        let reset_at = first_i64_field(candidate, ["reset_at", "resets_at"])
            .map(normalize_unix_timestamp_seconds);
        let reset_after_seconds = first_i64_field(
            candidate,
            [
                "reset_after_seconds",
                "resets_in_seconds",
                "resetAfterSeconds",
            ],
        )
        .filter(|seconds| *seconds >= 0);

        if reset_at.is_some() || reset_after_seconds.is_some() {
            let computed_reset_at =
                reset_at.or_else(|| reset_after_seconds.map(|seconds| now.saturating_add(seconds)));
            return Some((computed_reset_at, reset_after_seconds));
        }
    }

    None
}

fn write_quota_error(account: &mut CodexAccount, message: String) {
    account.quota_error = Some(CodexQuotaErrorInfo {
        code: extract_error_code_from_message(&message),
        message,
        timestamp: chrono::Utc::now().timestamp(),
    });
}

fn is_quota_exhaustion_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("api 返回错误 429")
        || lower.contains("too many requests")
        || lower.contains("rate_limit")
        || lower.contains("rate limit")
        || lower.contains("limit_reached")
        || lower.contains("usage_limit")
        || lower.contains("usage limit")
        || lower.contains("model_cap")
        || (lower.contains("quota")
            && (lower.contains("exceed") || lower.contains("limit") || lower.contains("exhaust")))
}

fn build_exhausted_quota_snapshot(account: &CodexAccount, message: &str) -> CodexQuota {
    let previous = account.quota.as_ref();
    let now = chrono::Utc::now().timestamp();
    let reset_at = extract_i64_marker_from_message(message, "[reset_at:")
        .map(normalize_unix_timestamp_seconds);
    let reset_after_seconds = extract_i64_marker_from_message(message, "[reset_after_seconds:");
    let hourly_reset_time = reset_at.or_else(|| previous.and_then(|quota| quota.hourly_reset_time));
    let weekly_reset_time = reset_at.or_else(|| previous.and_then(|quota| quota.weekly_reset_time));
    CodexQuota {
        hourly_percentage: 0,
        hourly_reset_time,
        hourly_window_minutes: previous.and_then(|quota| quota.hourly_window_minutes),
        hourly_window_present: previous
            .and_then(|quota| quota.hourly_window_present)
            .or(Some(true)),
        weekly_percentage: 0,
        weekly_reset_time,
        weekly_window_minutes: previous.and_then(|quota| quota.weekly_window_minutes),
        weekly_window_present: previous
            .and_then(|quota| quota.weekly_window_present)
            .or(Some(true)),
        raw_data: Some(json!({
            "source": "quota_refresh_error",
            "quota_exhausted": true,
            "exhausted_at": now,
            "reset_at": reset_at,
            "reset_after_seconds": reset_after_seconds,
        })),
    }
}

fn write_quota_fetch_error(account: &mut CodexAccount, message: String) {
    let quota_exhausted = is_quota_exhaustion_error(&message);
    write_quota_error(account, message);
    if quota_exhausted {
        let message = account
            .quota_error
            .as_ref()
            .map(|error| error.message.as_str())
            .unwrap_or_default();
        account.quota = Some(build_exhausted_quota_snapshot(account, message));
        account.usage_updated_at = Some(chrono::Utc::now().timestamp());
    }
}

/// 使用率窗口（5小时/周）
#[derive(Debug, Clone, Serialize, Deserialize)]
struct WindowInfo {
    #[serde(rename = "used_percent")]
    used_percent: Option<i32>,
    #[serde(rename = "limit_window_seconds")]
    limit_window_seconds: Option<i64>,
    #[serde(rename = "reset_after_seconds")]
    reset_after_seconds: Option<i64>,
    #[serde(rename = "reset_at")]
    reset_at: Option<i64>,
}

/// 速率限制信息
#[derive(Debug, Clone, Serialize, Deserialize)]
struct RateLimitInfo {
    allowed: Option<bool>,
    #[serde(rename = "limit_reached")]
    limit_reached: Option<bool>,
    #[serde(rename = "primary_window")]
    primary_window: Option<WindowInfo>,
    #[serde(rename = "secondary_window")]
    secondary_window: Option<WindowInfo>,
}

/// 使用率响应
#[derive(Debug, Clone, Serialize, Deserialize)]
struct UsageResponse {
    #[serde(rename = "plan_type")]
    plan_type: Option<String>,
    #[serde(rename = "rate_limit")]
    rate_limit: Option<RateLimitInfo>,
    #[serde(rename = "code_review_rate_limit")]
    code_review_rate_limit: Option<RateLimitInfo>,
    #[serde(rename = "rate_limit_reached_type")]
    rate_limit_reached_type: Option<serde_json::Value>,
}

fn normalize_remaining_percentage(window: &WindowInfo) -> i32 {
    let used = window.used_percent.unwrap_or(0).clamp(0, 100);
    100 - used
}

fn normalize_window_minutes(window: &WindowInfo) -> Option<i64> {
    let seconds = window.limit_window_seconds?;
    if seconds <= 0 {
        return None;
    }
    Some((seconds + 59) / 60)
}

fn is_weekly_window(window: &WindowInfo) -> bool {
    normalize_window_minutes(window)
        .map(|minutes| minutes >= WEEKLY_WINDOW_MINUTES_THRESHOLD)
        .unwrap_or(false)
}

fn normalize_reset_time(window: &WindowInfo) -> Option<i64> {
    if let Some(reset_at) = window.reset_at {
        return Some(reset_at);
    }

    let reset_after_seconds = window.reset_after_seconds?;
    if reset_after_seconds < 0 {
        return None;
    }

    Some(chrono::Utc::now().timestamp() + reset_after_seconds)
}

fn read_rate_limit_reached_type(value: &serde_json::Value) -> Option<String> {
    if let Some(kind) = value.as_str() {
        return Some(kind.trim().to_ascii_lowercase());
    }

    value
        .get("type")
        .or_else(|| value.get("kind"))
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_lowercase)
}

fn is_exhausted_rate_limit_reached_type(value: Option<&serde_json::Value>) -> bool {
    let Some(kind) = value.and_then(read_rate_limit_reached_type) else {
        return false;
    };

    matches!(
        kind.as_str(),
        "rate_limit_reached"
            | "workspace_owner_credits_depleted"
            | "workspace_member_credits_depleted"
            | "workspace_owner_usage_limit_reached"
            | "workspace_member_usage_limit_reached"
            | "usage_limit_reached"
            | "credits_depleted"
    )
}

fn rate_limit_reached_type_forces_all_windows_exhausted(value: Option<&serde_json::Value>) -> bool {
    let Some(kind) = value.and_then(read_rate_limit_reached_type) else {
        return false;
    };

    matches!(
        kind.as_str(),
        "workspace_owner_credits_depleted"
            | "workspace_member_credits_depleted"
            | "workspace_owner_usage_limit_reached"
            | "workspace_member_usage_limit_reached"
            | "credits_depleted"
    )
}

fn rate_limit_marks_exhausted(rate_limit: Option<&RateLimitInfo>) -> bool {
    let Some(rate_limit) = rate_limit else {
        return false;
    };

    rate_limit.limit_reached == Some(true) || rate_limit.allowed == Some(false)
}

fn usage_window_should_force_exhausted(
    window: &WindowInfo,
    top_level_exhausted: bool,
    force_all_windows_exhausted: bool,
    only_reported_window: bool,
) -> bool {
    force_all_windows_exhausted
        || (top_level_exhausted && (only_reported_window || window.used_percent.is_none()))
}

fn apply_window_to_quota_slots(
    window: &WindowInfo,
    force_exhausted: bool,
    hourly: &mut (i32, Option<i64>, Option<i64>, bool),
    weekly: &mut (i32, Option<i64>, Option<i64>, bool),
) {
    let remaining = if force_exhausted {
        0
    } else {
        normalize_remaining_percentage(window)
    };
    let reset_time = normalize_reset_time(window);
    let window_minutes = normalize_window_minutes(window);
    let target = if is_weekly_window(window) {
        weekly
    } else {
        hourly
    };

    if !target.3 || remaining < target.0 {
        target.0 = remaining;
        target.1 = reset_time;
        target.2 = window_minutes;
        target.3 = true;
    }
}

/// 配额查询结果（包含 plan_type）
pub struct FetchQuotaResult {
    pub quota: CodexQuota,
    pub plan_type: Option<String>,
}

async fn refresh_account_tokens(account: &mut CodexAccount, reason: &str) -> Result<(), String> {
    logger::log_info(&format!(
        "Codex 账号 {} 触发强制 Token 刷新: {}",
        account.email, reason
    ));

    let refreshed = codex_account::force_refresh_managed_account(&account.id, reason)
        .await
        .map_err(|e| format!("{}，刷新 Token 失败: {}", reason, e))?;
    *account = refreshed;
    Ok(())
}

/// 查询单个账号的配额
pub async fn fetch_quota(account: &CodexAccount) -> Result<FetchQuotaResult, String> {
    let client = reqwest::Client::new();

    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", account.tokens.access_token))
            .map_err(|e| format!("构建 Authorization 头失败: {}", e))?,
    );
    headers.insert(ACCEPT, HeaderValue::from_static("application/json"));

    // 添加 ChatGPT-Account-Id 头（关键！）
    let account_id = account.account_id.clone().or_else(|| {
        codex_account::extract_chatgpt_account_id_from_access_token(&account.tokens.access_token)
    });

    if let Some(ref acc_id) = account_id {
        if !acc_id.is_empty() {
            headers.insert(
                "ChatGPT-Account-Id",
                HeaderValue::from_str(acc_id)
                    .map_err(|e| format!("构建 Account-Id 头失败: {}", e))?,
            );
        }
    }

    logger::log_info(&format!(
        "Codex 配额请求: {} (account_id: {:?})",
        USAGE_URL, account_id
    ));

    let response = client
        .get(USAGE_URL)
        .headers(headers)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    let status = response.status();
    let headers = response.headers().clone();
    let body = response
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    let request_id = get_header_value(&headers, "request-id");
    let x_request_id = get_header_value(&headers, "x-request-id");
    let cf_ray = get_header_value(&headers, "cf-ray");
    let body_len = body.len();

    logger::log_info(&format!(
        "Codex 配额响应元信息: url={}, status={}, request-id={}, x-request-id={}, cf-ray={}, body_len={}",
        USAGE_URL, status, request_id, x_request_id, cf_ray, body_len
    ));

    if !status.is_success() {
        let detail_code = extract_detail_code_from_body(&body);
        let quota_reset_hint =
            extract_quota_reset_hint_from_body(&body, chrono::Utc::now().timestamp());

        logger::log_error(&format!(
            "Codex 配额接口返回非成功状态: url={}, status={}, request-id={}, x-request-id={}, cf-ray={}, detail_code={:?}, body_len={}",
            USAGE_URL,
            status,
            request_id,
            x_request_id,
            cf_ray,
            detail_code,
            body_len
        ));

        let mut error_message = format!("API 返回错误 {}", status);
        if let Some(code) = detail_code {
            error_message.push_str(&format!(" [error_code:{}]", code));
        }
        if let Some((reset_at, reset_after_seconds)) = quota_reset_hint {
            if let Some(reset_at) = reset_at {
                error_message.push_str(&format!(" [reset_at:{}]", reset_at));
            }
            if let Some(reset_after_seconds) = reset_after_seconds {
                error_message.push_str(&format!(" [reset_after_seconds:{}]", reset_after_seconds));
            }
        }
        error_message.push_str(&format!(" [body_len:{}]", body_len));
        return Err(error_message);
    }

    // 解析响应
    let usage: UsageResponse =
        serde_json::from_str(&body).map_err(|e| format!("解析 JSON 失败: {}", e))?;

    let quota = parse_quota_from_usage(&usage, &body)?;
    let plan_type = usage.plan_type.clone();

    Ok(FetchQuotaResult { quota, plan_type })
}

/// 从使用率响应中解析配额信息
fn parse_quota_from_usage(usage: &UsageResponse, raw_body: &str) -> Result<CodexQuota, String> {
    let rate_limit = usage.rate_limit.as_ref();
    let primary_window = rate_limit.and_then(|r| r.primary_window.as_ref());
    let secondary_window = rate_limit.and_then(|r| r.secondary_window.as_ref());
    let top_level_exhausted = rate_limit_marks_exhausted(rate_limit)
        || is_exhausted_rate_limit_reached_type(usage.rate_limit_reached_type.as_ref());
    let force_all_windows_exhausted = rate_limit_reached_type_forces_all_windows_exhausted(
        usage.rate_limit_reached_type.as_ref(),
    );

    let mut hourly = (100, None, None, false);
    let mut weekly = (100, None, None, false);
    let windows: Vec<&WindowInfo> = [primary_window, secondary_window]
        .into_iter()
        .flatten()
        .collect();
    let only_reported_window = windows.len() == 1;

    for window in windows {
        apply_window_to_quota_slots(
            window,
            usage_window_should_force_exhausted(
                window,
                top_level_exhausted,
                force_all_windows_exhausted,
                only_reported_window,
            ),
            &mut hourly,
            &mut weekly,
        );
    }

    // 保存原始响应
    let raw_data: Option<serde_json::Value> = serde_json::from_str(raw_body).ok();

    Ok(CodexQuota {
        hourly_percentage: hourly.0,
        hourly_reset_time: hourly.1,
        hourly_window_minutes: hourly.2,
        hourly_window_present: Some(hourly.3),
        weekly_percentage: weekly.0,
        weekly_reset_time: weekly.1,
        weekly_window_minutes: weekly.2,
        weekly_window_present: Some(weekly.3),
        raw_data,
    })
}

/// 从 id_token 中提取 plan_type 并同步更新账号和索引
fn sync_plan_type_from_token(account: &mut CodexAccount, plan_type: Option<String>) {
    if plan_type.is_none() {
        return;
    }

    let resolved_plan_type = codex_account::resolve_observed_plan_type(account, plan_type);
    let Some(ref new_plan) = resolved_plan_type else {
        return;
    };
    let old_plan = account.plan_type.clone();
    if account.plan_type.as_deref() != Some(new_plan) {
        logger::log_info(&format!(
            "Codex 账号 {} 订阅标识已更新: {:?} -> {:?}",
            account.email, old_plan, resolved_plan_type
        ));
        account.plan_type = resolved_plan_type;
        // 同步更新索引中的 plan_type
        if let Err(e) =
            codex_account::update_account_plan_type_in_index(&account.id, &account.plan_type)
        {
            logger::log_warn(&format!("更新索引 plan_type 失败: {}", e));
        }
    }
}

/// 刷新账号配额并保存（包含 token 自动刷新）
async fn refresh_account_quota_once(account_id: &str) -> Result<CodexQuota, String> {
    let mut account = codex_account::prepare_account_for_injection(account_id).await?;
    if account.is_api_key_auth() {
        account.quota = None;
        account.quota_error = None;
        account.usage_updated_at = None;
        let _ = codex_account::save_account(&account);
        return Err("API Key 账号不支持刷新配额，请在网页端查看。".to_string());
    }

    // 检查 token 是否过期，如果过期则刷新
    if crate::modules::codex_oauth::is_token_expired(&account.tokens.access_token) {
        match refresh_account_tokens(&mut account, "Token 已过期").await {
            Ok(()) => {
                logger::log_info(&format!("账号 {} 的 Token 刷新成功", account.email));

                // 从新的 id_token 重新解析 plan_type
                if let Ok((_, _, new_plan_type, _, _)) =
                    codex_account::extract_user_info(&account.tokens.id_token)
                {
                    sync_plan_type_from_token(&mut account, new_plan_type);
                }

                codex_account::save_account(&account)?;
            }
            Err(e) => {
                logger::log_error(&format!("账号 {} Token 刷新失败: {}", account.email, e));
                let message = e;
                write_quota_error(&mut account, message.clone());
                if let Err(save_err) = codex_account::save_account(&account) {
                    logger::log_warn(&format!("写入 Codex 配额错误失败: {}", save_err));
                }
                return Err(message);
            }
        }
    }

    let result = match fetch_quota(&account).await {
        Ok(result) => result,
        Err(e) => {
            write_quota_fetch_error(&mut account, e.clone());
            if let Err(save_err) = codex_account::save_account(&account) {
                logger::log_warn(&format!("写入 Codex 配额错误失败: {}", save_err));
            }
            return Err(e);
        }
    };

    account.quota = Some(result.quota.clone());

    // 从 usage 响应中的 plan_type 更新订阅标识；先挂上 quota 原文，避免 token/free 覆盖 usage=plus。
    if result.plan_type.is_some() {
        sync_plan_type_from_token(&mut account, result.plan_type);
    }

    account.quota_error = None;
    account.usage_updated_at = Some(chrono::Utc::now().timestamp());
    codex_account::save_account(&account)?;

    Ok(result.quota)
}

pub async fn refresh_account_quota(account_id: &str) -> Result<CodexQuota, String> {
    refresh_account_quota_once(account_id).await
}

/// 刷新所有账号配额
pub async fn refresh_all_quotas() -> Result<Vec<(String, Result<CodexQuota, String>)>, String> {
    use futures::future::join_all;
    use std::sync::Arc;
    use tokio::sync::Semaphore;

    const MAX_CONCURRENT: usize = 5;
    let accounts: Vec<_> = codex_account::list_accounts()
        .into_iter()
        .filter(|account| !account.is_api_key_auth())
        .collect();

    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT));
    let tasks: Vec<_> = accounts
        .into_iter()
        .map(|account| {
            let account_id = account.id;
            let semaphore = semaphore.clone();
            async move {
                let _permit = semaphore
                    .acquire_owned()
                    .await
                    .map_err(|e| format!("获取 Codex 刷新并发许可失败: {}", e))?;
                let result = refresh_account_quota(&account_id).await;
                Ok::<(String, Result<CodexQuota, String>), String>((account_id, result))
            }
        })
        .collect();

    let mut results = Vec::with_capacity(tasks.len());
    for task in join_all(tasks).await {
        match task {
            Ok(item) => results.push(item),
            Err(err) => return Err(err),
        }
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::codex::CodexTokens;

    fn test_account() -> CodexAccount {
        CodexAccount::new(
            "codex_test".to_string(),
            "user@example.com".to_string(),
            CodexTokens {
                id_token: String::new(),
                access_token: String::new(),
                refresh_token: None,
            },
        )
    }

    #[test]
    fn quota_usage_single_generic_limit_reached_zeroes_stale_window() {
        let usage: UsageResponse = serde_json::from_str(
            r#"{
              "plan_type":"free",
              "rate_limit":{
                "allowed":false,
                "limit_reached":true,
                "primary_window":{
                  "used_percent":3,
                  "limit_window_seconds":604800,
                  "reset_at":1700604800
                }
              },
              "rate_limit_reached_type":{"type":"rate_limit_reached","details":"default"}
            }"#,
        )
        .expect("usage payload should parse");

        let quota = parse_quota_from_usage(&usage, "{}").expect("quota should parse");

        assert_eq!(quota.hourly_window_present, Some(false));
        assert_eq!(quota.weekly_percentage, 0);
        assert_eq!(quota.weekly_reset_time, Some(1_700_604_800));
        assert_eq!(quota.weekly_window_present, Some(true));
    }

    #[test]
    fn quota_fetch_error_sets_exhausted_quota_to_zero() {
        let mut account = test_account();
        account.quota = Some(CodexQuota {
            hourly_percentage: 64,
            hourly_reset_time: Some(111),
            hourly_window_minutes: Some(300),
            hourly_window_present: Some(true),
            weekly_percentage: 27,
            weekly_reset_time: Some(222),
            weekly_window_minutes: Some(10080),
            weekly_window_present: Some(true),
            raw_data: None,
        });

        write_quota_fetch_error(
            &mut account,
            "API 返回错误 429 [error_code:usage_limit_reached] [body_len:42]".to_string(),
        );

        let quota = account.quota.as_ref().expect("quota snapshot");
        assert_eq!(quota.hourly_percentage, 0);
        assert_eq!(quota.weekly_percentage, 0);
        assert_eq!(quota.hourly_reset_time, Some(111));
        assert_eq!(quota.weekly_reset_time, Some(222));
        assert_eq!(
            account
                .quota_error
                .as_ref()
                .and_then(|error| error.code.as_deref()),
            Some("usage_limit_reached")
        );
        assert!(account.usage_updated_at.is_some());
    }

    #[test]
    fn quota_fetch_error_uses_reset_hint_for_exhausted_snapshot() {
        let mut account = test_account();
        account.quota = Some(CodexQuota {
            hourly_percentage: 64,
            hourly_reset_time: Some(111),
            hourly_window_minutes: Some(300),
            hourly_window_present: Some(true),
            weekly_percentage: 27,
            weekly_reset_time: Some(222),
            weekly_window_minutes: Some(10080),
            weekly_window_present: Some(true),
            raw_data: None,
        });

        write_quota_fetch_error(
            &mut account,
            "API 返回错误 429 [error_code:usage_limit_reached] [reset_at:333] [reset_after_seconds:60] [body_len:42]".to_string(),
        );

        let quota = account.quota.as_ref().expect("quota snapshot");
        assert_eq!(quota.hourly_percentage, 0);
        assert_eq!(quota.weekly_percentage, 0);
        assert_eq!(quota.hourly_reset_time, Some(333));
        assert_eq!(quota.weekly_reset_time, Some(333));
        assert_eq!(
            quota
                .raw_data
                .as_ref()
                .and_then(|value| value.get("reset_at"))
                .and_then(|value| value.as_i64()),
            Some(333)
        );
    }

    #[test]
    fn quota_reset_hint_body_computes_reset_at_from_reset_after_seconds() {
        let hint = extract_quota_reset_hint_from_body(
            r#"{"error":{"code":"usage_limit_reached","resets_in_seconds":60}}"#,
            1_700_000_000,
        )
        .expect("reset hint should parse");

        assert_eq!(hint, (Some(1_700_000_060), Some(60)));
    }

    #[test]
    fn token_refresh_error_is_not_quota_exhaustion() {
        assert!(!is_quota_exhaustion_error("Token 已过期且刷新失败"));
    }
}
