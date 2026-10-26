use std::collections::HashMap;

pub const CREATED: u8 = 1;
pub const UPDATED: u8 = 2;
pub const DELETED: u8 = 4;
pub const RENAMED: u8 = 8;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Change {
    Created { path: String, directory: bool },
    Updated { path: String },
    Deleted { path: String },
}

#[derive(Default)]
pub struct Batch {
    order: Vec<String>,
    kinds: HashMap<String, u8>,
    pub dropped: Vec<(String, String)>,
    pub touched: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Presence {
    Missing,
    File,
    Directory,
}

impl Batch {
    pub fn add(&mut self, relative: String, kind: u8) {
        self.touched = true;
        if relative.is_empty() {
            return;
        }
        match self.kinds.get_mut(&relative) {
            Some(held) => *held |= kind,
            None => {
                self.kinds.insert(relative.clone(), kind);
                self.order.push(relative);
            }
        }
    }

    pub fn drop_subtree(&mut self, relative: String, reason: String) {
        self.touched = true;
        if !self.dropped.iter().any(|(held, _)| *held == relative) {
            self.dropped.push((relative, reason));
        }
    }

    pub fn is_empty(&self) -> bool {
        !self.touched
    }

    pub fn resolve(self, mut presence: impl FnMut(&str) -> Presence) -> Vec<Change> {
        let Batch { order, kinds, .. } = self;
        let mut changes = Vec::with_capacity(order.len());
        for path in order {
            let kind = kinds[&path];
            let change = if kind == UPDATED {
                Change::Updated { path }
            } else if kind == DELETED {
                Change::Deleted { path }
            } else {
                match presence(&path) {
                    Presence::Missing => Change::Deleted { path },
                    found if kind & (CREATED | RENAMED) != 0 => Change::Created { path, directory: found == Presence::Directory },
                    _ => Change::Updated { path },
                }
            };
            changes.push(change);
        }
        changes
    }
}

#[cfg(test)]
mod tests {
    use super::{Batch, CREATED, Change, DELETED, Presence, RENAMED, UPDATED};

    #[test]
    fn the_standing_state_of_a_path_decides_what_a_mixed_batch_says_of_it() {
        let mut batch = Batch::default();
        batch.add("replaced-then-removed".into(), RENAMED);
        batch.add("removed-then-recreated".into(), DELETED);
        batch.add("removed-then-recreated".into(), CREATED);
        batch.add("written".into(), UPDATED);
        batch.add("made-dir".into(), CREATED);
        batch.add("replaced-then-removed".into(), DELETED);
        batch.add("gone".into(), DELETED);
        let standing = |path: &str| match path {
            "removed-then-recreated" => Presence::File,
            "made-dir" => Presence::Directory,
            _ => Presence::Missing,
        };
        assert_eq!(
            batch.resolve(standing),
            vec![
                Change::Deleted { path: "replaced-then-removed".into() },
                Change::Created { path: "removed-then-recreated".into(), directory: false },
                Change::Updated { path: "written".into() },
                Change::Created { path: "made-dir".into(), directory: true },
                Change::Deleted { path: "gone".into() },
            ]
        );
    }
}
