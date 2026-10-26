use std::io;

pub enum Refusal {
    Failed(String),
    WouldBlock,
    Closed,
    Invalid(String),
    Gone,
}

impl From<io::Error> for Refusal {
    fn from(error: io::Error) -> Self {
        Refusal::Failed(error.to_string())
    }
}
