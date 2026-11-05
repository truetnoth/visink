// Файловые команды для фронтенда: всё, что нужно интерфейсу ProjectFs, и ничего больше.
// Корень проекта приходит с фронтенда (папку выбрал пользователь), путь внутри — только относительный.

use std::fs;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};

/// Склеивает корень и относительный путь; запрещает выход за корень (`..`, абсолютные пути).
fn inside(root: &str, rel: &str) -> Result<PathBuf, String> {
    let root = Path::new(root);
    if !root.is_absolute() {
        return Err(format!("корень проекта должен быть абсолютным путём: {}", root.display()));
    }
    let mut out = root.to_path_buf();
    for part in Path::new(rel).components() {
        match part {
            Component::Normal(p) => out.push(p),
            Component::CurDir => {}
            _ => return Err(format!("путь выходит за папку проекта: {rel}")),
        }
    }
    Ok(out)
}

#[tauri::command]
fn read_text(root: String, path: String) -> Result<Option<String>, String> {
    match fs::read_to_string(inside(&root, &path)?) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{path}: {e}")),
    }
}

/// Двоичный файл (портрет) сырыми байтами — без JSON-массива чисел. Нет файла — пустой ответ.
#[tauri::command]
fn read_bytes(root: String, path: String) -> Result<tauri::ipc::Response, String> {
    match fs::read(inside(&root, &path)?) {
        Ok(bytes) => Ok(tauri::ipc::Response::new(bytes)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(tauri::ipc::Response::new(Vec::new())),
        Err(e) => Err(format!("{path}: {e}")),
    }
}

#[tauri::command]
fn write_text(root: String, path: String, content: String) -> Result<(), String> {
    let target = inside(&root, &path)?;
    if let Some(dir) = target.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("{path}: {e}"))?;
    }
    fs::write(&target, content).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn remove_file(root: String, path: String) -> Result<(), String> {
    match fs::remove_file(inside(&root, &path)?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("{path}: {e}")),
    }
}

/// Файлы под папкой, пути — относительно корня через `/`, по алфавиту. Нет папки — пустой список.
#[tauri::command]
fn list_files(root: String, dir: String, shallow: bool) -> Result<Vec<String>, String> {
    let base = inside(&root, &dir)?;
    let mut out = Vec::new();
    walk(Path::new(&root), &base, shallow, &mut out)?;
    out.sort();
    Ok(out)
}

fn walk(root: &Path, dir: &Path, shallow: bool, out: &mut Vec<String>) -> Result<(), String> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("{}: {e}", dir.display())),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_dir() {
            if !shallow {
                walk(root, &path, shallow, out)?;
            }
        } else if kind.is_file() {
            let rel = path.strip_prefix(root).map_err(|e| e.to_string())?;
            let parts: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
            out.push(parts.join("/"));
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![read_text, read_bytes, write_text, remove_file, list_files])
        .run(tauri::generate_context!())
        .expect("не удалось запустить Visink");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_paths_outside_root() {
        assert!(inside("/tmp/p", "../etc/passwd").is_err());
        assert!(inside("/tmp/p", "/etc/passwd").is_err());
        assert!(inside("relative", "a.txt").is_err());
        assert_eq!(inside("/tmp/p", "canvases/dean.canvas.json").unwrap(), PathBuf::from("/tmp/p/canvases/dean.canvas.json"));
    }

    #[test]
    fn roundtrip_and_listing() {
        let root = std::env::temp_dir().join(format!("visink-test-{}", std::process::id()));
        let r = root.to_string_lossy().into_owned();
        write_text(r.clone(), "canvases/dean.canvas.json".into(), "{}".into()).unwrap();
        write_text(r.clone(), "project.json".into(), "{\"name\":\"x\"}".into()).unwrap();
        assert_eq!(read_text(r.clone(), "project.json".into()).unwrap().as_deref(), Some("{\"name\":\"x\"}"));
        assert_eq!(read_text(r.clone(), "missing.json".into()).unwrap(), None);
        assert_eq!(list_files(r.clone(), "".into(), false).unwrap(), vec!["canvases/dean.canvas.json", "project.json"]);
        assert_eq!(list_files(r.clone(), "".into(), true).unwrap(), vec!["project.json"]);
        assert_eq!(list_files(r.clone(), "nope".into(), false).unwrap(), Vec::<String>::new());
        remove_file(r.clone(), "project.json".into()).unwrap();
        remove_file(r.clone(), "project.json".into()).unwrap();
        fs::remove_dir_all(root).unwrap();
    }
}
