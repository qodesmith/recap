# Research: client-side server-state management for Recap

Date: 2026-07-20
For: [#5 — What client-side technology beyond React, Tailwind and Shadcn?](https://github.com/qodesmith/recap/issues/5), question Q2
Status: **findings only — no decision made.** Every client-side technology choice is reserved to the user.

Three parallel investigations: TanStack Query/Router + Tauri v2 against primary sources; the Docker Desktop
(`~/repos/pinata`) Redux+RxJS architecture read from its own source; and a survey of Jotai, Zustand, Valtio,
TanStack Store, XState and the React primitives.

---

> ## ⚠️ Read this before relying on anything below
>
> **This is partial input to an open ticket, not settled research.** The session that produced it
> **stalled deliberately**: the transport question could not be answered without knowing what the Tauri
> backend actually emits. #5 is now blocked by
> [#7 — How is local inference invoked from Tauri?](https://github.com/qodesmith/recap/issues/7).
>
> **No technology has been chosen.** Every client-side pick is reserved to the user by a standing decision
> on the map. Nothing here is a recommendation to act on.
>
> ### What #7 can still overturn
>
> - **§2 (Transport: Channels vs events)** — in-process Rust vs sidecar determines whether a Tauri Channel
>   is even available on the hot path. Re-read this section against #7's answer before using it.
> - **§3's mitigations** — whether cache-thrash handling is needed at all also depends on
>   [#13](https://github.com/qodesmith/recap/issues/13)'s answer on progress chattiness.
>
> ### What stands regardless
>
> §4 (the playback cursor cannot be React state at ~60Hz — a fact about React's own source), the StrictMode
> double-subscribe leak and the optimistic-edit clobbering in §8, the `replaceEqualDeep` complexity analysis,
> the `streamedQuery` correction, §7 (Router), and §9 (Docker Desktop precedent). None of these depend on the
> backend architecture.
>
> ### Also note
>
> **Nothing here was benchmarked** — all performance claims are complexity read from source, not measured.
> See §8 for the full list of open holes.
>
> #5 is a `wayfinder:grilling` ticket: it resolves through conversation with the user, not by handing this
> document to an agent.

---

## 0. The short version

Your two-category model is right, but **category 2 splits in two**, and that split is the answer:

| Traffic | Example | Transport | Where it lands |
|---|---|---|---|
| Request/response | `list_recordings`, `rename_speaker` | `invoke` | TanStack Query cache |
| Ordered bulk stream | transcript segments arriving progressively | **Tauri Channel** | Query cache, batched |
| Coarse notification | track `pending → transcribing` | Tauri event | Query cache via `invalidateQueries` |
| Animation-rate signal | playback cursor at ~60 Hz | anything | **not React state at all** |

The fourth row is the finding that was not on the table when this research started. It is not a library choice —
it is a constraint that applies identically to Query, Jotai, Zustand, Valtio and Redux, for a reason in React's
own source. See §4.

---

## 1. Three independent sources converge on one rule

This is the strongest signal in the research, because the three lines of evidence are unrelated.

**Docker Desktop learned it empirically.** `client/docs/state-management/redux.md` has a section titled
*"When not to use Redux"*:

> it doesn't make sense to put all container logs into Redux, since they're very large and probably only used
> by one very specific part of the UI

Logs, stats time-series, build progress and terminal bytes were all kept **out** of the synced store. Logs went
to a bounded `shareReplay({ bufferSize: 10_000, refCount: true })` in the main process
(`packages/desktop/src/container-logs/container-logs.ts:94-97`), then into component `useState` via a single
`bufferTime(400)` producing **one** `setState` per 400 ms regardless of throughput
(`packages/desktop-ui/src/dashboard/logs/useAllLogs.ts:15-16, 182-186`). What Redux held about logs was a clear-cursor
timestamp and saved filter prefs — nothing more.

Image-pull progress is the sharpest example: the per-layer progress map stayed a main-process closure variable,
and a single aggregated `progression: number` crossed IPC
(`packages/desktop/src/main-process/ipc/image-pulling/manageImagePullIpcRequests.ts:189-192, 230-236`).

**Tauri's docs say it about transport.** From [calling-frontend](https://v2.tauri.app/develop/calling-frontend/):

> The event system is not designed for low latency or high throughput situations.

> Channels are designed to be fast and deliver ordered data.

**React's source says it about rendering.** `forceStoreRerender` schedules on `SyncLane` unconditionally; the
[RFC](https://github.com/reactjs/rfcs/blob/main/text/0214-use-sync-external-store.md) states *"Updates triggered by
a store change will always be synchronous, even when wrapped in startTransition."*

The rule all three arrive at: **high-frequency data does not belong in the shared cache.** Docker enforced it by
policy, Tauri by transport design, React by scheduler. The tiering decision is load-bearing; the library choice
is comparatively easy.

---

## 2. Transport: Channels vs events (Tauri)

Settled by primary source. Verbatim from [calling-frontend](https://v2.tauri.app/develop/calling-frontend/):

- events are *"not designed for low latency or high throughput situations"*
- event payloads are *"always JSON strings making them not suitable for bigger messages"*
- events *"directly evaluate JavaScript code"* under the hood
- *"if a listener is async and the event emitter sends multiple events in rapid succession, the listeners **may
  process events out of order**"*

Channels guarantee ordering, and not by convention — the JS class enforces it. From
[`packages/api/src/core.ts`](https://github.com/tauri-apps/tauri/blob/dev/packages/api/src/core.ts):

```ts
class Channel<T = unknown> {
  // the index is used as a mechanism to preserve message order
  #nextMessageIndex = 0
  #pendingMessages: Record<number, T> = {}
}
```

Out-of-order messages are parked and drained only when the index catches up. Termination is a distinct
`{ end: true, index }` message.

**Read against Recap:** segments arriving out of order would be a genuine correctness bug, not a cosmetic one.
Channels for segments and progress; events for coarse per-track transitions. Channels are also generic over
payload — `tauri::ipc::Channel<&[u8]>` is documented streaming 4096-byte chunks, which is the escape hatch if
waveform/PCM data ever needs to cross.

**Unmeasured:** Tauri quantifies none of this. "Not designed for high throughput" is qualitative; there is no
published events-vs-Channels benchmark and no stated payload ceiling. The direction is certain, the crossover
point is not.

---

## 3. TanStack Query over `invoke`

### It maps cleanly, as expected

Query requires the fn to *"throw or return a rejected Promise"*
([query-functions](https://tanstack.com/query/latest/docs/framework/react/guides/query-functions)); Tauri says
*"If the command returns an error, the promise will reject"*
([calling-rust](https://v2.tauri.app/develop/calling-rust/)). `queryFn: () => invoke('list_recordings')` is correct
with no wrapper. There is **no** first-party or community Query↔Tauri adapter, and none is needed.

### Three sharp edges

**`networkMode` will hang the app offline.** Query defaults to `networkMode: 'online'`, pausing queries when
`navigator.onLine` is false ([network-mode](https://tanstack.com/query/latest/docs/framework/react/guides/network-mode)).
For an app whose "network" is IPC, that means every query stalls on a plane. Set `networkMode: 'always'` globally.
Reconsider `retry: 3` too — retrying a deterministic local failure three times just delays the error.

**`invoke` has no `AbortSignal`.** Verified in source — the v2 options arg is `{ headers: HeadersInit }` only.
[tauri-apps/tauri#8351](https://github.com/tauri-apps/tauri/issues/8351) has been open since 2023-12-07.
Consequence: `cancelQueries` reverts cache state while the Rust command runs to completion. **Cancelling a
two-hour transcription (#7 Q3) requires a job id plus a separate `cancel_job` command flipping a
`CancellationToken` the Rust side polls.** A client-side decision imposing a Rust-side design constraint.

**Errors are not `Error` objects.** Tauri errors must `Serialize`, so a `Result<T, String>` rejects with a bare
string. `error.message` is `undefined`, and toast/ErrorBoundary code silently renders nothing. Normalize once at
the boundary.

### The cache-thrash worry is real, and it is O(N²)

This was the open question in the handoff. It is confirmed, with two independent multipliers.

**Structural sharing.** `setQueryData` → `Query.setData` → `replaceData` → `replaceEqualDeep`
([utils.ts](https://github.com/TanStack/query/blob/main/packages/query-core/src/utils.ts)), which walks the
*entire* new structure to maximize reference reuse. 5,000 segments × one write per segment = 5,000 full walks.

**Notification batching does not do what its name suggests.** From
[notifyManager.ts](https://github.com/TanStack/query/blob/main/packages/query-core/src/notifyManager.ts): outside a
transaction, `schedule` puts each callback in its own `setTimeout(..., 0)`. Real coalescing happens only inside
`notifyManager.batch()`. So N `setQueryData` calls from N separate event callbacks produce N separate macrotasks
and **N renders**. React 18 auto-batching cannot help — auto-batching merges updates within one task, and these are
deliberately in separate tasks.

Mitigations, in order of leverage:

1. **Batch in Rust.** Send ~50 segments per Channel message, not one. Worth more than all client-side tuning combined.
2. **Coalesce on arrival.** Buffer over an animation frame, apply one `setQueryData`. Docker's `bufferTime(400)`
   is the same move; 400 ms is a reasonable starting figure for progress, ~16 ms for anything visually tracked.
3. **Wrap multi-writes** in `notifyManager.batch()` — this is why it is exported.
4. **Split query keys** so segments live apart from recording metadata; patches then walk a smaller structure.
   Better than `structuralSharing: false`, which costs you reference stability for memoized rows.

### `streamedQuery` — exists, two priors were stale

Docs: [reference/streamedQuery](https://tanstack.com/query/latest/docs/reference/streamedQuery). Corrections
verified in source and changelog:

- The option is **`streamFn`**, not `queryFn` — renamed in 5.86.0 ([#9606](https://github.com/TanStack/query/pull/9606)).
- **`maxChunks` was removed** in 5.86.0, superseded by `reducer`/`initialValue`
  ([#9532](https://github.com/TanStack/query/pull/9532)).
- Still exported as `experimental_streamedQuery`; never renamed.

The state semantics are exactly Recap's requirement, natively — from the source JSDoc: *"The query will be in a
'pending' state until the first chunk of data is received, but will go to 'success' after that. The query will
stay in fetchStatus 'fetching' until the stream ends."* That is "a partially-transcribed Recording is a valid,
displayable state" as a library feature.

Two traps. Cancellation is **lazy**: the abort listener is registered only if your `streamFn` actually reads
`context.signal` (a getter). Never touch it and the stream runs to completion after unmount — deliberate, covered
by the test `should not abort when signal not consumed`, and undocumented on the reference page. And it calls
`setQueryData` **per chunk**, inheriting every cost above.

A hand-rolled Channel → coalesced-`setQueryData` bridge is ~40 lines with no experimental-API risk. Bridging a
Channel to `streamedQuery` needs a queue with a parked resolver anyway (a push callback cannot drive `for await`
directly), and backpressure is then unbounded with `maxChunks` gone.

---

## 4. The playback cursor is not a state-management problem

The most consequential finding, and it reframes part of the question.

Every candidate library — Query, Jotai, Zustand, Valtio, TanStack Store, Redux — subscribes through
`useSyncExternalStore`. React schedules those updates on `SyncLane` **unconditionally**
([RFC](https://github.com/reactjs/rfcs/blob/main/text/0214-use-sync-external-store.md)), and react.dev confirms:

> If the store is mutated during a non-blocking Transition update, React will fall back to performing that update
> as blocking.

So *"which state library handles 60 Hz best"* is a malformed question. The answer is the same for all of them.

`useDeferredValue` is **actively wrong** here. Per
[react.dev](https://react.dev/reference/react/useDeferredValue): *"if there's another update to the `value`, React
will restart the background re-render from scratch."* If ticks outpace the list render, the deferred render
restarts every tick and **may never commit while playback runs** — the highlight would freeze until pause. It is a
good fit for the *filter/search* path, not the cursor.

The working approach is to keep the cursor out of the render cycle entirely: a ref or vanilla emitter, writing a
CSS custom property on the list container each tick and letting CSS select the highlighted segment — or
imperatively toggling one class off the previous row and onto the current. Zero React renders per tick regardless
of list size.

**Flag honestly:** react.dev has no page endorsing this. The nearest guidance is permissive-but-hedged —
[manipulating-the-dom-with-refs](https://react.dev/learn/manipulating-the-dom-with-refs) says *"You can safely
modify parts of the DOM that React has **no reason** to update,"* and its named safe list is "focusing, scrolling,
measuring." Class toggling is not named. The pattern is structurally sound and universally used, but it should go
in an ADR as an inference, not a documented guarantee.

React 19.2's Performance Tracks (Scheduler track in Chrome DevTools) is the instrument for verifying the cursor
produces zero sync-lane renders.

---

## 5. Jotai for the push path

Relevant because it is the known-and-preferred option, and it does have a real answer for lists.

**Breadth is fine; depth is not.** Jotai's [performance guide](https://jotai.org/docs/guides/performance):
*"Breadth is essentially unlimited; only chain length matters."* Modeling a collection as a chain of derived atoms
throws `RangeError: Maximum call stack size exceeded`. The documented prescription for exactly this case:

> For a dynamic list whose items each need to be their own atom (for example, to render and update rows
> independently), reach for `splitAtom` rather than chaining.

**`atomFamily` is deprecated**, which changes the usual advice. Current
[family docs](https://jotai.org/docs/utilities/family) carry a `:::caution Deprecated` — removal in Jotai v3,
migrate to [`jotai-family`](https://github.com/jotaijs/jotai-family). Source emits a dev `console.warn`. The
migration target is at **34 stars** and hit 1.0.0 only in Dec 2025, so the blessed path is an early-adopter one.
`splitAtom` avoids the question.

Benchmark before committing: `splitAtom`'s mapping reuse does `prevMapping.keyList.indexOf(key)` per item — O(n²)
when the array identity is wholly new. Append-only growth is the good case; verify segment arrival hits it and pass
a stable `keyExtractor`.

**Jotai's own docs argue against granular atoms for fast-changing data:** *"an atom containing an object that
changes almost every second... may not be best suited to 'focus' on specific properties... anyway they will all
re-render at the same time."* Consistent with §4.

**`jotai-tanstack-query`: do not couple through it.** Last npm release 0.11.0 (2025-08-01), last commit 2026-02-17,
still 0.x, open issues including *"Using async derived atom from `atomWithSuspenseQuery` calls `queryFn`
infinitely"*. `@tanstack/react-query` itself is at 5.101.2 (2026-06-27) and shipping constantly. Use Query's own
hooks; use Jotai separately for client state.

Brief notes on the rest: **Zustand** is technically fine and its transient-update pattern is real, but the named
docs section was removed in the current restructure (404s; cite the
[v4.5.2 README](https://raw.githubusercontent.com/pmndrs/zustand/v4.5.2/readme.md) if it ever needs citing).
**Valtio** is genuinely good on large collections — *"cost... is based on the depth of your state tree... not the
breadth (1000s of books)"* — but its mutable-proxy model is a second paradigm alongside Jotai's.
**TanStack Store** is 0.x and describes itself as what *"powers the core of the TanStack ecosystem"*; you already
get it transitively via Query.

---

## 6. XState for track state: probably not

Tracks are literally a state machine, so this deserved a real look. The argument against is that the machine's
transitions are decided **in Rust**, and a mirrored machine inverts XState's value:

- **Guards fight you.** If Rust emits a state your client machine has no edge for, XState silently drops the
  event. The UI then disagrees with the backend and the bug is invisible. A plain `status` field matches by
  construction.
- **Two transition tables** to keep in lockstep, with nothing type-checking the correspondence.
- You would use `fromCallback` to pipe events in, then a transition table whose only job is to accept them.

If the machine should be formal, model it in Rust where it already lives and have the client render a
discriminated union. `tauri-specta` (868k downloads, the most-used crate in this space) generates TS types from
Rust types, which makes drift structurally impossible rather than merely discouraged — though note it has sat on
`2.0.0-rc.x` through rc.25.

`@xstate/store` (4.2.1, active, <1 kb) is a genuinely nice small event-driven store and the honest answer to "Redux
shape without RTK verbosity" — but it does nothing Jotai cannot, and adopting both means two models.

**No official Stately guidance exists on server-authoritative machines.** This verdict is reasoned from the
library's stated purpose, not from documentation either way.

---

## 7. TanStack Router interaction

Router is *"a perfect **coordinator** for external data fetching and caching libraries"*
([external-data-loading](https://tanstack.com/router/latest/docs/guide/external-data-loading)). The documented
pattern, comments included from the docs:

```tsx
// Use the `loader` option to ensure that the data is loaded
loader: () => queryClient.ensureQueryData(postsQueryOptions),
component: () => {
  // Read the data from the cache and subscribe to updates
  const { data } = useSuspenseQuery(postsQueryOptions)
}
```

The loader **ensures**; the component **subscribes**. `loader` → `useLoaderData` is a bad fit for push-updated
data — it returns a navigation-time snapshot, and your only recourse per event is `router.invalidate()`, which
reloads *every* active route's loader and cannot express "only this entity changed."

**`defaultPreloadStaleTime: 0` is required** if you preload — confirmed in three places including the canonical
[basic-react-query example](https://github.com/TanStack/router/blob/main/examples/react/basic-react-query/src/main.tsx).
Only the *preload* stale time needs changing; navigation `staleTime` already defaults to 0.

`@tanstack/react-router-ssr-query` is **irrelevant to Tauri** — its scope is SSR dehydration/hydration.

---

## 8. Open holes

**The mount/subscribe race is unsolved in any documentation.** `listen()` is a real async IPC round-trip — it
resolves only after Rust registers the listener and returns an `eventId`. Events emitted between snapshot-fetch
and listener-registration land nowhere, and you render a snapshot that is silently behind. Options, in order of
robustness:

1. Subscribe before fetching — inverts the race so you double-apply rather than miss. Safe if handlers are
   idempotent (patch by segment id, never append).
2. Monotonic sequence numbers; drop `seq <= lastApplied`, refetch on gap.
3. **Have the Rust command accept a Channel *and* return the snapshot**, so backend sends snapshot + deltas with
   no window at all. Strongest option, and the shape Channels are built for.

**StrictMode double-subscribe is a real leak, not an artifact.** The naive
`listen(...).then(fn => unlisten = fn)` + `return () => unlisten?.()` fires cleanup while `unlisten` is still
`undefined`, so listener #1 is never removed and #2 registers — **double-applied cache updates**. Needs a
`disposed` flag. Any unmount racing the promise hits this; StrictMode just makes it deterministic.

**Optimistic edits can be clobbered by events.** `cancelQueries` protects against in-flight *refetches* only. It
does nothing about a Tauri event arriving mid-edit and overwriting the optimistic value via `setQueryData`. The
handler needs to skip segments with a pending mutation, or the backend needs to echo an edit id to ignore. This is
the most likely source of "my edit flickered back" bugs.

**Conditional on other tickets.** The shape of the push stream is decided by
[#7](https://github.com/qodesmith/recap/issues/7) — in-process Rust vs sidecar changes whether a Channel is even
available on the hot path. Whether the thrash mitigations in §3 are needed at all depends on
[#13](https://github.com/qodesmith/recap/issues/13)'s answer on progress chattiness.

**Nothing here was benchmarked.** All performance claims are algorithmic complexity read from source, not
measurements. `replaceEqualDeep` walking the full structure and `notifyManager` scheduling per-transaction
macrotasks are facts; that they matter *at Recap's segment counts* is an inference to validate.

---

## 9. What Docker Desktop suggests carrying over

The full architecture reconstruction is beyond what Q2 needs, but several patterns generalize past Electron.
The cross-process trick itself does not — "same store on both sides" required both processes running JS.

- **Aggregate at the producer.** Fold in Rust, emit one scalar per tick. Every byte not sent is a serde cost and a
  render not paid for.
- **Cap everything, visibly.** `MAX_LOGS = 100_000`, `bufferSize: 10_000`, 1-hour stats window. Unbounded growth
  was treated as a bug class, not a tuning knob.
- **Gate subscriptions on demand,** and **emit current state on subscribe** — resubscription doubles as a refresh,
  which makes remount-after-navigation correct without a separate fetch path.
- **Filter redundant emissions at the source.** 114 uses of `distinctUntilChanged`, twice with comments naming a
  specific chatty endpoint. Recap's source is its own Rust code, so this is easier: use `PartialEq` and never emit
  the no-op.
- **One dead stream must not take down the others.** Their epic-level `catchError(() => NEVER)` deactivated one
  broken feature rather than killing all epics, plus a 2 s watchdog so silence was observable.
- **Write the "when not to use X" doc.** `docs/state-management/redux.md` is the highest-leverage artifact in that
  tree — it is why a codebase that size did not end up with 100k log lines in a synced store.

Strongest signal that the approach held: `packages/desktop-ui-2`, an active greenfield rewrite on React 19 +
TanStack Router + Vite + Tailwind, **drops RxJS and React Query but keeps the replica store verbatim**. Given a
clean slate, the sync mechanism survived.

And the trap: their action-forwarding channel has **no throttling at all**. That was safe only because the tiering
discipline kept hot data out. Port the plumbing without the policy and you get an unthrottled firehose across a
serde boundary.

---

## 10. Sources

Primary throughout: Tauri v2 docs and `tauri-apps/tauri` source; TanStack Query/Router docs, source and changelogs;
react.dev, `facebook/react` source and the `useSyncExternalStore` RFC; Jotai, Zustand and Valtio docs and source;
npm registry, crates.io and GitHub APIs for version/staleness data (checked 2026-07-20); and the `~/repos/pinata`
working tree with `path:line` citations.

Two claims lean on non-first-party sources and are labelled inline where used: TkDodo's
[WebSockets post](https://tkdodo.eu/blog/using-web-sockets-with-react-query) is maintainer guidance rather than API
reference, and the events-vs-Channels crossover point is directionally certain but unmeasured by anyone.
