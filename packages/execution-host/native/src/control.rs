#[derive(Default)]
pub struct Interruption {
    pub pending: usize,
    pub synthetic: bool,
    pub flushed: bool,
}

impl Interruption {
    pub fn fields(&self) -> [u64; 3] { [self.pending as u64, self.synthetic as u64, self.flushed as u64] }
}
