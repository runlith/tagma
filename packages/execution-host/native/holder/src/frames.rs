use crate::platform::Platform;
use crate::table::{Exit, Input, Pace, Prepared, Record, Transport, Usage};

pub const MAX_FRAME: usize = 4 << 20;

const LAUNCH: u8 = 1;
const ACT: u8 = 2;
const SIGNAL: u8 = 8;
const CLOSE_INPUT: u8 = 3;
const REAP: u8 = 4;
const RELEASE: u8 = 5;
const VACATE: u8 = 6;
const READY: u8 = 7;
const OBSERVE: u8 = 9;
const CLOSE_OUTPUT: u8 = 10;
const PACE: u8 = 11;
const BIND_GENERATION: u8 = 12;
const PREPARE: u8 = 13;
const ACTIVATE: u8 = 14;

const HELLO: u8 = 128;
const HELD: u8 = 129;
const LAUNCHED: u8 = 130;
const DONE: u8 = 131;
const REAPED: u8 = 132;
const REFUSED: u8 = 133;
const EXITED: u8 = 134;
const PACED: u8 = 135;

#[derive(Clone, Copy)]
pub enum Reason {
    Duplicate = 1,
    Unknown = 2,
    Reaped = 3,
    Running = 4,
    Transport = 5,
    Os = 6,
    Invalid = 7,
    Unsupported = 8,
    Capacity = 9,
    Gone = 10,
    Changed = 11,
    NotFound = 12,
    Denied = 13,
    Timeout = 14,
}

pub enum Stdin {
    Ignore,
    Inherit,
    Pipe,
}

pub enum Shape {
    Terminal { rows: u16, cols: u16 },
    Pipes { stdin: Stdin },
}

pub struct Launch {
    pub key: Vec<u8>,
    pub path: String,
    pub argv: Vec<String>,
    pub env: Vec<String>,
    pub cwd: Option<String>,
    pub shape: Shape,
    pub pace: Pace,
}

#[derive(Clone, Copy)]
pub enum Target {
    Leader,
    Work,
}

#[derive(Clone, Copy)]
pub enum Action {
    HangUp,
    Interrupt,
    Terminate,
    Kill,
}

pub enum Stream {
    Stdout,
    Stderr,
}

pub struct Paced {
    pub pid: u32,
    pub birth: String,
    pub initial: Pace,
    pub next: Pace,
}

pub enum Request {
    Launch(Launch),
    Act { key: Vec<u8>, target: Target, action: Action },
    Signal { key: Vec<u8>, target: Target, name: String },
    Pace { processes: Vec<Paced> },
    CloseInput { key: Vec<u8> },
    Reap { key: Vec<u8> },
    Observe { key: Vec<u8> },
    CloseOutput { key: Vec<u8>, stream: Stream },
    Release { key: Vec<u8> },
    Vacate,
    Ready,
    BindGeneration { generation: u64 },
    Prepare(Prepared),
    Activate,
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, count: usize) -> Result<&'a [u8], String> {
        let end = self.at.checked_add(count).filter(|end| *end <= self.bytes.len()).ok_or("the frame ends inside a field")?;
        let slice = &self.bytes[self.at..end];
        self.at = end;
        Ok(slice)
    }

    fn byte(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }

    fn half(&mut self) -> Result<u16, String> {
        let bytes = self.take(2)?;
        Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
    }

    fn word(&mut self) -> Result<u32, String> {
        let bytes = self.take(4)?;
        Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }

    fn long(&mut self) -> Result<u64, String> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().map_err(|_| "the integer does not occupy eight bytes")?))
    }

    fn pace(&mut self) -> Result<Pace, String> {
        match self.byte()? {
            0 => Ok(Pace::Full),
            1 => Ok(Pace::Low),
            2 => Ok(Pace::Lowest),
            other => Err(format!("pace {other} is not a pace")),
        }
    }

    fn target(&mut self) -> Result<Target, String> {
        match self.byte()? {
            1 => Ok(Target::Leader),
            2 => Ok(Target::Work),
            other => Err(format!("target {other} is neither leader nor work")),
        }
    }

    fn bytes(&mut self) -> Result<Vec<u8>, String> {
        let length = self.word()? as usize;
        Ok(self.take(length)?.to_vec())
    }

    fn text(&mut self) -> Result<String, String> {
        String::from_utf8(self.bytes()?).map_err(|_| "a string is not UTF-8".to_string())
    }

    fn part(&mut self) -> Result<String, String> {
        let path = self.text()?;
        if path.contains('\0') || path.split('/').any(|step| step.is_empty() || step == "." || step == "..") {
            return Err(format!("{path} does not name a part inside a bundle"));
        }
        Ok(path)
    }

    fn texts(&mut self) -> Result<Vec<String>, String> {
        let count = self.word()? as usize;
        if count > self.bytes.len() {
            return Err("a list claims more entries than the frame holds".into());
        }
        (0..count).map(|_| self.text()).collect()
    }

    fn end(&self) -> Result<(), String> {
        if self.at == self.bytes.len() { Ok(()) } else { Err("the frame carries bytes past its fields".into()) }
    }
}

pub fn request_of(body: &[u8]) -> u32 {
    if body.len() < 5 { 0 } else { u32::from_le_bytes([body[1], body[2], body[3], body[4]]) }
}

pub fn decode(body: &[u8]) -> Result<Request, String> {
    let mut reader = Reader { bytes: body, at: 0 };
    let op = reader.byte()?;
    reader.word()?;
    let request = match op {
        LAUNCH => {
            let key = reader.bytes()?;
            let path = reader.text()?;
            let argv = reader.texts()?;
            let env = reader.texts()?;
            let cwd = match reader.byte()? {
                0 => None,
                1 => Some(reader.text()?),
                other => return Err(format!("cwd marker {other} is neither 0 nor 1")),
            };
            let shape = match reader.byte()? {
                1 => Shape::Terminal { rows: reader.half()?, cols: reader.half()? },
                2 => Shape::Pipes {
                    stdin: match reader.byte()? {
                        0 => Stdin::Ignore,
                        1 => Stdin::Inherit,
                        2 => Stdin::Pipe,
                        other => return Err(format!("stdin {other} is not a policy")),
                    },
                },
                other => return Err(format!("transport {other} is not a transport")),
            };
            let pace = reader.pace()?;
            Request::Launch(Launch { key, path, argv, env, cwd, shape, pace })
        }
        ACT => {
            let key = reader.bytes()?;
            let target = reader.target()?;
            let action = match reader.byte()? {
                0 => Action::HangUp,
                1 => Action::Interrupt,
                2 => Action::Terminate,
                3 => Action::Kill,
                other => return Err(format!("stop step {other} is not an action")),
            };
            Request::Act { key, target, action }
        }
        SIGNAL => Request::Signal { key: reader.bytes()?, target: reader.target()?, name: reader.text()? },
        PACE => {
            let count = reader.word()? as usize;
            if count > body.len() {
                return Err("a pace list claims more processes than the frame holds".into());
            }
            let mut processes = Vec::with_capacity(count);
            for _ in 0..count {
                processes.push(Paced { pid: reader.word()?, birth: reader.text()?, initial: reader.pace()?, next: reader.pace()? });
            }
            Request::Pace { processes }
        }
        CLOSE_INPUT => Request::CloseInput { key: reader.bytes()? },
        REAP => Request::Reap { key: reader.bytes()? },
        OBSERVE => Request::Observe { key: reader.bytes()? },
        CLOSE_OUTPUT => {
            let key = reader.bytes()?;
            let stream = match reader.byte()? {
                1 => Stream::Stdout,
                2 => Stream::Stderr,
                other => return Err(format!("output {other} is neither stdout nor stderr")),
            };
            Request::CloseOutput { key, stream }
        },
        RELEASE => Request::Release { key: reader.bytes()? },
        VACATE => Request::Vacate,
        READY => Request::Ready,
        BIND_GENERATION => {
            let generation = reader.long()?;
            if generation > 9_007_199_254_740_991 { return Err("the generation exceeds the wire integer".into()); }
            Request::BindGeneration { generation }
        },
        PREPARE => {
            let holder = reader.part()?;
            let logic = reader.texts()?;
            if logic.is_empty() {
                return Err("a preparation names no logic program".into());
            }
            Request::Prepare(Prepared { holder, logic })
        }
        ACTIVATE => Request::Activate,
        other => return Err(format!("operation {other} is not one the holder serves")),
    };
    reader.end()?;
    Ok(request)
}

struct Frame {
    bytes: Vec<u8>,
}

impl Frame {
    fn new(op: u8, request: u32) -> Self {
        let mut bytes = vec![0u8; 4];
        bytes.push(op);
        bytes.extend_from_slice(&request.to_le_bytes());
        Self { bytes }
    }

    fn byte(&mut self, value: u8) -> &mut Self {
        self.bytes.push(value);
        self
    }

    fn word(&mut self, value: u32) -> &mut Self {
        self.bytes.extend_from_slice(&value.to_le_bytes());
        self
    }

    fn long(&mut self, value: u64) -> &mut Self {
        self.bytes.extend_from_slice(&value.to_le_bytes());
        self
    }

    fn data(&mut self, value: &[u8]) -> &mut Self {
        self.word(value.len() as u32);
        self.bytes.extend_from_slice(value);
        self
    }

    fn texts(&mut self, values: &[&str]) -> &mut Self {
        self.word(values.len() as u32);
        for value in values {
            self.data(value.as_bytes());
        }
        self
    }

    fn handed(&mut self, values: &[u64]) -> &mut Self {
        self.word(values.len() as u32);
        for value in values {
            self.long(*value);
        }
        self
    }

    fn exit(&mut self, exit: Option<&Exit>) -> &mut Self {
        match exit {
            None => self.byte(0),
            Some(Exit::Code(code)) => self.byte(1).word(*code as u32),
            Some(Exit::Signal(name)) => self.byte(2).data(name.as_bytes()),
        }
    }

    fn usage(&mut self, usage: &Usage) -> &mut Self {
        self.long(usage.user_micros).long(usage.system_micros).long(usage.peak_rss_bytes)
    }

    fn record<P: Platform>(&mut self, record: &Record<P>) -> &mut Self {
        self.data(&record.key).word(record.pid).word(record.work);
        match &record.transport {
            Transport::Terminal { name: Some(name), .. } => self.data(name),
            Transport::Terminal { name: None, .. } | Transport::Pipes { .. } => self.data(&[]),
        };
        self.data(record.birth.as_bytes());
        self.byte(match record.transport {
            Transport::Terminal { .. } => 1,
            Transport::Pipes { .. } => 2,
        });
        self.byte(record.pace as u8);
        self.byte(match record.input() {
            Input::Absent => 0,
            Input::Open => 1,
            Input::Closed => 2,
        });
        self.exit(record.exit.as_ref());
        match &record.reaped {
            None => self.byte(0),
            Some(usage) => self.byte(1).usage(usage),
        };
        self.byte(record.handle_mask())
    }

    fn finish(mut self) -> Vec<u8> {
        let length = (self.bytes.len() - 4) as u32;
        self.bytes[..4].copy_from_slice(&length.to_le_bytes());
        self.bytes
    }
}

pub struct Greeting<'a> {
    pub pid: u32,
    pub count: usize,
    pub handle_limit: Option<u64>,
    pub terminal_expense: u8,
    pub pipe_expense: u8,
    pub capabilities: &'a [&'static str],
    pub generation: Option<u64>,
}

pub fn hello(greeting: &Greeting, handed: &[u64]) -> Vec<u8> {
    let mut frame = Frame::new(HELLO, 0);
    frame.word(greeting.pid).word(greeting.count as u32);
    match greeting.handle_limit {
        None => frame.byte(0),
        Some(limit) => frame.byte(1).long(limit),
    };
    frame.byte(greeting.terminal_expense).byte(greeting.pipe_expense).texts(greeting.capabilities).handed(handed);
    match greeting.generation {
        None => frame.byte(0),
        Some(generation) => frame.byte(1).long(generation),
    };
    frame.finish()
}

pub fn held<P: Platform>(record: &Record<P>, handed: &[u64]) -> Vec<u8> {
    let mut frame = Frame::new(HELD, 0);
    frame.record(record).handed(handed);
    frame.finish()
}

pub fn launched<P: Platform>(request: u32, record: &Record<P>, handed: &[u64]) -> Vec<u8> {
    let mut frame = Frame::new(LAUNCHED, request);
    frame.record(record).handed(handed);
    frame.finish()
}

pub fn done(request: u32) -> Vec<u8> {
    Frame::new(DONE, request).finish()
}

pub fn reaped(request: u32, exit: &Exit, usage: &Usage) -> Vec<u8> {
    let mut frame = Frame::new(REAPED, request);
    frame.exit(Some(exit)).usage(usage);
    frame.finish()
}

pub fn refused(request: u32, reason: Reason, detail: &str) -> Vec<u8> {
    let mut frame = Frame::new(REFUSED, request);
    frame.byte(reason as u8).data(detail.as_bytes());
    frame.finish()
}

pub enum Kept {
    Held,
    Moved,
    Refused(Reason, String),
}

pub fn paced(request: u32, outcomes: &[Kept]) -> Vec<u8> {
    let mut frame = Frame::new(PACED, request);
    let fixed: usize = outcomes.iter().map(|outcome| if let Kept::Refused(..) = outcome { 6 } else { 1 }).sum();
    let mut room = MAX_FRAME.saturating_sub(frame.bytes.len() - 4 + 4 + fixed);
    frame.word(outcomes.len() as u32);
    for outcome in outcomes {
        match outcome {
            Kept::Held => frame.byte(0),
            Kept::Moved => frame.byte(1),
            Kept::Refused(reason, detail) => {
                let mut kept = detail.len().min(room);
                while !detail.is_char_boundary(kept) {
                    kept -= 1;
                }
                room -= kept;
                frame.byte(2).byte(*reason as u8).data(&detail.as_bytes()[..kept])
            }
        };
    }
    frame.finish()
}

pub fn exited(key: &[u8], exit: &Exit) -> Vec<u8> {
    let mut frame = Frame::new(EXITED, 0);
    frame.data(key).exit(Some(exit));
    frame.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pace_answer_fits_one_frame_and_keeps_every_outcome() {
        let count = (MAX_FRAME - 9) / 10;
        let outcomes: Vec<Kept> = (0..count).map(|_| Kept::Refused(Reason::Gone, "é".repeat(64))).collect();
        let bytes = paced(7, &outcomes);
        assert!(bytes.len() - 4 <= MAX_FRAME);
        assert_eq!(u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize, bytes.len() - 4);
        let mut reader = Reader { bytes: &bytes[4..], at: 0 };
        assert_eq!(reader.byte().unwrap(), PACED);
        assert_eq!(reader.word().unwrap(), 7);
        assert_eq!(reader.word().unwrap() as usize, count);
        for _ in 0..count {
            assert_eq!(reader.byte().unwrap(), 2);
            assert_eq!(reader.byte().unwrap(), Reason::Gone as u8);
            assert!(reader.text().is_ok());
        }
        reader.end().unwrap();
    }
}
