# Frontend adversarial review — 2026-10-10

Reviewed the existing uncommitted frontend state refactor and recent desktop and
mobile frontend work. Existing edits were preserved. This report records the
additional findings and fixes from this pass; the earlier state review remains
in [frontend-state-2026-10.md](frontend-state-2026-10.md).

## Fixed findings

### High: desktop writes and closes did not share save ownership

Two `flushTab` calls could send overlapping writes. A tab close could finish after
the first save while newer keystrokes remained dirty, losing those edits.
`closeTab` also retained its array index across an await: closing another tab
shifted the index and made the first close miss its target or remove a sibling.

Saves now coalesce per tab object and drain newer edits before resolving. Closing
rechecks object identity and its current index. A failed save retains the tab and
can be retried. Regression tests reproduce overlapping saves, typing during a
close, and array shifts while saving.

### High: a desktop open could survive a workspace reset

An `openFile` waiting for the active tab's save could resume after `reset`, create
its requested tab, and resolve its relative path against the next workspace.
Navigation requests now invalidate obsolete opens, activation and restoration.
A regression reproduces the old behavior and verifies that reset cancels it.

### High: desktop reloads could overwrite newer buffers

External reads looked up the tab by path after awaiting. Closing and reopening
the same path let an old read overwrite the replacement tab. Two external reads
could also finish in reverse order. Explicit Reload discarded typing received
while its disk read was pending.

All tab reads now share lifetime, path and request checks; saves invalidate old
disk snapshots. Explicit Reload waits for a pending save and checks the buffer
again before applying its result. These cases have regression coverage.

### High: mobile failed switches mixed document identities

`loadFile` changed `relPath` before reading its contents. On a failed read, the
old text remained under the requested filename, so subsequent typing could save
the wrong buffer into that file. The new identity now commits only on success;
the previous saved text remains available if the editor host remounts after an
error. Closing tabs likewise commits only after the save and replacement load
succeed. Failed saves retain the active tab and its descriptors.

### High: mobile disk conflicts did not actually wait for the user

Autosave overwrote the external file and dismissed the conflict warning before
the user selected Keep mine or Reload. Reload also cleared the dirty flag before
reading, so a read failure left unsaved text classified as clean.

Conflicts now block writes until explicitly resolved. Keep mine saves the
retained buffer; Reload waits for any dispatched write and only clears dirty
state after a successful read. Failed reloads and edits during reads retain the
buffer. Regression tests cover conflict resolution, failed reloads and failed
tab closes.

### High: mobile export could use stale content or ignore preparation errors

Export checked freshness before flushing, skipped dirty text when the previous
compile was fresh, ignored save/compile transport errors, and set its busy flag
after its first await. Repeated clicks could start concurrent exports. Workspace
copy also continued after a failed save.

Document export now saves first, checks every preparation result, captures the
chosen options, and sets busy state synchronously. Preparation checks ownership
before proceeding; callbacks cannot dismiss an unrelated overlay. The four
format handlers share one result path, and action flags reset in `finally`.
Workspace copy stops on save errors or a workspace switch. HTML retains its
independent backend compile path. Diagnostic failures may still use the last
successful paged build, matching the existing warning in the UI.

### Medium: mobile save acknowledgments did not invalidate old compiles

A compile started before a disk write could later mark the changed document
fresh. `onSaved` now invalidates pending compile responses. A regression verifies
that the old result cannot clear staleness, and export preparation tests cover
save errors, transport errors, cancellation and absent compiled pages.

### Medium: desktop startup listeners had no usable cleanup

The root used an async `onMount`, retained no native listener disposers and
awaited the font listener before registering the other subscriptions. Snippet
sync maintained another registration without teardown.

The root now returns synchronous cleanup and owns all six subscriptions through
one listener scope. Late registrations dispose themselves, and callbacks cannot
run after teardown. Snippet sync uses the same owner. Lifetime tests verify late
registration and idempotent disposal.

### Medium: a delayed mobile preview tap could navigate after closing

Clearing the double-tap timer did not cancel a lookup once its callback was
already awaiting IPC. A late result could open a source file or URL after the
overlay closed or a different document appeared.

Tap responses now check request identity, visibility, workspace version and
compile generation. Teardown cancels timers, and source jumps recheck ownership
after waiting for history traversal. This component fix has compiler/autofixer
validation; native touch interaction was not exercised.

## Validation and limits

- Desktop: 466 existing tests and 21 state regressions pass.
- Mobile: 86 existing tests and 42 state/lifecycle regressions pass.
- Added 22 regressions to the existing state test harness in this pass.
- Both apps pass `bun run check` with zero errors and zero warnings.
- Both frontend production builds pass; existing CSS, unused import, barrel and
  bundle-size notices remain.
- Edited components were analyzed with the Svelte autofixer. Its remaining
  suggestions concern intentional DOM/event synchronization effects.
- `git diff --check` passes.

Store tests mock Tauri and compile real rune modules. They establish frontend
ownership and ordering, not native IPC scheduling or filesystem atomicity. No
Tauri shell or Android interaction testing was performed. Native QA should cover
disk conflicts, failed saves, rapid workspace switches, repeated export/share
clicks, closing preview during a tap lookup, and remounting while subscriptions
register. Projector focus/fullscreen, Android IME and SAF behavior still require
their native environments.
