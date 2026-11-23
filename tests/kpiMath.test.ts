import { describe, expect, it } from "vitest";
import { aggregate, coverage, kpiAttainment, levelOf, statusOf, type Threshold } from "../backend/src/modules/kpi/measure.js";
import { completedPeriods, isPeriodStart, nextPeriodStart, periodEndOf, periodLabel, periodStartOf, periodStarts } from "../backend/src/modules/kpi/periods.js";

describe("measurement periods", () => {
  it("names every period by its first day and knows where it ends", () => {
    expect(periodStartOf("monthly", "2026-02-17")).toBe("2026-02-01");
    expect(periodEndOf("monthly", "2026-02-01")).toBe("2026-02-28");
    expect(periodEndOf("monthly", "2028-02-01")).toBe("2028-02-29"); // leap year
    expect(periodStartOf("quarterly", "2026-11-23")).toBe("2026-10-01");
    expect(periodEndOf("quarterly", "2026-10-01")).toBe("2026-12-31");
    expect(periodEndOf("quarterly", "2026-01-01")).toBe("2026-03-31");
    expect(periodStartOf("weekly", "2026-11-23")).toBe("2026-11-23"); // a Monday
    expect(periodStartOf("weekly", "2026-11-29")).toBe("2026-11-23"); // the Sunday after
    expect(periodEndOf("weekly", "2026-11-23")).toBe("2026-11-29");
    expect(periodStartOf("annual", "2026-07-04")).toBe("2026-01-01");
    expect(periodEndOf("annual", "2026-01-01")).toBe("2026-12-31");
    expect(periodEndOf("daily", "2026-05-05")).toBe("2026-05-05");
  });
  it("accepts only real period starts and steps from one to the next across year ends", () => {
    expect(isPeriodStart("monthly", "2026-03-01")).toBe(true);
    expect(isPeriodStart("monthly", "2026-03-02")).toBe(false);
    expect(isPeriodStart("weekly", "2026-11-24")).toBe(false);
    expect(isPeriodStart("quarterly", "2026-02-01")).toBe(false);
    expect(nextPeriodStart("monthly", "2026-12-01")).toBe("2027-01-01");
    expect(nextPeriodStart("quarterly", "2026-10-01")).toBe("2027-01-01");
    expect(nextPeriodStart("weekly", "2026-12-28")).toBe("2027-01-04");
  });
  it("lists the periods in a range, and the last completed periods before today", () => {
    expect(periodStarts("monthly", "2026-01-15", "2026-04-02")).toEqual(["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"]);
    expect(completedPeriods("monthly", "2026-11-23", 3)).toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]); // November is still open
    expect(completedPeriods("monthly", "2026-11-01", 2)).toEqual(["2026-09-01", "2026-10-01"]);
    expect(completedPeriods("quarterly", "2026-11-23", 2)).toEqual(["2026-04-01", "2026-07-01"]);
    expect(completedPeriods("monthly", "2026-11-23", 6, "2026-09-10")).toEqual(["2026-09-01", "2026-10-01"]); // nothing before the start date counts as missing
    expect(periodLabel("monthly", "2026-03-01")).toBe("Mar 2026");
    expect(periodLabel("quarterly", "2026-10-01")).toBe("Q4 2026");
  });
});

describe("KPI maths (golden values)", () => {
  it("aggregates several values, and nothing is no data (not zero)", () => {
    expect(aggregate([], "sum")).toBeNull();
    expect(aggregate([4, 6, 2], "sum")).toBe(12);
    expect(aggregate([4, 6, 2], "avg")).toBe(4);
    expect(aggregate([4, 6, 2], "last")).toBe(2);
    expect(aggregate([4, 6, 2], "min")).toBe(2);
    expect(aggregate([4, 6, 2], "max")).toBe(6);
  });
  it("attainment by direction, capped, with the range rule", () => {
    expect(kpiAttainment("higher_is_better", 30, 40, null)).toBe(0.75);
    expect(kpiAttainment("higher_is_better", 60, 40, null)).toBe(1); // no credit above the cap
    expect(kpiAttainment("higher_is_better", 60, 40, null, 1.2)).toBe(1.2);
    expect(kpiAttainment("higher_is_better", 0, 40, null)).toBe(0);
    expect(kpiAttainment("higher_is_better", -5, 40, null)).toBe(0);
    expect(kpiAttainment("lower_is_better", 8, 4, null)).toBe(0.5);
    expect(kpiAttainment("lower_is_better", 2, 4, null)).toBe(1);
    expect(kpiAttainment("lower_is_better", 0, 4, null)).toBe(1);
    expect(kpiAttainment("target_range", 75, 70, 85)).toBe(1);
    expect(kpiAttainment("target_range", 62.5, 70, 85)).toBeCloseTo(0.5);
    expect(kpiAttainment("target_range", 100, 70, 85)).toBe(0);
    expect(kpiAttainment("higher_is_better", null, 40, null)).toBeNull();
    expect(kpiAttainment("higher_is_better", 3, null, null)).toBeNull();
    expect(kpiAttainment("higher_is_better", 3, 0, null)).toBeNull();
    expect(kpiAttainment("target_range", 3, 70, null)).toBeNull();
  });
  const th: Threshold[] = [
    { level: "warning", comparator: "lt", basis: "percent_of_target", value: 80 },
    { level: "critical", comparator: "lt", basis: "percent_of_target", value: 50 },
    { level: "excellent", comparator: "gte", basis: "percent_of_target", value: 110 },
  ];
  it("a value reaches the most serious level it matches; thresholds as % of target need a target", () => {
    expect(levelOf(18, 40, th)).toBe("critical"); // 45%
    expect(levelOf(30, 40, th)).toBe("warning"); // 75%
    expect(levelOf(36, 40, th)).toBeNull(); // 90%
    expect(levelOf(44, 40, th)).toBe("excellent"); // 110% exactly
    expect(levelOf(10, null, th)).toBeNull(); // cannot be evaluated: not guessed
    expect(levelOf(null, 40, th)).toBeNull();
    expect(levelOf(7, 40, [{ level: "critical", comparator: "gt", basis: "absolute", value: 5 }])).toBe("critical");
    expect(statusOf(null, 40, th)).toBe("no_data");
    expect(statusOf(36, 40, th)).toBe("ok");
    expect(statusOf(44, 40, th)).toBe("excellent");
  });
  it("coverage is the share of expected periods with a value", () => {
    expect(coverage(2, 3)).toBeCloseTo(0.667, 2);
    expect(coverage(0, 3)).toBe(0);
    expect(coverage(0, 0)).toBeNull();
    expect(coverage(5, 3)).toBe(1);
  });
});
