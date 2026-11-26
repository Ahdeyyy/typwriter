import { describe, expect, it } from "bun:test";
import {
  HIDE_AFTER_PX,
  SHOW_AFTER_PX,
  TOP_ZONE_PX,
  initialScrollHide,
  nextScrollHide,
  syncScrollHide,
  type ScrollHideState,
} from "./immersive-logic";

const scrollThrough = (state: ScrollHideState, tops: number[]) =>
  tops.reduce((s, top) => nextScrollHide(s, top), state);

describe("nextScrollHide", () => {
  it("hides after scrolling down past the threshold", () => {
    const start = initialScrollHide(200);
    expect(nextScrollHide(start, 200 + HIDE_AFTER_PX - 1).hidden).toBe(false);
    expect(scrollThrough(start, [210, 200 + HIDE_AFTER_PX]).hidden).toBe(true);
  });

  it("never hides inside the top zone", () => {
    const s = scrollThrough(initialScrollHide(), [10, 20, TOP_ZONE_PX]);
    expect(s.hidden).toBe(false);
  });

  it("shows again after a slight upward scroll", () => {
    const hidden = scrollThrough(initialScrollHide(300), [400]);
    expect(hidden.hidden).toBe(true);
    expect(nextScrollHide(hidden, 400 - SHOW_AFTER_PX + 1).hidden).toBe(true);
    expect(nextScrollHide(hidden, 400 - SHOW_AFTER_PX).hidden).toBe(false);
  });

  it("restarts the count when the direction flips", () => {
    // Down 20 (not enough), up 5, down 20: neither leg alone reaches the
    // threshold, so the jitter of a hesitant drag doesn't hide anything.
    const s = scrollThrough(initialScrollHide(300), [320, 315, 335]);
    expect(s.hidden).toBe(false);
  });

  it("reveals when scrolled back to the top", () => {
    const hidden = scrollThrough(initialScrollHide(300), [500]);
    expect(nextScrollHide(hidden, 0).hidden).toBe(false);
  });

  it("ignores a bounce past the end", () => {
    const hidden = scrollThrough(initialScrollHide(300), [1000]);
    // Bounced 40px past maxTop and back: no upward travel counted.
    const s = scrollThrough(hidden, [1000]);
    expect(nextScrollHide(s, 1040, 1000).hidden).toBe(true);
    expect(nextScrollHide(nextScrollHide(s, 1040, 1000), 1000, 1000).hidden).toBe(true);
  });
});

describe("syncScrollHide", () => {
  it("never hides on a programmatic scroll and drops pending travel", () => {
    const partial = nextScrollHide(initialScrollHide(300), 320);
    const synced = syncScrollHide(partial, 900);
    expect(synced.hidden).toBe(false);
    expect(synced.travel).toBe(0);
    // The next real gesture starts from zero, not from the inherited 20px.
    expect(nextScrollHide(synced, 910).hidden).toBe(false);
  });

  it("keeps hidden chrome hidden, except at the top", () => {
    const hidden = scrollThrough(initialScrollHide(300), [400]);
    expect(syncScrollHide(hidden, 800).hidden).toBe(true);
    expect(syncScrollHide(hidden, 0).hidden).toBe(false);
  });
});
