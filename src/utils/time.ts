import { DateTime } from "luxon";

export function toZone(date: Date, zone: string) {
  return DateTime.fromJSDate(date).setZone(zone);
}

export function nextMinuteUTC(): Date {
  const dt = DateTime.utc()
    .plus({ minutes: 1 })
    .set({ second: 0, millisecond: 0 });
  return dt.toJSDate();
}
