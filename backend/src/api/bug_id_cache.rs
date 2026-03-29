use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// Cache mapping bug IDs to their hierarchical component paths.
#[derive(rkyv::Archive, rkyv::Deserialize, rkyv::Serialize, Debug, Default)]
#[archive(check_bytes)]
pub struct BugIdCache {
    /// Map of bug ID to list of components (folders).
    pub id_to_components: HashMap<u64, Vec<String>>,
}

impl BugIdCache {
    /// Loads the cache from disk or creates a new one if it doesn't exist.
    /// Then performs a scan of the root directory to update the cache.
    pub fn load_and_update(root: &Path) -> Self {
        let cache_path = root.join("__bug_id_cache__");
        let mut cache = if cache_path.exists() {
            match fs::read(&cache_path) {
                Ok(data) if !data.is_empty() => {
                    rkyv::from_bytes::<BugIdCache>(&data).unwrap_or_default()
                }
                _ => Self::default(),
            }
        } else {
            Self::default()
        };

        cache.update_from_disk(root);
        let _ = cache.save(root);
        cache
    }

    /// Recursively scans the disk for bug ID folders and updates the cache.
    pub fn update_from_disk(&mut self, root: &Path) {
        let mut walker = WalkDir::new(root).into_iter();

        loop {
            let entry = match walker.next() {
                None => break,
                Some(Err(_)) => continue,
                Some(Ok(entry)) => entry,
            };

            let path = entry.path();
            if path == root {
                continue;
            }

            if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                // Skip folders starting with __
                if file_name.starts_with("__") {
                    if entry.file_type().is_dir() {
                        walker.skip_current_dir();
                    }
                    continue;
                }

                // Components cannot be numbers. 
                // If folder name is a number, it's a bug ID folder.
                if let Ok(id) = file_name.parse::<u64>() {
                    if let Ok(relative_path) = path.strip_prefix(root) {
                        let components: Vec<String> = relative_path
                            .parent()
                            .map(|p| {
                                p.components()
                                    .map(|c| c.as_os_str().to_string_lossy().into_owned())
                                    .filter(|s| !s.is_empty())
                                    .collect()
                            })
                            .unwrap_or_default();
                        
                        self.id_to_components.insert(id, components);
                    }
                    
                    // Bug ID folders should not contain sub-components (as per rule: components cannot be numbers)
                    if entry.file_type().is_dir() {
                        walker.skip_current_dir();
                    }
                }
            }
        }
    }

    /// Saves the current cache state to disk.
    pub fn save(&self, root: &Path) -> std::io::Result<()> {
        let cache_path = root.join("__bug_id_cache__");
        let bytes = rkyv::to_bytes::<_, 1024>(self)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
        fs::write(cache_path, bytes)
    }

    /// Gets the full filesystem path for a bug ID.
    pub fn get_path(&self, root: &Path, id: u64) -> Option<PathBuf> {
        self.id_to_components.get(&id).map(|components| {
            let mut path = root.to_path_buf();
            for component in components {
                path.push(component);
            }
            path.push(id.to_string());
            path
        })
    }
}

#[cfg(test)]
mod bug_id_cache_test;
