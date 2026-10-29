use crate::frames::{self, Action, Launch, Reason, Target};
use crate::handover;
use crate::holder;
use crate::platform::{Event, Failure, Inheritance, Io, Launching, Opened, Part, Platform, Spawned, Timer};
use crate::table::{Exit, Pace, Prepared, Record, Table, Transport, Usage};
use std::cell::RefCell;
use std::collections::VecDeque;
use std::rc::Rc;

#[derive(Default)]
struct State {
    now: u64,
    standing: String,
    next: Option<String>,
    prior: Option<String>,
    starts: Vec<(u64, Vec<String>)>,
    replies: Vec<Vec<u8>>,
    input: VecDeque<u8>,
    events: VecDeque<Event<u32>>,
    timers: VecDeque<(Timer, u64)>,
    proven: u32,
    alive: bool,
    exited: bool,
    returned: bool,
}

thread_local! {
    static STATE: RefCell<Rc<RefCell<State>>> = RefCell::new(Rc::new(RefCell::new(State::default())));
}

struct Memory(Rc<RefCell<State>>);

fn prepared(logic: &str) -> Prepared {
    Prepared { holder: "native/holder".into(), logic: vec![logic.into()] }
}

fn request(kind: u8, serial: u32) -> Vec<u8> {
    let mut bytes = vec![kind];
    bytes.extend(serial.to_le_bytes());
    bytes
}

fn text(bytes: &mut Vec<u8>, value: &str) {
    bytes.extend((value.len() as u32).to_le_bytes());
    bytes.extend(value.as_bytes());
}

fn prepare(serial: u32, logic: &str) -> Vec<u8> {
    let mut bytes = request(13, serial);
    text(&mut bytes, "native/holder");
    bytes.extend(1u32.to_le_bytes());
    text(&mut bytes, logic);
    bytes
}

fn input(state: &mut State, requests: Vec<Vec<u8>>) {
    for body in requests {
        state.input.extend((body.len() as u32).to_le_bytes());
        state.input.extend(body);
    }
    state.events.push_back(Event::Readable(1));
}

fn refusal(replies: &[Vec<u8>], serial: u32) -> Option<u8> {
    replies.iter().find(|frame| frame[4] == 133 && frames::request_of(&frame[4..]) == serial).map(|frame| frame[9])
}

fn usage() -> Usage {
    Usage { user_micros: 0, system_micros: 0, peak_rss_bytes: 0 }
}

fn child() -> Record<Memory> {
    Record::new(b"child".to_vec(), Spawned {
        process: 2,
        pid: 42,
        work: 42,
        birth: "birth".into(),
        pace: Pace::Full,
        transport: Transport::Pipes { stdout: None, stderr: None, stdin: None, piped: false },
    })
}

impl Platform for Memory {
    type Handle = u64;
    type Channel = u32;
    type Process = u32;
    type Status = ();
    type Token = u32;
    const TERMINAL_EXPENSE: u8 = 1;
    const PIPE_EXPENSE: u8 = 3;

    fn open() -> Result<Opened<Self>, String> {
        let state = STATE.with(|slot| slot.borrow().clone());
        let mut table = Table::new(vec!["proven".into()]);
        table.insert(child());
        let returned = state.borrow().returned;
        if returned { table.prepared = Some(prepared("broken")); }
        let (table, _) = handover::encode(&table);
        Ok(Opened::Claimed { platform: Self(state), logic: Vec::new(), carried: Some(Inheritance { table, activated: !returned }) })
    }
    fn pid(&self) -> u32 { 1 }
    fn claim(&self) -> Rc<u64> { Rc::new(7) }
    fn handle_limit(&self) -> Option<u64> { None }
    fn capabilities(&self) -> &[&'static str] { &[] }
    fn start_logic(&mut self, argv: &[String]) -> Result<(u32, u32), String> {
        let mut state = self.0.borrow_mut();
        let now = state.now;
        state.exited = false;
        state.starts.push((now, argv.to_vec()));
        assert!(state.alive, "the held child must survive every logic restart");
        match argv[0].as_str() {
            "proven" => {
                state.proven += 1;
                if !state.returned && state.proven == 1 {
                    input(&mut state, vec![request(7, 1), prepare(2, "broken"), request(14, 3)]);
                } else if !state.returned && state.proven == 2 {
                    input(&mut state, vec![prepare(4, "broken")]);
                } else if state.returned && state.proven == 1 {
                    input(&mut state, vec![prepare(8, "broken"), request(14, 9)]);
                } else if now >= 23_750 && state.next.as_deref() == Some("broken") {
                    state.next = Some("fixed".into());
                    input(&mut state, vec![prepare(5, "stale")]);
                }
            }
            "broken" => {}
            "fixed" => input(&mut state, vec![request(6, 6)]),
            other => panic!("the holder started {other} instead of the current bundle entry"),
        }
        state.events.push_back(Event::Child);
        Ok((1, 1))
    }
    fn end(&mut self, _: &u32) { panic!("no logic outlives its channel") }
    fn token(&self, channel: &u32) -> u32 { *channel }
    fn hand(&mut self, _: &u32, handles: &[Rc<u64>]) -> Result<Vec<u64>, String> {
        Ok(handles.iter().map(|handle| **handle).collect())
    }
    fn send(&mut self, _: &u32, bytes: &[u8], _: &[Rc<u64>]) -> Io {
        self.0.borrow_mut().replies.push(bytes.to_vec());
        Io::Done(bytes.len())
    }
    fn watch_write(&mut self, _: &u32, _: bool) -> Result<(), String> { panic!("the memory channel has room") }
    fn receive(&mut self, _: &u32, into: &mut [u8]) -> Io {
        let mut state = self.0.borrow_mut();
        let count = into.len().min(state.input.len());
        if count == 0 { return Io::Blocked; }
        for byte in &mut into[..count] { *byte = state.input.pop_front().unwrap(); }
        Io::Done(count)
    }
    fn wait(&mut self, events: &mut Vec<Event<u32>>) -> Result<(), String> {
        let mut state = self.0.borrow_mut();
        if let Some(event) = state.events.pop_front() {
            if matches!(event, Event::Child) { state.exited = true; }
            events.push(event);
        } else {
            let (timer, ms) = state.timers.pop_front().expect("the holder must arrange its next event");
            state.now += ms;
            assert!(state.now < 50_000, "the fresh bundle must recover the holder");
            events.push(Event::Timer(timer));
        }
        Ok(())
    }
    fn timer(&mut self, timer: Timer, ms: u64) -> Result<(), String> {
        self.0.borrow_mut().timers.push_back((timer, ms));
        Ok(())
    }
    fn now_ms(&self) -> u64 { self.0.borrow().now }
    fn launch(&mut self, _: &Launch) -> Result<Launching<Self>, (Failure, Option<u32>)> { panic!("the child is inherited") }
    fn settle(&mut self, _: &mut ()) -> Option<Result<(), Failure>> { panic!("the child has started") }
    fn observe(&mut self, process: &u32) -> Option<Exit> {
        assert_eq!(*process, 2);
        None
    }
    fn reap(&mut self, process: &mut u32) -> Result<Option<(Exit, Usage)>, Failure> {
        if *process == 2 {
            return Ok((!self.0.borrow().alive).then(|| (Exit::Code(0), usage())));
        }
        let state = self.0.borrow();
        if !state.exited { return Ok(None); }
        let code = if state.standing == "fixed" { 0 } else { 1 };
        Ok(Some((Exit::Code(code), usage())))
    }
    fn close(&mut self, _: &mut u32, _: Part, _: Vec<Rc<u64>>) { panic!("the input stays held") }
    fn release(&mut self, _: &mut u32, _: Transport<u64>) {}
    fn act(&mut self, process: &mut u32, _: Target, action: Action) -> Result<(), Failure> {
        assert_eq!(*process, 2);
        assert!(matches!(action, Action::Kill));
        self.0.borrow_mut().alive = false;
        Ok(())
    }
    fn signal(&mut self, _: &mut u32, _: Target, _: &str) -> Result<(), Failure> { panic!("no named signal is sent") }
    fn abandon(&mut self, _: &mut u32) { panic!("no launch is abandoned") }
    fn pace(&mut self, _: u32, _: &str, _: Pace, _: Pace) -> Result<bool, Failure> { panic!("the child keeps its pace") }
    fn handle_value(handle: &u64) -> u64 { *handle }
    fn process_value(process: &u32) -> u64 { u64::from(*process) }
    fn keep_handle(_: u64) -> Result<(), String> { Ok(()) }
    fn own_handle(value: u64) -> u64 { value }
    fn adopt_process(value: u64) -> Result<u32, String> { Ok(value as u32) }
    fn seal(&mut self) {}
    fn retreat(&mut self, _: &[u64], _: &str) -> String { panic!("the same image needs no exec") }
    fn entry(&mut self) -> Result<Option<Prepared>, Failure> { Ok(self.0.borrow().next.as_deref().map(prepared)) }
    fn differs(&mut self, _: &str) -> Result<bool, Failure> { Ok(false) }
    fn prepare(&mut self, _: &str, _: &[u8], _: &[Rc<u64>]) -> Result<u32, Failure> { panic!("the holder image is unchanged") }
    fn rotate(&mut self) -> Result<(), Failure> {
        let mut state = self.0.borrow_mut();
        let next = state.next.take().expect("an activated candidate must exist");
        state.prior = Some(std::mem::replace(&mut state.standing, next));
        Ok(())
    }
    fn restore(&mut self) -> Result<(), Failure> {
        let mut state = self.0.borrow_mut();
        let prior = state.prior.take().expect("only a proven prior bundle can return");
        state.next = Some(std::mem::replace(&mut state.standing, prior));
        Ok(())
    }
    fn replace(&mut self, _: &str, _: &[u8], _: &[Rc<u64>]) -> Failure { panic!("the holder image is unchanged") }
}

#[test]
fn returned_bundle_is_not_reactivated_and_a_fresh_entry_overrides_a_stale_preparation() {
    let state = Rc::new(RefCell::new(State {
        standing: "proven".into(), next: Some("broken".into()), alive: true, ..State::default()
    }));
    STATE.with(|slot| *slot.borrow_mut() = state.clone());
    assert_eq!(holder::run::<Memory>().unwrap(), 0);
    let state = state.borrow();
    assert_eq!(state.standing, "fixed");
    assert_eq!(state.prior.as_deref(), Some("proven"));
    assert_eq!(refusal(&state.replies, 4), Some(Reason::Invalid as u8));
    assert!(state.replies.contains(&frames::done(5)));
    let starts: Vec<_> = state.starts.iter().map(|(at, argv)| (*at, argv[0].as_str())).collect();
    assert_eq!(&starts[..9], &[(0, "proven"), (0, "broken"), (0, "broken"), (250, "broken"), (750, "broken"), (1_750, "broken"), (3_750, "broken"), (7_750, "broken"), (7_750, "proven")]);
    assert_eq!(&starts[9..], &[(7_750, "proven"), (8_000, "proven"), (8_500, "proven"), (9_500, "proven"), (11_500, "proven"), (15_500, "proven"), (23_500, "proven"), (31_500, "proven"), (31_500, "fixed")]);
    let held = frames::held(&child(), &[]);
    assert_eq!(state.replies.iter().filter(|frame| **frame == held).count(), starts.len());
}

#[test]
fn returned_holder_refuses_to_prepare_or_retake_its_failed_successor() {
    let state = Rc::new(RefCell::new(State {
        standing: "proven".into(), next: Some("broken".into()), alive: true, returned: true, ..State::default()
    }));
    STATE.with(|slot| *slot.borrow_mut() = state.clone());
    assert_eq!(holder::run::<Memory>().unwrap(), 0);
    let state = state.borrow();
    assert_eq!(state.standing, "fixed");
    assert_eq!(state.prior.as_deref(), Some("proven"));
    assert_eq!(refusal(&state.replies, 8), Some(Reason::Invalid as u8));
    assert_eq!(refusal(&state.replies, 9), Some(Reason::Invalid as u8));
    let starts: Vec<_> = state.starts.iter().map(|(at, argv)| (*at, argv[0].as_str())).collect();
    assert_eq!(starts, [(0, "proven"), (0, "proven"), (250, "proven"), (750, "proven"), (1_750, "proven"), (3_750, "proven"), (7_750, "proven"), (15_750, "proven"), (23_750, "proven"), (23_750, "fixed")]);
    assert!(state.replies.contains(&frames::done(5)));
    let held = frames::held(&child(), &[]);
    assert_eq!(state.replies.iter().filter(|frame| **frame == held).count(), starts.len());
}
