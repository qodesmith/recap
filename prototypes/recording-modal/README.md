# PROTOTYPE — the recording modal (#25)

> Throwaway. Nothing here is production code, nothing touches real hardware, and
> the whole simulated world is in `src/capture.ts` (lifted from the #24
> prototype, which is where the meter signal modes and device-loss fake come
> from).

```bash
bun install
bun run dev     # http://localhost:5173/?variant=A
```

`←` / `→` or the floating bar switch variants. The amber panel is prototype
chrome: signal modes per source, sim speed, device unplug, the #13 transcription
toggle, the `capturing`-row toggle, and a live state readout.

## What is and isn't a variant

#25 says this is **not** a pick-one-of-four. There is **one** design, and the
switcher swaps **only the confirmation**, which is the single sub-question the
ticket says is genuinely open:

| | | |
|---|---|---|
| **A** | Confirm **in place** — the footer stops being a Stop button and becomes the question | ✅ **chosen** |
| **B** | Confirm **stacked** — a second modal over the first | rejected |
| **C** | Confirm **as a sheet** — slides up over the footer | rejected |

Everything else — layout, meters, timer, notice, transcription strip — is
identical across all three on purpose, so the comparison is about shape. B and C
are kept in the branch as the primary source for the decision.

## What to try

1. **Watch it at 1×** for 15 s at setup. The history needs ~12 s to fill.
2. **Press Start.** Ask whether the surface changed the right amount.
3. **Press Esc, then `×`.** Flip A/B/C on the confirmation.
4. **Click the dimmed backdrop** while recording. That is the thesis, felt.
5. **Set a source to Dead** and wait 8 s — at setup and mid-capture. Different
   treatment on purpose.
6. **Unplug the mic** mid-capture (#23: it never stops on its own).
7. **Discard** something 20 s old and ask whether it was too easy, or too hard.

## The design, and what each choice is answering

### The modal *is* record mode — and the backdrop says so out loud

Start leaves the modal exactly where it is. Clicking the backdrop does **not**
open the confirmation — a backdrop click is the most accidental gesture there
is — it **refuses visibly**: the modal shakes, and that is the entire response.
Nothing else on the surface changes, because a click out there was never a
request for anything. A modal that silently eats clicks reads as broken; one
that shrugs reads as deliberate.

### What Start changes: the controls go, the readings stay

The source rows are the **same component** before and after Start. The meter is
in the same place, at the same size, on the same axis — so the reading you did
at setup is the reading you keep doing, and nothing asks you to re-orient at the
exact moment a conversation started.

What changes is small and all in one direction: the toggles and the device
dropdown are **removed, not disabled** (a greyed control is a control that lies
about being reachable), a disabled source's row disappears entirely, the device
name becomes a **fact** rather than a picker, and the modal gains a red rail, a
red ring, a pulsing dot and the timer.

### The timer sits top-right, and it is the biggest thing in the modal

Four moving meters plus a clock was the ticket's worry. The clock is the only
number on the surface that is **not about a source**, and the header is the only
region that is not about a source either — so they belong together, above the
rows rather than among them.

### The meter: two stacked readings (`split` — the chosen shape)

#24 ordered both of A's instantaneous dBFS bar and B's rolling ~12 s history.
Each source shows the **history on top** and a **horizontal dB bar directly
underneath it**. Two readings, two axes, stacked: the history answers *what has
been arriving*, the bar answers *what is arriving now*.

A `unified` alternative was built and **rejected**: it folded both onto one
vertical dB axis (history left, "now" as a column continuing the same axis at
the right-hand end) to reduce four moving things to two. It's still behind the
knob as the primary source for that call.

Both shapes draw the room-tone band, and both draw the region below the signal
gate as a *darker* zone — #9's finding is that a silently-denied tap is not
quiet, it is **nothing**, and a meter without that distinction puts "quiet room"
and "denied" in the same place. The history carries a labelled axis
(`0` / `-24` / `room` / `-60`).

### The device-fallback notice sits under the header, not at the bottom

#23 put it in the sidebar Activity row; #24 put the sidebar out of reach. It
lives directly under the header and **above** the sources, because it is a
statement about a source you are about to read the meter of. **Nothing in this
modal scrolls**, so "does it survive being scrolled past" is answered by
construction. The affected row's device line also updates live — unplug the mic
and it reads `AirPods Pro` mid-capture.

### Discard: one confirm, priced in seconds

Three outcomes, one destructive:

- **Keep recording** takes the focus, because the most likely reason you are
  looking at this is that you hit Esc without meaning to.
- **Stop** reads as primary — it is the expected action.
- **Discard** is quiet, far from Cancel, and states its cost in the only unit the
  user has: *"throws away 0:32 · can't be undone"*.

**No second confirm.** #25 names that as the failure mode, and a confirmation
that has to be confirmed is an admission the first one didn't say enough. The
cost is in the label instead of in a second dialog.

**Discard closes the modal**, silently, and the row it created at Start
disappears from the library. Landing back on setup would have implied "now start
over" — a suggestion the app has no business making about a recording you just
threw away. Stop hands off to #22's page; Discard hands off to nothing.

### #13's transcription keeps running, and says so

A modal blocks *interaction*, not background work — so #13's rule is not
narrowed. But the Activity section is unreachable, and silently unreachable
progress is the one thing this app has said it will never do. One read-only line
at the bottom of the modal: it is running, here is how far, you get it back when
you stop. (In variant C the sheet covers it — a real cost of that shape.)

### #9's relaunch is offered only at setup

A denied tap is silence with no error and no preflight API, and granting it needs
a **relaunch** — which destroys a modal. So the affordance that causes one
("Open Privacy settings" / "Restart Recap") appears **only before Start**, when
losing the modal costs nothing, and never during a capture. Mid-capture a dead
source is reported, but nothing offers to restart the app.

### The backdrop shows no `capturing` row at all

The bundle exists from Start (#23), but the library is behind a modal for the
whole capture, so a row there is drawn where nobody is looking. The list's job
is to be **correct the moment the modal goes away** — the Recording appears when
it lands, as `preparing`.

**There is no capture row in the Activity sidebar either, ever** — you can never
be looking at the sidebar while a capture runs, so it would be unreachable UI.
That retires #23's "the Activity row names the source and says what happened".

## Settled

1. **Meter** — split, history above a horizontal dB bar. Unified rejected.
2. **Confirmation** — A, in place. No new layer.
3. **Discard** — one confirm, cost in the label, no acknowledgement, closes the
   modal.
4. **No `capturing` row** behind the modal, or anywhere else.
5. **Backdrop click** — shake, and nothing else.
