import { describe, it, expect } from "vitest";
import { nextMinuteUTC, toZone } from "../utils/time";
import { DateTime } from "luxon";

describe("time utils", () => {
  it("nextMinuteUTC returns a date aligned to minute", () => {
    const d = nextMinuteUTC();
    const dt = DateTime.fromJSDate(d).toUTC();
    expect(dt.second).toBe(0);
    expect(dt.millisecond).toBe(0);
  });

  it("toZone converts to given zone", () => {
    const now = new Date();
    const zoned = toZone(now, "Europe/Berlin");
    expect(zoned.zoneName).toBe("Europe/Berlin");
  });
});
