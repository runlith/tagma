#[cfg(target_os = "macos")]
#[path = "../testing/metal.rs"]
mod metal;

#[cfg(target_os = "macos")]
fn main() -> Result<(), String> {
    use std::io::{BufRead, Write};
    let work = metal::Work::open()?;
    println!("{}", if work.is_some() { "ready" } else { "unavailable" });
    std::io::stdout().flush().map_err(|error| error.to_string())?;
    for line in std::io::stdin().lock().lines() {
        let line = line.map_err(|error| error.to_string())?;
        match line.as_str() {
            "first" | "second" => {
                let work = work.as_ref().ok_or("there is no Metal device")?;
                let queue = usize::from(line == "second");
                let duration = work.complete(queue)?;
                println!("{line} {duration}");
                std::io::stdout().flush().map_err(|error| error.to_string())?;
            }
            "end" => return Ok(()),
            _ => return Err(format!("unknown GPU fixture command: {line}")),
        }
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn main() { println!("unavailable"); }
