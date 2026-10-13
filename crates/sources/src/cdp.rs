//! Minimal Chrome DevTools Protocol client (PLAN §5 headless-browser rewrite): a throwaway headless Edge / Chrome
//! with its own profile (never the user's running browser), one tab per page, JS evaluated in the page.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::Message;

/// `JUMPSHIP_BROWSER`, else the usual Edge / Chrome / Chromium locations.
pub fn browser() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("JUMPSHIP_BROWSER") {
        return Some(PathBuf::from(p));
    }
    let env = |k: &str| std::env::var(k).ok().map(PathBuf::from);
    let mut candidates: Vec<PathBuf> = Vec::new();
    for base in [env("ProgramFiles(x86)"), env("ProgramFiles"), env("LOCALAPPDATA")]
        .into_iter()
        .flatten()
    {
        candidates.push(base.join(r"Microsoft\Edge\Application\msedge.exe"));
        candidates.push(base.join(r"Google\Chrome\Application\chrome.exe"));
    }
    candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome".into());
    candidates.push("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge".into());
    let path = std::env::var_os("PATH").unwrap_or_default();
    for dir in std::env::split_paths(&path) {
        for name in [
            "chromium",
            "chromium-browser",
            "google-chrome",
            "google-chrome-stable",
            "microsoft-edge",
        ] {
            candidates.push(dir.join(name));
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// Profiles a run couldn't delete (browser still exiting when the process ended): gone after an hour.
fn sweep_stale_profiles() {
    let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) else {
        return;
    };
    for e in entries.flatten() {
        let old = e
            .metadata()
            .and_then(|m| m.modified())
            .is_ok_and(|t| t.elapsed().unwrap_or_default() > Duration::from_secs(3600));
        if old && e.file_name().to_string_lossy().starts_with("jumpship-cdp-") {
            let _ = std::fs::remove_dir_all(e.path());
        }
    }
}

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

pub struct Browser {
    _child: tokio::process::Child,
    dir: PathBuf,
    tx: mpsc::UnboundedSender<Message>,
    pending: Pending,
    next: AtomicU64,
}

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) \
                  Chrome/140.0.0.0 Safari/537.36";

impl Browser {
    pub async fn launch() -> Result<Self, String> {
        let exe = browser().ok_or("no Edge/Chrome/Chromium found (set JUMPSHIP_BROWSER to its executable)")?;
        sweep_stale_profiles();
        static RUN: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "jumpship-cdp-{}-{}",
            std::process::id(),
            RUN.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let child = tokio::process::Command::new(&exe)
            .args([
                "--headless=new",
                "--disable-gpu",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-extensions",
                "--mute-audio",
                "--lang=pt-BR",
                "--window-size=1280,800",
                "--remote-debugging-port=0",
            ])
            .arg(format!("--user-agent={UA}"))
            .arg(format!("--user-data-dir={}", dir.display()))
            .arg("about:blank")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("could not start {}: {e}", exe.display()))?;
        // The browser writes "<port>\n<ws path>" once DevTools listens.
        let port_file = dir.join("DevToolsActivePort");
        let mut endpoint = None;
        for _ in 0..150 {
            if let Ok(text) = std::fs::read_to_string(&port_file)
                && let [port, path, ..] = text.lines().collect::<Vec<_>>()[..]
            {
                endpoint = Some(format!("ws://127.0.0.1:{port}{path}"));
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let endpoint = endpoint.ok_or("browser did not open its DevTools port")?;
        let (ws, _) = tokio_tungstenite::connect_async(endpoint.as_str())
            .await
            .map_err(|e| format!("DevTools connect: {e}"))?;
        let (mut sink, mut stream) = ws.split();
        let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
        tokio::spawn(async move {
            while let Some(m) = rx.recv().await {
                if sink.send(m).await.is_err() {
                    break;
                }
            }
        });
        let pending: Pending = Arc::default();
        let waiting = pending.clone();
        tokio::spawn(async move {
            while let Some(Ok(msg)) = stream.next().await {
                let Message::Text(text) = msg else { continue };
                let Ok(v) = serde_json::from_str::<Value>(&text) else {
                    continue;
                };
                // Events (no id) are ignored: pages are polled instead.
                let Some(id) = v["id"].as_u64() else { continue };
                if let Some(reply) = waiting.lock().unwrap().remove(&id) {
                    let _ = reply.send(match v.get("error") {
                        Some(e) => Err(e["message"].as_str().unwrap_or("DevTools error").to_string()),
                        None => Ok(v["result"].clone()),
                    });
                }
            }
            // Browser gone: fail everything still waiting.
            waiting.lock().unwrap().clear();
        });
        Ok(Browser {
            _child: child,
            dir,
            tx,
            pending,
            next: AtomicU64::new(1),
        })
    }

    pub async fn call(&self, method: &str, params: Value, session: Option<&str>) -> Result<Value, String> {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let mut msg = json!({"id": id, "method": method, "params": params});
        if let Some(s) = session {
            msg["sessionId"] = s.into();
        }
        let (reply, answer) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, reply);
        self.tx
            .send(Message::Text(msg.to_string().into()))
            .map_err(|_| "browser connection closed")?;
        match tokio::time::timeout(Duration::from_secs(45), answer).await {
            Ok(Ok(r)) => r,
            Ok(Err(_)) => Err("browser connection closed".into()),
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                Err(format!("{method} timed out"))
            }
        }
    }

    /// Open `url` in a new tab, evaluate `script` (may return a promise) and close the tab.
    pub async fn eval_page(&self, url: &str, script: &str) -> Result<Value, String> {
        let target = self
            .call("Target.createTarget", json!({"url": "about:blank"}), None)
            .await?;
        let target_id = target["targetId"].as_str().unwrap_or_default().to_string();
        let result = async {
            let attached = self
                .call(
                    "Target.attachToTarget",
                    json!({"targetId": target_id, "flatten": true}),
                    None,
                )
                .await?;
            let session = attached["sessionId"].as_str().unwrap_or_default().to_string();
            let s = Some(session.as_str());
            let nav = self.call("Page.navigate", json!({"url": url}), s).await?;
            if let Some(e) = nav["errorText"].as_str().filter(|e| !e.is_empty()) {
                return Err(format!("{e} at {url}"));
            }
            let eval = json!({"expression": script, "awaitPromise": true, "returnByValue": true});
            let mut last = String::new();
            // A client-side redirect destroys the first document's context: retry on the next one.
            for _ in 0..3 {
                match self.call("Runtime.evaluate", eval.clone(), s).await {
                    Ok(r) if r.get("exceptionDetails").is_none() => return Ok(r["result"]["value"].clone()),
                    Ok(r) => last = r["exceptionDetails"]["text"].as_str().unwrap_or("script error").into(),
                    Err(e) => last = e,
                }
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
            Err(last)
        }
        .await;
        let _ = self
            .call("Target.closeTarget", json!({"targetId": target_id}), None)
            .await;
        result
    }
}

impl Drop for Browser {
    fn drop(&mut self) {
        // kill_on_drop ends the process; the profile dir goes once its files are released.
        let _ = self._child.start_kill();
        let dir = self.dir.clone();
        std::thread::spawn(move || {
            for _ in 0..20 {
                if std::fs::remove_dir_all(&dir).is_ok() || !dir.exists() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(250));
            }
        });
    }
}
