//! Per-host politeness (PLAN §5): every fetcher sends through [`send`], which spaces request starts to one host,
//! retries once after 429 / 502–504 or a dropped connection, and slows a host down when it answers 429.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use reqwest::{RequestBuilder, Response, header::RETRY_AFTER};

const MAX_GAP: Duration = Duration::from_secs(8);
const MAX_RETRY_AFTER: u64 = 20;

/// Minimum spacing between request starts per host.
fn base_gap(host: &str) -> Duration {
    // ponytail: two measured offenders (LinkedIn 429s on job pages, Gupy resets bursts); others get a light gap.
    if host.ends_with("linkedin.com") || host == "portal.gupy.io" {
        Duration::from_millis(1000)
    } else {
        Duration::from_millis(150)
    }
}

struct Host {
    next: Instant,
    gap: Duration,
}

static HOSTS: LazyLock<Mutex<HashMap<String, Host>>> = LazyLock::new(Default::default);

/// Reserve the host's next slot and wait for it.
async fn pace(host: &str) {
    let wait = {
        let mut hosts = HOSTS.lock().unwrap();
        let now = Instant::now();
        let h = hosts.entry(host.to_string()).or_insert_with(|| Host {
            next: now,
            gap: base_gap(host),
        });
        let slot = h.next.max(now);
        h.next = slot + h.gap;
        slot - now
    };
    if !wait.is_zero() {
        tokio::time::sleep(wait).await;
    }
}

/// 429 doubles the host's gap (up to 8 s); each other answer takes 10% off, down to the base gap.
fn adjust(host: &str, throttled: bool) {
    if let Some(h) = HOSTS.lock().unwrap().get_mut(host) {
        h.gap = if throttled {
            (h.gap * 2).min(MAX_GAP)
        } else {
            (h.gap * 9 / 10).max(base_gap(host))
        };
    }
}

/// `RequestBuilder::send` with pacing and one retry (bodies that can't be cloned, i.e. streams, aren't retried).
pub async fn send(rb: RequestBuilder) -> reqwest::Result<Response> {
    let (client, req) = rb.build_split();
    let req = req?;
    let host = req.url().host_str().unwrap_or_default().to_string();
    let again = req.try_clone();
    pace(&host).await;
    let first = client.execute(req).await;
    let wait = match &first {
        Ok(r) if matches!(r.status().as_u16(), 429 | 502 | 503 | 504) => {
            adjust(&host, r.status() == 429);
            r.headers()
                .get(RETRY_AFTER)
                .and_then(|v| v.to_str().ok()?.trim().parse::<u64>().ok())
                .filter(|s| *s <= MAX_RETRY_AFTER)
                .map_or(Duration::from_secs(2), Duration::from_secs)
        }
        Ok(_) => {
            adjust(&host, false);
            return first;
        }
        // Timeouts aren't retried: that would double an already long wait.
        Err(e) if !e.is_timeout() && (e.is_connect() || e.is_request()) => Duration::from_secs(2),
        Err(_) => return first,
    };
    let Some(req) = again else { return first };
    tracing::info!("{host}: retrying in {wait:?}");
    tokio::time::sleep(wait).await;
    pace(&host).await;
    let second = client.execute(req).await;
    if let Ok(r) = &second {
        adjust(&host, r.status() == 429);
    }
    second
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// Minimal HTTP server: the first `fail` connections get 429 + Retry-After: 1, the rest 200.
    async fn server(fail: usize) -> (String, Arc<AtomicUsize>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        let hits = Arc::new(AtomicUsize::new(0));
        let count = hits.clone();
        tokio::spawn(async move {
            loop {
                let (mut sock, _) = listener.accept().await.unwrap();
                let n = count.fetch_add(1, Ordering::SeqCst);
                let mut buf = [0u8; 2048];
                let _ = sock.read(&mut buf).await;
                let reply = if n < fail {
                    "HTTP/1.1 429 Too Many Requests\r\nRetry-After: 1\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                } else {
                    "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"
                };
                let _ = sock.write_all(reply.as_bytes()).await;
            }
        });
        (url, hits)
    }

    /// Acceptance: a 429 is retried after Retry-After, and the host's gap doubles.
    #[tokio::test]
    async fn retries_after_429() {
        let (url, hits) = server(1).await;
        let t = Instant::now();
        let r = send(reqwest::Client::new().get(&url)).await.unwrap();
        assert_eq!(r.status(), 200);
        assert_eq!(hits.load(Ordering::SeqCst), 2);
        assert!(t.elapsed() >= Duration::from_secs(1));
        assert_eq!(HOSTS.lock().unwrap()["127.0.0.1"].gap, Duration::from_millis(270));
    }

    /// Acceptance: requests to one host start at least one gap apart, even when fired together.
    #[test]
    fn paces_per_host() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let t = Instant::now();
            futures::future::join_all((0..3).map(|_| pace("pace.test"))).await;
            assert!(t.elapsed() >= Duration::from_millis(300));
            let t = Instant::now();
            pace("other.test").await;
            assert!(t.elapsed() < Duration::from_millis(50));
        });
    }
}
