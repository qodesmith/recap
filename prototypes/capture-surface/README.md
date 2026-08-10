# PROTOTYPE — the capture surface (issue #24)

Throwaway. Not production code. Exists to answer one question: **what does the
capture surface look like, where does it live, and what does it become once you
hit Start?**

```bash
cd prototypes/capture-surface
bun install
bun run dev
```

Four variants on one route, switchable with the floating bottom bar, `←`/`→`,
or `?variant=A|B|C|D`:

| | Where capture lives | What Start does | Meter |
|---|---|---|---|
| **A** | A dedicated route, from the sidebar | the page **transforms in place** | dBFS bar with the room-tone zone drawn in |
| **B** | A **modal sheet** over the library | dismisses; **Activity is the only live surface** | rolling ~12 s history — a flatline has a *shape* |
| **C** | A **permanent sidebar panel** | stays exactly where it is; nothing navigates | LED ladder; the bottom rungs are the room-tone rungs |
| **D** | **Fullscreen takeover** | stays fullscreen; Stop → #22's page | hero bar + numeric dBFS + a verdict in words |

The two questions are answered together on purpose — where it lives constrains
what Start can do, so a variant that mixed A's route with B's hand-off would be
a fifth variant, not a refinement.

## Settled by #23 — this is the content being laid out, not the question

Two source rows (both on, remembered) · mic device dropdown whose first entry is
`System default (…)`, a **rule not a device** · no picker for system audio ·
**live meters in setup *and* during capture** · nothing named at setup · Start is
immediate · sources fixed once running · **a capture never stops on its own** ·
one capture at a time, but capture-during-transcription is allowed · Stop →
`preparing` → #22's recording page.

## What to poke (yellow PROTOTYPE CONTROLS, bottom right)

**Set System audio to `Quiet room`, then to `Dead`.** That is the whole
question. #9 measured that a **denied audio tap returns pure silence, not an
error**, and macOS offers no preflight permission API — so the only thing
separating "granted, nobody is talking" from "silently denied and this
conversation is being lost" is whether the noise floor is moving. Every meter
here is drawn on a dB scale with the room-tone band marked, because a linear
meter puts both cases at the same place: zero.

- **Talking** includes genuine multi-second pauses (one pause in five runs 5–9 s).
  A "no signal" warning that fires during those has cried wolf — watch when each
  variant escalates.
- **Unplug it** — mid-capture this must fall back to the current default, **name
  the source, say what happened, and still be there when you look up**, with no
  modal (#23). At setup the same button gets you the pinned-but-missing case.
- **Sim speed** — leave at 1× to judge feel.
- **A transcription is running** — #13's Activity section, contending for the
  same sidebar space. Matters most in B, where Activity is carrying the capture.

## Questions to hold each variant against

1. Where does a `capturing` Recording show up — Activity, the library row, both?
2. Can you tell at a glance that one of two sources has gone flat?
3. If you navigate away mid-capture, what still tells you it's running?
4. #9 says granting the tap needs an **app relaunch**. What survives it — a
   route, a modal, a sidebar panel, a fullscreen mode?
5. Does Stop put you somewhere you wanted to be?

## Fidelity notes

`src/capture.ts` is a fake. Speech peaks (~−26 to −10 dBFS), room floor
(~−50 dBFS) and the −54 dBFS signal gate are **guessed** textbook numbers, not
Recap measurements — only the *shapes* are load-bearing (#9 measured that a
denied tap is digital zero). Meters are written straight to the DOM from one rAF
loop, never through React state — #5's cross-cutting inference applied to the
second push `Channel` #23 asked for; React re-renders here run at ~8 Hz.
