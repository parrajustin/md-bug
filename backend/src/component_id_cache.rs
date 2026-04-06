use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use crate::api::{ComponentMetadata, read_versioned};

/// Cache mapping component IDs to their hierarchical paths.
#[derive(Debug, Default)]
pub struct ComponentIdCache {
    /// Map of component ID to hierarchical path (e.g., "google/sxs").
    pub id_to_path: HashMap<u32, String>,
}

impl ComponentIdCache {
    /// Performs a full scan of the root directory to populate the cache.
    pub fn update_from_disk(&mut self, root: &Path) {
        self.id_to_path.clear();
        
        for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
            if entry.file_name() == "component_metadata" {
                if let Ok(data) = fs::read(entry.path()) {
                    if let Ok(meta) = read_versioned::<ComponentMetadata>(&data) {
                        if let Ok(relative_path) = entry.path().parent().unwrap().strip_prefix(root) {
                            let path_str = relative_path.to_string_lossy().replace('\\', "/");
                            if !path_str.is_empty() {
                                self.id_to_path.insert(meta.id, path_str);
                            }
                        }
                    }
                }
            }
        }
    }

    /// Gets the hierarchical path for a component ID.
    pub fn get_path(&self, id: u32) -> Option<String> {
        self.id_to_path.get(&id).cloned()
    }

    /// Inserts a mapping into the cache.
    pub fn insert(&mut self, id: u32, path: String) {
        self.id_to_path.insert(id, path);
    }

    /// Gets the next available component ID.
    pub fn get_next_id(&self) -> u32 {
        self.id_to_path.keys().max().map(|id| id + 1).unwrap_or(1)
    }
}
