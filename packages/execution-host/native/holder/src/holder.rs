use crate::control::{Control, Leaving};
use crate::frames::{self, Action, Greeting, Reason, Request, Stream, Target};
use crate::handover;
use crate::platform::{Event, Failure, Launching, Opened, Part, Platform, Timer};
use crate::table::{Exit, Prepared, Record, Table, Transport};
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

macro_rules! eprintln {
    ($($message:tt)*) => { P::diagnostic(format_args!($($message)*)) };
}

const CLAIM_HELD: i32 = 2;
const TABLE_REFUSED: i32 = 3;
const ACTIVATE_EXIT: i32 = 75;
const PREPARATION_PATIENCE_MS: u64 = 10_000;
const DEPARTURE_PATIENCE_MS: u64 = 10_000;
const STEADY_MS: u64 = 10_000;
const FIRST_PAUSE_MS: u64 = 250;
const LONGEST_PAUSE_MS: u64 = 8_000;
const RECEIVE_BYTES: usize = 65_536;
const UNKNOWN: &str = "the holder holds no execution under this key";

struct Logic<P: Platform> {
    process: P::Process,
    since: u64,
    ready: bool,
    control: Option<Control<P>>,
}

struct Starting<P: Platform> {
    request: u32,
    record: Record<P>,
    status: P::Status,
}

struct Refusal {
    request: u32,
    failure: Failure,
}

struct Preparing<P: Platform> {
    request: u32,
    prepared: Prepared,
    process: P::Process,
}

struct Return {
    logic: Vec<String>,
    from: Prepared,
}

struct Holder<P: Platform> {
    platform: P,
    starting: HashMap<P::Token, Starting<P>>,
    refusing: HashMap<u64, Refusal>,
    waiting_start: bool,
    table: Table<P>,
    logic: Option<Logic<P>>,
    vacating: bool,
    leaving: Option<i32>,
    failures: u32,
    landing: Vec<u8>,
    preparing: Option<Preparing<P>>,
    activation: bool,
    risen: bool,
    returning: Option<Return>,
    unsealed: bool,
    rejected: Vec<Prepared>,
}

impl<P: Platform> Holder<P> {
    fn send(&mut self, frame: impl FnOnce(&[u64]) -> Vec<u8>, handles: Vec<Rc<P::Handle>>) {
        let Some(control) = self.logic.as_mut().and_then(|logic| logic.control.as_mut()) else { return };
        let handed = if handles.is_empty() { Ok(Vec::new()) } else { self.platform.hand(&control.channel, &handles) };
        match handed {
            Ok(values) => control.queue(frame(&values), handles),
            Err(detail) => return self.detach(Leaving::Broken(format!("the handles of a frame could not be handed to the logic: {detail}"))),
        }
        self.flush();
    }

    fn reply(&mut self, bytes: Vec<u8>) {
        self.send(|_| bytes, Vec::new());
    }

    fn refuse(&mut self, request: u32, failure: Failure) {
        self.reply(frames::refused(request, failure.reason, &failure.detail));
    }

    fn flush(&mut self) {
        let Some(control) = self.logic.as_mut().and_then(|logic| logic.control.as_mut()) else { return };
        if let Err(detail) = control.flush(&mut self.platform) {
            self.detach(Leaving::Broken(detail));
        }
    }

    fn detach(&mut self, leaving: Leaving) {
        let Some(logic) = self.logic.as_mut() else { return };
        logic.control = None;
        match leaving {
            Leaving::Broken(detail) => {
                eprintln!("execution-holder: {detail}; the logic is ended so that the next one starts on a clean channel");
                self.platform.end(&logic.process);
            }
            Leaving::Gone => {
                if let Err(detail) = self.platform.timer(Timer::Departure, DEPARTURE_PATIENCE_MS) {
                    eprintln!("execution-holder: the departure of the logic could not be bounded ({detail}); it is ended now");
                    self.platform.end(&logic.process);
                }
            }
        }
    }

    fn overstay(&mut self) {
        let Some(logic) = self.logic.as_ref().filter(|logic| logic.control.is_none()) else { return };
        eprintln!("execution-holder: the logic closed its channel and did not exit within {DEPARTURE_PATIENCE_MS} ms; it is ended");
        self.platform.end(&logic.process);
    }

    fn start(&mut self) {
        if !self.starting.is_empty() || !self.refusing.is_empty() { self.waiting_start = true; return; }
        self.waiting_start = false;
        self.vacating = false;
        if std::mem::take(&mut self.activation) {
            if let Some(prepared) = self.table.prepared.clone() {
                self.activate(&prepared);
            }
        }
        match self.platform.start_logic(&self.table.logic) {
            Ok((process, channel)) => {
                if std::mem::take(&mut self.unsealed) {
                    self.platform.seal();
                }
                let token = self.platform.token(&channel);
                self.logic = Some(Logic { process, since: self.platform.now_ms(), ready: false, control: Some(Control::new(channel, token)) });
                let capabilities = self.platform.capabilities().to_vec();
                let greeting = Greeting {
                    pid: self.platform.pid(),
                    count: self.table.len(),
                    handle_limit: self.platform.handle_limit(),
                    terminal_expense: P::TERMINAL_EXPENSE,
                    pipe_expense: P::PIPE_EXPENSE,
                    capabilities: &capabilities,
                    generation: self.table.generation,
                };
                let hello = |handed: &[u64]| frames::hello(&greeting, handed);
                let claim = self.platform.claim();
                self.send(hello, vec![claim]);
                self.hold_all();
                self.children();
            }
            Err(detail) => {
                eprintln!("execution-holder: the logic would not start: {detail}");
                if std::mem::take(&mut self.unsealed) {
                    let handles: Vec<u64> = self.table.records().flat_map(|record| record.handles()).map(|handle| P::handle_value(&handle)).collect();
                    let failure = self.platform.retreat(&handles, &format!("the logic of the activated bundle would not start: {detail}"));
                    eprintln!("execution-holder: {failure}; this holder stays");
                    self.platform.seal();
                }
                if self.table.is_empty() {
                    self.leaving = Some(1);
                } else {
                    self.pause(false);
                }
            }
        }
    }

    fn hold_all(&mut self) {
        let Some(control) = self.logic.as_mut().and_then(|logic| logic.control.as_mut()) else { return };
        let mut refused = None;
        for record in self.table.records() {
            let handles = record.handles();
            let handed = if handles.is_empty() { Ok(Vec::new()) } else { self.platform.hand(&control.channel, &handles) };
            match handed {
                Ok(values) => control.queue(frames::held(record, &values), handles),
                Err(detail) => {
                    refused = Some(detail);
                    break;
                }
            }
        }
        match refused {
            Some(detail) => self.detach(Leaving::Broken(format!("the handles of a held execution could not be handed to the logic: {detail}"))),
            None => self.flush(),
        }
    }

    fn activate(&mut self, prepared: &Prepared) -> bool {
        let differs = match self.platform.differs(&prepared.holder) {
            Ok(differs) => differs,
            Err(failure) => {
                eprintln!("execution-holder: the next bundle stays inactive: {}", failure.detail);
                return false;
            }
        };
        if let Err(failure) = self.platform.rotate() {
            eprintln!("execution-holder: the next bundle could not be activated: {}", failure.detail);
            return false;
        }
        if !differs {
            let logic = std::mem::replace(&mut self.table.logic, prepared.logic.clone());
            self.returning = self.risen.then(|| Return { logic, from: prepared.clone() });
            self.table.prepared = None;
            self.risen = false;
            return true;
        }
        self.returning = None;
        if let Some(preparing) = self.preparing.take() {
            self.table.orphans.push(preparing.process);
        }
        let (table, handles) = handover::encode(&self.table);
        let failure = self.platform.replace(&prepared.holder, &table, &handles);
        eprintln!("execution-holder: the next holder did not take over ({}); the standing bundle is restored", failure.detail);
        if let Err(failure) = self.platform.restore() {
            eprintln!("execution-holder: the standing bundle could not be restored ({}); the logic of the bundle that stands starts", failure.detail);
            self.table.logic = prepared.logic.clone();
            self.table.prepared = None;
            self.risen = false;
            return true;
        }
        self.rejected.push(prepared.clone());
        false
    }

    fn candidate(&mut self) -> Option<Prepared> {
        match self.platform.entry() {
            Ok(entry) => entry.filter(|entry| !self.rejected.contains(entry)),
            Err(failure) => {
                eprintln!("execution-holder: the entry of the next bundle cannot be read: {}", failure.detail);
                None
            }
        }
    }

    fn give_back(&mut self) -> bool {
        let Some(back) = self.returning.take() else { return false };
        if let Err(failure) = self.platform.restore() {
            eprintln!("execution-holder: the logic of the activated bundle never came up and the prior bundle could not stand again: {}", failure.detail);
            return false;
        }
        eprintln!("execution-holder: the logic of the activated bundle never came up; the prior bundle stands again");
        self.table.logic = back.logic;
        self.rejected.push(back.from);
        true
    }

    fn pause(&mut self, served: bool) {
        if served {
            self.failures = 0;
        }
        self.failures += 1;
        if self.failures == 1 {
            return self.start();
        }
        let wait = (FIRST_PAUSE_MS << (self.failures - 2).min(10)).min(LONGEST_PAUSE_MS);
        if wait == LONGEST_PAUSE_MS && !self.risen {
            if let Some(prepared) = self.candidate() {
                let kept = self.table.prepared.replace(prepared.clone());
                if self.activate(&prepared) {
                    self.failures = 0;
                    return self.start();
                }
                self.table.prepared = kept;
            }
            if self.give_back() {
                self.failures = 0;
                return self.start();
            }
        }
        if let Err(detail) = self.platform.timer(Timer::Restart, wait) {
            eprintln!("execution-holder: the restart timer could not be armed: {detail}");
            self.start();
        }
    }

    fn receive(&mut self) {
        let ended = {
            let Some(control) = self.logic.as_mut().and_then(|logic| logic.control.as_mut()) else { return };
            control.fill(&mut self.platform, &mut self.landing)
        };
        loop {
            let Some(control) = self.logic.as_mut().and_then(|logic| logic.control.as_mut()) else { return };
            match control.frame() {
                Ok(Some(body)) => self.serve(&body),
                Ok(None) => break,
                Err(detail) => return self.detach(Leaving::Broken(detail)),
            }
        }
        if let Some(control) = self.logic.as_mut().and_then(|logic| logic.control.as_mut()) {
            control.compact();
        }
        if let Some(leaving) = ended {
            self.detach(leaving);
        }
    }

    fn serve(&mut self, body: &[u8]) {
        let request = frames::request_of(body);
        let decoded = match frames::decode(body) {
            Ok(decoded) => decoded,
            Err(detail) => return self.refuse(request, Failure::new(Reason::Invalid, detail)),
        };
        match decoded {
            Request::Launch(launch) => {
                if self.table.holds(&launch.key) || self.starting.values().any(|pending| pending.record.key == launch.key) {
                    return self.refuse(request, Failure::new(Reason::Duplicate, "the holder already holds an execution under this key"));
                }
                match self.platform.launch(&launch) {
                    Err((failure, rollback)) => {
                        self.reject_launch(request, failure, rollback);
                        self.children();
                    }
                    Ok(Launching { spawned, status, token }) => {
                        self.starting.insert(token, Starting { request, record: Record::new(launch.key, spawned), status });
                        self.started(token);
                    }
                }
            }
            Request::Act { key, target, action } => self.deliver(request, &key, |platform, process| platform.act(process, target, action)),
            Request::Signal { key, target, name } => self.deliver(request, &key, |platform, process| platform.signal(process, target, &name)),
            Request::Pace { processes } => {
                let outcomes: Vec<frames::Kept> = processes
                    .iter()
                    .map(|paced| match self.platform.pace(paced.pid, &paced.birth, paced.initial, paced.next) {
                        Ok(false) => frames::Kept::Held,
                        Ok(true) => frames::Kept::Moved,
                        Err(failure) => frames::Kept::Refused(failure.reason, failure.detail),
                    })
                    .collect();
                self.reply(frames::paced(request, &outcomes));
            }
            Request::CloseInput { key } => {
                let Some(record) = self.table.get(&key) else {
                    return self.refuse(request, Failure::new(Reason::Unknown, UNKNOWN));
                };
                let (part, handles) = match &mut record.transport {
                    Transport::Pipes { stdin, piped: true, .. } => (Part::Stdin, stdin.take().into_iter().collect()),
                    Transport::Pipes { .. } => return self.refuse(request, Failure::new(Reason::Transport, "the child was given no input pipe")),
                    Transport::Terminal { handles, .. } => (Part::Terminal, std::mem::take(handles)),
                };
                self.platform.close(&mut record.process, part, handles);
                self.reply(frames::done(request));
            }
            Request::Observe { key } => {
                let Some(record) = self.table.get(&key) else {
                    return self.refuse(request, Failure::new(Reason::Unknown, UNKNOWN));
                };
                let announced = if record.exit.is_none() {
                    record.exit = self.platform.observe(&record.process);
                    record.exit.as_ref().map(|exit| frames::exited(&key, exit))
                } else { None };
                if let Some(frame) = announced { self.reply(frame); }
                self.reply(frames::done(request));
            }
            Request::CloseOutput { key, stream } => {
                let Some(record) = self.table.get(&key) else {
                    return self.refuse(request, Failure::new(Reason::Unknown, UNKNOWN));
                };
                let (part, handle) = match (&mut record.transport, stream) {
                    (Transport::Pipes { stdout, .. }, Stream::Stdout) => (Part::Stdout, stdout.take()),
                    (Transport::Pipes { stderr, .. }, Stream::Stderr) => (Part::Stderr, stderr.take()),
                    (Transport::Terminal { .. }, _) => {
                        return self.refuse(request, Failure::new(Reason::Transport, "the terminal has no separate output pipe"));
                    }
                };
                self.platform.close(&mut record.process, part, handle.into_iter().collect());
                self.reply(frames::done(request));
            }
            Request::Reap { key } => {
                let Some(record) = self.table.get(&key) else {
                    return self.refuse(request, Failure::new(Reason::Unknown, UNKNOWN));
                };
                if let (Some(exit), Some(usage)) = (&record.exit, &record.reaped) {
                    let frame = frames::reaped(request, exit, usage);
                    return self.reply(frame);
                }
                let announced = if record.exit.is_none() {
                    record.exit = self.platform.observe(&record.process);
                    record.exit.as_ref().map(|exit| frames::exited(&key, exit))
                } else {
                    None
                };
                let answer = if record.exit.is_none() {
                    frames::refused(request, Reason::Running, "the leader has not exited")
                } else {
                    match self.platform.reap(&mut record.process) {
                        Ok(Some((exit, usage))) => {
                            let frame = frames::reaped(request, &exit, &usage);
                            record.exit = Some(exit);
                            record.reaped = Some(usage);
                            frame
                        }
                        Ok(None) => frames::refused(request, Reason::Running, "the leader has not exited"),
                        Err(failure) => frames::refused(request, failure.reason, &failure.detail),
                    }
                };
                if let Some(frame) = announced {
                    self.reply(frame);
                }
                self.reply(answer);
            }
            Request::Release { key } => {
                if self.table.get(&key).is_some_and(|record| record.reaped.is_none()) {
                    return self.refuse(request, Failure::new(Reason::Running, "the leader must be reaped before the execution is released"));
                }
                if let Some(record) = self.table.remove(&key) {
                    let Record { mut process, transport, .. } = record;
                    self.platform.release(&mut process, transport);
                }
                self.reply(frames::done(request));
            }
            Request::BindGeneration { generation } => {
                if self.table.generation.is_some_and(|held| held != generation) {
                    return self.refuse(request, Failure::new(Reason::Changed, "the holder already holds another generation"));
                }
                self.table.generation = Some(generation);
                self.reply(frames::done(request));
            }
            Request::Vacate => {
                self.vacating = true;
                self.reply(frames::done(request));
            }
            Request::Ready => {
                if let Some(logic) = self.logic.as_mut() {
                    logic.ready = true;
                }
                self.risen = true;
                self.returning = None;
                self.reply(frames::done(request));
            }
            Request::Prepare(prepared) => {
                if self.preparing.is_some() {
                    return self.refuse(request, Failure::new(Reason::Running, "the holder is already preparing a change"));
                }
                self.table.prepared = None;
                if self.rejected.contains(&prepared) {
                    return self.refuse(request, Failure::new(Reason::Invalid, "the holder turned back from this bundle: its logic never came up or its holder did not take over"));
                }
                match self.platform.differs(&prepared.holder) {
                    Err(failure) => self.refuse(request, failure),
                    Ok(false) => {
                        self.table.prepared = Some(prepared);
                        self.reply(frames::done(request));
                    }
                    Ok(true) => self.verify(request, prepared),
                }
            }
            Request::Activate => {
                if self.table.prepared.is_none() {
                    return self.refuse(request, Failure::new(Reason::Invalid, "no bundle was prepared to be activated"));
                }
                self.activation = true;
                self.reply(frames::done(request));
            }
        }
    }

    fn deliver(&mut self, request: u32, key: &[u8], act: impl FnOnce(&mut P, &mut P::Process) -> Result<(), Failure>) {
        let Some(record) = self.table.get(key) else {
            return self.refuse(request, Failure::new(Reason::Unknown, UNKNOWN));
        };
        if record.reaped.is_some() {
            return self.refuse(request, Failure::new(Reason::Reaped, "the leader was reaped; its pid and work may name another process"));
        }
        match act(&mut self.platform, &mut record.process) {
            Ok(()) => self.reply(frames::done(request)),
            Err(failure) => self.refuse(request, failure),
        }
    }

    fn launched(&mut self, request: u32, mut record: Record<P>) {
        record.exit = self.platform.observe(&record.process);
        let handles = record.handles();
        self.send(|handed| frames::launched(request, &record, handed), handles);
        self.table.insert(record);
    }

    fn started(&mut self, token: P::Token) {
        let Some(mut pending) = self.starting.remove(&token) else { return };
        let settled = match self.platform.settle(&mut pending.status) {
            None => {
                self.starting.insert(token, pending);
                return;
            }
            Some(settled) => settled,
        };
        let Starting { request, record, status } = pending;
        drop(status);
        match settled {
            Ok(()) => self.launched(request, record),
            Err(failure) => {
                let Record { mut process, transport, .. } = record;
                self.platform.abandon(&mut process);
                self.platform.release(&mut process, transport);
                self.reject_launch(request, failure, Some(process));
            }
        }
        if self.waiting_start && self.logic.is_none() && self.starting.is_empty() && self.refusing.is_empty() { self.start(); }
    }

    fn end_held(&mut self) {
        let keys: Vec<Vec<u8>> = self.table.records().map(|record| record.key.clone()).collect();
        for key in keys {
            let Some(Record { mut process, transport, reaped, .. }) = self.table.remove(&key) else { continue };
            if reaped.is_some() {
                self.platform.release(&mut process, transport);
                continue;
            }
            for target in [Target::Work, Target::Leader] {
                if let Err(failure) = self.platform.act(&mut process, target, Action::Kill) {
                    if !matches!(failure.reason, Reason::Gone) {
                        eprintln!("execution-holder: a held execution left behind by a vacating logic would not take its kill: {}", failure.detail);
                    }
                }
            }
            self.platform.release(&mut process, transport);
            self.collect(process);
        }
    }

    fn reject_launch(&mut self, request: u32, failure: Failure, rollback: Option<P::Process>) {
        if let Some(process) = rollback {
            let value = P::process_value(&process);
            if !self.collect(process) {
                self.refusing.insert(value, Refusal { request, failure });
                return;
            }
        }
        self.refuse(request, failure);
    }

    fn collect(&mut self, mut process: P::Process) -> bool {
        match self.platform.reap(&mut process) {
            Ok(Some(_)) => true,
            pending => {
                if let Err(failure) = pending { eprintln!("execution-holder: a discarded child could not be reaped: {}", failure.detail); }
                self.table.orphans.push(process);
                false
            }
        }
    }

    fn verify(&mut self, request: u32, prepared: Prepared) {
        let (table, handles) = handover::encode(&self.table);
        let process = match self.platform.prepare(&prepared.holder, &table, &handles) {
            Ok(process) => process,
            Err(failure) => return self.refuse(request, failure),
        };
        if let Err(detail) = self.platform.timer(Timer::Preparation, PREPARATION_PATIENCE_MS) {
            self.platform.end(&process);
            self.collect(process);
            return self.refuse(request, Failure::new(Reason::Os, format!("the preparation could not be bounded: {detail}")));
        }
        self.preparing = Some(Preparing { request, prepared, process });
    }

    fn expire(&mut self) {
        let Some(preparing) = self.preparing.take() else { return };
        self.platform.end(&preparing.process);
        self.collect(preparing.process);
        let detail = format!("the next holder did not answer within {PREPARATION_PATIENCE_MS} ms");
        self.refuse(preparing.request, Failure::new(Reason::Timeout, detail));
    }

    fn verdict(&mut self) {
        let Some(mut preparing) = self.preparing.take() else { return };
        match self.platform.reap(&mut preparing.process) {
            Ok(None) => self.preparing = Some(preparing),
            Ok(Some((Exit::Code(0), _))) => {
                self.table.prepared = Some(preparing.prepared);
                self.reply(frames::done(preparing.request));
            }
            Ok(Some((exit, _))) => {
                let ended = match exit {
                    Exit::Code(code) => format!("exit {code}"),
                    Exit::Signal(name) => name,
                };
                self.refuse(preparing.request, Failure::new(Reason::Invalid, format!("the next holder refused this holder's table: {ended}")));
            }
            Err(failure) => self.refuse(preparing.request, failure),
        }
    }

    fn children(&mut self) {
        let owned: HashSet<u64> = self
            .table
            .records()
            .filter(|record| record.reaped.is_none())
            .map(|record| P::process_value(&record.process))
            .chain(self.table.orphans.iter().map(P::process_value))
            .chain(self.starting.values().map(|starting| P::process_value(&starting.record.process)))
            .chain(self.logic.iter().map(|logic| P::process_value(&logic.process)))
            .chain(self.preparing.iter().map(|preparing| P::process_value(&preparing.process)))
            .collect();
        if let Err(detail) = self.platform.sweep(&owned) {
            eprintln!("execution-holder: descendants this holder inherited could not be reaped: {detail}");
        }
        self.verdict();
        for mut process in std::mem::take(&mut self.table.orphans) {
            match self.platform.reap(&mut process) {
                Ok(Some(_)) => {
                    let value = P::process_value(&process);
                    drop(process);
                    if let Some(Refusal { request, failure }) = self.refusing.remove(&value) { self.refuse(request, failure); }
                }
                pending => {
                    if let Err(failure) = pending { eprintln!("execution-holder: a discarded child could not be reaped: {}", failure.detail); }
                    self.table.orphans.push(process);
                }
            }
        }
        let mut announced = Vec::new();
        for record in self.table.records_mut().filter(|record| record.exit.is_none()) {
            if let Some(exit) = self.platform.observe(&record.process) {
                announced.push(frames::exited(&record.key, &exit));
                record.exit = Some(exit);
            }
        }
        for frame in announced {
            self.reply(frame);
        }
        let Some(logic) = self.logic.as_mut() else {
            if self.leaving.is_none() && self.waiting_start && self.starting.is_empty() && self.refusing.is_empty() { self.start(); }
            return;
        };
        let ready = logic.ready;
        let lived = self.platform.now_ms().saturating_sub(logic.since);
        let code = match self.platform.reap(&mut logic.process) {
            Ok(None) => return,
            Ok(Some((Exit::Code(code), _))) => code,
            Ok(Some((Exit::Signal(name), _))) => {
                eprintln!("execution-holder: the logic was ended by {name}");
                1
            }
            Err(_) => 1,
        };
        self.logic = None;
        if self.vacating && self.starting.is_empty() {
            self.end_held();
            self.leaving = Some(0);
            return;
        }
        if self.table.is_empty() && self.starting.is_empty() && !ready {
            self.leaving = Some(if self.vacating { 0 } else { code.max(1) });
            return;
        }
        if code == ACTIVATE_EXIT && !self.activation {
            if let Some(prepared) = self.candidate() {
                self.table.prepared = Some(prepared);
                self.activation = true;
            }
        }
        if self.activation {
            self.failures = 0;
            return self.start();
        }
        self.pause(ready || lived >= STEADY_MS);
    }

    fn done(&self) -> Option<i32> {
        self.leaving.filter(|_| {
            self.logic.is_none() && self.table.is_empty() && self.starting.is_empty() && self.refusing.is_empty() && self.table.orphans.is_empty() && self.preparing.is_none()
        })
    }

    fn handle(&mut self, event: Event<P::Token>) {
        let control = self.logic.as_ref().and_then(|logic| logic.control.as_ref()).map(|control| control.token);
        match event {
            Event::Readable(token) if Some(token) == control => self.receive(),
            Event::Readable(token) | Event::Writable(token) if self.starting.contains_key(&token) => self.started(token),
            Event::Writable(token) if Some(token) == control => self.flush(),
            Event::Child => self.children(),
            Event::Timer(Timer::Restart) if self.logic.is_none() => self.start(),
            Event::Timer(Timer::Preparation) => self.expire(),
            Event::Timer(Timer::Departure) => self.overstay(),
            _ => {}
        }
    }
}

fn inspect<P: Platform>(table: &[u8]) -> i32 {
    match handover::decode(table).and_then(|carried| carried.adopt::<P>()) {
        Ok(_) => 0,
        Err(detail) => {
            eprintln!("execution-holder: the table of the standing holder cannot be taken over: {detail}");
            TABLE_REFUSED
        }
    }
}

pub fn run<P: Platform>() -> Result<i32, String> {
    let (mut platform, logic, carried) = match P::open()? {
        Opened::Entered(code) => return Ok(code),
        Opened::Verifying(table) => return Ok(inspect::<P>(&table)),
        Opened::Held(state) => {
            eprintln!("execution-holder: another process holds the writer claim of {state}");
            return Ok(CLAIM_HELD);
        }
        Opened::Claimed { platform, logic, carried } => (platform, logic, carried),
    };
    let (table, unsealed, rejected) = match carried {
        None => (Table::new(logic), false, Vec::new()),
        Some(inheritance) => {
            let mut handles = Vec::new();
            let adopted = handover::decode(&inheritance.table).and_then(|carried| {
                handles = carried.handles();
                carried.adopt::<P>()
            });
            match adopted {
                Ok(mut table) => {
                    let prepared = table.prepared.take();
                    if !inheritance.activated {
                        platform.seal();
                        let returned = platform.entry().ok().flatten();
                        (table, false, prepared.into_iter().chain(returned).collect())
                    } else {
                        if let Some(prepared) = prepared {
                            table.logic = prepared.logic;
                        }
                        (table, true, Vec::new())
                    }
                }
                Err(detail) => return Err(platform.retreat(&handles, &format!("the carried table could not be taken over: {detail}"))),
            }
        }
    };
    let mut holder = Holder {
        platform,
        starting: HashMap::new(),
        refusing: HashMap::new(),
        waiting_start: false,
        table,
        logic: None,
        vacating: false,
        leaving: None,
        failures: 0,
        landing: vec![0u8; RECEIVE_BYTES],
        preparing: None,
        activation: false,
        risen: false,
        returning: None,
        unsealed,
        rejected,
    };
    holder.children();
    holder.start();
    let mut events = Vec::new();
    loop {
        if let Some(code) = holder.done() {
            holder.platform.flush_output();
            return Ok(code);
        }
        events.clear();
        holder.platform.wait(&mut events)?;
        for event in events.drain(..) {
            holder.handle(event);
        }
    }
}
