# Research: the Tauri push transport mechanism (`ipc::Channel`) for Recap

Date: 2026-07-20
For: [#5 — What client-side technology beyond React, Tailwind and Shadcn?](https://github.com/qodesmith/recap/issues/5), question Q2 — *where do the pushed pipeline deltas land client-side?*
Status: **findings only — no decision made.** The A-vs-B choice (Channel→`setQueryData` vs a separate client store) is reserved to the user. This document explains the mechanism so that choice can be made with a real model, and does not make it.

Companion to `docs/research/2026-07-20-client-server-state.md`. That note stalled on "what does the backend emit"; [#7](https://github.com/qodesmith/recap/issues/7) has since answered it (Swift sidecar → Rust reads JSON-lines stdout → Rust re-emits deltas over `tauri::ipc::Channel` + a `get_pipeline_state()` resync; transcripts land in `--out` files, stdout carries only pointers + one fused monotonic progress scalar per track). This note goes deeper on the Channel itself. See §7 for what in the prior note no longer applies.

Source discipline: every non-obvious claim below cites Tauri v2 docs, `tauri-apps/tauri` source, or `TanStack/query` source. Tauri source is pinned to commit `78eaeaf`; TanStack Query source to `181ea82`.

---

> ## Scope
>
> This covers the **transport mechanism only** — what Channel is, how it moves bytes, and what is vs is not built in on the JS side. It does **not** cover the segment-firehose thrash math from the prior note, because #7 deleted that use case (§7). Performance claims here are read from source, not benchmarked.

---

## 0. The short version

- **What is broadcast:** whatever `TSend` you pick, serialized. In practice a small tagged-enum JSON object per `.send()` call. Each message is wrapped by Rust as `{ message: <payload>, index: <n> }` and delivered individually — **per-message, not batched by the framework.** Batching, if wanted, is something *you* do in Rust before `.send()`. Payloads can also be raw bytes (`InvokeResponseBody::Raw`), and large payloads silently switch to a `fetch`-based path. ([channel.rs L142-194](https://github.com/tauri-apps/tauri/blob/78eaeafa88f34b8ede7f7dddde4175902dc3ce52/crates/tauri/src/ipc/channel.rs#L142-L194))
- **What mechanism:** `tauri::ipc::Channel<T>`. The **frontend constructs** `new Channel()`, sets `.onmessage`, and passes it *into* a command as an argument; Rust deserializes that argument into a `Channel<TSend>` and calls `.send()` on it. Ordering is guaranteed by an integer index (Rust stamps, JS reorders). Termination is signalled only when the Rust `Channel` is **dropped**. ([calling-frontend](https://v2.tauri.app/develop/calling-frontend/))
- **Built-in client listener?** Partly. The JS `Channel` class (`onmessage` setter + an internal reorder buffer) is built in and does the ordering/termination bookkeeping for you. But it is a **single-consumer sink with one settable handler** — there is **no** built-in subscribe/multi-listener/React-hook/observable. The bridge from `onmessage` into React (`setQueryData` or a store `set`) is ~40 lines you write. ([core.ts L77-154](https://github.com/tauri-apps/tauri/blob/78eaeafa88f34b8ede7f7dddde4175902dc3ce52/packages/api/src/core.ts#L77-L154))
- **`streamedQuery` verdict:** the "right tool, wrong problem" call **holds**, and for a sharper reason than before — `streamFn` must return an `AsyncIterable`, and a `Channel` is a push callback, not an async iterable. Verified against current source (§6).

---

## 1. Three transports, precisely

Recap has (at least) three flavors of backend→frontend traffic. Tauri v2 gives three distinct mechanisms, and the docs draw the line explicitly ([calling-frontend](https://v2.tauri.app/develop/calling-frontend/)):

| Mechanism | Direction | Shape | Ordering | Multi-listener | Recap use |
|---|---|---|---|---|---|
| `invoke` (command) | pull (JS asks, Rust answers once) | one request → one response/reject | n/a | n/a | `list_recordings`, `get_pipeline_state()` |
| Event (`emit`/`listen`) | push | JSON string, fire-and-forget | **not guaranteed** | yes (many `listen`ers) | coarse per-track transitions |
| **`Channel<T>`** | push | typed, ordered, per-`.send()` | **guaranteed** | **no (one sink)** | progress deltas + file pointers |

Docs, verbatim ([calling-frontend](https://v2.tauri.app/develop/calling-frontend/)):

- Events: *"The event system is not designed for low latency or high throughput situations."*
- Events: *"event payloads are always JSON strings making them not suitable for bigger messages."*
- Events: *"if a listener is async and the event emitter sends multiple events in rapid succession, the listeners may process events out of order."*
- Channels: *"Channels are designed to be fast and deliver ordered data. They are used internally for streaming operations such as download progress, child process output and WebSocket messages."*

That last sentence is the tell: Rust's own `Command` sidecar stdout streaming and download-progress use Channels internally, which is exactly #7's pattern (Rust reads sidecar stdout, re-emits deltas). Recap is doing by hand what Tauri does for its own child-process streaming.

---

## 2. What is actually broadcast (payload shape)

### 2a. You choose the type; it must serialize

`Channel<TSend>` is generic. The documented pattern is a Serde tagged enum, so each message is a discriminated union the JS side switches on ([calling-frontend](https://v2.tauri.app/develop/calling-frontend/)):

```rust
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "event", content = "data")]
enum DownloadEvent<'a> {
  Started { url: &'a str, download_id: usize, content_length: usize },
  Progress { download_id: usize, chunk_length: usize },
  Finished { download_id: usize },
}
```

For Recap this maps directly: a `PipelineDelta` enum (`ProgressChanged { track, progress }`, `TrackDone { track, transcript_path }`, …). The bound on `.send()` is `TSend: IpcResponse` ([channel.rs L291-297](https://github.com/tauri-apps/tauri/blob/78eaeafa88f34b8ede7f7dddde4175902dc3ce52/crates/tauri/src/ipc/channel.rs#L291-L297)), which any `Serialize` type satisfies.

### 2b. JSON vs bytes vs the fetch fallback — three tiers, chosen by size

`.send(data)` calls `data.body()` to get an `InvokeResponseBody`, then the per-message closure branches on variant and size ([channel.rs L153-182](https://github.com/tauri-apps/tauri/blob/78eaeafa88f34b8ede7f7dddde4175902dc3ce52/crates/tauri/src/ipc/channel.rs#L153-L182)):

1. **Small JSON** (`< MAX_JSON_DIRECT_EXECUTE_THRESHOLD`, 8192 bytes): the JSON is injected straight into the webview via `eval` as `{ message: <json>, index: <n> }`. No copy through a queue.
2. **Small raw bytes** (`InvokeResponseBody::Raw`, `< MAX_RAW_DIRECT_EXECUTE_THRESHOLD`, 1024 bytes): sent as a `Uint8Array(...).buffer`, i.e. an `ArrayBuffer` reaches JS — the escape hatch for binary (waveform/PCM) without base64.
3. **Anything larger:** stashed in a `ChannelDataIpcQueue` keyed by a `data_id`, and JS is told to `invoke('plugin:__TAURI_CHANNEL__|fetch', …)` to pull it back over the fetch bridge ([channel.rs L167-181](https://github.com/tauri-apps/tauri/blob/78eaeafa88f34b8ede7f7dddde4175902dc3ce52/crates/tauri/src/ipc/channel.rs#L167-L181)). This is transparent to your code but matters for §3: the large path is **async** and can therefore land out of order relative to small messages — which is why the ordering machinery exists.

**Per-message, not batched.** Each `.send()` produces exactly one indexed message. There is no framework-level coalescing. If Recap wants "50 deltas per message," Rust must build a `Vec<PipelineDelta>` and `.send()` it as one payload. Given #7 (one scalar progress per track, transcript is a file pointer), batching is likely unnecessary — see §7.

---

## 3. The mechanism end-to-end: how a Channel is built, passed, sent, ordered, terminated

### 3a. Construction is on the *frontend*, and it is synchronous

Contrary to "a command hands a Channel back," the flow is the reverse. The **JS side constructs** the Channel and passes it *in*:

```ts
import { Channel, invoke } from '@tauri-apps/api/core'
const channel = new Channel<PipelineDelta>()
channel.onmessage = (delta) => { /* patch React */ }
await invoke('subscribe_pipeline', { recordingId, channel })
```

The constructor immediately calls `transformCallback(...)`, which *synchronously* registers the handler locally and returns a numeric id ([core.ts L87-131](https://github.com/tauri-apps/tauri/blob/78eaeafa88f34b8ede7f7dddde4175902dc3ce52/packages/api/src/core.ts#L87-L131), [core.ts L69-75](https://github.com/tauri-apps/tauri/blob/78eaeafa88f34b8ede7f7dddde4175902dc3ce52/packages/api/src/core.ts#L69-L75)). This is a **key contrast with `listen()`** (§5): registering a Channel's receiver is a local synchronous op; only the `invoke` that carries it is an async round-trip.

### 3b. Serialization across the boundary

When the Channel is passed as an argument, Tauri serializes it to the sentinel string `` `__CHANNEL__:${this.id}` `` via a custom IPC serializer key ([core.ts L146-153](https://github.com/tauri-apps/tauri/blob/78eaeafa88f34b8ede7f7dddde4175902dc3ce52/packages/api/src/core.ts#L146-L153)). On the Rust side, `Channel`'s `CommandArg` impl deserializes that string, strips the `"__CHANNEL__:"` prefix, parses the id, and reconstitutes a live `Channel<TSend>` bound to that webview + callback id ([channel.rs L300-316](https://github.com/tauri-apps/tauri/blob/78eaeafa88f34b8ede7f7dddde4175902dc3ce52/crates/tauri/src/ipc/channel.rs#L300-L316), [channel.rs L121-130](https://github.com/tauri-apps/tauri/blob/78eaeafa88f34b8ede7f7dddde4175902dc3ce52/crates/tauri/src/ipc/channel.rs#L121-L130)). So the Rust command signature is simply:

```rust
#[tauri::command]
fn subscribe_pipeline(webview: Webview, recording_id: String, channel: Channel<PipelineDelta>) { … }
```

### 3c. Sending and the ordering guarantee (this is the load-bearing part)

`.send()` is a synchronous call into the closure `channel_on` built ([channel.rs L134-194](https://github.com/tauri-apps/tauri/blob/78eaeafa88f34b8ede7f7dddde4175902dc3ce52/crates/tauri/src/ipc/channel.rs#L134-L194)). Each send does `let current_index = counter.fetch_add(1, Ordering::Relaxed);` — a per-channel `AtomicUsize` stamps a monotonically increasing index onto every message, so ordering is a **framework guarantee, not a convention**:

```rust
let current_index = counter.fetch_add(1, Ordering::Relaxed);
// … eval → { message: <json>, index: current_index }
```

On the JS side the `Channel` class reassembles order with a next-index cursor and a pending buffer ([core.ts L82-131](https://github.com/tauri-apps/tauri/blob/78eaeafa88f34b8ede7f7dddde4175902dc3ce52/packages/api/src/core.ts#L82-L131)):

```ts
// the index is used as a mechanism to preserve message order
#nextMessageIndex = 0
#pendingMessages: T[] = []
```

If `index === #nextMessageIndex` it fires `onmessage` and drains any now-contiguous pending messages; otherwise it parks the message at `#pendingMessages[index]` until the gap fills. This is why the async large-payload path (§2b, tier 3) is safe: a big message routed through `fetch` that resolves late is buffered and delivered in order, never dropped, never reordered.

### 3d. Termination is a *drop* signal, and only on the JS-created path

There is no `.close()`. Termination is wired to Rust's `Drop`. `channel_on` installs an `on_drop` that, when the Rust `Channel` is dropped, evals `{ end: true, index: current_index }` where `current_index` = the count of messages already sent ([channel.rs L186-192](https://github.com/tauri-apps/tauri/blob/78eaeafa88f34b8ede7f7dddde4175902dc3ce52/crates/tauri/src/ipc/channel.rs#L186-L192)). JS handles it by unregistering the callback once the cursor reaches that end index (buffering the "end" too, so it fires only after all real messages drained) ([core.ts L98-125](https://github.com/tauri-apps/tauri/blob/78eaeafa88f34b8ede7f7dddde4175902dc3ce52/packages/api/src/core.ts#L98-L125), `cleanupCallback` → `unregisterCallback` at [core.ts L134-136](https://github.com/tauri-apps/tauri/blob/78eaeafa88f34b8ede7f7dddde4175902dc3ce52/packages/api/src/core.ts#L134-L136)).

Two consequences for Recap:
- **The `end` message is *not* surfaced to your `onmessage` handler.** `onmessage` only ever sees real payloads. If the UI needs to know "pipeline finished," that must be an explicit `PipelineDelta::Done` payload you `.send()`, not the framework's end signal (which only tears down the callback).
- **Keep the Rust `Channel` alive for as long as you stream.** If the command returns and drops the `Channel`, the stream ends. To push after the command returns, the `Channel` must be moved into whatever owns the streaming task (a `tauri::async_runtime::spawn`, a state-held map of `recording_id → Channel`, etc.). Note the alternate `Channel::new` / `from_callback_fn` constructors pass `on_drop: None` — no end signal at all ([channel.rs L211-284](https://github.com/tauri-apps/tauri/blob/78eaeafa88f34b8ede7f7dddde4175902dc3ce52/crates/tauri/src/ipc/channel.rs#L211-L284)); the drop-signal behavior is specific to the `channel_on` path used when a JS-created Channel is passed into a command, which is Recap's case.

---

## 4. Channel vs `invoke` (pull) vs events — the concrete differences

- **vs `invoke`:** `invoke` is one-shot request/response; the promise resolves or rejects once ([calling-rust](https://v2.tauri.app/develop/calling-rust/)). A Channel is the *same call* (`invoke('subscribe_pipeline', {channel})`) but the `channel` argument opens a durable one-way push lane that outlives the invoke's own resolution. `get_pipeline_state()` is a plain `invoke` (pull snapshot); the deltas are the Channel (push). They are complementary, not alternatives.
- **vs events:** events are broadcast (any number of `listen`ers, addressed by event name), unordered under async listeners, JSON-string-only, and evaluate JS under the hood. A Channel is point-to-point (one JS sink, addressed by callback id), ordered by construction, and supports raw bytes. Choose events for coarse "something changed, go refetch" fan-out; choose a Channel for an ordered high-rate stream to one consumer. (All per [calling-frontend](https://v2.tauri.app/develop/calling-frontend/).)

---

## 5. Does Tauri give the CLIENT built-in machinery to listen? (precise answer)

**Built in:**
- The `Channel<T>` class itself: `new Channel()`, the `onmessage` setter/getter, and — importantly — the ordering + termination bookkeeping (index cursor, pending buffer, auto-unregister on end). You do not hand-roll reordering. ([core.ts L77-154](https://github.com/tauri-apps/tauri/blob/78eaeafa88f34b8ede7f7dddde4175902dc3ce52/packages/api/src/core.ts#L77-L154))
- For the **event** system, `@tauri-apps/api/event` exports `listen`, `once`, `emit`, `emitTo`. `listen(event, handler)` returns `Promise<UnlistenFn>` — an **async** registration (it awaits Rust registering the listener and returning an id) ([event.ts L117-119, L85-119](https://github.com/tauri-apps/tauri/blob/78eaeafa88f34b8ede7f7dddde4175902dc3ce52/packages/api/src/event.ts#L85-L163)).

**NOT built in — you write it:**
- **No subscribe / multi-listener on a Channel.** `onmessage` is a single settable property; assigning a new handler replaces the old one ([core.ts L138-144](https://github.com/tauri-apps/tauri/blob/78eaeafa88f34b8ede7f7dddde4175902dc3ce52/packages/api/src/core.ts#L138-L144)). One Channel = one consumer. Fan-out to multiple UI subscribers is your code.
- **No React hook, no observable, no Query integration.** There is no `useChannel`, no `Channel.toObservable()`, nothing that turns a Channel into an async iterable, and no first-party TanStack Query adapter. The bridge — `channel.onmessage = (delta) => setQueryData(...)` (option A) or `channel.onmessage = (delta) => store.set(...)` (option B) — is app-authored. This is the ~40-line hook/provider from the prior note's §3, and it is the entirety of what A-vs-B is choosing between.

The two built-in receivers differ in a way that matters for the mount race (§8 of the prior note): a Channel's receiver registers **synchronously** in the constructor (§3a), whereas `listen()` is an async round-trip. So for Channels the only asynchrony before data can flow is the `invoke` that carries the Channel to Rust — which means the strongest race fix is structural and clean here: **have `subscribe_pipeline` accept the Channel *and return the snapshot* in the same command.** Rust then, within that one handler, captures the current state as the return value and begins sending deltas from that point, with no window in which a delta can fall between snapshot and subscription. This is prior-note §8 mitigation #3, and it fits #7's `get_pipeline_state()` model exactly — either fold the snapshot into `subscribe_pipeline`'s return, or send the first Channel message as a full-state frame. (Reasoned from the source mechanism; Tauri publishes no guidance on this race.)

---

## 6. `streamedQuery` — verdict confirmed, and sharpened

Verified against current `query-core` source (`181ea82`):

- Exported as **`experimental_streamedQuery`** ([query-core index.ts L43](https://github.com/TanStack/query/blob/181ea826cb5b5f722a774525046d8f4e105dd6bb/packages/query-core/src/index.ts#L43): `export { streamedQuery as experimental_streamedQuery }`). Still experimental.
- Option is **`streamFn`**, not `queryFn`; **no `maxChunks`** exists in current source (both prior-note claims re: the 5.86.0 rename/removal hold — the current shape is `streamFn` / `reducer` / `initialValue` / `refetchMode`) ([streamedQuery.ts L9-64](https://github.com/TanStack/query/blob/181ea826cb5b5f722a774525046d8f4e105dd6bb/packages/query-core/src/streamedQuery.ts#L9-L64)).
- Cancellation is **lazy**: the context passed to `streamFn` wraps the signal via `addConsumeAwareSignal`, and `cancelled` is only ever set if the stream code actually reads `context.signal` ([streamedQuery.ts L79-92](https://github.com/TanStack/query/blob/181ea826cb5b5f722a774525046d8f4e105dd6bb/packages/query-core/src/streamedQuery.ts#L79-L92)). Never touch the signal and the loop runs to completion after unmount.
- State JSDoc, verbatim: *"The query will be in a 'pending' state until the first chunk of data is received, but will go to 'success' after that. The query will stay in fetchStatus 'fetching' until the stream ends."* ([streamedQuery.ts L37-50](https://github.com/TanStack/query/blob/181ea826cb5b5f722a774525046d8f4e105dd6bb/packages/query-core/src/streamedQuery.ts#L37-L50))

**Why it is the wrong tool for Recap's Channel, decisively:**

1. **Type mismatch at the boundary.** `streamFn` must *return* `AsyncIterable<TQueryFnData> | Promise<AsyncIterable<TQueryFnData>>` and is consumed with `for await (const chunk of stream)` ([streamedQuery.ts L10-12, L94-98](https://github.com/TanStack/query/blob/181ea826cb5b5f722a774525046d8f4e105dd6bb/packages/query-core/src/streamedQuery.ts#L94-L112)). A Tauri Channel is a **push callback** (`onmessage`), not a pull-based async iterable. Adapting one to the other requires a hand-written queue with a parked promise resolver (push → `for await`), and with `maxChunks` gone that queue has no built-in bound.
2. **Accumulate, not replace.** The default `reducer` *appends* every chunk into an array ([streamedQuery.ts L58-60](https://github.com/TanStack/query/blob/181ea826cb5b5f722a774525046d8f4e105dd6bb/packages/query-core/src/streamedQuery.ts#L58-L60), `addToEnd`). Recap's progress delta is **replace-latest** ("track X is now at 0.62"), not a growing log. You would have to supply a custom `reducer`+`initialValue` that ignores accumulation — fighting the tool's core assumption. #7 removed the one place accumulate semantics fit (progressive segment append), because transcript is now a single file read at `track_done`, not a stream of chunks.
3. **It calls `setQueryData` per chunk anyway**, so it buys no batching over a hand bridge.

Net: `streamedQuery` is the correct tool for *"turn an async iterable into an accumulating Query."* Recap has neither an async iterable nor accumulate semantics. A direct `channel.onmessage → setQueryData/store.set` bridge is simpler and carries no experimental-API risk. **The prior verdict stands; this is stronger evidence for it, not weaker.**

---

## 7. What in the prior research note no longer applies

The prior note (`2026-07-20-client-server-state.md`) predates #7 and assumed a **per-segment streaming firehose**. #7 deleted that. Specifically:

- **§0 table, row "Ordered bulk stream (transcript segments arriving progressively)":** no longer exists as hot traffic. Transcript is a **single file read at `track_done`** (one `invoke`/read), not a Channel of segments. The Channel now carries only progress scalars + file pointers.
- **§3 "cache-thrash is real and O(N²)":** the two multipliers were *5,000 segments × one `setQueryData` per segment*. With #7, the delta stream is roughly one fused progress scalar per track per tick — orders of magnitude smaller. The `replaceEqualDeep` full-structure-walk and `notifyManager` per-macrotask-render analyses are **still true facts about TanStack source**, but at Recap's actual post-#7 volumes they are effectively moot on the delta path. They would only bite again if progress ticks are pathologically chatty (see [#13](https://github.com/qodesmith/recap/issues/13)) — in which case the mitigation is the same and cheaper: coalesce/`distinctUntilChanged` in Rust before `.send()` (§2b), since #7 makes Rust the source and `PartialEq` can drop no-op progress.
- **§2 "Channels for segments":** re-read — the *reason* changes. Ordering still matters (a stale progress scalar overwriting a newer one is a real bug), but "segments arriving out of order" is no longer the motivating case.
- **§3 `streamedQuery` sub-section:** superseded by §6 here (same verdict, verified against current source, plus the async-iterable/replace-latest arguments that #7 makes decisive).

**What still stands unchanged:** §4 (playback cursor must not be React state — a fact about React's scheduler, backend-independent), §8's StrictMode double-subscribe leak (applies to *any* async-registered listener; note Channels register synchronously so the leak window is smaller — the risk is really on the `listen()` path and on keeping the Rust-side Channel/subscription cleaned up), §8's optimistic-edit-clobbering, §7 (Router), §9 (Docker Desktop precedent — "aggregate at the producer" is now literally #7's design).

---

## 8. Sources

Primary throughout.
- Tauri v2 docs: [calling-frontend](https://v2.tauri.app/develop/calling-frontend/), [calling-rust](https://v2.tauri.app/develop/calling-rust/).
- `tauri-apps/tauri` source, pinned `78eaeaf`: [`crates/tauri/src/ipc/channel.rs`](https://github.com/tauri-apps/tauri/blob/78eaeafa88f34b8ede7f7dddde4175902dc3ce52/crates/tauri/src/ipc/channel.rs), [`packages/api/src/core.ts`](https://github.com/tauri-apps/tauri/blob/78eaeafa88f34b8ede7f7dddde4175902dc3ce52/packages/api/src/core.ts), [`packages/api/src/event.ts`](https://github.com/tauri-apps/tauri/blob/78eaeafa88f34b8ede7f7dddde4175902dc3ce52/packages/api/src/event.ts).
- `TanStack/query` source, pinned `181ea82`: [`packages/query-core/src/streamedQuery.ts`](https://github.com/TanStack/query/blob/181ea826cb5b5f722a774525046d8f4e105dd6bb/packages/query-core/src/streamedQuery.ts), [`packages/query-core/src/index.ts`](https://github.com/TanStack/query/blob/181ea826cb5b5f722a774525046d8f4e105dd6bb/packages/query-core/src/index.ts). Reference page: [streamedQuery](https://tanstack.com/query/latest/docs/reference/streamedQuery).
- Prior research: `docs/research/2026-07-20-client-server-state.md`. Handoff: `#7` resolution.

Not benchmarked — mechanism read from source, not measured. The A-vs-B decision (Channel→`setQueryData` vs separate store) is the user's; this note is input only.
