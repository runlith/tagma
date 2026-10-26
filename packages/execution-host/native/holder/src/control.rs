use crate::frames::MAX_FRAME;
use crate::platform::{Io, Platform};
use std::collections::VecDeque;
use std::rc::Rc;

pub enum Leaving {
    Gone,
    Broken(String),
}

struct Out<H> {
    bytes: Vec<u8>,
    sent: usize,
    handles: Vec<Rc<H>>,
}

pub struct Control<P: Platform> {
    pub channel: P::Channel,
    pub token: P::Token,
    inbox: Vec<u8>,
    read: usize,
    outbox: VecDeque<Out<P::Handle>>,
    writing: bool,
}

impl<P: Platform> Control<P> {
    pub fn new(channel: P::Channel, token: P::Token) -> Self {
        Self { channel, token, inbox: Vec::new(), read: 0, outbox: VecDeque::new(), writing: false }
    }

    pub fn queue(&mut self, bytes: Vec<u8>, handles: Vec<Rc<P::Handle>>) {
        self.outbox.push_back(Out { bytes, sent: 0, handles });
    }

    pub fn flush(&mut self, platform: &mut P) -> Result<(), String> {
        while let Some(out) = self.outbox.front_mut() {
            match platform.send(&self.channel, &out.bytes[out.sent..], &out.handles) {
                Io::Done(written) => {
                    out.handles.clear();
                    out.sent += written;
                    if out.sent == out.bytes.len() {
                        self.outbox.pop_front();
                    }
                }
                Io::Blocked => {
                    if !self.writing {
                        platform.watch_write(&self.channel, true)?;
                        self.writing = true;
                    }
                    return Ok(());
                }
                Io::Ended => return Err("the logic closed the channel to the holder".into()),
                Io::Broken(detail) => return Err(detail),
            }
        }
        if self.writing {
            platform.watch_write(&self.channel, false)?;
            self.writing = false;
        }
        Ok(())
    }

    pub fn fill(&mut self, platform: &mut P, landing: &mut [u8]) -> Option<Leaving> {
        loop {
            match platform.receive(&self.channel, landing) {
                Io::Done(read) => self.inbox.extend_from_slice(&landing[..read]),
                Io::Blocked => return None,
                Io::Ended => return Some(Leaving::Gone),
                Io::Broken(detail) => return Some(Leaving::Broken(detail)),
            }
        }
    }

    pub fn frame(&mut self) -> Result<Option<Vec<u8>>, String> {
        let inbox = &self.inbox[self.read..];
        if inbox.len() < 4 {
            return Ok(None);
        }
        let length = u32::from_le_bytes([inbox[0], inbox[1], inbox[2], inbox[3]]) as usize;
        if length == 0 || length > MAX_FRAME {
            return Err(format!("the logic sent a frame of {length} bytes"));
        }
        if inbox.len() < 4 + length {
            return Ok(None);
        }
        let body = inbox[4..4 + length].to_vec();
        self.read += 4 + length;
        Ok(Some(body))
    }

    pub fn compact(&mut self) {
        self.inbox.drain(..self.read);
        self.read = 0;
    }
}
