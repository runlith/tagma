use crate::platform::Platform;
use crate::table::{Exit, Pace, Prepared, Record, Table, Transport, Usage};
use std::collections::HashSet;
use std::rc::Rc;

pub enum CarriedTransport {
    Terminal { name: Option<Vec<u8>>, handles: Vec<u64> },
    Pipes { stdout: Option<u64>, stderr: Option<u64>, stdin: Option<u64>, piped: bool },
}

pub struct CarriedRecord {
    key: Vec<u8>,
    process: u64,
    pid: u32,
    work: u32,
    birth: String,
    pace: Pace,
    transport: CarriedTransport,
    exit: Option<Exit>,
    reaped: Option<Usage>,
}

pub struct Carried {
    generation: Option<u64>,
    logic: Vec<String>,
    prepared: Option<Prepared>,
    records: Vec<CarriedRecord>,
    orphans: Vec<u64>,
}

struct Writer {
    bytes: Vec<u8>,
}

impl Writer {
    fn byte(&mut self, value: u8) {
        self.bytes.push(value);
    }

    fn word(&mut self, value: u32) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn long(&mut self, value: u64) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn data(&mut self, value: &[u8]) {
        self.word(value.len() as u32);
        self.bytes.extend_from_slice(value);
    }

    fn texts(&mut self, values: &[String]) {
        self.word(values.len() as u32);
        for value in values {
            self.data(value.as_bytes());
        }
    }

    fn present(&mut self, value: Option<u64>) {
        match value {
            None => self.byte(0),
            Some(value) => {
                self.byte(1);
                self.long(value);
            }
        }
    }
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, count: usize) -> Result<&'a [u8], String> {
        let end = self.at.checked_add(count).filter(|end| *end <= self.bytes.len()).ok_or("the table ends inside a field")?;
        let slice = &self.bytes[self.at..end];
        self.at = end;
        Ok(slice)
    }

    fn byte(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }

    fn word(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().map_err(|_| "a word does not occupy four bytes")?))
    }

    fn long(&mut self) -> Result<u64, String> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().map_err(|_| "a long does not occupy eight bytes")?))
    }

    fn data(&mut self) -> Result<Vec<u8>, String> {
        let length = self.word()? as usize;
        Ok(self.take(length)?.to_vec())
    }

    fn text(&mut self) -> Result<String, String> {
        String::from_utf8(self.data()?).map_err(|_| "a string of the table is not UTF-8".to_string())
    }

    fn texts(&mut self) -> Result<Vec<String>, String> {
        (0..self.count()?).map(|_| self.text()).collect()
    }

    fn count(&mut self) -> Result<usize, String> {
        let count = self.word()? as usize;
        if count > self.bytes.len() - self.at { Err("a list claims more entries than the table holds".into()) } else { Ok(count) }
    }

    fn present(&mut self) -> Result<Option<u64>, String> {
        match self.byte()? {
            0 => Ok(None),
            1 => Ok(Some(self.long()?)),
            other => Err(format!("presence marker {other} is neither 0 nor 1")),
        }
    }
}

pub fn encode<P: Platform>(table: &Table<P>) -> (Vec<u8>, Vec<Rc<P::Handle>>) {
    let mut out = Writer { bytes: Vec::new() };
    let mut kept: Vec<Rc<P::Handle>> = Vec::new();
    let mut carry = |handle: &Rc<P::Handle>| {
        kept.push(Rc::clone(handle));
        P::handle_value(handle)
    };
    out.present(table.generation);
    out.texts(&table.logic);
    match &table.prepared {
        None => out.byte(0),
        Some(prepared) => {
            out.byte(1);
            out.data(prepared.holder.as_bytes());
            out.texts(&prepared.logic);
        }
    }
    out.word(table.len() as u32);
    for record in table.records() {
        out.data(&record.key);
        out.long(P::process_value(&record.process));
        out.word(record.pid);
        out.word(record.work);
        out.data(record.birth.as_bytes());
        out.byte(record.pace as u8);
        match &record.transport {
            Transport::Terminal { handles, name } => {
                out.byte(1);
                match name {
                    None => out.byte(0),
                    Some(name) => {
                        out.byte(1);
                        out.data(name);
                    }
                }
                out.word(handles.len() as u32);
                for handle in handles {
                    out.long(carry(handle));
                }
            }
            Transport::Pipes { stdout, stderr, stdin, piped } => {
                out.byte(2);
                for end in [stdout, stderr, stdin] {
                    let value = end.as_ref().map(&mut carry);
                    out.present(value);
                }
                out.byte(u8::from(*piped));
            }
        }
        match &record.exit {
            None => out.byte(0),
            Some(Exit::Code(code)) => {
                out.byte(1);
                out.word(*code as u32);
            }
            Some(Exit::Signal(name)) => {
                out.byte(2);
                out.data(name.as_bytes());
            }
        }
        match &record.reaped {
            None => out.byte(0),
            Some(usage) => {
                out.byte(1);
                out.long(usage.user_micros);
                out.long(usage.system_micros);
                out.long(usage.peak_rss_bytes);
            }
        }
    }
    out.word(table.orphans.len() as u32);
    for orphan in &table.orphans {
        out.long(P::process_value(orphan));
    }
    (out.bytes, kept)
}

pub fn decode(bytes: &[u8]) -> Result<Carried, String> {
    let mut reader = Reader { bytes, at: 0 };
    let generation = reader.present()?;
    let logic = reader.texts()?;
    if logic.is_empty() {
        return Err("the table names no logic program".into());
    }
    let prepared = match reader.byte()? {
        0 => None,
        1 => Some(Prepared { holder: reader.text()?, logic: reader.texts()? }),
        other => return Err(format!("preparation marker {other} is neither 0 nor 1")),
    };
    let mut records = Vec::new();
    let mut keys = HashSet::new();
    for _ in 0..reader.count()? {
        let key = reader.data()?;
        if !keys.insert(key.clone()) {
            return Err("the table names one execution twice".into());
        }
        let process = reader.long()?;
        let pid = reader.word()?;
        let work = reader.word()?;
        let birth = reader.text()?;
        let pace = match reader.byte()? {
            0 => Pace::Full,
            1 => Pace::Low,
            2 => Pace::Lowest,
            other => return Err(format!("pace {other} is not a pace")),
        };
        let transport = match reader.byte()? {
            1 => {
                let name = match reader.byte()? {
                    0 => None,
                    1 => Some(reader.data()?),
                    other => return Err(format!("terminal name marker {other} is neither 0 nor 1")),
                };
                let handles = (0..reader.count()?).map(|_| reader.long()).collect::<Result<_, _>>()?;
                CarriedTransport::Terminal { name, handles }
            }
            2 => {
                let stdout = reader.present()?;
                let stderr = reader.present()?;
                let stdin = reader.present()?;
                let piped = match reader.byte()? {
                    0 => false,
                    1 => true,
                    other => return Err(format!("input marker {other} is neither 0 nor 1")),
                };
                CarriedTransport::Pipes { stdout, stderr, stdin, piped }
            }
            other => return Err(format!("transport {other} is not a transport")),
        };
        let exit = match reader.byte()? {
            0 => None,
            1 => Some(Exit::Code(reader.word()? as i32)),
            2 => Some(Exit::Signal(reader.text()?)),
            other => return Err(format!("exit kind {other} is not an exit")),
        };
        let reaped = match reader.byte()? {
            0 => None,
            1 => Some(Usage { user_micros: reader.long()?, system_micros: reader.long()?, peak_rss_bytes: reader.long()? }),
            other => return Err(format!("reap marker {other} is neither 0 nor 1")),
        };
        if reaped.is_some() && exit.is_none() {
            return Err("a reaped execution names no exit".into());
        }
        records.push(CarriedRecord { key, process, pid, work, birth, pace, transport, exit, reaped });
    }
    let orphans = (0..reader.count()?).map(|_| reader.long()).collect::<Result<_, _>>()?;
    if reader.at != bytes.len() {
        return Err("the table carries bytes past its fields".into());
    }
    let carried = Carried { generation, logic, prepared, records, orphans };
    let mut seen = HashSet::new();
    if let Some(value) = carried.handles().into_iter().find(|value| !seen.insert(*value)) {
        return Err(format!("handle {value} is named twice"));
    }
    Ok(carried)
}

impl Carried {
    pub fn handles(&self) -> Vec<u64> {
        self.records
            .iter()
            .flat_map(|record| match &record.transport {
                CarriedTransport::Terminal { handles, .. } => handles.clone(),
                CarriedTransport::Pipes { stdout, stderr, stdin, .. } => stdout.iter().chain(stderr.iter()).chain(stdin.iter()).copied().collect(),
            })
            .collect()
    }

    pub fn adopt<P: Platform>(self) -> Result<Table<P>, String> {
        let processes = self.records.iter().map(|carried| P::adopt_process(carried.process)).collect::<Result<Vec<_>, _>>()?;
        let orphans = self.orphans.iter().map(|value| P::adopt_process(*value)).collect::<Result<Vec<_>, _>>()?;
        self.handles().into_iter().try_for_each(P::keep_handle)?;
        let mut table = Table::new(self.logic);
        table.generation = self.generation;
        table.prepared = self.prepared;
        table.orphans = orphans;
        let own = |value: Option<u64>| value.map(|value| Rc::new(P::own_handle(value)));
        for (carried, process) in self.records.into_iter().zip(processes) {
            let transport = match carried.transport {
                CarriedTransport::Terminal { name, handles } => {
                    Transport::Terminal { handles: handles.into_iter().map(|value| Rc::new(P::own_handle(value))).collect(), name }
                }
                CarriedTransport::Pipes { stdout, stderr, stdin, piped } => Transport::Pipes { stdout: own(stdout), stderr: own(stderr), stdin: own(stdin), piped },
            };
            table.insert(Record {
                key: carried.key,
                process,
                pid: carried.pid,
                work: carried.work,
                birth: carried.birth,
                pace: carried.pace,
                transport,
                exit: carried.exit,
                reaped: carried.reaped,
            });
        }
        Ok(table)
    }
}
