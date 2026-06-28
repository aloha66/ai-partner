use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

const SETTINGS_FILE_NAME: &str = "companion-settings.json";
const DEFAULT_COMPANION_ID: &str = "default-petdex";
const ANIMATIONS_MANIFEST_SCHEMA_VERSION: &str = "ai-partner.animations.v1";
const PETDEX_ATLAS_WIDTH: u32 = 1536;
const PETDEX_ATLAS_HEIGHT: u32 = 1872;
const PETDEX_CELL_WIDTH: u32 = 192;
const PETDEX_CELL_HEIGHT: u32 = 208;
const MAX_FRAMES_PER_ANIMATION: usize = 32;
const MIN_ANIMATION_FPS: u32 = 1;
const MAX_ANIMATION_FPS: u32 = 24;
const DEFAULT_PETDEX_FPS: u32 = 6;
const DEFAULT_SEQUENCE_FPS: u32 = 8;

#[derive(Clone)]
pub struct CompanionStore {
    inner: Arc<Mutex<CompanionStoreInner>>,
}

#[derive(Clone, Debug)]
struct CompanionStoreInner {
    home_dir: PathBuf,
    app_config_dir: PathBuf,
    selected: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionSettings {
    selected_companion_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionCatalog {
    companions: Vec<LocalCompanion>,
    selected_companion_id: String,
    selected_companion: LocalCompanion,
    fallback_used: bool,
    status: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCompanion {
    id: String,
    partner_id: String,
    display_name: String,
    description: Option<String>,
    root_path: Option<String>,
    spritesheet_path: Option<String>,
    atlas_url: Option<String>,
    capabilities: CompanionCapabilities,
    valid: bool,
    status: String,
    errors: Vec<String>,
    source: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionCapabilities {
    partner_id: String,
    animations: BTreeMap<String, CompanionTimeline>,
    fallbacks: BTreeMap<String, Vec<String>>,
    runtime_limits: CompanionRuntimeLimits,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionTimeline {
    animation: String,
    #[serde(rename = "loop")]
    loop_animation: bool,
    procedural: Vec<String>,
    source: CompanionFrameSource,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum CompanionFrameSource {
    PetdexRow {
        row: String,
        #[serde(rename = "frameCount")]
        frame_count: u32,
        fps: u32,
    },
    PngSequence {
        frames: Vec<String>,
        fps: u32,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionRuntimeLimits {
    frame_width: u32,
    frame_height: u32,
    max_frames_per_animation: u32,
    min_fps: u32,
    max_fps: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PetJson {
    id: String,
    display_name: Option<String>,
    description: Option<String>,
    spritesheet_path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnimationsManifest {
    schema_version: String,
    animations: Option<BTreeMap<String, AnimationManifestEntry>>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnimationManifestEntry {
    source: String,
    fps: Option<u32>,
    #[serde(rename = "loop")]
    loop_animation: Option<bool>,
    fallbacks: Option<Vec<String>>,
}

impl CompanionStore {
    pub fn from_app(app: &AppHandle) -> Self {
        let home_dir = app.path().home_dir().unwrap_or_else(|_| PathBuf::from("."));
        let app_config_dir = app
            .path()
            .app_config_dir()
            .unwrap_or_else(|_| home_dir.join(".config").join("ai-partner"));
        Self::new(home_dir, app_config_dir)
    }

    pub fn new(home_dir: PathBuf, app_config_dir: PathBuf) -> Self {
        let selected = read_settings(&app_config_dir).selected_companion_id;
        Self {
            inner: Arc::new(Mutex::new(CompanionStoreInner {
                home_dir,
                app_config_dir,
                selected,
            })),
        }
    }

    pub fn catalog(&self) -> CompanionCatalog {
        let inner = self.inner.lock().expect("companion mutex poisoned");
        let companions = scan_companions(&inner.home_dir);
        catalog_from_scan(&companions, inner.selected.as_deref())
    }

    pub fn select(&self, companion_id: &str) -> Result<CompanionCatalog, String> {
        let mut inner = self.inner.lock().expect("companion mutex poisoned");
        let companions = scan_companions(&inner.home_dir);
        let selected = companions
            .iter()
            .find(|companion| companion.id == companion_id)
            .ok_or_else(|| "companion not found".to_string())?;

        if !selected.valid {
            return Err("companion asset is invalid".to_string());
        }

        inner.selected = Some(selected.id.clone());
        write_settings(
            &inner.app_config_dir,
            &CompanionSettings {
                selected_companion_id: inner.selected.clone(),
            },
        )?;
        Ok(catalog_from_scan(&companions, inner.selected.as_deref()))
    }
}

pub fn get_catalog(store: &CompanionStore) -> CompanionCatalog {
    store.catalog()
}

pub fn select_companion(
    store: &CompanionStore,
    companion_id: String,
) -> Result<CompanionCatalog, String> {
    store.select(&companion_id)
}

#[cfg(test)]
fn local_pets_directory(store: &CompanionStore, source: &str) -> Result<PathBuf, String> {
    let inner = store.inner.lock().expect("companion mutex poisoned");
    let (source_directory, directory) = local_pets_paths(&inner.home_dir, source)?;
    reject_symlinked_pets_directory(&source_directory, &directory)?;
    Ok(directory)
}

pub fn ensure_local_pets_directory(
    store: &CompanionStore,
    source: &str,
) -> Result<PathBuf, String> {
    let inner = store.inner.lock().expect("companion mutex poisoned");
    let (source_directory, directory) = local_pets_paths(&inner.home_dir, source)?;
    reject_symlinked_pets_directory(&source_directory, &directory)?;
    create_plain_directory(&source_directory, "pets source directory")?;
    create_plain_directory(&directory, "pets directory")?;
    reject_symlinked_pets_directory(&source_directory, &directory)?;

    let source_real = fs::canonicalize(&source_directory).map_err(|error| error.to_string())?;
    let directory_real = fs::canonicalize(&directory).map_err(|error| error.to_string())?;
    if !directory_real.starts_with(source_real) {
        return Err("pets directory resolves outside companion source".to_string());
    }
    Ok(directory_real)
}

fn local_pets_paths(home_dir: &Path, source: &str) -> Result<(PathBuf, PathBuf), String> {
    let source_directory = match source {
        "petdex" => home_dir.join(".petdex"),
        "codex" => home_dir.join(".codex"),
        _ => return Err("unknown companion source".to_string()),
    };
    let directory = source_directory.join("pets");
    Ok((source_directory, directory))
}

fn reject_symlinked_pets_directory(
    source_directory: &Path,
    directory: &Path,
) -> Result<(), String> {
    reject_existing_symlink(source_directory, "pets source directory cannot be a symlink")?;
    reject_existing_symlink(directory, "pets directory cannot be a symlink")
}

fn reject_existing_symlink(path: &Path, symlink_error: &str) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => Err(symlink_error.to_string()),
        Ok(meta) if meta.is_dir() => Ok(()),
        Ok(_) => Err(format!("{} must be a directory", path.display())),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn create_plain_directory(path: &Path, label: &str) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => {
            Err(format!("{label} cannot be a symlink"))
        }
        Ok(meta) if meta.is_dir() => Ok(()),
        Ok(_) => Err(format!("{label} must be a directory")),
        Err(error) if error.kind() == ErrorKind::NotFound => {
            fs::create_dir(path).map_err(|error| error.to_string())?;
            reject_existing_symlink(path, &format!("{label} cannot be a symlink"))
        }
        Err(error) => Err(error.to_string()),
    }
}

fn read_settings(app_config_dir: &Path) -> CompanionSettings {
    let path = app_config_dir.join(SETTINGS_FILE_NAME);
    let Ok(raw) = fs::read_to_string(path) else {
        return CompanionSettings {
            selected_companion_id: None,
        };
    };
    serde_json::from_str(&raw).unwrap_or(CompanionSettings {
        selected_companion_id: None,
    })
}

fn write_settings(app_config_dir: &Path, settings: &CompanionSettings) -> Result<(), String> {
    fs::create_dir_all(app_config_dir).map_err(|error| error.to_string())?;
    let path = app_config_dir.join(SETTINGS_FILE_NAME);
    let tmp_path = app_config_dir.join(format!("{SETTINGS_FILE_NAME}.tmp"));
    let payload = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(&tmp_path, payload).map_err(|error| error.to_string())?;
    fs::rename(&tmp_path, &path).map_err(|error| error.to_string())?;
    Ok(())
}

fn catalog_from_scan(companions: &[LocalCompanion], selected_id: Option<&str>) -> CompanionCatalog {
    let default = default_companion();
    let selected_from_scan = selected_id.and_then(|id| {
        companions
            .iter()
            .find(|companion| companion.id == id && companion.valid)
    });
    let selected = selected_from_scan
        .cloned()
        .unwrap_or_else(|| default.clone());
    let fallback_used = selected_from_scan.is_none();
    let status = if fallback_used {
        "fallback"
    } else {
        "selected"
    }
    .to_string();

    CompanionCatalog {
        companions: companions.to_vec(),
        selected_companion_id: selected.id.clone(),
        selected_companion: selected,
        fallback_used,
        status,
    }
}

fn scan_companions(home_dir: &Path) -> Vec<LocalCompanion> {
    let mut by_identity = BTreeMap::<String, LocalCompanion>::new();
    for root in scan_roots(home_dir) {
        for candidate in candidate_roots(&root) {
            let companion = inspect_companion_root(&candidate, home_dir);
            let key = companion_identity_key(&companion);
            match by_identity.get(&key) {
                Some(existing) if existing.valid || !companion.valid => {}
                _ => {
                    by_identity.insert(key, companion);
                }
            }
        }
    }
    by_identity.into_values().collect()
}

fn companion_identity_key(companion: &LocalCompanion) -> String {
    companion.id.clone()
}

fn scan_roots(home_dir: &Path) -> Vec<PathBuf> {
    vec![
        home_dir.join(".petdex").join("pets"),
        home_dir.join(".codex").join("pets"),
    ]
}

fn candidate_roots(root: &Path) -> Vec<PathBuf> {
    let Ok(root_meta) = fs::symlink_metadata(root) else {
        return Vec::new();
    };
    if !root_meta.is_dir() || root_meta.file_type().is_symlink() {
        return Vec::new();
    }

    let mut candidates = Vec::new();
    if root.join("pet.json").is_file() {
        candidates.push(root.to_path_buf());
    }

    let Ok(entries) = fs::read_dir(root) else {
        return candidates;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.is_dir() && !meta.file_type().is_symlink() && path.join("pet.json").is_file() {
            candidates.push(path);
        }
    }
    candidates
}

fn inspect_companion_root(root: &Path, home_dir: &Path) -> LocalCompanion {
    let source = source_for_root(root, home_dir);
    let root_real = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let directory_name = root
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("local")
        .to_string();
    let selector_id = format!("{source}:{directory_name}");
    let mut errors = Vec::new();

    if fs::symlink_metadata(root)
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(true)
    {
        errors.push("asset root cannot be a symlink".to_string());
    }

    let pet_json_path = root.join("pet.json");
    if fs::symlink_metadata(&pet_json_path)
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(false)
    {
        errors.push("pet.json cannot be a symlink".to_string());
    }
    let pet_json = read_pet_json(&pet_json_path, &mut errors);
    let partner_id = pet_json
        .as_ref()
        .map(|pet| pet.id.clone())
        .unwrap_or_else(|| directory_name.clone());
    let display_name = pet_json
        .as_ref()
        .and_then(|pet| pet.display_name.clone())
        .unwrap_or_else(|| directory_name.clone());
    let description = pet_json.as_ref().and_then(|pet| pet.description.clone());

    let spritesheet_path = pet_json
        .as_ref()
        .and_then(|pet| resolve_spritesheet(root, &pet.spritesheet_path, &mut errors));
    let capabilities = capabilities_for_root(root, &partner_id, &mut errors);
    let valid = errors.is_empty();

    LocalCompanion {
        id: selector_id,
        partner_id: partner_id.clone(),
        display_name,
        description,
        root_path: Some(root_real.to_string_lossy().into_owned()),
        spritesheet_path: spritesheet_path
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned()),
        atlas_url: None,
        capabilities,
        valid,
        status: if valid { "valid" } else { "invalid" }.to_string(),
        errors,
        source,
    }
}

fn read_pet_json(path: &Path, errors: &mut Vec<String>) -> Option<PetJson> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => {
            errors.push("pet.json missing or unreadable".to_string());
            return None;
        }
    };
    let pet_json: PetJson = match serde_json::from_str(&raw) {
        Ok(pet_json) => pet_json,
        Err(_) => {
            errors.push("pet.json is invalid".to_string());
            return None;
        }
    };
    if pet_json.id.trim().is_empty() || pet_json.spritesheet_path.trim().is_empty() {
        errors.push("pet.json requires id and spritesheetPath".to_string());
        return None;
    }
    Some(pet_json)
}

fn capabilities_for_root(
    root: &Path,
    partner_id: &str,
    errors: &mut Vec<String>,
) -> CompanionCapabilities {
    let mut capabilities = default_capabilities_for(partner_id);
    let manifest_path = root.join("ai-partner.animations.json");
    if !manifest_path.is_file() {
        return capabilities;
    }
    if fs::symlink_metadata(&manifest_path)
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(false)
    {
        errors.push("animations manifest cannot be a symlink".to_string());
        return capabilities;
    }

    let raw = match fs::read_to_string(&manifest_path) {
        Ok(raw) => raw,
        Err(_) => {
            errors.push("animations manifest is unreadable".to_string());
            return capabilities;
        }
    };
    let manifest: AnimationsManifest = match serde_json::from_str(&raw) {
        Ok(manifest) => manifest,
        Err(_) => {
            errors.push("animations manifest is invalid".to_string());
            return capabilities;
        }
    };
    if manifest.schema_version != ANIMATIONS_MANIFEST_SCHEMA_VERSION {
        errors.push("animations manifest schemaVersion is unsupported".to_string());
        return capabilities;
    }

    for (animation_ref, entry) in manifest.animations.unwrap_or_default() {
        if !is_animation_ref(&animation_ref) {
            errors.push(format!("invalid animation ref: {animation_ref}"));
            continue;
        }
        if let Some(fallbacks) = &entry.fallbacks {
            if fallbacks.iter().all(|fallback| is_animation_ref(fallback)) {
                capabilities
                    .fallbacks
                    .insert(animation_ref.clone(), fallbacks.clone());
            } else {
                errors.push(format!("animation fallbacks are invalid: {animation_ref}"));
            }
        }
        let Some(sequence) = validate_animation_sequence(root, &animation_ref, &entry)
        else {
            continue;
        };
        capabilities.animations.insert(
            animation_ref.clone(),
            CompanionTimeline {
                animation: animation_ref,
                loop_animation: entry.loop_animation.unwrap_or(true),
                procedural: Vec::new(),
                source: CompanionFrameSource::PngSequence {
                    frames: sequence.frames,
                    fps: sequence.fps,
                },
            },
        );
    }

    capabilities
}

struct ValidatedAnimationSequence {
    frames: Vec<String>,
    fps: u32,
}

fn validate_animation_sequence(
    root: &Path,
    _animation_ref: &str,
    entry: &AnimationManifestEntry,
) -> Option<ValidatedAnimationSequence> {
    let source_path = resolve_animation_source(root, &entry.source).ok()?;

    let fps = entry.fps.unwrap_or(DEFAULT_SEQUENCE_FPS);
    if !(MIN_ANIMATION_FPS..=MAX_ANIMATION_FPS).contains(&fps) {
        return None;
    }

    let Ok(entries) = fs::read_dir(&source_path) else {
        return None;
    };
    let mut frame_paths = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .and_then(|value| value.to_str())
                .map(|extension| extension.eq_ignore_ascii_case("png"))
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    frame_paths.sort_by(|left, right| left.file_name().cmp(&right.file_name()));

    if frame_paths.is_empty() || frame_paths.len() > MAX_FRAMES_PER_ANIMATION {
        return None;
    }

    let root_real = match fs::canonicalize(root) {
        Ok(root_real) => root_real,
        Err(_) => return None,
    };
    let mut frames = Vec::new();
    for frame_path in frame_paths {
        let Ok(meta) = fs::symlink_metadata(&frame_path) else {
            return None;
        };
        if meta.file_type().is_symlink() {
            return None;
        }
        if !meta.is_file() {
            return None;
        }
        let Ok(frame_real) = fs::canonicalize(&frame_path) else {
            return None;
        };
        if !frame_real.starts_with(&root_real) {
            return None;
        }
        match image_dimensions(&frame_real) {
            Some((PETDEX_CELL_WIDTH, PETDEX_CELL_HEIGHT)) => {}
            Some((_width, _height)) => return None,
            None => return None,
        }
        frames.push(frame_real.to_string_lossy().into_owned());
    }

    Some(ValidatedAnimationSequence { frames, fps })
}

fn is_animation_ref(value: &str) -> bool {
    let Some((namespace, name)) = value.split_once('.') else {
        return false;
    };
    matches!(namespace, "workflow" | "physical" | "legacy")
        && !name.is_empty()
        && name
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn resolve_animation_source(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative_path);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("animation source escapes companion root".to_string());
    }

    let candidate = root.join(path);
    let meta = fs::symlink_metadata(&candidate)
        .map_err(|_| "animation source is missing".to_string())?;
    if meta.file_type().is_symlink() {
        return Err("animation source cannot be a symlink".to_string());
    }
    if !meta.is_dir() {
        return Err("animation source must be a directory".to_string());
    }
    let root_real = fs::canonicalize(root)
        .map_err(|_| "asset root is unreadable".to_string())?;
    let candidate_real = fs::canonicalize(candidate)
        .map_err(|_| "animation source is unreadable".to_string())?;
    if !candidate_real.starts_with(root_real) {
        return Err("animation source resolves outside companion root".to_string());
    }
    Ok(candidate_real)
}

fn resolve_spritesheet(
    root: &Path,
    relative_path: &str,
    errors: &mut Vec<String>,
) -> Option<PathBuf> {
    let path = Path::new(relative_path);
    if path.is_absolute()
        || path
            .components()
            .any(|component| component == Component::ParentDir)
    {
        errors.push("spritesheetPath must stay inside companion root".to_string());
        return None;
    }
    if path
        .components()
        .any(|component| matches!(component, Component::RootDir | Component::Prefix(_)))
    {
        errors.push("spritesheetPath must be relative".to_string());
        return None;
    }

    let candidate = root.join(path);
    let Ok(meta) = fs::symlink_metadata(&candidate) else {
        errors.push("spritesheet missing".to_string());
        return None;
    };
    if meta.file_type().is_symlink() {
        errors.push("spritesheet cannot be a symlink".to_string());
        return None;
    }
    if !meta.is_file() {
        errors.push("spritesheet must be a file".to_string());
        return None;
    }

    let extension = candidate
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if extension != "webp" && extension != "png" {
        errors.push("spritesheet must be a WebP or PNG file".to_string());
        return None;
    }

    let root_real = match fs::canonicalize(root) {
        Ok(root_real) => root_real,
        Err(_) => {
            errors.push("asset root is unreadable".to_string());
            return None;
        }
    };
    let candidate_real = match fs::canonicalize(&candidate) {
        Ok(candidate_real) => candidate_real,
        Err(_) => {
            errors.push("spritesheet is unreadable".to_string());
            return None;
        }
    };
    if !candidate_real.starts_with(root_real) {
        errors.push("spritesheet resolves outside companion root".to_string());
        return None;
    }
    match image_dimensions(&candidate_real) {
        Some((PETDEX_ATLAS_WIDTH, PETDEX_ATLAS_HEIGHT)) => {}
        Some((width, height)) => {
            errors.push(format!(
                "spritesheet must be {PETDEX_ATLAS_WIDTH}x{PETDEX_ATLAS_HEIGHT}, got {width}x{height}"
            ));
            return None;
        }
        None => {
            errors.push("spritesheet dimensions unavailable".to_string());
            return None;
        }
    }
    Some(candidate_real)
}

fn image_dimensions(path: &Path) -> Option<(u32, u32)> {
    let bytes = fs::read(path).ok()?;
    png_dimensions(&bytes).or_else(|| webp_dimensions(&bytes))
}

fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    if bytes.len() < 24 || &bytes[0..8] != PNG_SIGNATURE || &bytes[12..16] != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
    let height = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
    Some((width, height))
}

fn webp_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 20 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return None;
    }

    let mut offset = 12;
    while offset + 8 <= bytes.len() {
        let fourcc = &bytes[offset..offset + 4];
        let chunk_size =
            u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().ok()?) as usize;
        let data_start = offset + 8;
        let data_end = data_start.checked_add(chunk_size)?;
        if data_end > bytes.len() {
            return None;
        }

        match fourcc {
            b"VP8X" if chunk_size >= 10 => {
                let width = 1 + read_uint24_le(&bytes[data_start + 4..data_start + 7])?;
                let height = 1 + read_uint24_le(&bytes[data_start + 7..data_start + 10])?;
                return Some((width, height));
            }
            b"VP8L" if chunk_size >= 5 && bytes[data_start] == 0x2f => {
                let b1 = bytes[data_start + 1] as u32;
                let b2 = bytes[data_start + 2] as u32;
                let b3 = bytes[data_start + 3] as u32;
                let b4 = bytes[data_start + 4] as u32;
                let width = 1 + (((b2 & 0x3f) << 8) | b1);
                let height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
                return Some((width, height));
            }
            b"VP8 "
                if chunk_size >= 10
                    && bytes[data_start + 3..data_start + 6] == [0x9d, 0x01, 0x2a] =>
            {
                let width =
                    u16::from_le_bytes(bytes[data_start + 6..data_start + 8].try_into().ok()?)
                        as u32
                        & 0x3fff;
                let height =
                    u16::from_le_bytes(bytes[data_start + 8..data_start + 10].try_into().ok()?)
                        as u32
                        & 0x3fff;
                return Some((width, height));
            }
            _ => {}
        }

        offset = data_end + (chunk_size % 2);
    }
    None
}

fn read_uint24_le(bytes: &[u8]) -> Option<u32> {
    if bytes.len() != 3 {
        return None;
    }
    Some(bytes[0] as u32 | ((bytes[1] as u32) << 8) | ((bytes[2] as u32) << 16))
}

fn source_for_root(root: &Path, home_dir: &Path) -> String {
    let petdex = home_dir.join(".petdex").join("pets");
    let codex = home_dir.join(".codex").join("pets");
    if root.starts_with(&petdex) {
        "petdex".to_string()
    } else if root.starts_with(&codex) {
        "codex".to_string()
    } else {
        "repo".to_string()
    }
}

fn default_companion() -> LocalCompanion {
    LocalCompanion {
        id: DEFAULT_COMPANION_ID.to_string(),
        partner_id: DEFAULT_COMPANION_ID.to_string(),
        display_name: "Default Petdex".to_string(),
        description: Some("Built-in probe atlas fallback".to_string()),
        root_path: None,
        spritesheet_path: None,
        atlas_url: None,
        capabilities: default_capabilities_for(DEFAULT_COMPANION_ID),
        valid: true,
        status: "fallback".to_string(),
        errors: Vec::new(),
        source: "builtin".to_string(),
    }
}

fn default_capabilities_for(partner_id: &str) -> CompanionCapabilities {
    let mut animations = BTreeMap::new();
    for (animation, row, frame_count) in [
        ("legacy.idle", "idle", 6),
        ("legacy.running-right", "running-right", 8),
        ("legacy.running-left", "running-left", 8),
        ("legacy.waving", "waving", 4),
        ("legacy.jumping", "jumping", 5),
        ("legacy.failed", "failed", 8),
        ("legacy.waiting", "waiting", 6),
        ("legacy.running", "running", 6),
        ("legacy.review", "review", 6),
    ] {
        animations.insert(
            animation.to_string(),
            CompanionTimeline {
                animation: animation.to_string(),
                loop_animation: animation != "legacy.waving" && animation != "legacy.jumping",
                procedural: Vec::new(),
                source: CompanionFrameSource::PetdexRow {
                    row: row.to_string(),
                    frame_count,
                    fps: DEFAULT_PETDEX_FPS,
                },
            },
        );
    }

    CompanionCapabilities {
        partner_id: partner_id.to_string(),
        animations,
        fallbacks: default_fallbacks(),
        runtime_limits: CompanionRuntimeLimits {
            frame_width: PETDEX_CELL_WIDTH,
            frame_height: PETDEX_CELL_HEIGHT,
            max_frames_per_animation: MAX_FRAMES_PER_ANIMATION as u32,
            min_fps: MIN_ANIMATION_FPS,
            max_fps: MAX_ANIMATION_FPS,
        },
    }
}

fn default_fallbacks() -> BTreeMap<String, Vec<String>> {
    BTreeMap::from([
        ("workflow.idle".to_string(), vec!["legacy.idle".to_string()]),
        (
            "workflow.running".to_string(),
            vec!["legacy.running".to_string(), "legacy.idle".to_string()],
        ),
        (
            "workflow.reading".to_string(),
            vec![
                "legacy.review".to_string(),
                "legacy.running".to_string(),
                "legacy.idle".to_string(),
            ],
        ),
        (
            "workflow.editing".to_string(),
            vec![
                "legacy.running".to_string(),
                "legacy.review".to_string(),
                "legacy.idle".to_string(),
            ],
        ),
        (
            "workflow.waiting".to_string(),
            vec!["legacy.waiting".to_string(), "legacy.idle".to_string()],
        ),
        (
            "workflow.error".to_string(),
            vec!["legacy.failed".to_string(), "legacy.idle".to_string()],
        ),
        (
            "workflow.done".to_string(),
            vec![
                "legacy.waving".to_string(),
                "legacy.jumping".to_string(),
                "legacy.idle".to_string(),
            ],
        ),
        (
            "physical.carried".to_string(),
            vec!["legacy.idle".to_string()],
        ),
        (
            "physical.struggling".to_string(),
            vec![
                "legacy.running-left".to_string(),
                "legacy.running-right".to_string(),
                "legacy.idle".to_string(),
            ],
        ),
        (
            "physical.falling".to_string(),
            vec!["legacy.idle".to_string()],
        ),
        (
            "physical.recovering".to_string(),
            vec!["legacy.idle".to_string()],
        ),
    ])
}

#[allow(dead_code)]
fn _petdex_dimensions() -> (u32, u32) {
    (PETDEX_ATLAS_WIDTH, PETDEX_ATLAS_HEIGHT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn scans_local_pet_roots_and_keeps_directory_id_distinct_from_manifest_id() {
        let temp = temp_dir("scan");
        let home = temp.join("home");
        let config = temp.join("config");
        write_pet(
            &home.join(".petdex").join("pets").join("anya-2"),
            "anya",
            "Anya",
            "spritesheet.webp",
            Some("webp"),
        );
        write_pet(
            &home.join(".codex").join("pets").join("artoria"),
            "artoria",
            "Artoria",
            "spritesheet.webp",
            Some("webp"),
        );

        let store = CompanionStore::new(home, config);
        let catalog = store.catalog();

        assert_eq!(catalog.companions.len(), 2);
        assert!(catalog
            .companions
            .iter()
            .any(|companion| companion.id == "petdex:anya-2"
                && companion.partner_id == "anya"
                && companion.valid));
        assert!(catalog
            .companions
            .iter()
            .any(|companion| companion.id == "codex:artoria"
                && companion.partner_id == "artoria"
                && companion.valid));
        assert_eq!(catalog.selected_companion_id, DEFAULT_COMPANION_ID);
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn catalog_serializes_petdex_row_sources_for_frontend_contract() {
        let temp = temp_dir("catalog-frame-source");
        let catalog = CompanionStore::new(temp.join("home"), temp.join("config")).catalog();

        let payload = serde_json::to_value(&catalog).expect("catalog should serialize");
        let source = &payload["selectedCompanion"]["capabilities"]["animations"]["legacy.idle"]["source"];

        assert_eq!(source["kind"], "petdex-row");
        assert_eq!(source["frameCount"], 6);
        assert!(source.get("frame_count").is_none());
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn keeps_same_directory_names_from_petdex_and_codex_selectable() {
        let temp = temp_dir("duplicate-source");
        let home = temp.join("home");
        let config = temp.join("config");
        for source_root in [".petdex", ".codex"] {
            write_pet(
                &home.join(source_root).join("pets").join("artoria"),
                "artoria",
                "Artoria",
                "spritesheet.webp",
                Some("webp"),
            );
        }

        let store = CompanionStore::new(home.clone(), config.clone());
        let catalog = store.catalog();

        assert!(catalog
            .companions
            .iter()
            .any(|companion| companion.id == "petdex:artoria" && companion.valid));
        assert!(catalog
            .companions
            .iter()
            .any(|companion| companion.id == "codex:artoria" && companion.valid));

        store
            .select("codex:artoria")
            .expect("codex companion should remain selectable");
        let restored = CompanionStore::new(home, config).catalog();
        assert_eq!(restored.selected_companion_id, "codex:artoria");
        assert_eq!(restored.selected_companion.source, "codex");
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn persists_selected_companion_and_restores_it() {
        let temp = temp_dir("persist");
        let home = temp.join("home");
        let config = temp.join("config");
        write_pet(
            &home.join(".petdex").join("pets").join("artoria"),
            "artoria",
            "Artoria",
            "spritesheet.webp",
            Some("webp"),
        );

        let store = CompanionStore::new(home.clone(), config.clone());
        let selected = store
            .select("petdex:artoria")
            .expect("valid companion should select");
        assert_eq!(selected.selected_companion_id, "petdex:artoria");

        let restored = CompanionStore::new(home, config).catalog();
        assert_eq!(restored.selected_companion_id, "petdex:artoria");
        assert!(!restored.fallback_used);
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn rejects_invalid_selection_and_keeps_previous_choice() {
        let temp = temp_dir("invalid");
        let home = temp.join("home");
        let config = temp.join("config");
        write_pet(
            &home.join(".petdex").join("pets").join("artoria"),
            "artoria",
            "Artoria",
            "spritesheet.webp",
            Some("webp"),
        );
        write_pet(
            &home.join(".petdex").join("pets").join("broken"),
            "broken",
            "Broken",
            "missing.webp",
            None,
        );

        let store = CompanionStore::new(home, config);
        store
            .select("petdex:artoria")
            .expect("valid companion should select");

        assert!(store.select("petdex:broken").is_err());
        let catalog = store.catalog();
        assert_eq!(catalog.selected_companion_id, "petdex:artoria");
        assert!(catalog
            .companions
            .iter()
            .any(|companion| companion.id == "petdex:broken" && !companion.valid));
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn local_pets_directory_only_returns_scoped_pet_roots() {
        let temp = temp_dir("scoped-pets-dir");
        let home = temp.join("home");
        let config = temp.join("config");
        let store = CompanionStore::new(home.clone(), config);

        assert_eq!(
            local_pets_directory(&store, "petdex").expect("petdex root"),
            home.join(".petdex").join("pets")
        );
        assert_eq!(
            local_pets_directory(&store, "codex").expect("codex root"),
            home.join(".codex").join("pets")
        );
        assert_eq!(
            local_pets_directory(&store, "downloads").expect_err("unknown source rejected"),
            "unknown companion source"
        );
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn ensure_local_pets_directory_creates_scoped_plain_directories() {
        let temp = temp_dir("ensure-scoped-pets-dir");
        let home = temp.join("home");
        let config = temp.join("config");
        fs::create_dir_all(&home).expect("home dir write");
        let store = CompanionStore::new(home.clone(), config);

        assert_eq!(
            ensure_local_pets_directory(&store, "codex").expect("codex pets dir"),
            fs::canonicalize(home.join(".codex").join("pets")).expect("pets dir real path")
        );
        assert!(home.join(".codex").is_dir());
        assert!(home.join(".codex").join("pets").is_dir());
        let _ = fs::remove_dir_all(temp);
    }

    #[cfg(unix)]
    #[test]
    fn local_pets_directory_rejects_symlinked_pet_root() {
        use std::os::unix::fs::symlink;

        let temp = temp_dir("scoped-pets-dir-symlink");
        let home = temp.join("home");
        let outside = temp.join("outside");
        fs::create_dir_all(&outside).expect("outside dir write");
        fs::create_dir_all(home.join(".petdex")).expect("petdex parent write");
        symlink(&outside, home.join(".petdex").join("pets")).expect("pets symlink write");
        let store = CompanionStore::new(home, temp.join("config"));

        assert_eq!(
            local_pets_directory(&store, "petdex").expect_err("symlink root rejected"),
            "pets directory cannot be a symlink"
        );
        let _ = fs::remove_dir_all(temp);
    }

    #[cfg(unix)]
    #[test]
    fn local_pets_directory_rejects_symlinked_source_parent() {
        use std::os::unix::fs::symlink;

        let temp = temp_dir("scoped-pets-source-symlink");
        let home = temp.join("home");
        let outside = temp.join("outside");
        fs::create_dir_all(&outside).expect("outside dir write");
        fs::create_dir_all(&home).expect("home dir write");
        symlink(&outside, home.join(".petdex")).expect("source symlink write");
        let store = CompanionStore::new(home, temp.join("config"));

        assert_eq!(
            local_pets_directory(&store, "petdex").expect_err("source symlink rejected"),
            "pets source directory cannot be a symlink"
        );
        assert_eq!(
            ensure_local_pets_directory(&store, "petdex")
                .expect_err("ensure source symlink rejected"),
            "pets source directory cannot be a symlink"
        );
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn rejects_bad_atlas_dimensions() {
        let temp = temp_dir("dimensions");
        let home = temp.join("home");
        let root = home.join(".petdex").join("pets").join("bad-size");
        fs::create_dir_all(&root).expect("pet root should be writable");
        fs::write(
            root.join("pet.json"),
            serde_json::json!({
                "id": "bad-size",
                "displayName": "Bad Size",
                "spritesheetPath": "spritesheet.png"
            })
            .to_string(),
        )
        .expect("pet json write");
        fs::write(root.join("spritesheet.png"), fake_png_header(64, 64))
            .expect("spritesheet write");

        let catalog = CompanionStore::new(home, temp.join("config")).catalog();
        let bad = catalog
            .companions
            .iter()
            .find(|companion| companion.id == "petdex:bad-size")
            .expect("bad-size companion should be listed");

        assert!(!bad.valid);
        assert!(bad
            .errors
            .iter()
            .any(|error| error.contains("spritesheet must be 1536x1872")));
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn rejects_spritesheet_paths_that_escape_the_companion_root() {
        let temp = temp_dir("escape");
        let home = temp.join("home");
        let root = home.join(".petdex").join("pets").join("escape");
        fs::create_dir_all(&root).expect("pet root should be writable");
        fs::write(
            home.join(".petdex").join("pets").join("outside.png"),
            fake_png_header(PETDEX_ATLAS_WIDTH, PETDEX_ATLAS_HEIGHT),
        )
        .expect("outside sprite write");
        fs::write(
            root.join("pet.json"),
            serde_json::json!({
                "id": "escape",
                "displayName": "Escape",
                "spritesheetPath": "../outside.png"
            })
            .to_string(),
        )
        .expect("pet json write");

        let catalog = CompanionStore::new(home, temp.join("config")).catalog();
        let escape = catalog
            .companions
            .iter()
            .find(|companion| companion.id == "petdex:escape")
            .expect("escape companion should be listed");

        assert!(!escape.valid);
        assert!(escape.spritesheet_path.is_none());
        assert!(escape
            .errors
            .iter()
            .any(|error| error == "spritesheetPath must stay inside companion root"));
        let _ = fs::remove_dir_all(temp);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_spritesheet_symlinks_before_exposing_asset_urls() {
        use std::os::unix::fs::symlink;

        let temp = temp_dir("symlink");
        let home = temp.join("home");
        let root = home.join(".petdex").join("pets").join("symlinked");
        fs::create_dir_all(&root).expect("pet root should be writable");
        let target = temp.join("outside.png");
        fs::write(
            &target,
            fake_png_header(PETDEX_ATLAS_WIDTH, PETDEX_ATLAS_HEIGHT),
        )
        .expect("outside sprite write");
        symlink(&target, root.join("spritesheet.png")).expect("spritesheet symlink write");
        fs::write(
            root.join("pet.json"),
            serde_json::json!({
                "id": "symlinked",
                "displayName": "Symlinked",
                "spritesheetPath": "spritesheet.png"
            })
            .to_string(),
        )
        .expect("pet json write");

        let catalog = CompanionStore::new(home, temp.join("config")).catalog();
        let symlinked = catalog
            .companions
            .iter()
            .find(|companion| companion.id == "petdex:symlinked")
            .expect("symlinked companion should be listed");

        assert!(!symlinked.valid);
        assert!(symlinked.spritesheet_path.is_none());
        assert!(symlinked
            .errors
            .iter()
            .any(|error| error == "spritesheet cannot be a symlink"));
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn loads_manifest_capabilities_when_present() {
        let temp = temp_dir("manifest");
        let home = temp.join("home");
        let root = home.join(".petdex").join("pets").join("custom");
        write_pet(&root, "custom", "Custom", "spritesheet.png", Some("png"));
        let animation_dir = root.join("animations").join("wave");
        fs::create_dir_all(&animation_dir).expect("animation dir write");
        fs::write(
            animation_dir.join("001.png"),
            fake_png_header(PETDEX_CELL_WIDTH, PETDEX_CELL_HEIGHT),
        )
        .expect("second frame write");
        fs::write(
            animation_dir.join("000.png"),
            fake_png_header(PETDEX_CELL_WIDTH, PETDEX_CELL_HEIGHT),
        )
        .expect("first frame write");
        fs::write(
            root.join("ai-partner.animations.json"),
            serde_json::json!({
                "schemaVersion": "ai-partner.animations.v1",
                "animations": {
                    "workflow.done": {
                        "source": "animations/wave",
                        "fps": 8,
                        "loop": false,
                        "fallbacks": ["legacy.waving"]
                    }
                }
            })
            .to_string(),
        )
        .expect("manifest write");

        let catalog = CompanionStore::new(home, temp.join("config")).catalog();
        let custom = catalog
            .companions
            .iter()
            .find(|companion| companion.id == "petdex:custom")
            .expect("custom companion should be listed");

        assert!(custom.valid);
        assert_eq!(
            custom
                .capabilities
                .animations
                .get("workflow.done")
                .map(|timeline| timeline.loop_animation),
            Some(false)
        );
        let timeline = custom
            .capabilities
            .animations
            .get("workflow.done")
            .expect("workflow.done sequence should be registered");
        assert_eq!(
            timeline.source,
            CompanionFrameSource::PngSequence {
                frames: vec![
                    fs::canonicalize(animation_dir.join("000.png"))
                        .expect("first frame real path")
                        .to_string_lossy()
                        .into_owned(),
                    fs::canonicalize(animation_dir.join("001.png"))
                        .expect("second frame real path")
                        .to_string_lossy()
                        .into_owned(),
                ],
                fps: 8
            }
        );
        assert_eq!(
            custom.capabilities.fallbacks.get("workflow.done"),
            Some(&vec!["legacy.waving".to_string()])
        );
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn skips_bad_manifest_sequences_while_preserving_legacy_fallbacks() {
        let temp = temp_dir("manifest-bad-sequence");
        let home = temp.join("home");
        let root = home.join(".petdex").join("pets").join("custom");
        write_pet(&root, "custom", "Custom", "spritesheet.png", Some("png"));
        fs::write(
            root.join("ai-partner.animations.json"),
            serde_json::json!({
                "schemaVersion": "ai-partner.animations.v1",
                "animations": {
                    "workflow.done": {
                        "source": "extras/missing",
                        "fps": 8,
                        "loop": false,
                        "fallbacks": ["legacy.waving", "legacy.idle"]
                    }
                }
            })
            .to_string(),
        )
        .expect("manifest write");

        let catalog = CompanionStore::new(home, temp.join("config")).catalog();
        let custom = catalog
            .companions
            .iter()
            .find(|companion| companion.id == "petdex:custom")
            .expect("custom companion should be listed");

        assert!(custom.valid);
        assert!(!custom.capabilities.animations.contains_key("workflow.done"));
        assert_eq!(
            custom.capabilities.fallbacks.get("workflow.done"),
            Some(&vec!["legacy.waving".to_string(), "legacy.idle".to_string()])
        );
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn smoke_discovers_local_anya_and_artoria_when_installed() {
        let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
            return;
        };
        let expected = [
            ("petdex:anya-2", "anya"),
            ("petdex:artoria", "artoria"),
            ("codex:anya-2", "anya"),
            ("codex:artoria", "artoria"),
        ];
        if expected.iter().any(|(id, _)| {
            let (source, directory) = id.split_once(':').expect("expected source id");
            let root = match source {
                "petdex" => ".petdex",
                "codex" => ".codex",
                _ => return true,
            };
            !home
                .join(root)
                .join("pets")
                .join(directory)
                .join("pet.json")
                .is_file()
        }) {
            return;
        }

        let temp = temp_dir("real-assets");
        let store = CompanionStore::new(home, temp.clone());
        let catalog = store.catalog();

        for (id, partner_id) in expected {
            assert!(catalog.companions.iter().any(|companion| {
                companion.id == id && companion.partner_id == partner_id && companion.valid
            }));
        }
        let _ = fs::remove_dir_all(temp);
    }

    fn write_pet(
        root: &Path,
        id: &str,
        display_name: &str,
        spritesheet_path: &str,
        sprite_extension: Option<&str>,
    ) {
        fs::create_dir_all(root).expect("pet root should be writable");
        let pet_json = serde_json::json!({
            "id": id,
            "displayName": display_name,
            "spritesheetPath": spritesheet_path
        });
        fs::write(root.join("pet.json"), pet_json.to_string()).expect("pet json write");
        if sprite_extension.is_some() {
            fs::write(
                root.join(spritesheet_path),
                fake_png_header(PETDEX_ATLAS_WIDTH, PETDEX_ATLAS_HEIGHT),
            )
            .expect("spritesheet write");
        }
    }

    fn fake_png_header(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"\x89PNG\r\n\x1a\n");
        bytes.extend_from_slice(&13_u32.to_be_bytes());
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
        bytes.extend_from_slice(&0_u32.to_be_bytes());
        bytes
    }

    fn temp_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should be monotonic")
            .as_nanos();
        std::env::temp_dir().join(format!("ai-partner-companion-{name}-{nonce}"))
    }
}
