use crate::platform::{Platform, Spawned};
use std::collections::BTreeMap;
use std::rc::Rc;

#[derive(Clone, Copy)]
pub enum Pace {
    Full = 0,
    Low = 1,
    Lowest = 2,
}

#[derive(Clone)]
pub enum Exit {
    Code(i32),
    Signal(String),
}

#[derive(Clone)]
pub struct Usage {
    pub user_micros: u64,
    pub system_micros: u64,
    pub peak_rss_bytes: u64,
}

pub enum Transport<H> {
    Terminal { handles: Vec<Rc<H>>, name: Option<Vec<u8>> },
    Pipes { stdout: Option<Rc<H>>, stderr: Option<Rc<H>>, stdin: Option<Rc<H>>, piped: bool },
}

pub enum Input {
    Absent,
    Open,
    Closed,
}

pub struct Record<P: Platform> {
    pub key: Vec<u8>,
    pub process: P::Process,
    pub pid: u32,
    pub work: u32,
    pub birth: String,
    pub pace: Pace,
    pub transport: Transport<P::Handle>,
    pub exit: Option<Exit>,
    pub reaped: Option<Usage>,
}

impl<P: Platform> Record<P> {
    pub fn new(key: Vec<u8>, spawned: Spawned<P>) -> Self {
        let Spawned { process, pid, work, birth, pace, transport } = spawned;
        Self { key, process, pid, work, birth, pace, transport, exit: None, reaped: None }
    }

    pub fn handles(&self) -> Vec<Rc<P::Handle>> {
        match &self.transport {
            Transport::Terminal { handles, .. } => handles.iter().map(Rc::clone).collect(),
            Transport::Pipes { stdout, stderr, stdin, .. } => stdout.iter().chain(stderr.iter()).chain(stdin.iter()).map(Rc::clone).collect(),
        }
    }

    pub fn handle_mask(&self) -> u8 {
        match &self.transport {
            Transport::Terminal { handles, .. } => handles.len() as u8,
            Transport::Pipes { stdout, stderr, stdin, .. } =>
                u8::from(stdout.is_some()) | (u8::from(stderr.is_some()) << 1) | (u8::from(stdin.is_some()) << 2),
        }
    }

    pub fn input(&self) -> Input {
        match &self.transport {
            Transport::Terminal { handles, .. } => if handles.is_empty() { Input::Closed } else { Input::Open },
            Transport::Pipes { stdin: Some(_), .. } => Input::Open,
            Transport::Pipes { stdin: None, piped: true, .. } => Input::Closed,
            Transport::Pipes { .. } => Input::Absent,
        }
    }
}

#[derive(Clone, PartialEq)]
pub struct Prepared {
    pub holder: String,
    pub logic: Vec<String>,
}

pub struct Table<P: Platform> {
    records: BTreeMap<Vec<u8>, Record<P>>,
    pub orphans: Vec<P::Process>,
    pub generation: Option<u64>,
    pub logic: Vec<String>,
    pub prepared: Option<Prepared>,
}

impl<P: Platform> Table<P> {
    pub fn new(logic: Vec<String>) -> Self {
        Self { records: BTreeMap::new(), orphans: Vec::new(), generation: None, logic, prepared: None }
    }
}

impl<P: Platform> Table<P> {
    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }

    pub fn len(&self) -> usize {
        self.records.len()
    }

    pub fn records(&self) -> impl Iterator<Item = &Record<P>> {
        self.records.values()
    }

    pub fn records_mut(&mut self) -> impl Iterator<Item = &mut Record<P>> {
        self.records.values_mut()
    }

    pub fn holds(&self, key: &[u8]) -> bool {
        self.records.contains_key(key)
    }

    pub fn get(&mut self, key: &[u8]) -> Option<&mut Record<P>> {
        self.records.get_mut(key)
    }

    pub fn insert(&mut self, record: Record<P>) {
        self.records.insert(record.key.clone(), record);
    }

    pub fn remove(&mut self, key: &[u8]) -> Option<Record<P>> {
        self.records.remove(key)
    }
}
