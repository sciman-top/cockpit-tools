use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, ErrorKind};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use chrono::{DateTime, Utc};
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{json, Value as JsonValue};
use toml_edit::Document;

use crate::modules;

const DEFAULT_INSTANCE_ID: &str = "__default__";
const DEFAULT_INSTANCE_NAME: &str = "默认实例";
const DEFAULT_PROVIDER_ID: &str = "openai";
const SESSION_INDEX_FILE: &str = "session_index.jsonl";
const STATE_DB_FILE: &str = "state_5.sqlite";
const CONFIG_FILE_NAME: &str = "config.toml";
const GLOBAL_STATE_FILE: &str = ".codex-global-state.json";
const SESSION_DIRS: [&str; 2] = ["sessions", "archived_sessions"];
const SESSION_VISIBILITY_REPAIR_BACKUP_PREFIX: &str = "backup-";
const SESSION_VISIBILITY_REPAIR_BACKUP_SUFFIX: &str = "-session-visibility-repair";
const MAX_SESSION_VISIBILITY_REPAIR_BACKUPS: usize = 2;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSessionVisibilityRepairItem {
    pub instance_id: String,
    pub instance_name: String,
    pub target_provider: String,
    pub changed_rollout_file_count: usize,
    pub provider_changed_rollout_file_count: usize,
    pub updated_sqlite_row_count: usize,
    pub updated_workspace_root_count: usize,
    pub updated_thread_workspace_hint_count: usize,
    pub skipped_sqlite_file: bool,
    pub backup_dir: Option<String>,
    pub running: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSessionVisibilityRepairSummary {
    pub instance_count: usize,
    pub mutated_instance_count: usize,
    pub changed_rollout_file_count: usize,
    pub provider_changed_rollout_file_count: usize,
    pub updated_sqlite_row_count: usize,
    pub updated_workspace_root_count: usize,
    pub updated_thread_workspace_hint_count: usize,
    pub repairable_metadata_count: usize,
    pub workspace_repair_count: usize,
    pub skipped_sqlite_file_count: usize,
    pub items: Vec<CodexSessionVisibilityRepairItem>,
    pub backup_dirs: Vec<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSessionVisibilityActiveWorkspaceRepairItem {
    pub instance_id: String,
    pub instance_name: String,
    pub workspace_filtered_thread_count: usize,
    pub updated_active_workspace_root_count: usize,
    pub backup_dir: Option<String>,
    pub running: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSessionVisibilityActiveWorkspaceRepairSummary {
    pub instance_count: usize,
    pub mutated_instance_count: usize,
    pub workspace_filtered_thread_count: usize,
    pub updated_active_workspace_root_count: usize,
    pub items: Vec<CodexSessionVisibilityActiveWorkspaceRepairItem>,
    pub backup_dirs: Vec<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSessionVisibilityDiagnosticItem {
    pub instance_id: String,
    pub instance_name: String,
    pub target_provider: String,
    pub rollout_thread_count: usize,
    pub provider_mismatch_thread_count: usize,
    pub sqlite_rows_to_update: usize,
    pub repairable_metadata_count: usize,
    pub workspace_filtered_thread_count: usize,
    pub workspace_root_count: usize,
    pub missing_workspace_root_count: usize,
    pub missing_thread_workspace_hint_count: usize,
    pub workspace_repair_count: usize,
    pub active_workspace_repair_root_count: usize,
    pub active_workspace_roots: Vec<String>,
    pub skipped_sqlite_file: bool,
    pub running: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSessionVisibilityDiagnosticSummary {
    pub instance_count: usize,
    pub rollout_thread_count: usize,
    pub provider_mismatch_thread_count: usize,
    pub sqlite_rows_to_update: usize,
    pub repairable_metadata_count: usize,
    pub workspace_filtered_thread_count: usize,
    pub missing_workspace_root_count: usize,
    pub missing_thread_workspace_hint_count: usize,
    pub workspace_repair_count: usize,
    pub active_workspace_repair_root_count: usize,
    pub skipped_sqlite_file_count: usize,
    pub items: Vec<CodexSessionVisibilityDiagnosticItem>,
    pub message: String,
}

#[derive(Debug, Clone)]
struct CodexSyncInstance {
    id: String,
    name: String,
    data_dir: PathBuf,
    last_pid: Option<u32>,
}

#[derive(Debug, Clone)]
struct RolloutProviderChange {
    relative_path: PathBuf,
    absolute_path: PathBuf,
    updated_first_line: Option<String>,
    target_modified_at: Option<SystemTime>,
}

#[derive(Debug, Clone, Copy)]
struct SqliteProviderScan {
    rows_to_update: usize,
    skipped_unusable_database: bool,
}

#[derive(Debug, Clone, Copy)]
struct ThreadsTableColumns {
    model_provider: bool,
    has_user_event: bool,
    first_user_message: bool,
    thread_source: bool,
}

#[derive(Debug, Clone, Default)]
struct RolloutVisibilityScan {
    thread_count: usize,
    provider_mismatch_thread_count: usize,
    workspace_filtered_thread_count: usize,
    workspace_root_count: usize,
    missing_workspace_root_count: usize,
    missing_thread_workspace_hint_count: usize,
    active_workspace_roots: Vec<String>,
    active_workspace_roots_to_add: Vec<String>,
    workspace_plan: GlobalStateWorkspaceRepairPlan,
}

#[derive(Debug, Clone, Default)]
struct GlobalStateWorkspaceRepairPlan {
    workspace_roots: Vec<String>,
    thread_workspace_hints: Vec<ThreadWorkspaceHint>,
    missing_workspace_root_count: usize,
    missing_thread_workspace_hint_count: usize,
}

#[derive(Debug, Clone)]
struct ThreadWorkspaceHint {
    thread_id: String,
    workspace_root: String,
}

pub fn diagnose_session_visibility_across_instances(
) -> Result<CodexSessionVisibilityDiagnosticSummary, String> {
    let instances = collect_instances()?;
    let process_entries = modules::process::collect_codex_process_entries();
    let mut items = Vec::with_capacity(instances.len());
    let mut rollout_thread_count = 0usize;
    let mut provider_mismatch_thread_count = 0usize;
    let mut sqlite_rows_to_update = 0usize;
    let mut repairable_metadata_count = 0usize;
    let mut workspace_filtered_thread_count = 0usize;
    let mut missing_workspace_root_count = 0usize;
    let mut missing_thread_workspace_hint_count = 0usize;
    let mut workspace_repair_count = 0usize;
    let mut active_workspace_repair_root_count = 0usize;
    let mut skipped_sqlite_file_count = 0usize;

    for instance in &instances {
        let running = is_instance_running(instance, &process_entries);
        let target_provider = read_target_provider(&instance.data_dir)?;
        let rollout_scan = scan_rollout_visibility(&instance.data_dir, &target_provider)?;
        let sqlite_scan = count_sqlite_rows_to_update(&instance.data_dir, &target_provider)?;
        if sqlite_scan.skipped_unusable_database {
            skipped_sqlite_file_count += 1;
        }

        let item_repairable_metadata_count =
            rollout_scan.provider_mismatch_thread_count + sqlite_scan.rows_to_update;
        rollout_thread_count += rollout_scan.thread_count;
        provider_mismatch_thread_count += rollout_scan.provider_mismatch_thread_count;
        sqlite_rows_to_update += sqlite_scan.rows_to_update;
        repairable_metadata_count += item_repairable_metadata_count;
        workspace_filtered_thread_count += rollout_scan.workspace_filtered_thread_count;
        missing_workspace_root_count += rollout_scan.missing_workspace_root_count;
        missing_thread_workspace_hint_count += rollout_scan.missing_thread_workspace_hint_count;
        let item_workspace_repair_count = rollout_scan.missing_workspace_root_count
            + rollout_scan.missing_thread_workspace_hint_count;
        workspace_repair_count += item_workspace_repair_count;
        active_workspace_repair_root_count += rollout_scan.active_workspace_roots_to_add.len();

        items.push(CodexSessionVisibilityDiagnosticItem {
            instance_id: instance.id.clone(),
            instance_name: instance.name.clone(),
            target_provider,
            rollout_thread_count: rollout_scan.thread_count,
            provider_mismatch_thread_count: rollout_scan.provider_mismatch_thread_count,
            sqlite_rows_to_update: sqlite_scan.rows_to_update,
            repairable_metadata_count: item_repairable_metadata_count,
            workspace_filtered_thread_count: rollout_scan.workspace_filtered_thread_count,
            workspace_root_count: rollout_scan.workspace_root_count,
            missing_workspace_root_count: rollout_scan.missing_workspace_root_count,
            missing_thread_workspace_hint_count: rollout_scan.missing_thread_workspace_hint_count,
            workspace_repair_count: item_workspace_repair_count,
            active_workspace_repair_root_count: rollout_scan.active_workspace_roots_to_add.len(),
            active_workspace_roots: rollout_scan.active_workspace_roots,
            skipped_sqlite_file: sqlite_scan.skipped_unusable_database,
            running,
        });
    }

    let message = build_diagnostic_summary_message(
        repairable_metadata_count,
        workspace_filtered_thread_count,
        missing_workspace_root_count,
        missing_thread_workspace_hint_count,
        skipped_sqlite_file_count,
    );

    Ok(CodexSessionVisibilityDiagnosticSummary {
        instance_count: instances.len(),
        rollout_thread_count,
        provider_mismatch_thread_count,
        sqlite_rows_to_update,
        repairable_metadata_count,
        workspace_filtered_thread_count,
        missing_workspace_root_count,
        missing_thread_workspace_hint_count,
        workspace_repair_count,
        active_workspace_repair_root_count,
        skipped_sqlite_file_count,
        items,
        message,
    })
}

pub fn repair_session_visibility_active_workspace_roots_across_instances(
) -> Result<CodexSessionVisibilityActiveWorkspaceRepairSummary, String> {
    let instances = collect_instances()?;
    let process_entries = modules::process::collect_codex_process_entries();
    let mut items = Vec::with_capacity(instances.len());
    let mut backup_dirs = Vec::new();
    let mut mutated_instance_count = 0usize;
    let mut workspace_filtered_thread_count = 0usize;
    let mut updated_active_workspace_root_count = 0usize;
    let mut mutated_running_instance_count = 0usize;

    for instance in &instances {
        let running = is_instance_running(instance, &process_entries);
        let target_provider = read_target_provider(&instance.data_dir)?;
        let rollout_scan = scan_rollout_visibility(&instance.data_dir, &target_provider)?;
        workspace_filtered_thread_count += rollout_scan.workspace_filtered_thread_count;
        let roots_to_add = rollout_scan.active_workspace_roots_to_add;

        if roots_to_add.is_empty() {
            items.push(CodexSessionVisibilityActiveWorkspaceRepairItem {
                instance_id: instance.id.clone(),
                instance_name: instance.name.clone(),
                workspace_filtered_thread_count: rollout_scan.workspace_filtered_thread_count,
                updated_active_workspace_root_count: 0,
                backup_dir: None,
                running,
            });
            continue;
        }

        let backup_dir = backup_instance_files(
            &instance.data_dir,
            &[],
            false,
            true,
            &instance.id,
            &target_provider,
        )?;
        let backup_dir_string = backup_dir.to_string_lossy().to_string();
        let repaired =
            update_global_state_active_workspace_roots(&instance.data_dir, &roots_to_add);
        let updated_count = match repaired {
            Ok(value) => value,
            Err(error) => {
                let restore_result =
                    restore_instance_files_from_backup(&instance.data_dir, &backup_dir, false);
                if let Err(restore_error) = restore_result {
                    return Err(format!(
                        "扩展 active workspace roots 失败 ({}): {}；自动回滚也失败: {}；备份目录: {}",
                        instance.name,
                        error,
                        restore_error,
                        backup_dir.display()
                    ));
                }
                return Err(format!(
                    "扩展 active workspace roots 失败 ({}): {}；已自动回滚，备份目录: {}",
                    instance.name,
                    error,
                    backup_dir.display()
                ));
            }
        };

        mutated_instance_count += 1;
        updated_active_workspace_root_count += updated_count;
        if running {
            mutated_running_instance_count += 1;
        }
        backup_dirs.push(backup_dir_string.clone());
        items.push(CodexSessionVisibilityActiveWorkspaceRepairItem {
            instance_id: instance.id.clone(),
            instance_name: instance.name.clone(),
            workspace_filtered_thread_count: rollout_scan.workspace_filtered_thread_count,
            updated_active_workspace_root_count: updated_count,
            backup_dir: Some(backup_dir_string),
            running,
        });
    }

    prune_session_visibility_repair_backups(&instances);

    let message = build_active_workspace_repair_summary_message(
        mutated_instance_count,
        updated_active_workspace_root_count,
        workspace_filtered_thread_count,
        mutated_running_instance_count,
    );

    Ok(CodexSessionVisibilityActiveWorkspaceRepairSummary {
        instance_count: instances.len(),
        mutated_instance_count,
        workspace_filtered_thread_count,
        updated_active_workspace_root_count,
        items,
        backup_dirs,
        message,
    })
}

pub fn repair_session_visibility_across_instances(
) -> Result<CodexSessionVisibilityRepairSummary, String> {
    let instances = collect_instances()?;
    let process_entries = modules::process::collect_codex_process_entries();
    let mut items = Vec::with_capacity(instances.len());
    let mut backup_dirs = Vec::new();
    let mut mutated_instance_count = 0usize;
    let mut changed_rollout_file_count = 0usize;
    let mut provider_changed_rollout_file_count = 0usize;
    let mut updated_sqlite_row_count = 0usize;
    let mut updated_workspace_root_count = 0usize;
    let mut updated_thread_workspace_hint_count = 0usize;
    let mut repairable_metadata_count = 0usize;
    let mut workspace_repair_count = 0usize;
    let mut skipped_sqlite_file_count = 0usize;
    let mut mutated_running_instance_count = 0usize;

    for instance in &instances {
        let running = is_instance_running(instance, &process_entries);
        let target_provider = read_target_provider(&instance.data_dir)?;
        let rollout_changes =
            collect_rollout_provider_changes(&instance.data_dir, &target_provider)?;
        let provider_rollout_changes = rollout_changes
            .iter()
            .filter(|change| change.updated_first_line.is_some())
            .count();
        let sqlite_scan = count_sqlite_rows_to_update(&instance.data_dir, &target_provider)?;
        let sqlite_rows_to_update = sqlite_scan.rows_to_update;
        let rollout_scan = scan_rollout_visibility(&instance.data_dir, &target_provider)?;
        let workspace_plan = rollout_scan.workspace_plan;
        let workspace_roots_to_update = workspace_plan.missing_workspace_root_count;
        let thread_workspace_hints_to_update = workspace_plan.missing_thread_workspace_hint_count;
        if sqlite_scan.skipped_unusable_database {
            skipped_sqlite_file_count += 1;
        }

        if rollout_changes.is_empty()
            && sqlite_rows_to_update == 0
            && workspace_roots_to_update == 0
            && thread_workspace_hints_to_update == 0
        {
            items.push(CodexSessionVisibilityRepairItem {
                instance_id: instance.id.clone(),
                instance_name: instance.name.clone(),
                target_provider,
                changed_rollout_file_count: 0,
                provider_changed_rollout_file_count: 0,
                updated_sqlite_row_count: 0,
                updated_workspace_root_count: 0,
                updated_thread_workspace_hint_count: 0,
                skipped_sqlite_file: sqlite_scan.skipped_unusable_database,
                backup_dir: None,
                running,
            });
            continue;
        }

        let backup_dir = backup_instance_files(
            &instance.data_dir,
            &rollout_changes,
            sqlite_rows_to_update > 0,
            workspace_roots_to_update > 0 || thread_workspace_hints_to_update > 0,
            &instance.id,
            &target_provider,
        )?;
        let backup_dir_string = backup_dir.to_string_lossy().to_string();

        let repaired = repair_single_instance(
            &instance.data_dir,
            &target_provider,
            &rollout_changes,
            sqlite_rows_to_update > 0,
            &workspace_plan,
        );
        let sqlite_rows_updated = match repaired {
            Ok(value) => value,
            Err(error) => {
                let restore_result = restore_instance_files_from_backup(
                    &instance.data_dir,
                    &backup_dir,
                    sqlite_rows_to_update > 0,
                );
                if let Err(restore_error) = restore_result {
                    return Err(format!(
                        "修复实例历史会话可见性失败 ({}): {}；自动回滚也失败: {}；备份目录: {}",
                        instance.name,
                        error,
                        restore_error,
                        backup_dir.display()
                    ));
                }
                return Err(format!(
                    "修复实例历史会话可见性失败 ({}): {}；已自动回滚，备份目录: {}",
                    instance.name,
                    error,
                    backup_dir.display()
                ));
            }
        };

        mutated_instance_count += 1;
        changed_rollout_file_count += rollout_changes.len();
        provider_changed_rollout_file_count += provider_rollout_changes;
        updated_sqlite_row_count += sqlite_rows_updated;
        updated_workspace_root_count += workspace_roots_to_update;
        updated_thread_workspace_hint_count += thread_workspace_hints_to_update;
        repairable_metadata_count += provider_rollout_changes + sqlite_rows_updated;
        workspace_repair_count += workspace_roots_to_update + thread_workspace_hints_to_update;
        if running {
            mutated_running_instance_count += 1;
        }
        backup_dirs.push(backup_dir_string.clone());
        items.push(CodexSessionVisibilityRepairItem {
            instance_id: instance.id.clone(),
            instance_name: instance.name.clone(),
            target_provider,
            changed_rollout_file_count: rollout_changes.len(),
            provider_changed_rollout_file_count: provider_rollout_changes,
            updated_sqlite_row_count: sqlite_rows_updated,
            updated_workspace_root_count: workspace_roots_to_update,
            updated_thread_workspace_hint_count: thread_workspace_hints_to_update,
            skipped_sqlite_file: sqlite_scan.skipped_unusable_database,
            backup_dir: Some(backup_dir_string),
            running,
        });
    }

    prune_session_visibility_repair_backups(&instances);

    let message = build_summary_message(
        mutated_instance_count,
        changed_rollout_file_count,
        updated_sqlite_row_count,
        mutated_running_instance_count,
        skipped_sqlite_file_count,
    );

    Ok(CodexSessionVisibilityRepairSummary {
        instance_count: instances.len(),
        mutated_instance_count,
        changed_rollout_file_count,
        provider_changed_rollout_file_count,
        updated_sqlite_row_count,
        updated_workspace_root_count,
        updated_thread_workspace_hint_count,
        repairable_metadata_count,
        workspace_repair_count,
        skipped_sqlite_file_count,
        items,
        backup_dirs,
        message,
    })
}

pub fn read_history_visibility_provider_for_dir(data_dir: &Path) -> Result<String, String> {
    read_target_provider(data_dir)
}

fn repair_single_instance(
    data_dir: &Path,
    target_provider: &str,
    rollout_changes: &[RolloutProviderChange],
    update_sqlite: bool,
    workspace_plan: &GlobalStateWorkspaceRepairPlan,
) -> Result<usize, String> {
    let sqlite_rows_updated = if update_sqlite {
        update_sqlite_provider(data_dir, target_provider)?
    } else {
        0
    };
    for change in rollout_changes {
        rewrite_rollout_provider(change)?;
    }
    update_global_state_workspaces(data_dir, workspace_plan)?;
    Ok(sqlite_rows_updated)
}

fn build_summary_message(
    mutated_instance_count: usize,
    changed_rollout_file_count: usize,
    updated_sqlite_row_count: usize,
    mutated_running_instance_count: usize,
    _skipped_sqlite_file_count: usize,
) -> String {
    if mutated_instance_count == 0 {
        return "所有 Codex 实例的历史会话 provider 元数据与工作区索引已一致，无需修复".to_string();
    }

    if mutated_running_instance_count > 0 {
        return format!(
            "已为 {} 个实例修复历史会话可见性：改写 {} 个 rollout 文件，更新 {} 条 SQLite 记录，并同步工作区索引。运行中的实例可能需要刷新或重启后显示",
            mutated_instance_count, changed_rollout_file_count, updated_sqlite_row_count
        );
    }

    format!(
        "已为 {} 个实例修复历史会话可见性：改写 {} 个 rollout 文件，更新 {} 条 SQLite 记录，并同步工作区索引",
        mutated_instance_count, changed_rollout_file_count, updated_sqlite_row_count
    )
}

fn build_active_workspace_repair_summary_message(
    mutated_instance_count: usize,
    updated_active_workspace_root_count: usize,
    workspace_filtered_thread_count: usize,
    mutated_running_instance_count: usize,
) -> String {
    if mutated_instance_count == 0 {
        if workspace_filtered_thread_count > 0 {
            return format!(
                "当前 active workspace roots 已覆盖历史会话工作区；仍有 {} 条会话受过滤时，请刷新 Codex App 项目视图",
                workspace_filtered_thread_count
            );
        }
        return "当前 active workspace roots 已覆盖历史会话工作区，无需扩展".to_string();
    }

    if mutated_running_instance_count > 0 {
        return format!(
            "已为 {} 个实例扩展 active workspace roots：新增 {} 个历史工作区。运行中的实例可能需要刷新或重启后显示",
            mutated_instance_count, updated_active_workspace_root_count
        );
    }

    format!(
        "已为 {} 个实例扩展 active workspace roots：新增 {} 个历史工作区",
        mutated_instance_count, updated_active_workspace_root_count
    )
}

fn build_diagnostic_summary_message(
    repairable_metadata_count: usize,
    workspace_filtered_thread_count: usize,
    missing_workspace_root_count: usize,
    missing_thread_workspace_hint_count: usize,
    skipped_sqlite_file_count: usize,
) -> String {
    let workspace_repair_count = missing_workspace_root_count + missing_thread_workspace_hint_count;
    if repairable_metadata_count == 0 && workspace_repair_count == 0 {
        if workspace_filtered_thread_count > 0 {
            return format!(
                "未发现可自动写入的 provider 或工作区索引差异；有 {} 条会话的 cwd 不在当前 active workspace roots 中，可能仍会被当前项目视图过滤",
                workspace_filtered_thread_count
            );
        }
        if skipped_sqlite_file_count > 0 {
            return format!(
                "未发现可自动写入的会话可见性差异；已跳过 {} 个无效或损坏的 state_5.sqlite",
                skipped_sqlite_file_count
            );
        }
        return "未发现会话可见性差异".to_string();
    }

    let mut parts = Vec::new();
    if repairable_metadata_count > 0 {
        parts.push(format!(
            "{} 项 provider/SQLite 元数据可修复",
            repairable_metadata_count
        ));
    }
    if workspace_repair_count > 0 {
        parts.push(format!(
            "{} 项工作区索引或线程归属 hint 可同步",
            workspace_repair_count
        ));
    }
    if workspace_filtered_thread_count > 0 {
        parts.push(format!(
            "{} 条会话可能仍受当前 active workspace roots 过滤",
            workspace_filtered_thread_count
        ));
    }
    if skipped_sqlite_file_count > 0 {
        parts.push(format!(
            "已跳过 {} 个无效或损坏的 state_5.sqlite",
            skipped_sqlite_file_count
        ));
    }
    parts.join("；")
}

fn collect_instances() -> Result<Vec<CodexSyncInstance>, String> {
    let mut instances = Vec::new();
    let default_dir = modules::codex_instance::get_default_codex_home()?;
    let store = modules::codex_instance::load_instance_store()?;
    instances.push(CodexSyncInstance {
        id: DEFAULT_INSTANCE_ID.to_string(),
        name: DEFAULT_INSTANCE_NAME.to_string(),
        data_dir: default_dir,
        last_pid: store.default_settings.last_pid,
    });

    for instance in store.instances {
        let user_data_dir = instance.user_data_dir.trim();
        if user_data_dir.is_empty() {
            continue;
        }
        instances.push(CodexSyncInstance {
            id: instance.id,
            name: instance.name,
            data_dir: PathBuf::from(user_data_dir),
            last_pid: instance.last_pid,
        });
    }

    Ok(instances)
}

fn is_instance_running(
    instance: &CodexSyncInstance,
    process_entries: &[(u32, Option<String>)],
) -> bool {
    let codex_home = if instance.id == DEFAULT_INSTANCE_ID {
        None
    } else {
        instance.data_dir.to_str()
    };
    modules::process::resolve_codex_pid_from_entries(instance.last_pid, codex_home, process_entries)
        .is_some()
}

fn read_target_provider(data_dir: &Path) -> Result<String, String> {
    let config_path = data_dir.join(CONFIG_FILE_NAME);
    if !config_path.exists() {
        return Ok(DEFAULT_PROVIDER_ID.to_string());
    }

    let content = fs::read_to_string(&config_path).map_err(|error| {
        format!(
            "读取 config.toml 失败 ({}): {}",
            config_path.display(),
            error
        )
    })?;
    if content.trim().is_empty() {
        return Ok(DEFAULT_PROVIDER_ID.to_string());
    }

    let doc = content.parse::<Document>().map_err(|error| {
        format!(
            "解析 config.toml 失败 ({}): {}",
            config_path.display(),
            error
        )
    })?;
    let provider = doc
        .get("model_provider")
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_PROVIDER_ID);
    Ok(provider.to_string())
}

fn scan_rollout_visibility(
    data_dir: &Path,
    target_provider: &str,
) -> Result<RolloutVisibilityScan, String> {
    let mut thread_count = 0usize;
    let mut provider_mismatch_thread_count = 0usize;
    let mut hints = Vec::<ThreadWorkspaceHint>::new();
    let mut seen_hints = HashSet::<String>::new();
    let mut workspace_roots = Vec::<String>::new();
    let mut seen_roots = HashSet::<String>::new();

    for dir_name in SESSION_DIRS {
        let root_dir = data_dir.join(dir_name);
        if !root_dir.exists() {
            continue;
        }
        for rollout_path in list_rollout_files(&root_dir)? {
            let Some((first_line, _separator)) = read_first_line(&rollout_path)? else {
                continue;
            };
            let Some(parsed) = parse_session_meta_record(&first_line) else {
                continue;
            };
            let Some(thread_id) = session_meta_id(&parsed) else {
                continue;
            };
            thread_count += 1;

            let current_provider = parsed["payload"]
                .get("model_provider")
                .and_then(JsonValue::as_str)
                .unwrap_or("");
            if current_provider != target_provider {
                provider_mismatch_thread_count += 1;
            }

            let Some(workspace_root) =
                session_meta_cwd(&parsed).and_then(|cwd| normalize_workspace_root(&cwd))
            else {
                continue;
            };
            if seen_roots.insert(workspace_root.clone()) {
                workspace_roots.push(workspace_root.clone());
            }
            if seen_hints.insert(thread_id.clone()) {
                hints.push(ThreadWorkspaceHint {
                    thread_id,
                    workspace_root,
                });
            }
        }
    }

    let global_state = read_global_state(data_dir)?;
    let object = global_state.as_object();
    let active_workspace_roots = object
        .map(|object| read_normalized_string_array(object, "active-workspace-roots"))
        .unwrap_or_default();
    let workspace_root_count = workspace_roots.len();

    let missing_workspace_roots = object
        .map(|object| {
            workspace_roots
                .iter()
                .filter(|root| {
                    !global_state_array_contains(object, "project-order", root)
                        || !global_state_array_contains(
                            object,
                            "electron-saved-workspace-roots",
                            root,
                        )
                })
                .cloned()
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| workspace_roots.clone());
    let missing_thread_workspace_hints = object
        .map(|object| {
            hints
                .iter()
                .filter(|hint| !global_state_thread_hint_matches(object, hint))
                .cloned()
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| hints.clone());
    let workspace_filtered_thread_count = if active_workspace_roots.is_empty() {
        0
    } else {
        hints
            .iter()
            .filter(|hint| {
                !active_workspace_roots
                    .iter()
                    .any(|root| root == &hint.workspace_root)
            })
            .count()
    };
    let active_workspace_roots_to_add = if active_workspace_roots.is_empty() {
        Vec::new()
    } else {
        workspace_roots
            .iter()
            .filter(|root| !active_workspace_roots.iter().any(|active| active == *root))
            .cloned()
            .collect::<Vec<_>>()
    };

    Ok(RolloutVisibilityScan {
        thread_count,
        provider_mismatch_thread_count,
        workspace_filtered_thread_count,
        workspace_root_count,
        missing_workspace_root_count: missing_workspace_roots.len(),
        missing_thread_workspace_hint_count: missing_thread_workspace_hints.len(),
        active_workspace_roots,
        active_workspace_roots_to_add,
        workspace_plan: GlobalStateWorkspaceRepairPlan {
            workspace_roots,
            thread_workspace_hints: hints,
            missing_workspace_root_count: missing_workspace_roots.len(),
            missing_thread_workspace_hint_count: missing_thread_workspace_hints.len(),
        },
    })
}

fn collect_rollout_provider_changes(
    data_dir: &Path,
    target_provider: &str,
) -> Result<Vec<RolloutProviderChange>, String> {
    let session_index_map = match read_session_index_map(data_dir) {
        Ok(value) => value,
        Err(error) => {
            modules::logger::log_warn(&format!(
                "读取 Codex session_index.jsonl 失败，跳过该时间来源并继续修复会话可见性: {}",
                error
            ));
            HashMap::new()
        }
    };
    let mut changes = Vec::new();

    for dir_name in SESSION_DIRS {
        let root_dir = data_dir.join(dir_name);
        if !root_dir.exists() {
            continue;
        }
        let rollout_paths = list_rollout_files(&root_dir)?;
        for rollout_path in rollout_paths {
            let Some((first_line, _separator)) = read_first_line(&rollout_path)? else {
                continue;
            };
            let Some(mut parsed) = parse_session_meta_record(&first_line) else {
                continue;
            };
            let session_id = session_meta_id(&parsed);
            let target_modified_at = session_id
                .as_deref()
                .and_then(|id| session_index_map.get(id))
                .and_then(parse_session_index_updated_at_ms)
                .or_else(|| rollout_file_activity_ms(&rollout_path))
                .and_then(modules::codex_session_file_time::system_time_from_unix_millis);
            let current_modified_at =
                modules::codex_session_file_time::read_modified_time(&rollout_path);
            let current_provider = parsed["payload"]
                .get("model_provider")
                .and_then(JsonValue::as_str)
                .unwrap_or("");
            let provider_matches = current_provider == target_provider;
            let modified_time_matches = target_modified_at.is_none()
                || modules::codex_session_file_time::same_modified_time_millis(
                    current_modified_at,
                    target_modified_at,
                );
            if provider_matches && modified_time_matches {
                continue;
            }

            let updated_first_line = if provider_matches {
                None
            } else if let Some(payload) =
                parsed.get_mut("payload").and_then(JsonValue::as_object_mut)
            {
                payload.insert(
                    "model_provider".to_string(),
                    JsonValue::String(target_provider.to_string()),
                );
                Some(
                    serde_json::to_string(&parsed)
                        .map_err(|error| format!("序列化 session_meta 失败: {}", error))?,
                )
            } else {
                None
            };

            let relative_path = rollout_path
                .strip_prefix(data_dir)
                .map_err(|_| format!("无法计算 rollout 相对路径: {}", rollout_path.display()))?;
            changes.push(RolloutProviderChange {
                relative_path: relative_path.to_path_buf(),
                absolute_path: rollout_path,
                updated_first_line,
                target_modified_at,
            });
        }
    }

    changes.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(changes)
}

fn list_rollout_files(root_dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut result = Vec::new();
    let entries = fs::read_dir(root_dir)
        .map_err(|error| format!("读取目录失败 ({}): {}", root_dir.display(), error))?;

    for entry in entries {
        let entry =
            entry.map_err(|error| format!("读取目录项失败 ({}): {}", root_dir.display(), error))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("读取文件类型失败 ({}): {}", path.display(), error))?;
        if file_type.is_dir() {
            result.extend(list_rollout_files(&path)?);
            continue;
        }
        if file_type.is_file() {
            let file_name = path
                .file_name()
                .and_then(|item| item.to_str())
                .unwrap_or_default();
            if file_name.starts_with("rollout-") && file_name.ends_with(".jsonl") {
                result.push(path);
            }
        }
    }

    result.sort();
    Ok(result)
}

fn read_first_line(path: &Path) -> Result<Option<(String, String)>, String> {
    let file = fs::File::open(path)
        .map_err(|error| format!("打开 rollout 文件失败 ({}): {}", path.display(), error))?;
    let mut reader = BufReader::new(file);
    let mut buffer = Vec::new();
    let bytes_read = reader
        .read_until(b'\n', &mut buffer)
        .map_err(|error| format!("读取 rollout 首行失败 ({}): {}", path.display(), error))?;
    if bytes_read == 0 {
        return Ok(None);
    }

    let (line_bytes, separator) = if buffer.ends_with(b"\r\n") {
        (&buffer[..buffer.len() - 2], "\r\n")
    } else if buffer.ends_with(b"\n") {
        (&buffer[..buffer.len() - 1], "\n")
    } else {
        (&buffer[..], "")
    };

    let line = String::from_utf8(line_bytes.to_vec()).map_err(|error| {
        format!(
            "解析 rollout 首行 UTF-8 失败 ({}): {}",
            path.display(),
            error
        )
    })?;
    Ok(Some((line, separator.to_string())))
}

fn parse_session_meta_record(first_line: &str) -> Option<JsonValue> {
    if first_line.trim().is_empty() {
        return None;
    }

    let parsed = serde_json::from_str::<JsonValue>(first_line).ok()?;
    if parsed.get("type").and_then(JsonValue::as_str) != Some("session_meta") {
        return None;
    }
    if !parsed.get("payload").is_some_and(JsonValue::is_object) {
        return None;
    }
    Some(parsed)
}

fn session_meta_id(meta: &JsonValue) -> Option<String> {
    meta.get("payload")
        .and_then(|payload| payload.get("id").or_else(|| payload.get("session_id")))
        .and_then(JsonValue::as_str)
        .map(str::to_string)
        .or_else(|| {
            meta.get("id")
                .or_else(|| meta.get("session_id"))
                .and_then(JsonValue::as_str)
                .map(str::to_string)
        })
}

fn session_meta_cwd(meta: &JsonValue) -> Option<String> {
    meta.get("payload")
        .and_then(|payload| payload.get("cwd"))
        .or_else(|| meta.get("cwd"))
        .and_then(JsonValue::as_str)
        .map(str::to_string)
}

fn normalize_workspace_root(value: &str) -> Option<String> {
    let mut value = value.trim();
    if value.is_empty() {
        return None;
    }
    if let Some(stripped) = value.strip_prefix("\\\\?\\") {
        value = stripped;
    }

    let is_windows_path = value.starts_with("\\\\")
        || value
            .as_bytes()
            .get(1)
            .is_some_and(|separator| *separator == b':');
    let separator = if is_windows_path { '\\' } else { '/' };
    let mut normalized = if is_windows_path {
        value.replace('/', "\\")
    } else {
        value.replace('\\', "/")
    };
    while normalized.len() > 3 && normalized.ends_with(separator) {
        normalized.pop();
    }

    if normalized.trim().is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn read_global_state(root_dir: &Path) -> Result<JsonValue, String> {
    let path = root_dir.join(GLOBAL_STATE_FILE);
    if !path.exists() {
        return Ok(json!({}));
    }

    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("读取 Codex 全局状态失败 ({}): {}", path.display(), error))?;
    Ok(serde_json::from_str::<JsonValue>(&raw).unwrap_or_else(|_| json!({})))
}

fn read_normalized_string_array(
    object: &serde_json::Map<String, JsonValue>,
    key: &str,
) -> Vec<String> {
    object
        .get(key)
        .and_then(JsonValue::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str().and_then(normalize_workspace_root))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn global_state_array_contains(
    object: &serde_json::Map<String, JsonValue>,
    key: &str,
    workspace: &str,
) -> bool {
    object
        .get(key)
        .and_then(JsonValue::as_array)
        .map(|values| {
            values.iter().any(|value| {
                value.as_str().and_then(normalize_workspace_root).as_deref() == Some(workspace)
            })
        })
        .unwrap_or(false)
}

fn global_state_thread_hint_matches(
    object: &serde_json::Map<String, JsonValue>,
    hint: &ThreadWorkspaceHint,
) -> bool {
    object
        .get("thread-workspace-root-hints")
        .and_then(JsonValue::as_object)
        .and_then(|hints| hints.get(&hint.thread_id))
        .and_then(JsonValue::as_str)
        .and_then(normalize_workspace_root)
        .as_deref()
        == Some(hint.workspace_root.as_str())
}

fn update_global_state_workspaces(
    root_dir: &Path,
    plan: &GlobalStateWorkspaceRepairPlan,
) -> Result<bool, String> {
    if plan.workspace_roots.is_empty() && plan.thread_workspace_hints.is_empty() {
        return Ok(false);
    }

    let path = root_dir.join(GLOBAL_STATE_FILE);
    let mut value = read_global_state(root_dir)?;
    if !value.is_object() {
        value = json!({});
    }
    let Some(object) = value.as_object_mut() else {
        return Err("Codex 全局状态文件格式无效".to_string());
    };

    let mut changed = false;
    changed |= merge_string_array(object, "project-order", &plan.workspace_roots);
    changed |= merge_string_array(
        object,
        "electron-saved-workspace-roots",
        &plan.workspace_roots,
    );
    changed |= merge_thread_workspace_hints(object, &plan.thread_workspace_hints);

    if changed {
        let serialized = serde_json::to_string_pretty(&value)
            .map_err(|error| format!("序列化 Codex 全局状态失败: {}", error))?;
        modules::atomic_write::write_string_atomic(&path, &format!("{}\n", serialized))
            .map_err(|error| format!("写入 Codex 全局状态失败 ({}): {}", path.display(), error))?;
    }

    Ok(changed)
}

fn update_global_state_active_workspace_roots(
    root_dir: &Path,
    roots: &[String],
) -> Result<usize, String> {
    if roots.is_empty() {
        return Ok(0);
    }

    let path = root_dir.join(GLOBAL_STATE_FILE);
    let mut value = read_global_state(root_dir)?;
    if !value.is_object() {
        value = json!({});
    }
    let Some(object) = value.as_object_mut() else {
        return Err("Codex 全局状态文件格式无效".to_string());
    };

    let updated_count = merge_string_array_count(object, "active-workspace-roots", roots);
    if updated_count > 0 {
        let serialized = serde_json::to_string_pretty(&value)
            .map_err(|error| format!("序列化 Codex 全局状态失败: {}", error))?;
        modules::atomic_write::write_string_atomic(&path, &format!("{}\n", serialized))
            .map_err(|error| format!("写入 Codex 全局状态失败 ({}): {}", path.display(), error))?;
    }

    Ok(updated_count)
}

fn merge_string_array(
    object: &mut serde_json::Map<String, JsonValue>,
    key: &str,
    additions: &[String],
) -> bool {
    let mut changed = false;
    let mut values = object
        .get(key)
        .and_then(JsonValue::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| item.as_str().map(|value| value.to_string()))
        .collect::<Vec<_>>();
    let mut normalized_values = values
        .iter()
        .filter_map(|value| normalize_workspace_root(value))
        .collect::<HashSet<_>>();

    for addition in additions {
        let Some(normalized) = normalize_workspace_root(addition) else {
            continue;
        };
        if normalized_values.insert(normalized.clone()) {
            values.push(normalized);
            changed = true;
        }
    }

    if changed {
        object.insert(
            key.to_string(),
            JsonValue::Array(values.into_iter().map(JsonValue::String).collect()),
        );
    }

    changed
}

fn merge_string_array_count(
    object: &mut serde_json::Map<String, JsonValue>,
    key: &str,
    additions: &[String],
) -> usize {
    let mut updated_count = 0usize;
    let mut values = object
        .get(key)
        .and_then(JsonValue::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| item.as_str().map(|value| value.to_string()))
        .collect::<Vec<_>>();
    let mut normalized_values = values
        .iter()
        .filter_map(|value| normalize_workspace_root(value))
        .collect::<HashSet<_>>();

    for addition in additions {
        let Some(normalized) = normalize_workspace_root(addition) else {
            continue;
        };
        if normalized_values.insert(normalized.clone()) {
            values.push(normalized);
            updated_count += 1;
        }
    }

    if updated_count > 0 {
        object.insert(
            key.to_string(),
            JsonValue::Array(values.into_iter().map(JsonValue::String).collect()),
        );
    }

    updated_count
}

fn merge_thread_workspace_hints(
    object: &mut serde_json::Map<String, JsonValue>,
    additions: &[ThreadWorkspaceHint],
) -> bool {
    let mut changed = false;
    if !object
        .get("thread-workspace-root-hints")
        .is_some_and(JsonValue::is_object)
    {
        object.insert("thread-workspace-root-hints".to_string(), json!({}));
        changed = true;
    }
    let Some(hints) = object
        .get_mut("thread-workspace-root-hints")
        .and_then(JsonValue::as_object_mut)
    else {
        return changed;
    };

    for addition in additions {
        let Some(normalized) = normalize_workspace_root(&addition.workspace_root) else {
            continue;
        };
        let current = hints
            .get(&addition.thread_id)
            .and_then(JsonValue::as_str)
            .and_then(normalize_workspace_root);
        if current.as_deref() == Some(normalized.as_str()) {
            continue;
        }
        hints.insert(addition.thread_id.clone(), JsonValue::String(normalized));
        changed = true;
    }

    changed
}

fn read_session_index_map(root_dir: &Path) -> Result<HashMap<String, JsonValue>, String> {
    let path = root_dir.join(SESSION_INDEX_FILE);
    if !path.exists() {
        return Ok(HashMap::new());
    }

    let content = fs::read_to_string(&path).map_err(|error| {
        format!(
            "读取 session_index.jsonl 失败 ({}): {}",
            path.display(),
            error
        )
    })?;
    let mut entries = HashMap::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(parsed) = serde_json::from_str::<JsonValue>(trimmed) else {
            continue;
        };
        let Some(id) = parsed.get("id").and_then(JsonValue::as_str) else {
            continue;
        };
        entries.insert(id.to_string(), parsed);
    }

    Ok(entries)
}

fn parse_session_index_updated_at_ms(entry: &JsonValue) -> Option<i128> {
    [
        "updated_at",
        "updatedAt",
        "last_updated_at",
        "lastUpdatedAt",
    ]
    .iter()
    .filter_map(|key| entry.get(*key))
    .find_map(parse_json_timestamp_ms)
}

fn rollout_file_activity_ms(path: &Path) -> Option<i128> {
    let content = fs::read_to_string(path).ok()?;
    content
        .lines()
        .filter_map(|line| serde_json::from_str::<JsonValue>(line.trim()).ok())
        .filter_map(|value| parse_rollout_line_timestamp_ms(&value))
        .max()
}

fn parse_rollout_line_timestamp_ms(value: &JsonValue) -> Option<i128> {
    value
        .get("timestamp")
        .or_else(|| value.get("time"))
        .or_else(|| value.get("created_at"))
        .or_else(|| value.get("createdAt"))
        .and_then(parse_json_timestamp_ms)
        .or_else(|| {
            value
                .get("payload")
                .and_then(|payload| {
                    payload
                        .get("timestamp")
                        .or_else(|| payload.get("time"))
                        .or_else(|| payload.get("created_at"))
                        .or_else(|| payload.get("createdAt"))
                })
                .and_then(parse_json_timestamp_ms)
        })
}

fn parse_json_timestamp_ms(value: &JsonValue) -> Option<i128> {
    match value {
        JsonValue::Number(number) => number.as_i64().map(normalize_codex_timestamp_ms),
        JsonValue::String(text) => DateTime::parse_from_rfc3339(text)
            .ok()
            .map(|value| value.timestamp_millis() as i128)
            .or_else(|| text.parse::<i64>().ok().map(normalize_codex_timestamp_ms)),
        _ => None,
    }
}

fn normalize_codex_timestamp_ms(timestamp: i64) -> i128 {
    let timestamp = timestamp as i128;
    if timestamp > 10_000_000_000_000 {
        timestamp / 1_000
    } else if timestamp > 10_000_000_000 {
        timestamp
    } else {
        timestamp * 1_000
    }
}

fn is_missing_threads_table_error(error: &rusqlite::Error) -> bool {
    error
        .to_string()
        .to_ascii_lowercase()
        .contains("no such table: threads")
}

fn log_skipped_sqlite_database(path: &Path, reason: &str) {
    modules::logger::log_warn(&format!(
        "跳过无效或损坏的 Codex state_5.sqlite ({}): {}",
        path.display(),
        reason
    ));
}

fn count_sqlite_rows_to_update(
    data_dir: &Path,
    target_provider: &str,
) -> Result<SqliteProviderScan, String> {
    let db_path = data_dir.join(STATE_DB_FILE);
    if !db_path.exists() {
        return Ok(SqliteProviderScan {
            rows_to_update: 0,
            skipped_unusable_database: false,
        });
    }

    let connection = match Connection::open(&db_path) {
        Ok(connection) => connection,
        Err(error) if modules::db::is_unusable_sqlite_database_error(&error) => {
            log_skipped_sqlite_database(&db_path, &error.to_string());
            return Ok(SqliteProviderScan {
                rows_to_update: 0,
                skipped_unusable_database: true,
            });
        }
        Err(error) => {
            return Err(format!(
                "打开实例数据库失败 ({}): {}",
                db_path.display(),
                error
            ));
        }
    };
    let columns = match read_threads_table_columns(&connection) {
        Ok(columns) => columns,
        Err(error) if modules::db::is_unusable_sqlite_database_error(&error) => {
            log_skipped_sqlite_database(&db_path, &error.to_string());
            return Ok(SqliteProviderScan {
                rows_to_update: 0,
                skipped_unusable_database: true,
            });
        }
        Err(error) => {
            return Err(format_sqlite_read_error(
                &db_path,
                "读取 SQLite threads 表结构失败",
                &error,
            ));
        }
    };
    let Some(columns) = columns else {
        return Ok(SqliteProviderScan {
            rows_to_update: 0,
            skipped_unusable_database: false,
        });
    };
    let Some(where_clause) = build_threads_repair_where_clause(columns) else {
        return Ok(SqliteProviderScan {
            rows_to_update: 0,
            skipped_unusable_database: false,
        });
    };
    let sql = format!("SELECT COUNT(*) FROM threads WHERE {where_clause}");
    let count_result = if columns.model_provider {
        connection.query_row(sql.as_str(), [target_provider], |row| {
            row.get::<usize, i64>(0)
        })
    } else {
        connection.query_row(sql.as_str(), [], |row| row.get::<usize, i64>(0))
    };
    let count = match count_result {
        Ok(count) => count,
        Err(error) if modules::db::is_unusable_sqlite_database_error(&error) => {
            log_skipped_sqlite_database(&db_path, &error.to_string());
            return Ok(SqliteProviderScan {
                rows_to_update: 0,
                skipped_unusable_database: true,
            });
        }
        Err(error) if is_missing_threads_table_error(&error) => {
            return Ok(SqliteProviderScan {
                rows_to_update: 0,
                skipped_unusable_database: false,
            });
        }
        Err(error) => {
            return Err(format!(
                "统计 SQLite 会话可见性差异失败 ({}): {}",
                db_path.display(),
                error
            ));
        }
    };
    Ok(SqliteProviderScan {
        rows_to_update: count.max(0) as usize,
        skipped_unusable_database: false,
    })
}

fn update_sqlite_provider(data_dir: &Path, target_provider: &str) -> Result<usize, String> {
    let db_path = data_dir.join(STATE_DB_FILE);
    if !db_path.exists() {
        return Ok(0);
    }

    let mut connection = match Connection::open(&db_path) {
        Ok(connection) => connection,
        Err(error) if modules::db::is_unusable_sqlite_database_error(&error) => {
            log_skipped_sqlite_database(&db_path, &error.to_string());
            return Ok(0);
        }
        Err(error) => {
            return Err(format!(
                "打开实例数据库失败 ({}): {}",
                db_path.display(),
                error
            ));
        }
    };
    connection
        .busy_timeout(Duration::from_secs(3))
        .map_err(|error| {
            format!(
                "设置 SQLite busy_timeout 失败 ({}): {}",
                db_path.display(),
                error
            )
        })?;
    let columns = match read_threads_table_columns(&connection) {
        Ok(columns) => columns,
        Err(error) if modules::db::is_unusable_sqlite_database_error(&error) => {
            log_skipped_sqlite_database(&db_path, &error.to_string());
            return Ok(0);
        }
        Err(error) => {
            return Err(format_sqlite_read_error(
                &db_path,
                "读取 SQLite threads 表结构失败",
                &error,
            ));
        }
    };
    let Some(columns) = columns else {
        return Ok(0);
    };
    let Some(where_clause) = build_threads_repair_where_clause(columns) else {
        return Ok(0);
    };
    let set_clause = build_threads_repair_set_clause(columns);
    let transaction = connection
        .transaction()
        .map_err(|error| format_sqlite_write_error(&db_path, &error))?;
    let sql = format!("UPDATE threads SET {set_clause} WHERE {where_clause}");
    let update_result = if columns.model_provider {
        transaction.execute(sql.as_str(), [target_provider])
    } else {
        transaction.execute(sql.as_str(), [])
    };
    let updated_rows = match update_result {
        Ok(updated_rows) => updated_rows,
        Err(error) if modules::db::is_unusable_sqlite_database_error(&error) => {
            log_skipped_sqlite_database(&db_path, &error.to_string());
            return Ok(0);
        }
        Err(error) if is_missing_threads_table_error(&error) => {
            return Ok(0);
        }
        Err(error) => return Err(format_sqlite_write_error(&db_path, &error)),
    };
    if let Err(error) = transaction.commit() {
        if modules::db::is_unusable_sqlite_database_error(&error) {
            log_skipped_sqlite_database(&db_path, &error.to_string());
            return Ok(0);
        }
        return Err(format_sqlite_write_error(&db_path, &error));
    }
    Ok(updated_rows)
}

fn read_threads_table_columns(
    connection: &Connection,
) -> Result<Option<ThreadsTableColumns>, rusqlite::Error> {
    let mut statement = connection.prepare("PRAGMA table_info(threads)")?;
    let rows = statement.query_map([], |row| row.get::<usize, String>(1))?;
    let mut names = HashSet::new();
    for row in rows {
        let name = row?;
        names.insert(name);
    }
    if names.is_empty() {
        return Ok(None);
    }
    Ok(Some(ThreadsTableColumns {
        model_provider: names.contains("model_provider"),
        has_user_event: names.contains("has_user_event"),
        first_user_message: names.contains("first_user_message"),
        thread_source: names.contains("thread_source"),
    }))
}

fn build_threads_repair_where_clause(columns: ThreadsTableColumns) -> Option<String> {
    let mut predicates = Vec::new();
    if columns.model_provider {
        predicates.push("COALESCE(model_provider, '') <> ?1");
    }
    if columns.has_user_event && columns.first_user_message {
        predicates
            .push("(COALESCE(first_user_message, '') <> '' AND COALESCE(has_user_event, 0) <> 1)");
    }
    if columns.thread_source && columns.first_user_message {
        predicates
            .push("(COALESCE(first_user_message, '') <> '' AND COALESCE(thread_source, '') = '')");
    }
    if predicates.is_empty() {
        None
    } else {
        Some(predicates.join(" OR "))
    }
}

fn build_threads_repair_set_clause(columns: ThreadsTableColumns) -> String {
    let mut assignments = Vec::new();
    if columns.model_provider {
        assignments.push("model_provider = ?1");
    }
    if columns.has_user_event && columns.first_user_message {
        assignments.push(
            "has_user_event = CASE WHEN COALESCE(first_user_message, '') <> '' THEN 1 ELSE has_user_event END",
        );
    }
    if columns.thread_source && columns.first_user_message {
        assignments.push(
            "thread_source = CASE WHEN COALESCE(thread_source, '') = '' AND COALESCE(first_user_message, '') <> '' THEN 'user' ELSE thread_source END",
        );
    }
    assignments.join(", ")
}

fn format_sqlite_read_error(path: &Path, action: &str, error: &rusqlite::Error) -> String {
    format!("{} ({}): {}", action, path.display(), error)
}

fn format_sqlite_write_error(path: &Path, error: &rusqlite::Error) -> String {
    let message = error.to_string();
    let lowered = message.to_ascii_lowercase();
    if lowered.contains("database is locked") || lowered.contains("database busy") {
        return format!(
            "state_5.sqlite 当前被占用，请关闭 Codex / Codex App 后重试 ({}): {}",
            path.display(),
            message
        );
    }
    format!(
        "更新 SQLite 会话可见性失败 ({}): {}",
        path.display(),
        message
    )
}

fn rewrite_rollout_provider(change: &RolloutProviderChange) -> Result<(), String> {
    let original_modified_at =
        modules::codex_session_file_time::read_modified_time(&change.absolute_path);
    if let Some(updated_first_line) = change.updated_first_line.as_deref() {
        let bytes = fs::read(&change.absolute_path).map_err(|error| {
            format!(
                "读取 rollout 文件失败 ({}): {}",
                change.absolute_path.display(),
                error
            )
        })?;
        let (offset, separator) = detect_first_line_boundary(&bytes);
        let mut next_bytes = Vec::with_capacity(updated_first_line.len() + bytes.len());
        next_bytes.extend_from_slice(updated_first_line.as_bytes());
        next_bytes.extend_from_slice(separator.as_bytes());
        next_bytes.extend_from_slice(&bytes[offset..]);
        write_bytes_atomic(&change.absolute_path, &next_bytes)?;
    }
    modules::codex_session_file_time::restore_modified_time(
        &change.absolute_path,
        change.target_modified_at.or(original_modified_at),
    )
}

fn detect_first_line_boundary(bytes: &[u8]) -> (usize, &'static str) {
    for (index, byte) in bytes.iter().enumerate() {
        if *byte == b'\n' {
            if index > 0 && bytes[index - 1] == b'\r' {
                return (index + 1, "\r\n");
            }
            return (index + 1, "\n");
        }
    }
    (bytes.len(), "")
}

fn write_bytes_atomic(path: &Path, content: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("无法定位目标目录: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("创建目录失败 ({}): {}", parent.display(), error))?;

    let temp_path = parent.join(format!(
        ".{}.provider-repair.{}.{}",
        path.file_name()
            .and_then(|item| item.to_str())
            .unwrap_or("file"),
        std::process::id(),
        Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    fs::write(&temp_path, content)
        .map_err(|error| format!("写入临时文件失败 ({}): {}", temp_path.display(), error))?;
    if let Err(error) = fs::rename(&temp_path, path) {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("替换文件失败 ({}): {}", path.display(), error));
    }
    Ok(())
}

fn sqlite_sidecar_paths(db_path: &Path) -> Vec<PathBuf> {
    let raw = db_path.to_string_lossy();
    vec![
        PathBuf::from(format!("{}-wal", raw)),
        PathBuf::from(format!("{}-shm", raw)),
    ]
}

fn remove_sqlite_sidecar_files(db_path: &Path) -> Result<(), String> {
    for path in sqlite_sidecar_paths(db_path) {
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "清理 SQLite sidecar 文件失败 ({}): {}",
                    path.display(),
                    error
                ));
            }
        }
    }
    Ok(())
}

fn backup_sqlite_database(data_dir: &Path, backup_dir: &Path) -> Result<bool, String> {
    let db_path = data_dir.join(STATE_DB_FILE);
    if !db_path.exists() {
        return Ok(false);
    }

    let backup_db_path = backup_dir.join(STATE_DB_FILE);
    let connection = Connection::open(&db_path).map_err(|error| {
        format!(
            "打开 state_5.sqlite 以创建一致备份失败 ({}): {}",
            db_path.display(),
            error
        )
    })?;
    connection
        .busy_timeout(Duration::from_secs(3))
        .map_err(|error| {
            format!(
                "设置 SQLite 备份 busy_timeout 失败 ({}): {}",
                db_path.display(),
                error
            )
        })?;

    if backup_db_path.exists() {
        fs::remove_file(&backup_db_path).map_err(|error| {
            format!(
                "删除旧 state_5.sqlite 备份失败 ({}): {}",
                backup_db_path.display(),
                error
            )
        })?;
    }
    let backup_target = backup_db_path.to_string_lossy().to_string();
    connection
        .execute("VACUUM main INTO ?1", [backup_target.as_str()])
        .map_err(|error| {
            format!(
                "备份 state_5.sqlite 失败 ({} -> {}): {}",
                db_path.display(),
                backup_db_path.display(),
                error
            )
        })?;
    Ok(true)
}

fn restore_sqlite_database_from_backup(data_dir: &Path, backup_dir: &Path) -> Result<bool, String> {
    let backup_db_path = backup_dir.join(STATE_DB_FILE);
    if !backup_db_path.exists() {
        return Ok(false);
    }

    let target_db_path = data_dir.join(STATE_DB_FILE);
    fs::create_dir_all(data_dir).map_err(|error| {
        format!(
            "创建 state_5.sqlite 恢复目录失败 ({}): {}",
            data_dir.display(),
            error
        )
    })?;
    remove_sqlite_sidecar_files(&target_db_path)?;
    fs::copy(&backup_db_path, &target_db_path).map_err(|error| {
        format!(
            "恢复 state_5.sqlite 失败 ({} -> {}): {}",
            backup_db_path.display(),
            target_db_path.display(),
            error
        )
    })?;
    remove_sqlite_sidecar_files(&target_db_path)?;
    Ok(true)
}

fn backup_instance_files(
    data_dir: &Path,
    rollout_changes: &[RolloutProviderChange],
    include_sqlite: bool,
    include_global_state: bool,
    instance_id: &str,
    target_provider: &str,
) -> Result<PathBuf, String> {
    let backup_dir = create_unique_session_visibility_backup_dir(data_dir)?;

    let mut backed_up_files = Vec::new();
    let mut sqlite_backup_created = false;
    let mut global_state_backup_created = false;
    for change in rollout_changes {
        let target = backup_dir.join("files").join(&change.relative_path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "创建 rollout 备份目录失败 ({}): {}",
                    parent.display(),
                    error
                )
            })?;
        }
        fs::copy(&change.absolute_path, &target).map_err(|error| {
            format!(
                "备份 rollout 文件失败 ({} -> {}): {}",
                change.absolute_path.display(),
                target.display(),
                error
            )
        })?;
        modules::codex_session_file_time::restore_modified_time(
            &target,
            modules::codex_session_file_time::read_modified_time(&change.absolute_path),
        )?;
        backed_up_files.push(change.relative_path.to_string_lossy().to_string());
    }

    if include_sqlite {
        sqlite_backup_created = backup_sqlite_database(data_dir, &backup_dir)?;
    }
    if include_global_state {
        global_state_backup_created = backup_global_state_file(data_dir, &backup_dir)?;
    }

    let manifest = json!({
        "instanceId": instance_id,
        "instanceRoot": data_dir,
        "targetProvider": target_provider,
        "createdAt": Utc::now().to_rfc3339(),
        "hasSqliteBackup": sqlite_backup_created,
        "hasGlobalStateBackup": global_state_backup_created,
        "rolloutFiles": backed_up_files,
    });
    fs::write(
        backup_dir.join("manifest.json"),
        format!(
            "{}\n",
            serde_json::to_string_pretty(&manifest)
                .map_err(|error| format!("序列化可见性修复备份清单失败: {}", error))?
        ),
    )
    .map_err(|error| {
        format!(
            "写入可见性修复备份清单失败 ({}): {}",
            backup_dir.display(),
            error
        )
    })?;

    Ok(backup_dir)
}

fn create_unique_session_visibility_backup_dir(data_dir: &Path) -> Result<PathBuf, String> {
    let timestamp = Utc::now().format("%Y%m%d-%H%M%S-%f").to_string();
    for attempt in 0..1000 {
        let timestamp = if attempt == 0 {
            timestamp.clone()
        } else {
            format!("{}-{:03}", timestamp, attempt)
        };
        let backup_dir_name = format!(
            "{}{}{}",
            SESSION_VISIBILITY_REPAIR_BACKUP_PREFIX,
            timestamp,
            SESSION_VISIBILITY_REPAIR_BACKUP_SUFFIX
        );
        let backup_dir = data_dir.join(backup_dir_name);
        match fs::create_dir(&backup_dir) {
            Ok(()) => return Ok(backup_dir),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!(
                    "创建备份目录失败 ({}): {}",
                    backup_dir.display(),
                    error
                ))
            }
        }
    }

    Err(format!(
        "创建备份目录失败 ({}): 同一时间戳下的备份目录过多",
        data_dir.display()
    ))
}

fn backup_global_state_file(data_dir: &Path, backup_dir: &Path) -> Result<bool, String> {
    let source = data_dir.join(GLOBAL_STATE_FILE);
    if !source.exists() {
        return Ok(false);
    }

    let target = backup_dir.join("files").join(GLOBAL_STATE_FILE);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "创建 Codex 全局状态备份目录失败 ({}): {}",
                parent.display(),
                error
            )
        })?;
    }
    fs::copy(&source, &target).map_err(|error| {
        format!(
            "备份 Codex 全局状态失败 ({} -> {}): {}",
            source.display(),
            target.display(),
            error
        )
    })?;
    modules::codex_session_file_time::restore_modified_time(
        &target,
        modules::codex_session_file_time::read_modified_time(&source),
    )?;
    Ok(true)
}

fn parse_session_visibility_repair_backup_timestamp(name: &str) -> Option<&str> {
    let timestamp = name
        .strip_prefix(SESSION_VISIBILITY_REPAIR_BACKUP_PREFIX)?
        .strip_suffix(SESSION_VISIBILITY_REPAIR_BACKUP_SUFFIX)?;

    let parts = timestamp.split('-').collect::<Vec<_>>();
    let valid = matches!(
        parts.as_slice(),
        [date, time]
            if date.len() == 8
                && time.len() == 6
                && date.chars().all(|value| value.is_ascii_digit())
                && time.chars().all(|value| value.is_ascii_digit())
    ) || matches!(
        parts.as_slice(),
        [date, time, nanos]
            if date.len() == 8
                && time.len() == 6
                && nanos.len() == 9
                && date.chars().all(|value| value.is_ascii_digit())
                && time.chars().all(|value| value.is_ascii_digit())
                && nanos.chars().all(|value| value.is_ascii_digit())
    ) || matches!(
        parts.as_slice(),
        [date, time, nanos, counter]
            if date.len() == 8
                && time.len() == 6
                && nanos.len() == 9
                && counter.len() == 3
                && date.chars().all(|value| value.is_ascii_digit())
                && time.chars().all(|value| value.is_ascii_digit())
                && nanos.chars().all(|value| value.is_ascii_digit())
                && counter.chars().all(|value| value.is_ascii_digit())
    );
    if !valid {
        return None;
    }

    Some(timestamp)
}

fn prune_session_visibility_repair_backups(instances: &[CodexSyncInstance]) {
    for instance in instances {
        if let Err(error) = prune_instance_session_visibility_repair_backups(&instance.data_dir) {
            modules::logger::log_warn(&format!(
                "清理 Codex 会话可见性修复旧备份失败 ({}): {}",
                instance.data_dir.display(),
                error
            ));
        }
    }
}

fn prune_instance_session_visibility_repair_backups(data_dir: &Path) -> Result<(), String> {
    let entries = match fs::read_dir(data_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "读取实例目录失败 ({}): {}",
                data_dir.display(),
                error
            ));
        }
    };
    let mut backups: Vec<(String, PathBuf)> = Vec::new();

    for entry in entries {
        let entry = entry
            .map_err(|error| format!("读取实例目录项失败 ({}): {}", data_dir.display(), error))?;
        let file_type = entry.file_type().map_err(|error| {
            format!(
                "读取实例目录项类型失败 ({}): {}",
                entry.path().display(),
                error
            )
        })?;
        if !file_type.is_dir() {
            continue;
        }

        let file_name = entry.file_name();
        let Some(file_name) = file_name.to_str() else {
            continue;
        };
        let Some(timestamp) = parse_session_visibility_repair_backup_timestamp(file_name) else {
            continue;
        };
        backups.push((timestamp.to_string(), entry.path()));
    }

    if backups.len() <= MAX_SESSION_VISIBILITY_REPAIR_BACKUPS {
        return Ok(());
    }

    backups.sort_by(|left, right| right.0.cmp(&left.0));
    for (_, path) in backups
        .into_iter()
        .skip(MAX_SESSION_VISIBILITY_REPAIR_BACKUPS)
    {
        fs::remove_dir_all(&path)
            .map_err(|error| format!("删除旧备份失败 ({}): {}", path.display(), error))?;
    }

    Ok(())
}

fn restore_instance_files_from_backup(
    data_dir: &Path,
    backup_dir: &Path,
    include_sqlite: bool,
) -> Result<(), String> {
    let files_root = backup_dir.join("files");
    if files_root.exists() {
        restore_directory_contents(&files_root, data_dir)?;
    }

    if include_sqlite {
        let _ = restore_sqlite_database_from_backup(data_dir, backup_dir)?;
    }

    Ok(())
}

fn restore_directory_contents(source_root: &Path, target_root: &Path) -> Result<(), String> {
    let entries = fs::read_dir(source_root)
        .map_err(|error| format!("读取备份目录失败 ({}): {}", source_root.display(), error))?;
    for entry in entries {
        let entry = entry.map_err(|error| {
            format!("读取备份目录项失败 ({}): {}", source_root.display(), error)
        })?;
        let source_path = entry.path();
        let file_type = entry.file_type().map_err(|error| {
            format!(
                "读取备份文件类型失败 ({}): {}",
                source_path.display(),
                error
            )
        })?;
        let relative = source_path
            .strip_prefix(source_root)
            .map_err(|_| format!("无法计算备份相对路径: {}", source_path.display()))?;
        let target_path = target_root.join(relative);

        if file_type.is_dir() {
            fs::create_dir_all(&target_path).map_err(|error| {
                format!("创建恢复目录失败 ({}): {}", target_path.display(), error)
            })?;
            restore_directory_contents(&source_path, &target_path)?;
            continue;
        }

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("创建恢复父目录失败 ({}): {}", parent.display(), error))?;
        }
        fs::copy(&source_path, &target_path).map_err(|error| {
            format!(
                "恢复备份文件失败 ({} -> {}): {}",
                source_path.display(),
                target_path.display(),
                error
            )
        })?;
        modules::codex_session_file_time::restore_modified_time(
            &target_path,
            modules::codex_session_file_time::read_modified_time(&source_path),
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    fn make_temp_dir(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let base_dir =
            std::env::temp_dir().join(format!("{}-{}-{}", prefix, std::process::id(), unique));
        if base_dir.exists() {
            fs::remove_dir_all(&base_dir).expect("cleanup old temp dir");
        }
        fs::create_dir_all(&base_dir).expect("create temp dir");
        base_dir
    }

    #[test]
    fn rollout_repair_updates_provider_and_preserves_session_time() {
        let data_dir = make_temp_dir("codex-session-visibility-rollout-time-test");
        let rollout_dir = data_dir.join("sessions").join("2026").join("05").join("23");
        fs::create_dir_all(&rollout_dir).expect("create rollout dir");
        let rollout_path = rollout_dir.join("rollout-test.jsonl");
        fs::write(
            &rollout_path,
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s1\",\"model_provider\":\"old\"}}\n{\"type\":\"event\",\"timestamp\":\"2024-01-01T00:00:00Z\"}\n",
        )
        .expect("write rollout");
        fs::write(
            data_dir.join(SESSION_INDEX_FILE),
            "{\"id\":\"s1\",\"thread_name\":\"Test\",\"updated_at\":\"2024-02-03T04:05:06Z\"}\n",
        )
        .expect("write session index");
        let polluted_modified_at = UNIX_EPOCH + Duration::from_secs(1_800_000_000);
        fs::OpenOptions::new()
            .write(true)
            .open(&rollout_path)
            .expect("open rollout")
            .set_modified(polluted_modified_at)
            .expect("set polluted rollout mtime");

        let changes =
            collect_rollout_provider_changes(&data_dir, "relay").expect("collect rollout changes");
        assert_eq!(changes.len(), 1);

        repair_single_instance(
            &data_dir,
            "relay",
            &changes,
            false,
            &GlobalStateWorkspaceRepairPlan::default(),
        )
        .expect("repair rollout");

        let content = fs::read_to_string(&rollout_path).expect("read repaired rollout");
        let first_line = content.lines().next().expect("first line");
        let parsed = serde_json::from_str::<JsonValue>(first_line).expect("parse first line");
        assert_eq!(
            parsed["payload"]
                .get("model_provider")
                .and_then(JsonValue::as_str),
            Some("relay")
        );
        assert_eq!(
            fs::metadata(&rollout_path)
                .expect("rollout metadata")
                .modified()
                .expect("rollout mtime"),
            UNIX_EPOCH + Duration::from_secs(1_706_933_106)
        );
        fs::remove_dir_all(&data_dir).expect("cleanup temp dir");
    }

    #[test]
    fn rollout_repair_restores_activity_time_without_provider_change() {
        let data_dir = make_temp_dir("codex-session-visibility-mtime-only-test");
        let rollout_dir = data_dir.join("sessions").join("2026").join("05").join("23");
        fs::create_dir_all(&rollout_dir).expect("create rollout dir");
        let rollout_path = rollout_dir.join("rollout-test.jsonl");
        let rollout_content =
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s1\",\"model_provider\":\"relay\"}}\n{\"type\":\"event\",\"timestamp\":\"2024-01-01T00:00:00Z\"}\n";
        fs::write(&rollout_path, rollout_content).expect("write rollout");
        let polluted_modified_at = UNIX_EPOCH + Duration::from_secs(1_800_000_000);
        fs::OpenOptions::new()
            .write(true)
            .open(&rollout_path)
            .expect("open rollout")
            .set_modified(polluted_modified_at)
            .expect("set polluted rollout mtime");

        let changes =
            collect_rollout_provider_changes(&data_dir, "relay").expect("collect rollout changes");
        assert_eq!(changes.len(), 1);
        assert!(changes[0].updated_first_line.is_none());

        repair_single_instance(
            &data_dir,
            "relay",
            &changes,
            false,
            &GlobalStateWorkspaceRepairPlan::default(),
        )
        .expect("repair rollout time");

        assert_eq!(
            fs::read_to_string(&rollout_path).expect("read repaired rollout"),
            rollout_content
        );
        assert_eq!(
            fs::metadata(&rollout_path)
                .expect("rollout metadata")
                .modified()
                .expect("rollout mtime"),
            UNIX_EPOCH + Duration::from_secs(1_704_067_200)
        );
        fs::remove_dir_all(&data_dir).expect("cleanup temp dir");
    }

    #[test]
    fn sqlite_repair_marks_threads_with_first_user_message_visible() {
        let data_dir = make_temp_dir("codex-session-visibility-sqlite-test");
        let db_path = data_dir.join(STATE_DB_FILE);
        let connection = Connection::open(&db_path).expect("open sqlite");
        connection
            .execute(
                "CREATE TABLE threads (
                    id TEXT PRIMARY KEY,
                    model_provider TEXT,
                    has_user_event INTEGER,
                    first_user_message TEXT,
                    thread_source TEXT
                )",
                [],
            )
            .expect("create threads table");
        connection
            .execute(
                "INSERT INTO threads (id, model_provider, has_user_event, first_user_message, thread_source)
                 VALUES
                 ('matched-invisible', 'relay', 0, 'hello', ''),
                 ('old-invisible', 'old', 0, 'hi', NULL),
                 ('already-visible', 'relay', 1, 'visible', 'user'),
                 ('provider-only', '', 0, '', NULL)",
                [],
            )
            .expect("insert rows");
        drop(connection);

        let scan = count_sqlite_rows_to_update(&data_dir, "relay").expect("scan sqlite");
        assert_eq!(scan.rows_to_update, 3);
        assert!(!scan.skipped_unusable_database);

        let updated_rows = update_sqlite_provider(&data_dir, "relay").expect("update sqlite");
        assert_eq!(updated_rows, 3);

        let connection = Connection::open(&db_path).expect("reopen sqlite");
        let matched_invisible = connection
            .query_row(
                "SELECT model_provider, has_user_event, thread_source FROM threads WHERE id = 'matched-invisible'",
                [],
                |row| {
                    Ok((
                        row.get::<usize, String>(0)?,
                        row.get::<usize, i64>(1)?,
                        row.get::<usize, String>(2)?,
                    ))
                },
            )
            .expect("read matched row");
        assert_eq!(
            matched_invisible,
            ("relay".to_string(), 1, "user".to_string())
        );

        let old_invisible = connection
            .query_row(
                "SELECT model_provider, has_user_event, thread_source FROM threads WHERE id = 'old-invisible'",
                [],
                |row| {
                    Ok((
                        row.get::<usize, String>(0)?,
                        row.get::<usize, i64>(1)?,
                        row.get::<usize, String>(2)?,
                    ))
                },
            )
            .expect("read old row");
        assert_eq!(old_invisible, ("relay".to_string(), 1, "user".to_string()));

        let provider_only = connection
            .query_row(
                "SELECT model_provider, has_user_event FROM threads WHERE id = 'provider-only'",
                [],
                |row| Ok((row.get::<usize, String>(0)?, row.get::<usize, i64>(1)?)),
            )
            .expect("read provider-only row");
        assert_eq!(provider_only, ("relay".to_string(), 0));

        drop(connection);
        fs::remove_dir_all(&data_dir).expect("cleanup temp dir");
    }

    #[test]
    fn rollout_repair_restores_session_time_without_provider_change() {
        let data_dir = make_temp_dir("codex-session-visibility-time-test");
        let rollout_dir = data_dir.join("sessions").join("2026").join("05").join("23");
        fs::create_dir_all(&rollout_dir).expect("create rollout dir");
        let rollout_path = rollout_dir.join("rollout-test.jsonl");
        fs::write(
            &rollout_path,
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s1\",\"model_provider\":\"relay\"}}\n{\"type\":\"event\",\"timestamp\":\"2024-01-01T00:00:00Z\"}\n",
        )
        .expect("write rollout");
        fs::write(
            data_dir.join("session_index.jsonl"),
            "{\"id\":\"s1\",\"thread_name\":\"Test\",\"updated_at\":\"2024-02-03T04:05:06Z\"}\n",
        )
        .expect("write session index");
        let stale_modified_at = UNIX_EPOCH + Duration::from_secs(1_800_000_000);
        fs::OpenOptions::new()
            .write(true)
            .open(&rollout_path)
            .expect("open rollout")
            .set_modified(stale_modified_at)
            .expect("set stale rollout mtime");

        let changes =
            collect_rollout_provider_changes(&data_dir, "relay").expect("collect rollout changes");
        assert_eq!(changes.len(), 1);

        repair_single_instance(
            &data_dir,
            "relay",
            &changes,
            false,
            &GlobalStateWorkspaceRepairPlan::default(),
        )
        .expect("repair rollout time");

        let content = fs::read_to_string(&rollout_path).expect("read repaired rollout");
        assert!(content.contains("\"model_provider\":\"relay\""));
        assert_eq!(
            fs::metadata(&rollout_path)
                .expect("rollout metadata")
                .modified()
                .expect("rollout mtime"),
            UNIX_EPOCH + Duration::from_secs(1_706_933_106)
        );
        fs::remove_dir_all(&data_dir).expect("cleanup temp dir");
    }

    #[test]
    fn sqlite_repair_keeps_provider_only_schema_working() {
        let data_dir = make_temp_dir("codex-session-provider-only-sqlite-test");
        let db_path = data_dir.join(STATE_DB_FILE);
        let connection = Connection::open(&db_path).expect("open sqlite");
        connection
            .execute(
                "CREATE TABLE threads (id TEXT PRIMARY KEY, model_provider TEXT)",
                [],
            )
            .expect("create threads table");
        connection
            .execute(
                "INSERT INTO threads (id, model_provider) VALUES ('old', 'old'), ('same', 'relay')",
                [],
            )
            .expect("insert rows");
        drop(connection);

        let scan = count_sqlite_rows_to_update(&data_dir, "relay").expect("scan sqlite");
        assert_eq!(scan.rows_to_update, 1);
        let updated_rows = update_sqlite_provider(&data_dir, "relay").expect("update sqlite");
        assert_eq!(updated_rows, 1);

        let connection = Connection::open(&db_path).expect("reopen sqlite");
        let old_provider = connection
            .query_row(
                "SELECT model_provider FROM threads WHERE id = 'old'",
                [],
                |row| row.get::<usize, String>(0),
            )
            .expect("read old provider");
        assert_eq!(old_provider, "relay");

        drop(connection);
        fs::remove_dir_all(&data_dir).expect("cleanup temp dir");
    }

    #[test]
    fn visibility_diagnostic_detects_workspace_filter_and_missing_hints() {
        let data_dir = make_temp_dir("codex-session-visibility-workspace-scan-test");
        let rollout_dir = data_dir.join("sessions").join("2026").join("06").join("13");
        fs::create_dir_all(&rollout_dir).expect("create rollout dir");
        fs::write(
            rollout_dir.join("rollout-test.jsonl"),
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"t1\",\"model_provider\":\"relay\",\"cwd\":\"/repo/hidden\"}}\n{\"type\":\"event\"}\n",
        )
        .expect("write rollout");
        fs::write(
            data_dir.join(GLOBAL_STATE_FILE),
            "{\"active-workspace-roots\":[\"/repo/current\"],\"project-order\":[],\"electron-saved-workspace-roots\":[],\"thread-workspace-root-hints\":{}}\n",
        )
        .expect("write global state");

        let scan = scan_rollout_visibility(&data_dir, "relay").expect("scan rollout visibility");

        assert_eq!(scan.thread_count, 1);
        assert_eq!(scan.provider_mismatch_thread_count, 0);
        assert_eq!(scan.workspace_filtered_thread_count, 1);
        assert_eq!(scan.workspace_root_count, 1);
        assert_eq!(scan.missing_workspace_root_count, 1);
        assert_eq!(scan.missing_thread_workspace_hint_count, 1);
        assert_eq!(
            scan.active_workspace_roots,
            vec!["/repo/current".to_string()]
        );
        fs::remove_dir_all(&data_dir).expect("cleanup temp dir");
    }

    #[test]
    fn workspace_repair_syncs_project_indexes_and_thread_hints_only() {
        let data_dir = make_temp_dir("codex-session-visibility-workspace-repair-test");
        fs::write(
            data_dir.join(GLOBAL_STATE_FILE),
            "{\"active-workspace-roots\":[\"/repo/current\"],\"project-order\":[],\"electron-saved-workspace-roots\":[],\"thread-workspace-root-hints\":{}}\n",
        )
        .expect("write global state");
        let plan = GlobalStateWorkspaceRepairPlan {
            workspace_roots: vec!["/repo/hidden".to_string()],
            thread_workspace_hints: vec![ThreadWorkspaceHint {
                thread_id: "t1".to_string(),
                workspace_root: "/repo/hidden".to_string(),
            }],
            missing_workspace_root_count: 1,
            missing_thread_workspace_hint_count: 1,
        };

        assert!(update_global_state_workspaces(&data_dir, &plan).expect("update global state"));

        let parsed = serde_json::from_str::<JsonValue>(
            &fs::read_to_string(data_dir.join(GLOBAL_STATE_FILE)).expect("read global state"),
        )
        .expect("parse global state");
        assert_eq!(
            parsed["active-workspace-roots"]
                .as_array()
                .expect("active roots array")
                .iter()
                .filter_map(JsonValue::as_str)
                .collect::<Vec<_>>(),
            vec!["/repo/current"]
        );
        assert_eq!(
            parsed["project-order"]
                .as_array()
                .expect("project order array")
                .iter()
                .filter_map(JsonValue::as_str)
                .collect::<Vec<_>>(),
            vec!["/repo/hidden"]
        );
        assert_eq!(
            parsed["electron-saved-workspace-roots"]
                .as_array()
                .expect("saved roots array")
                .iter()
                .filter_map(JsonValue::as_str)
                .collect::<Vec<_>>(),
            vec!["/repo/hidden"]
        );
        assert_eq!(
            parsed["thread-workspace-root-hints"]["t1"].as_str(),
            Some("/repo/hidden")
        );
        fs::remove_dir_all(&data_dir).expect("cleanup temp dir");
    }

    #[test]
    fn protected_active_workspace_repair_extends_active_roots_only() {
        let data_dir = make_temp_dir("codex-session-visibility-active-root-repair-test");
        fs::write(
            data_dir.join(GLOBAL_STATE_FILE),
            "{\"active-workspace-roots\":[\"/repo/current\"],\"project-order\":[],\"electron-saved-workspace-roots\":[],\"thread-workspace-root-hints\":{}}\n",
        )
        .expect("write global state");

        let updated_count =
            update_global_state_active_workspace_roots(&data_dir, &["/repo/hidden".to_string()])
                .expect("update active workspace roots");

        assert_eq!(updated_count, 1);
        let parsed = serde_json::from_str::<JsonValue>(
            &fs::read_to_string(data_dir.join(GLOBAL_STATE_FILE)).expect("read global state"),
        )
        .expect("parse global state");
        assert_eq!(
            parsed["active-workspace-roots"]
                .as_array()
                .expect("active roots array")
                .iter()
                .filter_map(JsonValue::as_str)
                .collect::<Vec<_>>(),
            vec!["/repo/current", "/repo/hidden"]
        );
        assert_eq!(
            parsed["project-order"]
                .as_array()
                .expect("project order array")
                .len(),
            0
        );
        assert_eq!(
            parsed["electron-saved-workspace-roots"]
                .as_array()
                .expect("saved roots array")
                .len(),
            0
        );
        assert_eq!(
            parsed["thread-workspace-root-hints"]
                .as_object()
                .expect("thread hints object")
                .len(),
            0
        );
        fs::remove_dir_all(&data_dir).expect("cleanup temp dir");
    }

    #[test]
    fn session_visibility_repair_backups_are_unique_within_same_second() {
        let data_dir = make_temp_dir("codex-session-visibility-backup-unique-test");

        let first = backup_instance_files(&data_dir, &[], false, false, "default", "openai")
            .expect("create first backup");
        let second = backup_instance_files(&data_dir, &[], false, false, "default", "openai")
            .expect("create second backup");

        assert_ne!(first, second);
        assert!(first.exists());
        assert!(second.exists());
        fs::remove_dir_all(&data_dir).expect("cleanup temp dir");
    }

    #[test]
    fn sqlite_backup_restore_replaces_db_and_clears_sidecars() {
        let data_dir = make_temp_dir("codex-session-visibility-sqlite-backup-test");
        let db_path = data_dir.join(STATE_DB_FILE);
        let connection = Connection::open(&db_path).expect("open sqlite");
        connection
            .execute(
                "CREATE TABLE threads (id TEXT PRIMARY KEY, model_provider TEXT)",
                [],
            )
            .expect("create threads table");
        connection
            .execute(
                "INSERT INTO threads (id, model_provider) VALUES ('thread-1', 'old')",
                [],
            )
            .expect("insert old row");
        drop(connection);

        let backup_dir = backup_instance_files(&data_dir, &[], true, false, "default", "relay")
            .expect("backup db");

        let connection = Connection::open(&db_path).expect("reopen sqlite");
        connection
            .execute(
                "UPDATE threads SET model_provider = 'new' WHERE id = 'thread-1'",
                [],
            )
            .expect("mutate db after backup");
        drop(connection);
        for path in sqlite_sidecar_paths(&db_path) {
            fs::write(path, b"stale wal/shm").expect("write stale sidecar");
        }

        restore_instance_files_from_backup(&data_dir, &backup_dir, true).expect("restore db");
        for path in sqlite_sidecar_paths(&db_path) {
            assert!(
                !path.exists(),
                "stale sidecar should be removed: {:?}",
                path
            );
        }

        let connection = Connection::open(&db_path).expect("open restored sqlite");
        let provider = connection
            .query_row(
                "SELECT model_provider FROM threads WHERE id = 'thread-1'",
                [],
                |row| row.get::<usize, String>(0),
            )
            .expect("read restored provider");
        assert_eq!(provider, "old");

        drop(connection);
        fs::remove_dir_all(&data_dir).expect("cleanup temp dir");
    }
}
