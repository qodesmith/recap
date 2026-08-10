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

| | |
|---|---|
| **A** | Confirm **in place** — the footer stops being a Stop button and becomes the question |
| **B** | Confirm **stacked** — a second modal over the first |
| **C** | Confirm **as a sheet** — slides up over the footer, meters stay visible |

Everything else — layout, meters, timer, notice, transcription strip — is
identical across all three on purpose, so the comparison is about shape.

There is one extra knob that is **not** a variant: **meter shape**
(unified/split). See below.

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
is — it **refuses visibly**: the modal shakes and the subtitle changes to
"Recap is recording — stop before you do anything else." A modal that silently
eats clicks reads as broken; one that answers reads as deliberate.

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

### The meter: two readings, one dB axis (`unified`, the proposal)

#24 ordered both of A's instantaneous dBFS bar and B's rolling ~12 s history.
Taken literally that is four moving things for two sources.

The proposal collapses them into **one widget with one vertical dB axis**: the
history is the left ~94 %, time running left→right, and the instantaneous bar is
a column at the right-hand end of the *same* axis — "now", continuing the line.
The room-tone band is a horizontal band across both, so it is marked once and
means the same thing in both readings. Two widgets, not four.

The `split` knob draws #24's two meters as literally described. **Flip between
them** — if unified isn't better, it should lose here.

Either way the axis is labelled (`0` / `-24` / `room` / `-60`) and the region
below the signal gate is drawn as a *darker* zone, because #9's finding is that
a silently-denied tap is not quiet — it is **nothing**, and a linear meter puts
"quiet room" and "denied" in the same place.

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

Discard returns you to **setup** with the modal still open, and the row it
created at Start disappears from the library.

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

### The backdrop renders the `capturing` row, but not live

The Recording exists from Start (#23's bundle-at-Start), so the row exists. It
carries a static "Recording" chip — **no ticking clock, no pulsing dot**. A
second clock behind frosted glass is a duplicate you can't read. Toggle it off
in the knobs and judge whether it earns its place at all.

**There is no capture row in the Activity sidebar, ever** — you can never be
looking at the sidebar while a capture runs, so it would be unreachable UI. That
retires #23's "the Activity row names the source and says what happened".

## Open — react to these

1. **Unified vs split meter.** The one place the design overrides #24's literal
   instruction.
2. **Which confirmation.** A / B / C.
3. **Does Discard need more friction, or less?** It is currently one click from
   the confirmation, with the cost in the label.
4. **Should Discard acknowledge itself?** Right now it is silent — you just land
   back on setup. Nothing says "0:20 discarded".
5. **Is the `capturing` row behind the modal worth rendering?**
6. **Is the backdrop shake right, or should a backdrop click open the
   confirmation like Esc does?**
