use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use walkdir::WalkDir;

/// Archivable data for the bug ID cache.
#[derive(rkyv::Archive, rkyv::Deserialize, rkyv::Serialize, Debug, Default)]
#[archive(check_bytes)]
pub struct BugIdCacheData {
    pub id_to_components: HashMap<u64, Vec<String>>,
    pub next_bug_id: u32,
    pub next_comment_ids: HashMap<u64, u32>,
}

/// Cache mapping bug IDs to their hierarchical component paths, with granular locking.
pub struct BugIdCache {
    /// Map of bug ID to list of components (folders).
    pub id_to_components: Mutex<HashMap<u64, Vec<String>>>,
    /// Next available bug ID.
    pub next_bug_id: Mutex<u32>,
    /// Next available comment ID for each bug, protected by individual mutexes.
    pub comment_id_counters: Mutex<HashMap<u64, Arc<Mutex<u32>>>>,
}

impl BugIdCache {
    pub fn new() -> Self {
        Self {
            id_to_components: Mutex::new(HashMap::new()),
            next_bug_id: Mutex::new(1),
            comment_id_counters: Mutex::new(HashMap::new()),
        }
    }

    /// Loads the cache from disk or creates a new one if it doesn't exist.
    pub fn load_and_update(root: &Path) -> Self {
        let cache_path = root.join("__bug_id_cache__");
        let data = if cache_path.exists() {
            match fs::read(&cache_path) {
                Ok(bytes) if !bytes.is_empty() => {
                    rkyv::from_bytes::<BugIdCacheData>(&bytes).unwrap_or_default()
                }
                _ => BugIdCacheData::default(),
            }
        } else {
            BugIdCacheData::default()
        };

        let cache = Self::new();
        {
            *cache.id_to_components.lock().unwrap() = data.id_to_components;
            *cache.next_bug_id.lock().unwrap() = if data.next_bug_id == 0 { 1 } else { data.next_bug_id };
            let mut counters = cache.comment_id_counters.lock().unwrap();
            for (id, next_cid) in data.next_comment_ids {
                counters.insert(id, Arc::new(Mutex::new(next_cid)));
            }
        }

        cache.update_from_disk(root);
        let _ = cache.save(root);
        cache
    }

    pub fn update_from_disk(&self, root: &Path) {
        let mut walker = WalkDir::new(root).into_iter();
        let mut max_id = 0;

        let mut discovered_bugs = Vec::new();

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
                if file_name.starts_with("__") {
                    if entry.file_type().is_dir() {
                        walker.skip_current_dir();
                    }
                    continue;
                }

                if let Ok(id) = file_name.parse::<u64>() {
                    if id > max_id {
                        max_id = id;
                    }

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
                        
                        // Scan for comments
                        let mut max_comment_id = 0;
                        if let Ok(dir) = fs::read_dir(path) {
                            for comment_entry in dir.filter_map(|e| e.ok()) {
                                let cname = comment_entry.file_name().into_string().unwrap_or_default();
                                if cname.starts_with("comment_") {
                                    if let Ok(cid) = cname["comment_".len()..].parse::<u32>() {
                                        if cid > max_comment_id {
                                            max_comment_id = cid;
                                        }
                                    }
                                }
                            }
                        }
                        discovered_bugs.push((id, components, max_comment_id + 1));
                    }
                    
                    if entry.file_type().is_dir() {
                        walker.skip_current_dir();
                    }
                }
            }
        }

        {
            let mut next_id = self.next_bug_id.lock().unwrap();
            if max_id >= *next_id as u64 {
                *next_id = (max_id + 1) as u32;
            }
        }

        let mut id_to_comp = self.id_to_components.lock().unwrap();
        let mut counters = self.comment_id_counters.lock().unwrap();
        for (id, components, next_cid) in discovered_bugs {
            id_to_comp.insert(id, components);
            counters.entry(id).or_insert_with(|| Arc::new(Mutex::new(next_cid)));
        }
    }

    pub fn get_next_bug_id(&self) -> u32 {
        let mut next_id = self.next_bug_id.lock().unwrap();
        let id = *next_id;
        *next_id += 1;
        id
    }

    pub fn get_next_comment_id(&self, bug_id: u64) -> u32 {
        let counter = {
            let mut counters = self.comment_id_counters.lock().unwrap();
            counters.entry(bug_id).or_insert_with(|| Arc::new(Mutex::new(1))).clone()
        };
        let mut next_id = counter.lock().unwrap();
        let id = *next_id;
        *next_id += 1;
        id
    }

    pub fn insert_bug(&self, id: u64, components: Vec<String>) {
        self.id_to_components.lock().unwrap().insert(id, components);
        self.comment_id_counters.lock().unwrap().entry(id).or_insert_with(|| Arc::new(Mutex::new(1)));
    }

    pub fn save(&self, root: &Path) -> std::io::Result<()> {
        let data = {
            let id_to_comp = self.id_to_components.lock().unwrap();
            let next_id = self.next_bug_id.lock().unwrap();
            let counters = self.comment_id_counters.lock().unwrap();
            
            let mut next_comment_ids = HashMap::new();
            for (id, counter) in counters.iter() {
                next_comment_ids.insert(*id, *counter.lock().unwrap());
            }
            BugIdCacheData {
                id_to_components: id_to_comp.clone(),
                next_bug_id: *next_id,
                next_comment_ids,
            }
        };

        let cache_path = root.join("__bug_id_cache__");
        let bytes = rkyv::to_bytes::<_, 4096>(&data)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
        fs::write(cache_path, bytes)
    }

    pub fn get_path(&self, root: &Path, id: u64) -> Option<PathBuf> {
        let id_to_comp = self.id_to_components.lock().unwrap();
        id_to_comp.get(&id).map(|components| {
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
#[path = "bug_id_cache_test.rs"]
mod bug_id_cache_test;
