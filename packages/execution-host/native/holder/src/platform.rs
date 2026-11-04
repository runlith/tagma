use crate::frames::{Action, Launch, Reason, Target};
use crate::table::{Exit, Pace, Prepared, Transport, Usage};
use std::collections::HashSet;
use std::hash::Hash;
use std::rc::Rc;

pub struct Failure {
    pub reason: Reason,
    pub detail: String,
}

impl Failure {
    pub fn new(reason: Reason, detail: impl Into<String>) -> Self {
        Self { reason, detail: detail.into() }
    }
}

pub enum Io {
    Done(usize),
    Blocked,
    Ended,
    Broken(String),
}

#[derive(Clone, Copy)]
pub enum Timer {
    Restart,
    Preparation,
    Departure,
}

pub enum Event<T> {
    Readable(T),
    Writable(T),
    Child,
    Timer(Timer),
}

pub enum Part {
    Terminal,
    Stdin,
    Stdout,
    Stderr,
}

pub enum Opened<P> {
    Entered(i32),
    Held(String),
    Verifying(Vec<u8>),
    Claimed { platform: P, logic: Vec<String>, carried: Option<Inheritance> },
}

pub struct Inheritance {
    pub table: Vec<u8>,
    pub activated: bool,
}

pub struct Spawned<P: Platform> {
    pub process: P::Process,
    pub pid: u32,
    pub work: u32,
    pub birth: String,
    pub pace: Pace,
    pub transport: Transport<P::Handle>,
}

pub struct Launching<P: Platform> {
    pub spawned: Spawned<P>,
    pub status: P::Status,
    pub token: P::Token,
}

pub trait Platform: Sized {
    type Handle;
    type Channel;
    type Process;
    type Status;
    type Token: Copy + Eq + Hash;

    const TERMINAL_EXPENSE: u8;
    const PIPE_EXPENSE: u8;

    fn open() -> Result<Opened<Self>, String>;
    fn diagnostic(message: std::fmt::Arguments<'_>) { eprintln!("{message}"); }
    fn flush_output(&mut self) {}
    fn pid(&self) -> u32;
    fn claim(&self) -> Rc<Self::Handle>;
    fn handle_limit(&self) -> Option<u64>;
    fn capabilities(&self) -> &[&'static str];

    fn start_logic(&mut self, argv: &[String]) -> Result<(Self::Process, Self::Channel), String>;
    fn end(&mut self, logic: &Self::Process);

    fn token(&self, channel: &Self::Channel) -> Self::Token;
    fn hand(&mut self, channel: &Self::Channel, handles: &[Rc<Self::Handle>]) -> Result<Vec<u64>, String>;
    fn send(&mut self, channel: &Self::Channel, bytes: &[u8], handles: &[Rc<Self::Handle>]) -> Io;
    fn watch_write(&mut self, channel: &Self::Channel, on: bool) -> Result<(), String>;
    fn receive(&mut self, channel: &Self::Channel, into: &mut [u8]) -> Io;

    fn wait(&mut self, events: &mut Vec<Event<Self::Token>>) -> Result<(), String>;
    fn timer(&mut self, timer: Timer, ms: u64) -> Result<(), String>;
    fn now_ms(&self) -> u64;

    fn launch(&mut self, launch: &Launch) -> Result<Launching<Self>, (Failure, Option<Self::Process>)>;
    fn settle(&mut self, status: &mut Self::Status) -> Option<Result<(), Failure>>;
    fn observe(&mut self, process: &Self::Process) -> Option<Exit>;
    fn reap(&mut self, process: &mut Self::Process) -> Result<Option<(Exit, Usage)>, Failure>;
    fn sweep(&mut self, _owned: &HashSet<u64>) -> Result<(), String> {
        Ok(())
    }
    fn close(&mut self, process: &mut Self::Process, part: Part, handles: Vec<Rc<Self::Handle>>);
    fn release(&mut self, process: &mut Self::Process, transport: Transport<Self::Handle>);
    fn act(&mut self, process: &mut Self::Process, target: Target, action: Action) -> Result<(), Failure>;
    fn signal(&mut self, process: &mut Self::Process, target: Target, name: &str) -> Result<(), Failure>;
    fn abandon(&mut self, process: &mut Self::Process);
    fn pace(&mut self, pid: u32, birth: &str, initial: Pace, next: Pace) -> Result<bool, Failure>;

    fn handle_value(handle: &Self::Handle) -> u64;
    fn process_value(process: &Self::Process) -> u64;
    fn keep_handle(value: u64) -> Result<(), String>;
    fn own_handle(value: u64) -> Self::Handle;
    fn adopt_process(value: u64) -> Result<Self::Process, String>;
    fn seal(&mut self);
    fn retreat(&mut self, handles: &[u64], why: &str) -> String;

    fn entry(&mut self) -> Result<Option<Prepared>, Failure>;
    fn differs(&mut self, holder: &str) -> Result<bool, Failure>;
    fn prepare(&mut self, holder: &str, table: &[u8], handles: &[Rc<Self::Handle>]) -> Result<Self::Process, Failure>;
    fn rotate(&mut self) -> Result<(), Failure>;
    fn restore(&mut self) -> Result<(), Failure>;
    fn replace(&mut self, holder: &str, table: &[u8], handles: &[Rc<Self::Handle>]) -> Failure;
}
