//! Shadow terminal emulator. Each PTY session owns one. The emulator is
//! fed every byte read from the PTY **continuously** — even when no WS
//! clients are attached — so `snapshot()` always returns a current view
//! and reconnect-on-drop is instantaneous.
//!
//! Uses `std::sync::RwLock` (not tokio's) because the blocking PTY
//! reader task calls `process` synchronously. Operations are very fast
//! — tens of microseconds for a single write — and never hold the lock
//! across an await.

use std::sync::{Arc, RwLock};
use vt100::Parser;

#[derive(Clone)]
pub struct ShadowEmulator {
    parser: Arc<RwLock<Parser>>,
}

impl ShadowEmulator {
    pub fn new(rows: u16, cols: u16) -> Self {
        // scrollback = 0 because this emulator's job is just to reproduce
        // the current screen state on reconnect; the timeline pane owns
        // historical context.
        Self {
            parser: Arc::new(RwLock::new(Parser::new(rows, cols, 0))),
        }
    }

    /// Feed PTY bytes into the emulator. Called by the (blocking) reader
    /// task on every PTY read.
    pub fn process(&self, bytes: &[u8]) {
        let mut p = self.parser.write().unwrap();
        p.process(bytes);
    }

    /// Render the current screen as an ANSI byte stream that, when
    /// written to an xterm, reproduces the visible state (including
    /// cursor position and — when active — the alternate screen buffer).
    pub fn snapshot(&self) -> Vec<u8> {
        let p = self.parser.read().unwrap();
        p.screen().contents_formatted()
    }

    pub fn resize(&self, rows: u16, cols: u16) {
        let mut p = self.parser.write().unwrap();
        p.set_size(rows, cols);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_contains_text_written_to_emulator() {
        let em = ShadowEmulator::new(24, 80);
        em.process(b"hello world");
        let snap = em.snapshot();
        let as_str = String::from_utf8_lossy(&snap);
        assert!(as_str.contains("hello world"), "got: {as_str:?}");
    }

    #[test]
    fn snapshot_reflects_alt_screen_switch() {
        let em = ShadowEmulator::new(24, 80);
        em.process(b"before");
        // DEC private mode 1049 enters the alternate screen buffer.
        em.process(b"\x1b[?1049h");
        em.process(b"in alt screen");
        let snap = em.snapshot();
        let as_str = String::from_utf8_lossy(&snap);
        assert!(as_str.contains("in alt screen"), "got: {as_str:?}");
    }

    #[test]
    fn resize_does_not_panic() {
        let em = ShadowEmulator::new(24, 80);
        em.process(b"content");
        em.resize(40, 120);
        let _ = em.snapshot();
    }
}
