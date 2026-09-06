var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => TaskManagerPlugin
});
module.exports = __toCommonJS(main_exports);

// src/task-mode.ts
var import_obsidian6 = require("obsidian");

// node_modules/chrono-node/dist/esm/types.js
var Meridiem;
(function(Meridiem2) {
  Meridiem2[Meridiem2["AM"] = 0] = "AM";
  Meridiem2[Meridiem2["PM"] = 1] = "PM";
})(Meridiem || (Meridiem = {}));
var Weekday;
(function(Weekday2) {
  Weekday2[Weekday2["SUNDAY"] = 0] = "SUNDAY";
  Weekday2[Weekday2["MONDAY"] = 1] = "MONDAY";
  Weekday2[Weekday2["TUESDAY"] = 2] = "TUESDAY";
  Weekday2[Weekday2["WEDNESDAY"] = 3] = "WEDNESDAY";
  Weekday2[Weekday2["THURSDAY"] = 4] = "THURSDAY";
  Weekday2[Weekday2["FRIDAY"] = 5] = "FRIDAY";
  Weekday2[Weekday2["SATURDAY"] = 6] = "SATURDAY";
})(Weekday || (Weekday = {}));
var Month;
(function(Month2) {
  Month2[Month2["JANUARY"] = 1] = "JANUARY";
  Month2[Month2["FEBRUARY"] = 2] = "FEBRUARY";
  Month2[Month2["MARCH"] = 3] = "MARCH";
  Month2[Month2["APRIL"] = 4] = "APRIL";
  Month2[Month2["MAY"] = 5] = "MAY";
  Month2[Month2["JUNE"] = 6] = "JUNE";
  Month2[Month2["JULY"] = 7] = "JULY";
  Month2[Month2["AUGUST"] = 8] = "AUGUST";
  Month2[Month2["SEPTEMBER"] = 9] = "SEPTEMBER";
  Month2[Month2["OCTOBER"] = 10] = "OCTOBER";
  Month2[Month2["NOVEMBER"] = 11] = "NOVEMBER";
  Month2[Month2["DECEMBER"] = 12] = "DECEMBER";
})(Month || (Month = {}));

// node_modules/chrono-node/dist/esm/utils/dates.js
function assignSimilarDate(component, target) {
  component.assign("day", target.getDate());
  component.assign("month", target.getMonth() + 1);
  component.assign("year", target.getFullYear());
}
function assignSimilarTime(component, target) {
  component.assign("hour", target.getHours());
  component.assign("minute", target.getMinutes());
  component.assign("second", target.getSeconds());
  component.assign("millisecond", target.getMilliseconds());
  component.assign("meridiem", target.getHours() < 12 ? Meridiem.AM : Meridiem.PM);
}
function implySimilarDate(component, target) {
  component.imply("day", target.getDate());
  component.imply("month", target.getMonth() + 1);
  component.imply("year", target.getFullYear());
}
function implySimilarTime(component, target) {
  component.imply("hour", target.getHours());
  component.imply("minute", target.getMinutes());
  component.imply("second", target.getSeconds());
  component.imply("millisecond", target.getMilliseconds());
  component.imply("meridiem", target.getHours() < 12 ? Meridiem.AM : Meridiem.PM);
}

// node_modules/chrono-node/dist/esm/timezone.js
var TIMEZONE_ABBR_MAP = {
  ACDT: 630,
  ACST: 570,
  ADT: -180,
  AEDT: 660,
  AEST: 600,
  AFT: 270,
  AKDT: -480,
  AKST: -540,
  ALMT: 360,
  AMST: -180,
  AMT: -240,
  ANAST: 720,
  ANAT: 720,
  AQTT: 300,
  ART: -180,
  AST: -240,
  AWDT: 540,
  AWST: 480,
  AZOST: 0,
  AZOT: -60,
  AZST: 300,
  AZT: 240,
  BNT: 480,
  BOT: -240,
  BRST: -120,
  BRT: -180,
  BST: 60,
  BTT: 360,
  CAST: 480,
  CAT: 120,
  CCT: 390,
  CDT: -300,
  CEST: 120,
  CET: {
    timezoneOffsetDuringDst: 2 * 60,
    timezoneOffsetNonDst: 60,
    dstStart: (year) => getLastWeekdayOfMonth(year, Month.MARCH, Weekday.SUNDAY, 2),
    dstEnd: (year) => getLastWeekdayOfMonth(year, Month.OCTOBER, Weekday.SUNDAY, 3)
  },
  CHADT: 825,
  CHAST: 765,
  CKT: -600,
  CLST: -180,
  CLT: -240,
  COT: -300,
  CST: -360,
  CT: {
    timezoneOffsetDuringDst: -5 * 60,
    timezoneOffsetNonDst: -6 * 60,
    dstStart: (year) => getNthWeekdayOfMonth(year, Month.MARCH, Weekday.SUNDAY, 2, 2),
    dstEnd: (year) => getNthWeekdayOfMonth(year, Month.NOVEMBER, Weekday.SUNDAY, 1, 2)
  },
  CVT: -60,
  CXT: 420,
  ChST: 600,
  DAVT: 420,
  EASST: -300,
  EAST: -360,
  EAT: 180,
  ECT: -300,
  EDT: -240,
  EEST: 180,
  EET: 120,
  EGST: 0,
  EGT: -60,
  EST: -300,
  ET: {
    timezoneOffsetDuringDst: -4 * 60,
    timezoneOffsetNonDst: -5 * 60,
    dstStart: (year) => getNthWeekdayOfMonth(year, Month.MARCH, Weekday.SUNDAY, 2, 2),
    dstEnd: (year) => getNthWeekdayOfMonth(year, Month.NOVEMBER, Weekday.SUNDAY, 1, 2)
  },
  FJST: 780,
  FJT: 720,
  FKST: -180,
  FKT: -240,
  FNT: -120,
  GALT: -360,
  GAMT: -540,
  GET: 240,
  GFT: -180,
  GILT: 720,
  GMT: 0,
  GST: 240,
  GYT: -240,
  HAA: -180,
  HAC: -300,
  HADT: -540,
  HAE: -240,
  HAP: -420,
  HAR: -360,
  HAST: -600,
  HAT: -90,
  HAY: -480,
  HKT: 480,
  HLV: -210,
  HNA: -240,
  HNC: -360,
  HNE: -300,
  HNP: -480,
  HNR: -420,
  HNT: -150,
  HNY: -540,
  HOVT: 420,
  ICT: 420,
  IDT: 180,
  IOT: 360,
  IRDT: 270,
  IRKST: 540,
  IRKT: 540,
  IRST: 210,
  IST: 330,
  JST: 540,
  KGT: 360,
  KRAST: 480,
  KRAT: 480,
  KST: 540,
  KUYT: 240,
  LHDT: 660,
  LHST: 630,
  LINT: 840,
  MAGST: 720,
  MAGT: 720,
  MART: -510,
  MAWT: 300,
  MDT: -360,
  MESZ: 120,
  MEZ: 60,
  MHT: 720,
  MMT: 390,
  MSD: 240,
  MSK: 180,
  MST: -420,
  MT: {
    timezoneOffsetDuringDst: -6 * 60,
    timezoneOffsetNonDst: -7 * 60,
    dstStart: (year) => getNthWeekdayOfMonth(year, Month.MARCH, Weekday.SUNDAY, 2, 2),
    dstEnd: (year) => getNthWeekdayOfMonth(year, Month.NOVEMBER, Weekday.SUNDAY, 1, 2)
  },
  MUT: 240,
  MVT: 300,
  MYT: 480,
  NCT: 660,
  NDT: -90,
  NFT: 690,
  NOVST: 420,
  NOVT: 360,
  NPT: 345,
  NST: -150,
  NUT: -660,
  NZDT: 780,
  NZST: 720,
  OMSST: 420,
  OMST: 420,
  PDT: -420,
  PET: -300,
  PETST: 720,
  PETT: 720,
  PGT: 600,
  PHOT: 780,
  PHT: 480,
  PKT: 300,
  PMDT: -120,
  PMST: -180,
  PONT: 660,
  PST: -480,
  PT: {
    timezoneOffsetDuringDst: -7 * 60,
    timezoneOffsetNonDst: -8 * 60,
    dstStart: (year) => getNthWeekdayOfMonth(year, Month.MARCH, Weekday.SUNDAY, 2, 2),
    dstEnd: (year) => getNthWeekdayOfMonth(year, Month.NOVEMBER, Weekday.SUNDAY, 1, 2)
  },
  PWT: 540,
  PYST: -180,
  PYT: -240,
  RET: 240,
  SAMT: 240,
  SAST: 120,
  SBT: 660,
  SCT: 240,
  SGT: 480,
  SRT: -180,
  SST: -660,
  TAHT: -600,
  TFT: 300,
  TJT: 300,
  TKT: 780,
  TLT: 540,
  TMT: 300,
  TVT: 720,
  ULAT: 480,
  UTC: 0,
  UYST: -120,
  UYT: -180,
  UZT: 300,
  VET: -210,
  VLAST: 660,
  VLAT: 660,
  VUT: 660,
  WAST: 120,
  WAT: 60,
  WEST: 60,
  WESZ: 60,
  WET: 0,
  WEZ: 0,
  WFT: 720,
  WGST: -120,
  WGT: -180,
  WIB: 420,
  WIT: 540,
  WITA: 480,
  WST: 780,
  WT: 0,
  YAKST: 600,
  YAKT: 600,
  YAPT: 600,
  YEKST: 360,
  YEKT: 360
};
function getNthWeekdayOfMonth(year, month, weekday, n, hour = 0) {
  let dayOfMonth = 0;
  let i = 0;
  while (i < n) {
    dayOfMonth++;
    const date = new Date(year, month - 1, dayOfMonth);
    if (date.getDay() === weekday)
      i++;
  }
  return new Date(year, month - 1, dayOfMonth, hour);
}
function getLastWeekdayOfMonth(year, month, weekday, hour = 0) {
  const oneIndexedWeekday = weekday === 0 ? 7 : weekday;
  const date = new Date(year, month - 1 + 1, 1, 12);
  const firstWeekdayNextMonth = date.getDay() === 0 ? 7 : date.getDay();
  let dayDiff;
  if (firstWeekdayNextMonth === oneIndexedWeekday)
    dayDiff = 7;
  else if (firstWeekdayNextMonth < oneIndexedWeekday)
    dayDiff = 7 + firstWeekdayNextMonth - oneIndexedWeekday;
  else
    dayDiff = firstWeekdayNextMonth - oneIndexedWeekday;
  date.setDate(date.getDate() - dayDiff);
  return new Date(year, month - 1, date.getDate(), hour);
}
function toTimezoneOffset(timezoneInput, date, timezoneOverrides = {}) {
  var _a;
  if (timezoneInput == null) {
    return null;
  }
  if (typeof timezoneInput === "number") {
    return timezoneInput;
  }
  const matchedTimezone = (_a = timezoneOverrides[timezoneInput]) != null ? _a : TIMEZONE_ABBR_MAP[timezoneInput];
  if (matchedTimezone == null) {
    return null;
  }
  if (typeof matchedTimezone == "number") {
    return matchedTimezone;
  }
  if (date == null) {
    return null;
  }
  if (date > matchedTimezone.dstStart(date.getFullYear()) && !(date > matchedTimezone.dstEnd(date.getFullYear()))) {
    return matchedTimezone.timezoneOffsetDuringDst;
  }
  return matchedTimezone.timezoneOffsetNonDst;
}

// node_modules/chrono-node/dist/esm/calculation/duration.js
var EmptyDuration = {
  day: 0,
  second: 0,
  millisecond: 0
};
function addDuration(ref, duration) {
  var _a, _b, _c, _d, _e, _f, _g;
  let date = new Date(ref);
  if (duration["y"]) {
    duration["year"] = duration["y"];
    delete duration["y"];
  }
  if (duration["mo"]) {
    duration["month"] = duration["mo"];
    delete duration["mo"];
  }
  if (duration["M"]) {
    duration["month"] = duration["M"];
    delete duration["M"];
  }
  if (duration["w"]) {
    duration["week"] = duration["w"];
    delete duration["w"];
  }
  if (duration["d"]) {
    duration["day"] = duration["d"];
    delete duration["d"];
  }
  if (duration["h"]) {
    duration["hour"] = duration["h"];
    delete duration["h"];
  }
  if (duration["m"]) {
    duration["minute"] = duration["m"];
    delete duration["m"];
  }
  if (duration["s"]) {
    duration["second"] = duration["s"];
    delete duration["s"];
  }
  if (duration["ms"]) {
    duration["millisecond"] = duration["ms"];
    delete duration["ms"];
  }
  if ("year" in duration) {
    const floor = Math.floor(duration["year"]);
    date.setFullYear(date.getFullYear() + floor);
    const remainingFraction = duration["year"] - floor;
    if (remainingFraction > 0) {
      duration.month = (_a = duration == null ? void 0 : duration.month) != null ? _a : 0;
      duration.month += remainingFraction * 12;
    }
  }
  if ("quarter" in duration) {
    const floor = Math.floor(duration["quarter"]);
    date.setMonth(date.getMonth() + floor * 3);
  }
  if ("month" in duration) {
    const floor = Math.floor(duration["month"]);
    date.setMonth(date.getMonth() + floor);
    const remainingFraction = duration["month"] - floor;
    if (remainingFraction > 0) {
      duration.week = (_b = duration == null ? void 0 : duration.week) != null ? _b : 0;
      duration.week += remainingFraction * 4;
    }
  }
  if ("week" in duration) {
    const floor = Math.floor(duration["week"]);
    date.setDate(date.getDate() + floor * 7);
    const remainingFraction = duration["week"] - floor;
    if (remainingFraction > 0) {
      duration.day = (_c = duration == null ? void 0 : duration.day) != null ? _c : 0;
      duration.day += Math.round(remainingFraction * 7);
    }
  }
  if ("day" in duration) {
    const floor = Math.floor(duration["day"]);
    date.setDate(date.getDate() + floor);
    const remainingFraction = duration["day"] - floor;
    if (remainingFraction > 0) {
      duration.hour = (_d = duration == null ? void 0 : duration.hour) != null ? _d : 0;
      duration.hour += Math.round(remainingFraction * 24);
    }
  }
  if ("hour" in duration) {
    const floor = Math.floor(duration["hour"]);
    date.setHours(date.getHours() + floor);
    const remainingFraction = duration["hour"] - floor;
    if (remainingFraction > 0) {
      duration.minute = (_e = duration == null ? void 0 : duration.minute) != null ? _e : 0;
      duration.minute += Math.round(remainingFraction * 60);
    }
  }
  if ("minute" in duration) {
    const floor = Math.floor(duration["minute"]);
    date.setMinutes(date.getMinutes() + floor);
    const remainingFraction = duration["minute"] - floor;
    if (remainingFraction > 0) {
      duration.second = (_f = duration == null ? void 0 : duration.second) != null ? _f : 0;
      duration.second += Math.round(remainingFraction * 60);
    }
  }
  if ("second" in duration) {
    const floor = Math.floor(duration["second"]);
    date.setSeconds(date.getSeconds() + floor);
    const remainingFraction = duration["second"] - floor;
    if (remainingFraction > 0) {
      duration.millisecond = (_g = duration == null ? void 0 : duration.millisecond) != null ? _g : 0;
      duration.millisecond += Math.round(remainingFraction * 1e3);
    }
  }
  if ("millisecond" in duration) {
    const floor = Math.floor(duration["millisecond"]);
    date.setMilliseconds(date.getMilliseconds() + floor);
  }
  return date;
}
function reverseDuration(duration) {
  const reversed = {};
  for (const key in duration) {
    reversed[key] = -duration[key];
  }
  return reversed;
}

// node_modules/chrono-node/dist/esm/results.js
var ReferenceWithTimezone = class _ReferenceWithTimezone {
  constructor(instant, timezoneOffset) {
    __publicField(this, "instant");
    __publicField(this, "timezoneOffset");
    this.instant = instant != null ? instant : /* @__PURE__ */ new Date();
    this.timezoneOffset = timezoneOffset != null ? timezoneOffset : null;
  }
  static fromDate(date) {
    return new _ReferenceWithTimezone(date);
  }
  static fromInput(input, timezoneOverrides) {
    var _a;
    if (input instanceof Date) {
      return _ReferenceWithTimezone.fromDate(input);
    }
    const instant = (_a = input == null ? void 0 : input.instant) != null ? _a : /* @__PURE__ */ new Date();
    const timezoneOffset = toTimezoneOffset(input == null ? void 0 : input.timezone, instant, timezoneOverrides);
    return new _ReferenceWithTimezone(instant, timezoneOffset);
  }
  getDateWithAdjustedTimezone() {
    const date = new Date(this.instant);
    if (this.timezoneOffset !== null) {
      date.setMinutes(date.getMinutes() - this.getSystemTimezoneAdjustmentMinute(this.instant));
    }
    return date;
  }
  getSystemTimezoneAdjustmentMinute(date, overrideTimezoneOffset) {
    var _a;
    if (!date) {
      date = /* @__PURE__ */ new Date();
    }
    const currentTimezoneOffset = -date.getTimezoneOffset();
    const targetTimezoneOffset = (_a = overrideTimezoneOffset != null ? overrideTimezoneOffset : this.timezoneOffset) != null ? _a : currentTimezoneOffset;
    return currentTimezoneOffset - targetTimezoneOffset;
  }
  getTimezoneOffset() {
    var _a;
    return (_a = this.timezoneOffset) != null ? _a : -this.instant.getTimezoneOffset();
  }
};
var ParsingComponents = class _ParsingComponents {
  constructor(reference, knownComponents) {
    __publicField(this, "knownValues");
    __publicField(this, "impliedValues");
    __publicField(this, "reference");
    __publicField(this, "_tags", /* @__PURE__ */ new Set());
    this.reference = reference;
    this.knownValues = {};
    this.impliedValues = {};
    if (knownComponents) {
      for (const key in knownComponents) {
        this.knownValues[key] = knownComponents[key];
      }
    }
    const date = reference.getDateWithAdjustedTimezone();
    this.imply("day", date.getDate());
    this.imply("month", date.getMonth() + 1);
    this.imply("year", date.getFullYear());
    this.imply("hour", 12);
    this.imply("minute", 0);
    this.imply("second", 0);
    this.imply("millisecond", 0);
  }
  static createRelativeFromReference(reference, duration = EmptyDuration) {
    let date = addDuration(reference.getDateWithAdjustedTimezone(), duration);
    const components = new _ParsingComponents(reference);
    components.addTag("result/relativeDate");
    if ("hour" in duration || "minute" in duration || "second" in duration || "millisecond" in duration) {
      components.addTag("result/relativeDateAndTime");
      assignSimilarTime(components, date);
      assignSimilarDate(components, date);
      components.assign("timezoneOffset", reference.getTimezoneOffset());
    } else {
      implySimilarTime(components, date);
      components.imply("timezoneOffset", reference.getTimezoneOffset());
      if ("day" in duration) {
        components.assign("day", date.getDate());
        components.assign("month", date.getMonth() + 1);
        components.assign("year", date.getFullYear());
        components.assign("weekday", date.getDay());
      } else if ("week" in duration) {
        components.assign("day", date.getDate());
        components.assign("month", date.getMonth() + 1);
        components.assign("year", date.getFullYear());
        components.imply("weekday", date.getDay());
      } else {
        components.imply("day", date.getDate());
        if ("month" in duration) {
          components.assign("month", date.getMonth() + 1);
          components.assign("year", date.getFullYear());
        } else {
          components.imply("month", date.getMonth() + 1);
          if ("year" in duration) {
            components.assign("year", date.getFullYear());
          } else {
            components.imply("year", date.getFullYear());
          }
        }
      }
    }
    return components;
  }
  get(component) {
    if (component in this.knownValues) {
      return this.knownValues[component];
    }
    if (component in this.impliedValues) {
      return this.impliedValues[component];
    }
    return null;
  }
  isCertain(component) {
    return component in this.knownValues;
  }
  getCertainComponents() {
    return Object.keys(this.knownValues);
  }
  imply(component, value) {
    if (component in this.knownValues) {
      return this;
    }
    this.impliedValues[component] = value;
    return this;
  }
  assign(component, value) {
    this.knownValues[component] = value;
    delete this.impliedValues[component];
    return this;
  }
  addDurationAsImplied(duration) {
    const currentDate = this.dateWithoutTimezoneAdjustment();
    const date = addDuration(currentDate, duration);
    if ("day" in duration || "week" in duration || "month" in duration || "year" in duration) {
      this.delete(["day", "weekday", "month", "year"]);
      this.imply("day", date.getDate());
      this.imply("weekday", date.getDay());
      this.imply("month", date.getMonth() + 1);
      this.imply("year", date.getFullYear());
    }
    if ("second" in duration || "minute" in duration || "hour" in duration) {
      this.delete(["second", "minute", "hour"]);
      this.imply("second", date.getSeconds());
      this.imply("minute", date.getMinutes());
      this.imply("hour", date.getHours());
    }
    return this;
  }
  delete(components) {
    if (typeof components === "string") {
      components = [components];
    }
    for (const component of components) {
      delete this.knownValues[component];
      delete this.impliedValues[component];
    }
  }
  clone() {
    const component = new _ParsingComponents(this.reference);
    component.knownValues = {};
    component.impliedValues = {};
    for (const key in this.knownValues) {
      component.knownValues[key] = this.knownValues[key];
    }
    for (const key in this.impliedValues) {
      component.impliedValues[key] = this.impliedValues[key];
    }
    return component;
  }
  isOnlyDate() {
    return !this.isCertain("hour") && !this.isCertain("minute") && !this.isCertain("second");
  }
  isOnlyTime() {
    return !this.isCertain("weekday") && !this.isCertain("day") && !this.isCertain("month") && !this.isCertain("year");
  }
  isOnlyWeekdayComponent() {
    return this.isCertain("weekday") && !this.isCertain("day") && !this.isCertain("month");
  }
  isDateWithUnknownYear() {
    return this.isCertain("month") && !this.isCertain("year");
  }
  isValidDate() {
    const date = new Date(Date.UTC(this.get("year"), this.get("month") - 1, this.get("day"), this.get("hour"), this.get("minute"), this.get("second"), this.get("millisecond")));
    date.setUTCFullYear(this.get("year"));
    if (date.getUTCFullYear() !== this.get("year"))
      return false;
    if (date.getUTCMonth() !== this.get("month") - 1)
      return false;
    if (date.getUTCDate() !== this.get("day"))
      return false;
    if (this.get("hour") != null && date.getUTCHours() != this.get("hour"))
      return false;
    if (this.get("minute") != null && date.getUTCMinutes() != this.get("minute"))
      return false;
    return true;
  }
  toString() {
    return `[ParsingComponents {
            tags: ${JSON.stringify(Array.from(this._tags).sort())}, 
            knownValues: ${JSON.stringify(this.knownValues)}, 
            impliedValues: ${JSON.stringify(this.impliedValues)}}, 
            reference: ${JSON.stringify(this.reference)}]`;
  }
  date() {
    var _a;
    const timezoneOffset = (_a = this.get("timezoneOffset")) != null ? _a : this.reference.timezoneOffset;
    if (timezoneOffset === null || timezoneOffset === void 0) {
      return this.dateWithoutTimezoneAdjustment();
    }
    const date = new Date(Date.UTC(this.get("year"), this.get("month") - 1, this.get("day"), this.get("hour"), this.get("minute"), this.get("second"), this.get("millisecond")));
    date.setUTCFullYear(this.get("year"));
    return new Date(date.getTime() - timezoneOffset * 6e4);
  }
  addTag(tag) {
    this._tags.add(tag);
    return this;
  }
  addTags(tags) {
    for (const tag of tags) {
      this._tags.add(tag);
    }
    return this;
  }
  tags() {
    return new Set(this._tags);
  }
  dateWithoutTimezoneAdjustment() {
    const date = new Date(this.get("year"), this.get("month") - 1, this.get("day"), this.get("hour"), this.get("minute"), this.get("second"), this.get("millisecond"));
    date.setFullYear(this.get("year"));
    return date;
  }
};
var ParsingResult = class _ParsingResult {
  constructor(reference, index, text, start, end) {
    __publicField(this, "refDate");
    __publicField(this, "index");
    __publicField(this, "text");
    __publicField(this, "reference");
    __publicField(this, "start");
    __publicField(this, "end");
    this.reference = reference;
    this.refDate = reference.instant;
    this.index = index;
    this.text = text;
    this.start = start || new ParsingComponents(reference);
    this.end = end;
  }
  clone() {
    const result = new _ParsingResult(this.reference, this.index, this.text);
    result.start = this.start ? this.start.clone() : null;
    result.end = this.end ? this.end.clone() : null;
    return result;
  }
  date() {
    return this.start.date();
  }
  addTag(tag) {
    this.start.addTag(tag);
    if (this.end) {
      this.end.addTag(tag);
    }
    return this;
  }
  addTags(tags) {
    this.start.addTags(tags);
    if (this.end) {
      this.end.addTags(tags);
    }
    return this;
  }
  tags() {
    const combinedTags = new Set(this.start.tags());
    if (this.end) {
      for (const tag of this.end.tags()) {
        combinedTags.add(tag);
      }
    }
    return combinedTags;
  }
  toString() {
    const tags = Array.from(this.tags()).sort();
    return `[ParsingResult {index: ${this.index}, text: '${this.text}', tags: ${JSON.stringify(tags)} ...}]`;
  }
};

// node_modules/chrono-node/dist/esm/utils/pattern.js
function repeatedTimeunitPattern(prefix, singleTimeunitPattern, connectorPattern = "\\s{0,5},?\\s{0,5}") {
  const singleTimeunitPatternNoCapture = singleTimeunitPattern.replace(/\((?!\?)/g, "(?:");
  return `${prefix}${singleTimeunitPatternNoCapture}(?:${connectorPattern}${singleTimeunitPatternNoCapture}){0,10}`;
}
function extractTerms(dictionary) {
  let keys;
  if (dictionary instanceof Array) {
    keys = [...dictionary];
  } else if (dictionary instanceof Map) {
    keys = Array.from(dictionary.keys());
  } else {
    keys = Object.keys(dictionary);
  }
  return keys;
}
function matchAnyPattern(dictionary) {
  const joinedTerms = extractTerms(dictionary).sort((a, b) => b.length - a.length).join("|").replace(/\./g, "\\.");
  return `(?:${joinedTerms})`;
}

// node_modules/chrono-node/dist/esm/calculation/years.js
function findMostLikelyADYear(yearNumber) {
  if (yearNumber < 100) {
    if (yearNumber > 50) {
      yearNumber = yearNumber + 1900;
    } else {
      yearNumber = yearNumber + 2e3;
    }
  }
  return yearNumber;
}
function findYearClosestToRef(refDate, day, month) {
  let date = new Date(refDate);
  date.setMonth(month - 1);
  date.setDate(day);
  const nextYear = addDuration(date, { "year": 1 });
  const lastYear = addDuration(date, { "year": -1 });
  if (Math.abs(nextYear.getTime() - refDate.getTime()) < Math.abs(date.getTime() - refDate.getTime())) {
    date = nextYear;
  } else if (Math.abs(lastYear.getTime() - refDate.getTime()) < Math.abs(date.getTime() - refDate.getTime())) {
    date = lastYear;
  }
  return date.getFullYear();
}

// node_modules/chrono-node/dist/esm/locales/en/constants.js
var WEEKDAY_DICTIONARY = {
  sunday: 0,
  sun: 0,
  "sun.": 0,
  monday: 1,
  mon: 1,
  "mon.": 1,
  tuesday: 2,
  tue: 2,
  "tue.": 2,
  wednesday: 3,
  wed: 3,
  "wed.": 3,
  thursday: 4,
  thurs: 4,
  "thurs.": 4,
  thur: 4,
  "thur.": 4,
  thu: 4,
  "thu.": 4,
  friday: 5,
  fri: 5,
  "fri.": 5,
  saturday: 6,
  sat: 6,
  "sat.": 6
};
var FULL_MONTH_NAME_DICTIONARY = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12
};
var MONTH_DICTIONARY = {
  ...FULL_MONTH_NAME_DICTIONARY,
  jan: 1,
  "jan.": 1,
  feb: 2,
  "feb.": 2,
  mar: 3,
  "mar.": 3,
  apr: 4,
  "apr.": 4,
  jun: 6,
  "jun.": 6,
  jul: 7,
  "jul.": 7,
  aug: 8,
  "aug.": 8,
  sep: 9,
  "sep.": 9,
  sept: 9,
  "sept.": 9,
  oct: 10,
  "oct.": 10,
  nov: 11,
  "nov.": 11,
  dec: 12,
  "dec.": 12
};
var INTEGER_WORD_DICTIONARY = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12
};
var ORDINAL_WORD_DICTIONARY = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
  twentieth: 20,
  "twenty first": 21,
  "twenty-first": 21,
  "twenty second": 22,
  "twenty-second": 22,
  "twenty third": 23,
  "twenty-third": 23,
  "twenty fourth": 24,
  "twenty-fourth": 24,
  "twenty fifth": 25,
  "twenty-fifth": 25,
  "twenty sixth": 26,
  "twenty-sixth": 26,
  "twenty seventh": 27,
  "twenty-seventh": 27,
  "twenty eighth": 28,
  "twenty-eighth": 28,
  "twenty ninth": 29,
  "twenty-ninth": 29,
  "thirtieth": 30,
  "thirty first": 31,
  "thirty-first": 31
};
var TIME_UNIT_DICTIONARY_NO_ABBR = {
  second: "second",
  seconds: "second",
  minute: "minute",
  minutes: "minute",
  hour: "hour",
  hours: "hour",
  day: "day",
  days: "day",
  week: "week",
  weeks: "week",
  month: "month",
  months: "month",
  quarter: "quarter",
  quarters: "quarter",
  year: "year",
  years: "year"
};
var TIME_UNIT_DICTIONARY = {
  s: "second",
  sec: "second",
  second: "second",
  seconds: "second",
  m: "minute",
  min: "minute",
  mins: "minute",
  minute: "minute",
  minutes: "minute",
  h: "hour",
  hr: "hour",
  hrs: "hour",
  hour: "hour",
  hours: "hour",
  d: "day",
  day: "day",
  days: "day",
  w: "week",
  week: "week",
  weeks: "week",
  mo: "month",
  mon: "month",
  mos: "month",
  month: "month",
  months: "month",
  qtr: "quarter",
  quarter: "quarter",
  quarters: "quarter",
  y: "year",
  yr: "year",
  year: "year",
  years: "year",
  ...TIME_UNIT_DICTIONARY_NO_ABBR
};
var NUMBER_PATTERN = `(?:${matchAnyPattern(INTEGER_WORD_DICTIONARY)}|[0-9]+|[0-9]+\\.[0-9]+|half(?:\\s{0,2}an?)?|an?\\b(?:\\s{0,2}few)?|few|several|the|a?\\s{0,2}couple\\s{0,2}(?:of)?)`;
function parseNumberPattern(match) {
  const num = match.toLowerCase();
  if (INTEGER_WORD_DICTIONARY[num] !== void 0) {
    return INTEGER_WORD_DICTIONARY[num];
  } else if (num === "a" || num === "an" || num == "the") {
    return 1;
  } else if (num.match(/few/)) {
    return 3;
  } else if (num.match(/half/)) {
    return 0.5;
  } else if (num.match(/couple/)) {
    return 2;
  } else if (num.match(/several/)) {
    return 7;
  }
  return parseFloat(num);
}
var ORDINAL_NUMBER_PATTERN = `(?:${matchAnyPattern(ORDINAL_WORD_DICTIONARY)}|[0-9]{1,2}(?:st|nd|rd|th)?)`;
function parseOrdinalNumberPattern(match) {
  let num = match.toLowerCase();
  if (ORDINAL_WORD_DICTIONARY[num] !== void 0) {
    return ORDINAL_WORD_DICTIONARY[num];
  }
  num = num.replace(/(?:st|nd|rd|th)$/i, "");
  return parseInt(num);
}
var YEAR_PATTERN = `(?:[1-9][0-9]{0,3}\\s{0,2}(?:BE|AD|BC|BCE|CE)|[1-9][0-9]{3}|[0-9]{2}(?!\\w|:\\d|\\s+(?:am|pm|o\\s*clock|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)))`;
function parseYear(match) {
  if (/BE/i.test(match)) {
    match = match.replace(/BE/i, "");
    return parseInt(match) - 543;
  }
  if (/BCE?/i.test(match)) {
    match = match.replace(/BCE?/i, "");
    return -parseInt(match);
  }
  if (/(AD|CE)/i.test(match)) {
    match = match.replace(/(AD|CE)/i, "");
    return parseInt(match);
  }
  const rawYearNumber = parseInt(match);
  return findMostLikelyADYear(rawYearNumber);
}
var SINGLE_TIME_UNIT_PATTERN = `(${NUMBER_PATTERN})\\s{0,3}(${matchAnyPattern(TIME_UNIT_DICTIONARY)})`;
var SINGLE_TIME_UNIT_REGEX = new RegExp(SINGLE_TIME_UNIT_PATTERN, "i");
var SINGLE_TIME_UNIT_NO_ABBR_PATTERN = `(${NUMBER_PATTERN})\\s{0,3}(${matchAnyPattern(TIME_UNIT_DICTIONARY_NO_ABBR)})`;
var TIME_UNIT_CONNECTOR_PATTERN = `\\s{0,5},?(?:\\s*and)?\\s{0,5}`;
var TIME_UNITS_PATTERN = repeatedTimeunitPattern(`(?:(?:about|around)\\s{0,3})?`, SINGLE_TIME_UNIT_PATTERN, TIME_UNIT_CONNECTOR_PATTERN);
var TIME_UNITS_NO_ABBR_PATTERN = repeatedTimeunitPattern(`(?:(?:about|around)\\s{0,3})?`, SINGLE_TIME_UNIT_NO_ABBR_PATTERN, TIME_UNIT_CONNECTOR_PATTERN);
function parseDuration(timeunitText) {
  const fragments = {};
  let remainingText = timeunitText;
  let match = SINGLE_TIME_UNIT_REGEX.exec(remainingText);
  while (match) {
    collectDateTimeFragment(fragments, match);
    remainingText = remainingText.substring(match[0].length).trim();
    match = SINGLE_TIME_UNIT_REGEX.exec(remainingText);
  }
  if (Object.keys(fragments).length == 0) {
    return null;
  }
  return fragments;
}
function collectDateTimeFragment(fragments, match) {
  if (match[0].match(/^[a-zA-Z]+$/)) {
    return;
  }
  const num = parseNumberPattern(match[1]);
  const unit = TIME_UNIT_DICTIONARY[match[2].toLowerCase()];
  fragments[unit] = num;
}

// node_modules/chrono-node/dist/esm/common/parsers/AbstractParserWithWordBoundary.js
var AbstractParserWithWordBoundaryChecking = class {
  constructor() {
    __publicField(this, "cachedInnerPattern", null);
    __publicField(this, "cachedPattern", null);
  }
  innerPatternHasChange(context, currentInnerPattern) {
    return this.innerPattern(context) !== currentInnerPattern;
  }
  patternLeftBoundary() {
    return `(\\W|^)`;
  }
  pattern(context) {
    if (this.cachedInnerPattern) {
      if (!this.innerPatternHasChange(context, this.cachedInnerPattern)) {
        return this.cachedPattern;
      }
    }
    this.cachedInnerPattern = this.innerPattern(context);
    this.cachedPattern = new RegExp(`${this.patternLeftBoundary()}${this.cachedInnerPattern.source}`, this.cachedInnerPattern.flags);
    return this.cachedPattern;
  }
  extract(context, match) {
    var _a;
    const header = (_a = match[1]) != null ? _a : "";
    match.index = match.index + header.length;
    match[0] = match[0].substring(header.length);
    for (let i = 2; i < match.length; i++) {
      match[i - 1] = match[i];
    }
    return this.innerExtract(context, match);
  }
};

// node_modules/chrono-node/dist/esm/locales/en/parsers/ENTimeUnitWithinFormatParser.js
var PATTERN_WITH_OPTIONAL_PREFIX = new RegExp(`(?:(?:within|in|for)\\s*)?(?:(?:about|around|roughly|approximately|just)\\s*(?:~\\s*)?)?(${TIME_UNITS_PATTERN})(?=\\W|$)`, "i");
var PATTERN_WITH_PREFIX = new RegExp(`(?:within|in|for)\\s*(?:(?:about|around|roughly|approximately|just)\\s*(?:~\\s*)?)?(${TIME_UNITS_PATTERN})(?=\\W|$)`, "i");
var PATTERN_WITH_PREFIX_STRICT = new RegExp(`(?:within|in|for)\\s*(?:(?:about|around|roughly|approximately|just)\\s*(?:~\\s*)?)?(${TIME_UNITS_NO_ABBR_PATTERN})(?=\\W|$)`, "i");
var ENTimeUnitWithinFormatParser = class extends AbstractParserWithWordBoundaryChecking {
  constructor(strictMode) {
    super();
    __publicField(this, "strictMode");
    this.strictMode = strictMode;
  }
  innerPattern(context) {
    if (this.strictMode) {
      return PATTERN_WITH_PREFIX_STRICT;
    }
    return context.option.forwardDate ? PATTERN_WITH_OPTIONAL_PREFIX : PATTERN_WITH_PREFIX;
  }
  innerExtract(context, match) {
    if (match[0].match(/^for\s*the\s*\w+/)) {
      return null;
    }
    const timeUnits = parseDuration(match[1]);
    if (!timeUnits) {
      return null;
    }
    return ParsingComponents.createRelativeFromReference(context.reference, timeUnits);
  }
};

// node_modules/chrono-node/dist/esm/locales/en/parsers/ENMonthNameLittleEndianParser.js
var PATTERN = new RegExp(`(?:on\\s{0,3})?(${ORDINAL_NUMBER_PATTERN})(?:\\s{0,3}(?:to|\\-|\\\u2013|until|through|till)\\s{0,3}(${ORDINAL_NUMBER_PATTERN}))?(?:-|/|\\s{0,3}(?:of)?\\s{0,3})(${matchAnyPattern(MONTH_DICTIONARY)})(?:(?:-|/|,?\\s{0,3})(${YEAR_PATTERN}(?!\\w)))?(?=\\W|$)`, "i");
var DATE_GROUP = 1;
var DATE_TO_GROUP = 2;
var MONTH_NAME_GROUP = 3;
var YEAR_GROUP = 4;
var ENMonthNameLittleEndianParser = class extends AbstractParserWithWordBoundaryChecking {
  innerPattern() {
    return PATTERN;
  }
  innerExtract(context, match) {
    const result = context.createParsingResult(match.index, match[0]);
    const month = MONTH_DICTIONARY[match[MONTH_NAME_GROUP].toLowerCase()];
    const day = parseOrdinalNumberPattern(match[DATE_GROUP]);
    if (day > 31) {
      match.index = match.index + match[DATE_GROUP].length;
      return null;
    }
    result.start.assign("month", month);
    result.start.assign("day", day);
    if (match[YEAR_GROUP]) {
      const yearNumber = parseYear(match[YEAR_GROUP]);
      result.start.assign("year", yearNumber);
    } else {
      const year = findYearClosestToRef(context.refDate, day, month);
      result.start.imply("year", year);
    }
    if (match[DATE_TO_GROUP]) {
      const endDate = parseOrdinalNumberPattern(match[DATE_TO_GROUP]);
      result.end = result.start.clone();
      result.end.assign("day", endDate);
    }
    return result;
  }
};

// node_modules/chrono-node/dist/esm/locales/en/parsers/ENMonthNameMiddleEndianParser.js
var PATTERN2 = new RegExp(`(${matchAnyPattern(MONTH_DICTIONARY)})(?:-|/|\\s*,?\\s*)(${ORDINAL_NUMBER_PATTERN})(?!\\s*(?:am|pm))\\s*(?:(?:to|\\-)\\s*(${ORDINAL_NUMBER_PATTERN})\\s*)?(?:(?:-|/|\\s*,\\s*|\\s+)(${YEAR_PATTERN}))?(?=\\W|$)(?!\\:\\d)`, "i");
var MONTH_NAME_GROUP2 = 1;
var DATE_GROUP2 = 2;
var DATE_TO_GROUP2 = 3;
var YEAR_GROUP2 = 4;
var ENMonthNameMiddleEndianParser = class extends AbstractParserWithWordBoundaryChecking {
  constructor(shouldSkipYearLikeDate) {
    super();
    __publicField(this, "shouldSkipYearLikeDate");
    this.shouldSkipYearLikeDate = shouldSkipYearLikeDate;
  }
  innerPattern() {
    return PATTERN2;
  }
  innerExtract(context, match) {
    const month = MONTH_DICTIONARY[match[MONTH_NAME_GROUP2].toLowerCase()];
    const day = parseOrdinalNumberPattern(match[DATE_GROUP2]);
    if (day > 31) {
      return null;
    }
    if (this.shouldSkipYearLikeDate) {
      if (!match[DATE_TO_GROUP2] && !match[YEAR_GROUP2] && match[DATE_GROUP2].match(/^\d{2}$/)) {
        return null;
      }
    }
    const components = context.createParsingComponents({
      day,
      month
    }).addTag("parser/ENMonthNameMiddleEndianParser");
    if (match[YEAR_GROUP2]) {
      const year = parseYear(match[YEAR_GROUP2]);
      components.assign("year", year);
    } else {
      const year = findYearClosestToRef(context.refDate, day, month);
      components.imply("year", year);
    }
    if (!match[DATE_TO_GROUP2]) {
      return components;
    }
    const endDate = parseOrdinalNumberPattern(match[DATE_TO_GROUP2]);
    const result = context.createParsingResult(match.index, match[0]);
    result.start = components;
    result.end = components.clone();
    result.end.assign("day", endDate);
    return result;
  }
};

// node_modules/chrono-node/dist/esm/locales/en/parsers/ENMonthNameParser.js
var PATTERN3 = new RegExp(`((?:in)\\s*)?(${matchAnyPattern(MONTH_DICTIONARY)})\\s*(?:(?:,|-|of)?\\s*(${YEAR_PATTERN})?)?(?=[^\\s\\w]|\\s+[^0-9]|\\s+$|$)`, "i");
var PREFIX_GROUP = 1;
var MONTH_NAME_GROUP3 = 2;
var YEAR_GROUP3 = 3;
var ENMonthNameParser = class extends AbstractParserWithWordBoundaryChecking {
  innerPattern() {
    return PATTERN3;
  }
  innerExtract(context, match) {
    const monthName = match[MONTH_NAME_GROUP3].toLowerCase();
    if (match[0].length <= 3 && !FULL_MONTH_NAME_DICTIONARY[monthName]) {
      return null;
    }
    const result = context.createParsingResult(match.index + (match[PREFIX_GROUP] || "").length, match.index + match[0].length);
    result.start.imply("day", 1);
    result.start.addTag("parser/ENMonthNameParser");
    const month = MONTH_DICTIONARY[monthName];
    result.start.assign("month", month);
    if (match[YEAR_GROUP3]) {
      const year = parseYear(match[YEAR_GROUP3]);
      result.start.assign("year", year);
    } else {
      const year = findYearClosestToRef(context.refDate, 1, month);
      result.start.imply("year", year);
    }
    return result;
  }
};

// node_modules/chrono-node/dist/esm/locales/en/parsers/ENYearMonthDayParser.js
var PATTERN4 = new RegExp(`([0-9]{4})[-\\.\\/\\s](?:(${matchAnyPattern(MONTH_DICTIONARY)})|([0-9]{1,2}))[-\\.\\/\\s]([0-9]{1,2})(?=\\W|$)`, "i");
var YEAR_NUMBER_GROUP = 1;
var MONTH_NAME_GROUP4 = 2;
var MONTH_NUMBER_GROUP = 3;
var DATE_NUMBER_GROUP = 4;
var ENYearMonthDayParser = class extends AbstractParserWithWordBoundaryChecking {
  constructor(strictMonthDateOrder) {
    super();
    __publicField(this, "strictMonthDateOrder");
    this.strictMonthDateOrder = strictMonthDateOrder;
  }
  innerPattern() {
    return PATTERN4;
  }
  innerExtract(context, match) {
    const year = parseInt(match[YEAR_NUMBER_GROUP]);
    let day = parseInt(match[DATE_NUMBER_GROUP]);
    let month = match[MONTH_NUMBER_GROUP] ? parseInt(match[MONTH_NUMBER_GROUP]) : MONTH_DICTIONARY[match[MONTH_NAME_GROUP4].toLowerCase()];
    if (month < 1 || month > 12) {
      if (this.strictMonthDateOrder) {
        return null;
      }
      if (day >= 1 && day <= 12) {
        [month, day] = [day, month];
      }
    }
    if (day < 1 || day > 31) {
      return null;
    }
    return {
      day,
      month,
      year
    };
  }
};

// node_modules/chrono-node/dist/esm/locales/en/parsers/ENYearMonthNameParser.js
var YEAR_PATTERN2 = `(?:[1-9][0-9]{0,3}\\s{0,2}(?:BE|AD|BC|BCE|CE)|[1-9][0-9]{3})`;
var PATTERN5 = new RegExp(`(${YEAR_PATTERN2})(?:\\s*[-.\\/,]?\\s*|\\s+of\\s+)(${matchAnyPattern(MONTH_DICTIONARY)})(?=[^\\s\\w]|\\s+[^0-9]|\\s+$|$)`, "i");
var YEAR_GROUP4 = 1;
var MONTH_NAME_GROUP5 = 2;
var ENYearMonthNameParser = class extends AbstractParserWithWordBoundaryChecking {
  innerPattern() {
    return PATTERN5;
  }
  innerExtract(context, match) {
    const year = parseYear(match[YEAR_GROUP4]);
    const monthName = match[MONTH_NAME_GROUP5].toLowerCase();
    const month = MONTH_DICTIONARY[monthName];
    const result = context.createParsingResult(match.index, match[0]);
    result.start.imply("day", 1);
    result.start.assign("month", month);
    result.start.assign("year", year);
    result.start.addTag("parser/ENYearMonthNameParser");
    return result;
  }
};

// node_modules/chrono-node/dist/esm/locales/en/parsers/ENSlashMonthFormatParser.js
var PATTERN6 = new RegExp("([0-9]|0[1-9]|1[012])/([0-9]{4})", "i");
var MONTH_GROUP = 1;
var YEAR_GROUP5 = 2;
var ENSlashMonthFormatParser = class extends AbstractParserWithWordBoundaryChecking {
  innerPattern() {
    return PATTERN6;
  }
  innerExtract(context, match) {
    const year = parseInt(match[YEAR_GROUP5]);
    const month = parseInt(match[MONTH_GROUP]);
    return context.createParsingComponents().imply("day", 1).assign("month", month).assign("year", year);
  }
};

// node_modules/chrono-node/dist/esm/common/parsers/AbstractTimeExpressionParser.js
function primaryTimePattern(leftBoundary, primaryPrefix, primarySuffix, flags) {
  return new RegExp(`${leftBoundary}${primaryPrefix}(\\d{1,4})(?:(?:\\.|:|\uFF1A)(\\d{1,2})(?:(?::|\uFF1A)(\\d{2})(?:\\.(\\d{1,6}))?)?)?(?:\\s*(a\\.m\\.|p\\.m\\.|am?|pm?))?${primarySuffix}`, flags);
}
function followingTimePatten(followingPhase, followingSuffix) {
  return new RegExp(`^(${followingPhase})(\\d{1,4})(?:(?:\\.|\\:|\\\uFF1A)(\\d{1,2})(?:(?:\\.|\\:|\\\uFF1A)(\\d{1,2})(?:\\.(\\d{1,6}))?)?)?(?:\\s*(a\\.m\\.|p\\.m\\.|am?|pm?))?${followingSuffix}`, "i");
}
var HOUR_GROUP = 2;
var MINUTE_GROUP = 3;
var SECOND_GROUP = 4;
var MILLI_SECOND_GROUP = 5;
var AM_PM_HOUR_GROUP = 6;
var AbstractTimeExpressionParser = class {
  constructor(strictMode = false) {
    __publicField(this, "strictMode");
    __publicField(this, "cachedPrimaryPrefix", null);
    __publicField(this, "cachedPrimarySuffix", null);
    __publicField(this, "cachedPrimaryTimePattern", null);
    __publicField(this, "cachedFollowingPhase", null);
    __publicField(this, "cachedFollowingSuffix", null);
    __publicField(this, "cachedFollowingTimePatten", null);
    this.strictMode = strictMode;
  }
  patternFlags() {
    return "i";
  }
  primaryPatternLeftBoundary() {
    return `(^|\\s|T|\\b)`;
  }
  primarySuffix() {
    return `(?!/)(?=\\W|$)`;
  }
  followingSuffix() {
    return `(?!/)(?=\\W|$)`;
  }
  pattern(context) {
    return this.getPrimaryTimePatternThroughCache();
  }
  extract(context, match) {
    const startComponents = this.extractPrimaryTimeComponents(context, match);
    if (!startComponents) {
      if (match[0].match(/^\d{4}/)) {
        match.index += 4;
        return null;
      }
      match.index += match[0].length;
      return null;
    }
    const index = match.index + match[1].length;
    const text = match[0].substring(match[1].length);
    const result = context.createParsingResult(index, text, startComponents);
    match.index += match[0].length;
    const remainingText = context.text.substring(match.index);
    const followingPattern = this.getFollowingTimePatternThroughCache();
    const followingMatch = followingPattern.exec(remainingText);
    if (text.match(/^\d{3,4}/) && followingMatch) {
      if (followingMatch[0].match(/^\s*([+-])\s*\d{2,4}$/)) {
        return null;
      }
      if (followingMatch[0].match(/^\s*([+-])\s*\d{2}\W\d{2}/)) {
        return null;
      }
    }
    if (!followingMatch || followingMatch[0].match(/^\s*([+-])\s*\d{3,4}$/)) {
      return this.checkAndReturnWithoutFollowingPattern(result);
    }
    result.end = this.extractFollowingTimeComponents(context, followingMatch, result);
    if (result.end) {
      result.text += followingMatch[0];
    }
    return this.checkAndReturnWithFollowingPattern(result);
  }
  extractPrimaryTimeComponents(context, match, strict2 = false) {
    const components = context.createParsingComponents();
    let minute = 0;
    let meridiem = null;
    let hour = parseInt(match[HOUR_GROUP]);
    if (hour > 100) {
      if (match[HOUR_GROUP].length == 4 && match[MINUTE_GROUP] == null && !match[AM_PM_HOUR_GROUP]) {
        return null;
      }
      if (this.strictMode || match[MINUTE_GROUP] != null) {
        return null;
      }
      minute = hour % 100;
      hour = Math.floor(hour / 100);
    }
    if (hour > 24) {
      return null;
    }
    if (match[MINUTE_GROUP] != null) {
      if (match[MINUTE_GROUP].length == 1 && !match[AM_PM_HOUR_GROUP]) {
        return null;
      }
      minute = parseInt(match[MINUTE_GROUP]);
    }
    if (minute >= 60) {
      return null;
    }
    if (hour > 12) {
      meridiem = Meridiem.PM;
    }
    if (match[AM_PM_HOUR_GROUP] != null) {
      if (hour > 12)
        return null;
      const ampm = match[AM_PM_HOUR_GROUP][0].toLowerCase();
      if (ampm == "a") {
        meridiem = Meridiem.AM;
        if (hour == 12) {
          hour = 0;
        }
      }
      if (ampm == "p") {
        meridiem = Meridiem.PM;
        if (hour != 12) {
          hour += 12;
        }
      }
    }
    components.assign("hour", hour);
    components.assign("minute", minute);
    if (meridiem !== null) {
      components.assign("meridiem", meridiem);
    } else {
      if (hour < 12) {
        components.imply("meridiem", Meridiem.AM);
      } else {
        components.imply("meridiem", Meridiem.PM);
      }
    }
    if (match[MILLI_SECOND_GROUP] != null) {
      const millisecond = parseInt(match[MILLI_SECOND_GROUP].substring(0, 3));
      if (millisecond >= 1e3)
        return null;
      components.assign("millisecond", millisecond);
    }
    if (match[SECOND_GROUP] != null) {
      const second = parseInt(match[SECOND_GROUP]);
      if (second >= 60)
        return null;
      components.assign("second", second);
    }
    return components;
  }
  extractFollowingTimeComponents(context, match, result) {
    const components = context.createParsingComponents();
    if (match[MILLI_SECOND_GROUP] != null) {
      const millisecond = parseInt(match[MILLI_SECOND_GROUP].substring(0, 3));
      if (millisecond >= 1e3)
        return null;
      components.assign("millisecond", millisecond);
    }
    if (match[SECOND_GROUP] != null) {
      const second = parseInt(match[SECOND_GROUP]);
      if (second >= 60)
        return null;
      components.assign("second", second);
    }
    let hour = parseInt(match[HOUR_GROUP]);
    let minute = 0;
    let meridiem = -1;
    if (match[MINUTE_GROUP] != null) {
      minute = parseInt(match[MINUTE_GROUP]);
    } else if (hour > 100) {
      minute = hour % 100;
      hour = Math.floor(hour / 100);
    }
    if (minute >= 60 || hour > 24) {
      return null;
    }
    if (hour >= 12) {
      meridiem = Meridiem.PM;
    }
    if (match[AM_PM_HOUR_GROUP] != null) {
      if (hour > 12) {
        return null;
      }
      const ampm = match[AM_PM_HOUR_GROUP][0].toLowerCase();
      if (ampm == "a") {
        meridiem = Meridiem.AM;
        if (hour == 12) {
          hour = 0;
          if (!components.isCertain("day")) {
            components.imply("day", components.get("day") + 1);
          }
        }
      }
      if (ampm == "p") {
        meridiem = Meridiem.PM;
        if (hour != 12)
          hour += 12;
      }
      if (!result.start.isCertain("meridiem")) {
        if (meridiem == Meridiem.AM) {
          result.start.imply("meridiem", Meridiem.AM);
          if (result.start.get("hour") == 12) {
            result.start.assign("hour", 0);
          }
        } else {
          result.start.imply("meridiem", Meridiem.PM);
          if (result.start.get("hour") != 12) {
            result.start.assign("hour", result.start.get("hour") + 12);
          }
        }
      }
    }
    components.assign("hour", hour);
    components.assign("minute", minute);
    if (meridiem >= 0) {
      components.assign("meridiem", meridiem);
    } else {
      const startAtPM = result.start.isCertain("meridiem") && result.start.get("hour") > 12;
      if (startAtPM) {
        if (result.start.get("hour") - 12 > hour) {
          components.imply("meridiem", Meridiem.AM);
        } else if (hour <= 12) {
          components.assign("hour", hour + 12);
          components.assign("meridiem", Meridiem.PM);
        }
      } else if (hour > 12) {
        components.imply("meridiem", Meridiem.PM);
      } else if (hour <= 12) {
        components.imply("meridiem", Meridiem.AM);
      }
    }
    if (components.date().getTime() < result.start.date().getTime()) {
      components.imply("day", components.get("day") + 1);
    }
    return components;
  }
  checkAndReturnWithoutFollowingPattern(result) {
    if (result.text.match(/^\d$/)) {
      return null;
    }
    if (result.text.match(/^\d\d\d+$/)) {
      return null;
    }
    if (result.text.match(/\d[apAP]$/)) {
      return null;
    }
    const endingWithNumbers = result.text.match(/[^\d:.](\d[\d.]+)$/);
    if (endingWithNumbers) {
      const endingNumbers = endingWithNumbers[1];
      if (this.strictMode) {
        return null;
      }
      if (endingNumbers.includes(".") && !endingNumbers.match(/\d(\.\d{2})+$/)) {
        return null;
      }
      const endingNumberVal = parseInt(endingNumbers);
      if (endingNumberVal > 24) {
        return null;
      }
    }
    return result;
  }
  checkAndReturnWithFollowingPattern(result) {
    if (result.text.match(/^\d+-\d+$/)) {
      return null;
    }
    const endingWithNumbers = result.text.match(/[^\d:.](\d[\d.]+)\s*-\s*(\d[\d.]+)$/);
    if (endingWithNumbers) {
      if (this.strictMode) {
        return null;
      }
      const startingNumbers = endingWithNumbers[1];
      const endingNumbers = endingWithNumbers[2];
      if (endingNumbers.includes(".") && !endingNumbers.match(/\d(\.\d{2})+$/)) {
        return null;
      }
      const endingNumberVal = parseInt(endingNumbers);
      const startingNumberVal = parseInt(startingNumbers);
      if (endingNumberVal > 24 || startingNumberVal > 24) {
        return null;
      }
    }
    return result;
  }
  getPrimaryTimePatternThroughCache() {
    const primaryPrefix = this.primaryPrefix();
    const primarySuffix = this.primarySuffix();
    if (this.cachedPrimaryPrefix === primaryPrefix && this.cachedPrimarySuffix === primarySuffix) {
      return this.cachedPrimaryTimePattern;
    }
    this.cachedPrimaryTimePattern = primaryTimePattern(this.primaryPatternLeftBoundary(), primaryPrefix, primarySuffix, this.patternFlags());
    this.cachedPrimaryPrefix = primaryPrefix;
    this.cachedPrimarySuffix = primarySuffix;
    return this.cachedPrimaryTimePattern;
  }
  getFollowingTimePatternThroughCache() {
    const followingPhase = this.followingPhase();
    const followingSuffix = this.followingSuffix();
    if (this.cachedFollowingPhase === followingPhase && this.cachedFollowingSuffix === followingSuffix) {
      return this.cachedFollowingTimePatten;
    }
    this.cachedFollowingTimePatten = followingTimePatten(followingPhase, followingSuffix);
    this.cachedFollowingPhase = followingPhase;
    this.cachedFollowingSuffix = followingSuffix;
    return this.cachedFollowingTimePatten;
  }
};

// node_modules/chrono-node/dist/esm/locales/en/parsers/ENTimeExpressionParser.js
var ENTimeExpressionParser = class extends AbstractTimeExpressionParser {
  constructor(strictMode) {
    super(strictMode);
  }
  followingPhase() {
    return "\\s*(?:\\-|\\\u2013|\\~|\\\u301C|to|until|through|till|\\?)\\s*";
  }
  primaryPrefix() {
    return "(?:(?:at|from)\\s*)??";
  }
  primarySuffix() {
    return "(?:\\s*(?:o\\W*clock|at\\s*night|in\\s*the\\s*(?:morning|afternoon)))?(?!/)(?=\\W|$)";
  }
  extractPrimaryTimeComponents(context, match) {
    const components = super.extractPrimaryTimeComponents(context, match);
    if (!components) {
      return components;
    }
    if (match[0].endsWith("night")) {
      const hour = components.get("hour");
      if (hour >= 6 && hour < 12) {
        components.assign("hour", components.get("hour") + 12);
        components.assign("meridiem", Meridiem.PM);
      } else if (hour < 6) {
        components.assign("meridiem", Meridiem.AM);
      }
    }
    if (match[0].endsWith("afternoon")) {
      components.assign("meridiem", Meridiem.PM);
      const hour = components.get("hour");
      if (hour >= 0 && hour <= 6) {
        components.assign("hour", components.get("hour") + 12);
      }
    }
    if (match[0].endsWith("morning")) {
      components.assign("meridiem", Meridiem.AM);
      const hour = components.get("hour");
      if (hour < 12) {
        components.assign("hour", components.get("hour"));
      }
    }
    return components.addTag("parser/ENTimeExpressionParser");
  }
  extractFollowingTimeComponents(context, match, result) {
    const followingComponents = super.extractFollowingTimeComponents(context, match, result);
    if (followingComponents) {
      followingComponents.addTag("parser/ENTimeExpressionParser");
    }
    return followingComponents;
  }
};

// node_modules/chrono-node/dist/esm/locales/en/parsers/ENTimeUnitAgoFormatParser.js
var PATTERN7 = new RegExp(`(${TIME_UNITS_PATTERN})\\s{0,5}(?:ago|before|earlier)(?=\\W|$)`, "i");
var STRICT_PATTERN = new RegExp(`(${TIME_UNITS_NO_ABBR_PATTERN})\\s{0,5}(?:ago|before|earlier)(?=\\W|$)`, "i");
var ENTimeUnitAgoFormatParser = class extends AbstractParserWithWordBoundaryChecking {
  constructor(strictMode) {
    super();
    __publicField(this, "strictMode");
    this.strictMode = strictMode;
  }
  innerPattern() {
    return this.strictMode ? STRICT_PATTERN : PATTERN7;
  }
  innerExtract(context, match) {
    const duration = parseDuration(match[1]);
    if (!duration) {
      return null;
    }
    return ParsingComponents.createRelativeFromReference(context.reference, reverseDuration(duration));
  }
};

// node_modules/chrono-node/dist/esm/locales/en/parsers/ENTimeUnitLaterFormatParser.js
var PATTERN8 = new RegExp(`(${TIME_UNITS_PATTERN})\\s{0,5}(?:later|after|from now|henceforth|forward|out)(?=(?:\\W|$))`, "i");
var STRICT_PATTERN2 = new RegExp(`(${TIME_UNITS_NO_ABBR_PATTERN})\\s{0,5}(later|after|from now)(?=\\W|$)`, "i");
var GROUP_NUM_TIMEUNITS = 1;
var ENTimeUnitLaterFormatParser = class extends AbstractParserWithWordBoundaryChecking {
  constructor(strictMode) {
    super();
    __publicField(this, "strictMode");
    this.strictMode = strictMode;
  }
  innerPattern() {
    return this.strictMode ? STRICT_PATTERN2 : PATTERN8;
  }
  innerExtract(context, match) {
    const timeUnits = parseDuration(match[GROUP_NUM_TIMEUNITS]);
    if (!timeUnits) {
      return null;
    }
    return ParsingComponents.createRelativeFromReference(context.reference, timeUnits);
  }
};

// node_modules/chrono-node/dist/esm/common/abstractRefiners.js
var Filter = class {
  refine(context, results) {
    return results.filter((r) => this.isValid(context, r));
  }
};
var MergingRefiner = class {
  refine(context, results) {
    if (results.length < 2) {
      return results;
    }
    const mergedResults = [];
    let curResult = results[0];
    let nextResult = null;
    for (let i = 1; i < results.length; i++) {
      nextResult = results[i];
      const textBetween = context.text.substring(curResult.index + curResult.text.length, nextResult.index);
      if (!this.shouldMergeResults(textBetween, curResult, nextResult, context)) {
        mergedResults.push(curResult);
        curResult = nextResult;
      } else {
        const left = curResult;
        const right = nextResult;
        const mergedResult = this.mergeResults(textBetween, left, right, context);
        context.debug(() => {
          console.log(`${this.constructor.name} merged ${left} and ${right} into ${mergedResult}`);
        });
        curResult = mergedResult;
      }
    }
    if (curResult != null) {
      mergedResults.push(curResult);
    }
    return mergedResults;
  }
};

// node_modules/chrono-node/dist/esm/common/refiners/AbstractMergeDateRangeRefiner.js
var AbstractMergeDateRangeRefiner = class extends MergingRefiner {
  shouldMergeResults(textBetween, currentResult, nextResult) {
    return !currentResult.end && !nextResult.end && textBetween.match(this.patternBetween()) != null;
  }
  mergeResults(textBetween, fromResult, toResult) {
    if (!fromResult.start.isOnlyWeekdayComponent() && !toResult.start.isOnlyWeekdayComponent()) {
      toResult.start.getCertainComponents().forEach((key) => {
        if (!fromResult.start.isCertain(key)) {
          fromResult.start.imply(key, toResult.start.get(key));
        }
      });
      fromResult.start.getCertainComponents().forEach((key) => {
        if (!toResult.start.isCertain(key)) {
          toResult.start.imply(key, fromResult.start.get(key));
        }
      });
    }
    if (fromResult.start.date() > toResult.start.date()) {
      let fromDate = fromResult.start.date();
      let toDate = toResult.start.date();
      if (toResult.start.isOnlyWeekdayComponent() && addDuration(toDate, { day: 7 }) > fromDate) {
        toDate = addDuration(toDate, { day: 7 });
        toResult.start.imply("day", toDate.getDate());
        toResult.start.imply("month", toDate.getMonth() + 1);
        toResult.start.imply("year", toDate.getFullYear());
      } else if (fromResult.start.isOnlyWeekdayComponent() && addDuration(fromDate, { day: -7 }) < toDate) {
        fromDate = addDuration(fromDate, { day: -7 });
        fromResult.start.imply("day", fromDate.getDate());
        fromResult.start.imply("month", fromDate.getMonth() + 1);
        fromResult.start.imply("year", fromDate.getFullYear());
      } else if (toResult.start.isDateWithUnknownYear() && addDuration(toDate, { year: 1 }) > fromDate) {
        toDate = addDuration(toDate, { year: 1 });
        toResult.start.imply("year", toDate.getFullYear());
      } else if (fromResult.start.isDateWithUnknownYear() && addDuration(fromDate, { year: -1 }) < toDate) {
        fromDate = addDuration(fromDate, { year: -1 });
        fromResult.start.imply("year", fromDate.getFullYear());
      } else {
        [toResult, fromResult] = [fromResult, toResult];
      }
    }
    const result = fromResult.clone();
    result.start = fromResult.start;
    result.end = toResult.start;
    result.index = Math.min(fromResult.index, toResult.index);
    if (fromResult.index < toResult.index) {
      result.text = fromResult.text + textBetween + toResult.text;
    } else {
      result.text = toResult.text + textBetween + fromResult.text;
    }
    return result;
  }
};

// node_modules/chrono-node/dist/esm/locales/en/refiners/ENMergeDateRangeRefiner.js
var ENMergeDateRangeRefiner = class extends AbstractMergeDateRangeRefiner {
  patternBetween() {
    return /^\s*(to|-|–|until|through|till)\s*$/i;
  }
};

// node_modules/chrono-node/dist/esm/calculation/mergingCalculation.js
function mergeDateTimeResult(dateResult, timeResult) {
  const result = dateResult.clone();
  const beginDate = dateResult.start;
  const beginTime = timeResult.start;
  result.start = mergeDateTimeComponent(beginDate, beginTime);
  if (dateResult.end != null || timeResult.end != null) {
    const endDate = dateResult.end == null ? dateResult.start : dateResult.end;
    const endTime = timeResult.end == null ? timeResult.start : timeResult.end;
    const endDateTime = mergeDateTimeComponent(endDate, endTime);
    if (dateResult.end == null && endDateTime.date().getTime() < result.start.date().getTime()) {
      const nextDay = new Date(endDateTime.date().getTime());
      nextDay.setDate(nextDay.getDate() + 1);
      if (endDateTime.isCertain("day")) {
        assignSimilarDate(endDateTime, nextDay);
      } else {
        implySimilarDate(endDateTime, nextDay);
      }
    }
    result.end = endDateTime;
  }
  return result;
}
function mergeDateTimeComponent(dateComponent, timeComponent) {
  const dateTimeComponent = dateComponent.clone();
  if (timeComponent.isCertain("hour")) {
    dateTimeComponent.assign("hour", timeComponent.get("hour"));
    dateTimeComponent.assign("minute", timeComponent.get("minute"));
    if (timeComponent.isCertain("second")) {
      dateTimeComponent.assign("second", timeComponent.get("second"));
      if (timeComponent.isCertain("millisecond")) {
        dateTimeComponent.assign("millisecond", timeComponent.get("millisecond"));
      } else {
        dateTimeComponent.imply("millisecond", timeComponent.get("millisecond"));
      }
    } else {
      dateTimeComponent.imply("second", timeComponent.get("second"));
      dateTimeComponent.imply("millisecond", timeComponent.get("millisecond"));
    }
  } else {
    dateTimeComponent.imply("hour", timeComponent.get("hour"));
    dateTimeComponent.imply("minute", timeComponent.get("minute"));
    dateTimeComponent.imply("second", timeComponent.get("second"));
    dateTimeComponent.imply("millisecond", timeComponent.get("millisecond"));
  }
  if (timeComponent.isCertain("timezoneOffset")) {
    dateTimeComponent.assign("timezoneOffset", timeComponent.get("timezoneOffset"));
  }
  const dateHasMeaningfulMeridiem = dateComponent.get("meridiem") != null && (dateComponent.isCertain("meridiem") || Array.from(dateComponent.tags()).some((t) => t.startsWith("casualReference/")));
  if (timeComponent.isCertain("meridiem")) {
    dateTimeComponent.assign("meridiem", timeComponent.get("meridiem"));
  } else if (timeComponent.get("meridiem") != null && !dateHasMeaningfulMeridiem) {
    dateTimeComponent.imply("meridiem", timeComponent.get("meridiem"));
  }
  if (dateTimeComponent.get("meridiem") == Meridiem.PM && dateTimeComponent.get("hour") < 12) {
    if (timeComponent.isCertain("hour")) {
      dateTimeComponent.assign("hour", dateTimeComponent.get("hour") + 12);
    } else {
      dateTimeComponent.imply("hour", dateTimeComponent.get("hour") + 12);
    }
  }
  dateTimeComponent.addTags(dateComponent.tags());
  dateTimeComponent.addTags(timeComponent.tags());
  return dateTimeComponent;
}

// node_modules/chrono-node/dist/esm/common/refiners/AbstractMergeDateTimeRefiner.js
var AbstractMergeDateTimeRefiner = class extends MergingRefiner {
  shouldMergeResults(textBetween, currentResult, nextResult) {
    return (currentResult.start.isOnlyDate() && nextResult.start.isOnlyTime() || nextResult.start.isOnlyDate() && currentResult.start.isOnlyTime()) && textBetween.match(this.patternBetween()) != null;
  }
  mergeResults(textBetween, currentResult, nextResult) {
    const result = currentResult.start.isOnlyDate() ? mergeDateTimeResult(currentResult, nextResult) : mergeDateTimeResult(nextResult, currentResult);
    result.index = currentResult.index;
    result.text = currentResult.text + textBetween + nextResult.text;
    return result;
  }
};

// node_modules/chrono-node/dist/esm/locales/en/refiners/ENMergeDateTimeRefiner.js
var ENMergeDateTimeRefiner = class extends AbstractMergeDateTimeRefiner {
  patternBetween() {
    return new RegExp("^\\s*(T|at|after|before|on|of|,|-|\\.|\u2219|:)?\\s*$");
  }
};

// node_modules/chrono-node/dist/esm/common/refiners/ExtractTimezoneAbbrRefiner.js
var TIMEZONE_NAME_PATTERN = new RegExp("^\\s*,?\\s*\\(?([A-Z]{2,4})\\)?(?=\\W|$)", "i");
var ExtractTimezoneAbbrRefiner = class {
  constructor(timezoneOverrides) {
    __publicField(this, "timezoneOverrides");
    this.timezoneOverrides = timezoneOverrides;
  }
  refine(context, results) {
    var _a;
    const timezoneOverrides = (_a = context.option.timezones) != null ? _a : {};
    results.forEach((result) => {
      var _a2, _b;
      const suffix = context.text.substring(result.index + result.text.length);
      const match = TIMEZONE_NAME_PATTERN.exec(suffix);
      if (!match) {
        return;
      }
      const timezoneAbbr = match[1].toUpperCase();
      const refDate = (_b = (_a2 = result.start.date()) != null ? _a2 : result.refDate) != null ? _b : /* @__PURE__ */ new Date();
      const tzOverrides = { ...this.timezoneOverrides, ...timezoneOverrides };
      const extractedTimezoneOffset = toTimezoneOffset(timezoneAbbr, refDate, tzOverrides);
      if (extractedTimezoneOffset == null) {
        return;
      }
      context.debug(() => {
        console.log(`Extracting timezone: '${timezoneAbbr}' into: ${extractedTimezoneOffset} for: ${result.start}`);
      });
      const currentTimezoneOffset = result.start.get("timezoneOffset");
      if (currentTimezoneOffset !== null && extractedTimezoneOffset != currentTimezoneOffset) {
        if (result.start.isCertain("timezoneOffset")) {
          return;
        }
        if (timezoneAbbr != match[1]) {
          return;
        }
      }
      if (result.start.isOnlyDate()) {
        if (timezoneAbbr != match[1]) {
          return;
        }
      }
      result.text += match[0];
      if (!result.start.isCertain("timezoneOffset")) {
        result.start.assign("timezoneOffset", extractedTimezoneOffset);
      }
      if (result.end != null && !result.end.isCertain("timezoneOffset")) {
        result.end.assign("timezoneOffset", extractedTimezoneOffset);
      }
    });
    return results;
  }
};

// node_modules/chrono-node/dist/esm/common/refiners/ExtractTimezoneOffsetRefiner.js
var TIMEZONE_OFFSET_PATTERN = new RegExp("^\\s*(?:\\(?(?:GMT|UTC)\\s?)?([+-])(\\d{1,2})(?::?(\\d{2}))?\\)?", "i");
var TIMEZONE_OFFSET_SIGN_GROUP = 1;
var TIMEZONE_OFFSET_HOUR_OFFSET_GROUP = 2;
var TIMEZONE_OFFSET_MINUTE_OFFSET_GROUP = 3;
var ExtractTimezoneOffsetRefiner = class {
  refine(context, results) {
    results.forEach(function(result) {
      if (result.start.isCertain("timezoneOffset")) {
        return;
      }
      const suffix = context.text.substring(result.index + result.text.length);
      const match = TIMEZONE_OFFSET_PATTERN.exec(suffix);
      if (!match) {
        return;
      }
      context.debug(() => {
        console.log(`Extracting timezone: '${match[0]}' into : ${result}`);
      });
      const hourOffset = parseInt(match[TIMEZONE_OFFSET_HOUR_OFFSET_GROUP]);
      const minuteOffset = parseInt(match[TIMEZONE_OFFSET_MINUTE_OFFSET_GROUP] || "0");
      let timezoneOffset = hourOffset * 60 + minuteOffset;
      if (timezoneOffset > 14 * 60) {
        return;
      }
      if (match[TIMEZONE_OFFSET_SIGN_GROUP] === "-") {
        timezoneOffset = -timezoneOffset;
      }
      if (result.end != null) {
        result.end.assign("timezoneOffset", timezoneOffset);
      }
      result.start.assign("timezoneOffset", timezoneOffset);
      result.text += match[0];
    });
    return results;
  }
};

// node_modules/chrono-node/dist/esm/common/refiners/OverlapRemovalRefiner.js
var OverlapRemovalRefiner = class {
  refine(context, results) {
    if (results.length < 2) {
      return results;
    }
    const filteredResults = [];
    let prevResult = results[0];
    for (let i = 1; i < results.length; i++) {
      const result = results[i];
      if (result.index >= prevResult.index + prevResult.text.length) {
        filteredResults.push(prevResult);
        prevResult = result;
        continue;
      }
      let kept = null;
      let removed = null;
      if (result.text.length > prevResult.text.length) {
        kept = result;
        removed = prevResult;
      } else {
        kept = prevResult;
        removed = result;
      }
      context.debug(() => {
        console.log(`${this.constructor.name} remove ${removed} by ${kept}`);
      });
      prevResult = kept;
    }
    if (prevResult != null) {
      filteredResults.push(prevResult);
    }
    return filteredResults;
  }
};

// node_modules/chrono-node/dist/esm/calculation/weekdays.js
function createParsingComponentsAtWeekday(reference, weekday, modifier) {
  const refDate = reference.getDateWithAdjustedTimezone();
  const daysToWeekday = getDaysToWeekday(refDate, weekday, modifier);
  let components = new ParsingComponents(reference);
  components = components.addDurationAsImplied({ day: daysToWeekday });
  components.assign("weekday", weekday);
  return components;
}
function getDaysToWeekday(refDate, weekday, modifier) {
  const refWeekday = refDate.getDay();
  switch (modifier) {
    case "this":
      return getDaysForwardToWeekday(refDate, weekday);
    case "last":
      return getBackwardDaysToWeekday(refDate, weekday);
    case "next":
      if (refWeekday == Weekday.SUNDAY) {
        return weekday == Weekday.SUNDAY ? 7 : weekday;
      }
      if (refWeekday == Weekday.SATURDAY) {
        if (weekday == Weekday.SATURDAY)
          return 7;
        if (weekday == Weekday.SUNDAY)
          return 8;
        return 1 + weekday;
      }
      if (weekday < refWeekday && weekday != Weekday.SUNDAY) {
        return getDaysForwardToWeekday(refDate, weekday);
      } else {
        return getDaysForwardToWeekday(refDate, weekday) + 7;
      }
  }
  return getDaysToWeekdayClosest(refDate, weekday);
}
function getDaysToWeekdayClosest(refDate, weekday) {
  const backward = getBackwardDaysToWeekday(refDate, weekday);
  const forward = getDaysForwardToWeekday(refDate, weekday);
  return forward < -backward ? forward : backward;
}
function getDaysForwardToWeekday(refDate, weekday) {
  const refWeekday = refDate.getDay();
  let forwardCount = weekday - refWeekday;
  if (forwardCount < 0) {
    forwardCount += 7;
  }
  return forwardCount;
}
function getBackwardDaysToWeekday(refDate, weekday) {
  const refWeekday = refDate.getDay();
  let backwardCount = weekday - refWeekday;
  if (backwardCount >= 0) {
    backwardCount -= 7;
  }
  return backwardCount;
}

// node_modules/chrono-node/dist/esm/common/refiners/ForwardDateRefiner.js
var ForwardDateRefiner = class {
  refine(context, results) {
    if (!context.option.forwardDate) {
      return results;
    }
    results.forEach((result) => {
      let refDate = context.reference.getDateWithAdjustedTimezone();
      if (result.start.isOnlyTime() && context.reference.instant > result.start.date()) {
        const refDate2 = context.reference.getDateWithAdjustedTimezone();
        const refFollowingDay = new Date(refDate2);
        refFollowingDay.setDate(refFollowingDay.getDate() + 1);
        implySimilarDate(result.start, refFollowingDay);
        context.debug(() => {
          console.log(`${this.constructor.name} adjusted ${result} time from the ref date (${refDate2}) to the following day (${refFollowingDay})`);
        });
        if (result.end && result.end.isOnlyTime()) {
          implySimilarDate(result.end, refFollowingDay);
          if (result.start.date() > result.end.date()) {
            refFollowingDay.setDate(refFollowingDay.getDate() + 1);
            implySimilarDate(result.end, refFollowingDay);
          }
        }
      }
      if (result.start.isOnlyWeekdayComponent() && refDate > result.start.date()) {
        let daysToAdd = getDaysForwardToWeekday(refDate, result.start.get("weekday")) || 7;
        const forwardedWeekday = addDuration(refDate, { day: daysToAdd });
        implySimilarDate(result.start, forwardedWeekday);
        context.debug(() => {
          console.log(`${this.constructor.name} adjusted ${result} weekday (${result.start})`);
        });
        if (result.end && result.start.date() > result.end.date()) {
          let daysToAdd2 = getDaysForwardToWeekday(refDate, result.start.get("weekday")) || 7;
          const forwardedWeekday2 = addDuration(refDate, { day: daysToAdd2 });
          implySimilarDate(result.end, forwardedWeekday2);
          context.debug(() => {
            console.log(`${this.constructor.name} adjusted ${result} weekday (${result.end})`);
          });
        }
      }
      if (result.start.isDateWithUnknownYear() && refDate > result.start.date()) {
        for (let i = 0; i < 3 && refDate > result.start.date(); i++) {
          result.start.imply("year", result.start.get("year") + 1);
          context.debug(() => {
            console.log(`${this.constructor.name} adjusted ${result} year (${result.start})`);
          });
          if (result.end && !result.end.isCertain("year")) {
            result.end.imply("year", result.end.get("year") + 1);
            context.debug(() => {
              console.log(`${this.constructor.name} adjusted ${result} month (${result.start})`);
            });
          }
        }
      }
    });
    return results;
  }
};

// node_modules/chrono-node/dist/esm/common/refiners/UnlikelyFormatFilter.js
var UnlikelyFormatFilter = class extends Filter {
  constructor(strictMode) {
    super();
    __publicField(this, "strictMode");
    this.strictMode = strictMode;
  }
  isValid(context, result) {
    if (result.text.replace(" ", "").match(/^\d*(\.\d*)?$/)) {
      context.debug(() => {
        console.log(`Removing unlikely result '${result.text}'`);
      });
      return false;
    }
    if (!result.start.isValidDate()) {
      context.debug(() => {
        console.log(`Removing invalid result: ${result} (${result.start})`);
      });
      return false;
    }
    if (result.end && !result.end.isValidDate()) {
      context.debug(() => {
        console.log(`Removing invalid result: ${result} (${result.end})`);
      });
      return false;
    }
    if (this.strictMode) {
      return this.isStrictModeValid(context, result);
    }
    return true;
  }
  isStrictModeValid(context, result) {
    if (result.start.isOnlyWeekdayComponent()) {
      context.debug(() => {
        console.log(`(Strict) Removing weekday only component: ${result} (${result.end})`);
      });
      return false;
    }
    return true;
  }
};

// node_modules/chrono-node/dist/esm/common/parsers/ISOFormatParser.js
var PATTERN9 = new RegExp("([0-9]{4})\\-([0-9]{1,2})\\-([0-9]{1,2})(?:T([0-9]{1,2}):([0-9]{1,2})(?::([0-9]{1,2})(?:\\.(\\d{1,4}))?)?(Z|([+-]\\d{2}):?(\\d{2})?)?)?(?=\\W|$)", "i");
var YEAR_NUMBER_GROUP2 = 1;
var MONTH_NUMBER_GROUP2 = 2;
var DATE_NUMBER_GROUP2 = 3;
var HOUR_NUMBER_GROUP = 4;
var MINUTE_NUMBER_GROUP = 5;
var SECOND_NUMBER_GROUP = 6;
var MILLISECOND_NUMBER_GROUP = 7;
var TZD_GROUP = 8;
var TZD_HOUR_OFFSET_GROUP = 9;
var TZD_MINUTE_OFFSET_GROUP = 10;
var ISOFormatParser = class extends AbstractParserWithWordBoundaryChecking {
  innerPattern() {
    return PATTERN9;
  }
  innerExtract(context, match) {
    const components = context.createParsingComponents({
      "year": parseInt(match[YEAR_NUMBER_GROUP2]),
      "month": parseInt(match[MONTH_NUMBER_GROUP2]),
      "day": parseInt(match[DATE_NUMBER_GROUP2])
    });
    if (match[HOUR_NUMBER_GROUP] != null) {
      components.assign("hour", parseInt(match[HOUR_NUMBER_GROUP]));
      components.assign("minute", parseInt(match[MINUTE_NUMBER_GROUP]));
      if (match[SECOND_NUMBER_GROUP] != null) {
        components.assign("second", parseInt(match[SECOND_NUMBER_GROUP]));
      }
      if (match[MILLISECOND_NUMBER_GROUP] != null) {
        components.assign("millisecond", parseInt(match[MILLISECOND_NUMBER_GROUP]));
      }
      if (match[TZD_GROUP] != null) {
        let offset = 0;
        if (match[TZD_HOUR_OFFSET_GROUP]) {
          const hourOffset = parseInt(match[TZD_HOUR_OFFSET_GROUP]);
          let minuteOffset = 0;
          if (match[TZD_MINUTE_OFFSET_GROUP] != null) {
            minuteOffset = parseInt(match[TZD_MINUTE_OFFSET_GROUP]);
          }
          offset = hourOffset * 60;
          if (offset < 0) {
            offset -= minuteOffset;
          } else {
            offset += minuteOffset;
          }
        }
        components.assign("timezoneOffset", offset);
      }
    }
    return components.addTag("parser/ISOFormatParser");
  }
};

// node_modules/chrono-node/dist/esm/common/refiners/MergeWeekdayComponentRefiner.js
var MergeWeekdayComponentRefiner = class extends MergingRefiner {
  mergeResults(textBetween, currentResult, nextResult) {
    const newResult = nextResult.clone();
    newResult.index = currentResult.index;
    newResult.text = currentResult.text + textBetween + newResult.text;
    newResult.start.assign("weekday", currentResult.start.get("weekday"));
    if (newResult.end) {
      newResult.end.assign("weekday", currentResult.start.get("weekday"));
    }
    return newResult;
  }
  shouldMergeResults(textBetween, currentResult, nextResult) {
    const weekdayThenNormalDate = currentResult.start.isOnlyWeekdayComponent() && !currentResult.start.isCertain("hour") && nextResult.start.isCertain("day");
    return weekdayThenNormalDate && textBetween.match(/^,?\s*$/) != null;
  }
};

// node_modules/chrono-node/dist/esm/configurations.js
function includeCommonConfiguration(configuration2, strictMode = false) {
  configuration2.parsers.unshift(new ISOFormatParser());
  configuration2.refiners.unshift(new MergeWeekdayComponentRefiner());
  configuration2.refiners.unshift(new ExtractTimezoneOffsetRefiner());
  configuration2.refiners.unshift(new OverlapRemovalRefiner());
  configuration2.refiners.push(new ExtractTimezoneAbbrRefiner());
  configuration2.refiners.push(new OverlapRemovalRefiner());
  configuration2.refiners.push(new ForwardDateRefiner());
  configuration2.refiners.push(new UnlikelyFormatFilter(strictMode));
  return configuration2;
}

// node_modules/chrono-node/dist/esm/common/casualReferences.js
function now(reference) {
  const targetDate = reference.getDateWithAdjustedTimezone();
  const component = new ParsingComponents(reference, {});
  assignSimilarDate(component, targetDate);
  assignSimilarTime(component, targetDate);
  component.assign("timezoneOffset", reference.getTimezoneOffset());
  component.addTag("casualReference/now");
  return component;
}
function today(reference) {
  const targetDate = reference.getDateWithAdjustedTimezone();
  const component = new ParsingComponents(reference, {});
  assignSimilarDate(component, targetDate);
  implySimilarTime(component, targetDate);
  component.delete("meridiem");
  component.addTag("casualReference/today");
  return component;
}
function yesterday(reference) {
  return theDayBefore(reference, 1).addTag("casualReference/yesterday");
}
function tomorrow(reference) {
  return theDayAfter(reference, 1).addTag("casualReference/tomorrow");
}
function theDayBefore(reference, numDay) {
  return theDayAfter(reference, -numDay);
}
function theDayAfter(reference, nDays) {
  const targetDate = reference.getDateWithAdjustedTimezone();
  const component = new ParsingComponents(reference, {});
  const newDate = new Date(targetDate.getTime());
  newDate.setDate(newDate.getDate() + nDays);
  assignSimilarDate(component, newDate);
  implySimilarTime(component, newDate);
  component.delete("meridiem");
  return component;
}
function tonight(reference, implyHour = 22) {
  const targetDate = reference.getDateWithAdjustedTimezone();
  const component = new ParsingComponents(reference, {});
  assignSimilarDate(component, targetDate);
  component.imply("hour", implyHour);
  component.imply("meridiem", Meridiem.PM);
  component.addTag("casualReference/tonight");
  return component;
}
function evening(reference, implyHour = 20) {
  const component = new ParsingComponents(reference, {});
  component.imply("meridiem", Meridiem.PM);
  component.imply("hour", implyHour);
  component.addTag("casualReference/evening");
  return component;
}
function midnight(reference) {
  const component = new ParsingComponents(reference, {});
  if (reference.getDateWithAdjustedTimezone().getHours() > 2) {
    component.addDurationAsImplied({ day: 1 });
  }
  component.assign("hour", 0);
  component.imply("minute", 0);
  component.imply("second", 0);
  component.imply("millisecond", 0);
  component.addTag("casualReference/midnight");
  return component;
}
function morning(reference, implyHour = 6) {
  const component = new ParsingComponents(reference, {});
  component.imply("meridiem", Meridiem.AM);
  component.imply("hour", implyHour);
  component.imply("minute", 0);
  component.imply("second", 0);
  component.imply("millisecond", 0);
  component.addTag("casualReference/morning");
  return component;
}
function afternoon(reference, implyHour = 15) {
  const component = new ParsingComponents(reference, {});
  component.imply("meridiem", Meridiem.PM);
  component.imply("hour", implyHour);
  component.imply("minute", 0);
  component.imply("second", 0);
  component.imply("millisecond", 0);
  component.addTag("casualReference/afternoon");
  return component;
}
function noon(reference) {
  const component = new ParsingComponents(reference, {});
  component.imply("meridiem", Meridiem.AM);
  component.assign("hour", 12);
  component.imply("minute", 0);
  component.imply("second", 0);
  component.imply("millisecond", 0);
  component.addTag("casualReference/noon");
  return component;
}

// node_modules/chrono-node/dist/esm/locales/en/parsers/ENCasualDateParser.js
var PATTERN10 = /(now|today|tonight|tomorrow|overmorrow|tmr|tmrw|yesterday|last\s*night)(?=\W|$)/i;
var ENCasualDateParser = class extends AbstractParserWithWordBoundaryChecking {
  innerPattern(context) {
    return PATTERN10;
  }
  innerExtract(context, match) {
    let targetDate = context.refDate;
    const lowerText = match[0].toLowerCase();
    let component = context.createParsingComponents();
    switch (lowerText) {
      case "now":
        component = now(context.reference);
        break;
      case "today":
        component = today(context.reference);
        break;
      case "yesterday":
        component = yesterday(context.reference);
        break;
      case "tomorrow":
      case "tmr":
      case "tmrw":
        component = tomorrow(context.reference);
        break;
      case "tonight":
        component = tonight(context.reference);
        break;
      case "overmorrow":
        component = theDayAfter(context.reference, 2);
        break;
      default:
        if (lowerText.match(/last\s*night/)) {
          if (targetDate.getHours() > 6) {
            const previousDay = new Date(targetDate.getTime());
            previousDay.setDate(previousDay.getDate() - 1);
            targetDate = previousDay;
          }
          assignSimilarDate(component, targetDate);
          component.imply("hour", 0);
        }
        break;
    }
    component.addTag("parser/ENCasualDateParser");
    return component;
  }
};

// node_modules/chrono-node/dist/esm/locales/en/parsers/ENCasualTimeParser.js
var PATTERN11 = /(?:this)?\s{0,3}(morning|afternoon|evening|night|midnight|midday|noon)(?=\W|$)/i;
var ENCasualTimeParser = class extends AbstractParserWithWordBoundaryChecking {
  innerPattern() {
    return PATTERN11;
  }
  innerExtract(context, match) {
    let component = null;
    switch (match[1].toLowerCase()) {
      case "afternoon":
        component = afternoon(context.reference);
        break;
      case "evening":
      case "night":
        component = evening(context.reference);
        break;
      case "midnight":
        component = midnight(context.reference);
        break;
      case "morning":
        component = morning(context.reference);
        break;
      case "noon":
      case "midday":
        component = noon(context.reference);
        break;
    }
    if (component) {
      component.addTag("parser/ENCasualTimeParser");
    }
    return component;
  }
};

// node_modules/chrono-node/dist/esm/locales/en/parsers/ENWeekdayParser.js
var PATTERN12 = new RegExp(`(?:(?:\\,|\\(|\\\uFF08)\\s*)?(?:on\\s*?)?(?:(this|last|past|next)\\s*)?(${matchAnyPattern(WEEKDAY_DICTIONARY)}|weekend|weekday)(?:\\s*(?:\\,|\\)|\\\uFF09))?(?:\\s*(?:of\\s*)?(this|last|past|next)\\s*week)?(?=\\W|$)`, "i");
var PREFIX_GROUP2 = 1;
var WEEKDAY_GROUP = 2;
var POSTFIX_GROUP = 3;
var ENWeekdayParser = class extends AbstractParserWithWordBoundaryChecking {
  innerPattern() {
    return PATTERN12;
  }
  innerExtract(context, match) {
    const prefix = match[PREFIX_GROUP2];
    const postfix = match[POSTFIX_GROUP];
    let modifierWord = prefix || postfix;
    modifierWord = modifierWord || "";
    modifierWord = modifierWord.toLowerCase();
    let modifier = null;
    if (modifierWord == "last" || modifierWord == "past") {
      modifier = "last";
    } else if (modifierWord == "next") {
      modifier = "next";
    } else if (modifierWord == "this") {
      modifier = "this";
    }
    const weekday_word = match[WEEKDAY_GROUP].toLowerCase();
    let weekday;
    if (WEEKDAY_DICTIONARY[weekday_word] !== void 0) {
      weekday = WEEKDAY_DICTIONARY[weekday_word];
    } else if (weekday_word == "weekend") {
      weekday = modifier == "last" ? Weekday.SUNDAY : Weekday.SATURDAY;
    } else if (weekday_word == "weekday") {
      const refWeekday = context.reference.getDateWithAdjustedTimezone().getDay();
      if (refWeekday == Weekday.SUNDAY || refWeekday == Weekday.SATURDAY) {
        weekday = modifier == "last" ? Weekday.FRIDAY : Weekday.MONDAY;
      } else {
        weekday = refWeekday - 1;
        weekday = modifier == "last" ? weekday - 1 : weekday + 1;
        weekday = weekday % 5 + 1;
      }
    } else {
      return null;
    }
    return createParsingComponentsAtWeekday(context.reference, weekday, modifier);
  }
};

// node_modules/chrono-node/dist/esm/locales/en/parsers/ENRelativeDateFormatParser.js
var PATTERN13 = new RegExp(`(this|last|past|next|after\\s*this)\\s*(${matchAnyPattern(TIME_UNIT_DICTIONARY)})(?=\\s*)(?=\\W|$)`, "i");
var MODIFIER_WORD_GROUP = 1;
var RELATIVE_WORD_GROUP = 2;
var ENRelativeDateFormatParser = class extends AbstractParserWithWordBoundaryChecking {
  innerPattern() {
    return PATTERN13;
  }
  innerExtract(context, match) {
    const modifier = match[MODIFIER_WORD_GROUP].toLowerCase();
    const unitWord = match[RELATIVE_WORD_GROUP].toLowerCase();
    const timeunit = TIME_UNIT_DICTIONARY[unitWord];
    if (modifier == "next" || modifier.startsWith("after")) {
      const timeUnits = {};
      timeUnits[timeunit] = 1;
      return ParsingComponents.createRelativeFromReference(context.reference, timeUnits);
    }
    if (modifier == "last" || modifier == "past") {
      const timeUnits = {};
      timeUnits[timeunit] = -1;
      return ParsingComponents.createRelativeFromReference(context.reference, timeUnits);
    }
    const components = context.createParsingComponents();
    let date = new Date(context.reference.instant.getTime());
    if (unitWord.match(/week/i)) {
      date.setDate(date.getDate() - date.getDay());
      components.imply("day", date.getDate());
      components.imply("month", date.getMonth() + 1);
      components.imply("year", date.getFullYear());
    } else if (unitWord.match(/month/i)) {
      date.setDate(1);
      components.imply("day", date.getDate());
      components.assign("year", date.getFullYear());
      components.assign("month", date.getMonth() + 1);
    } else if (unitWord.match(/year/i)) {
      date.setDate(1);
      date.setMonth(0);
      components.imply("day", date.getDate());
      components.imply("month", date.getMonth() + 1);
      components.assign("year", date.getFullYear());
    }
    return components;
  }
};

// node_modules/chrono-node/dist/esm/common/parsers/SlashDateFormatParser.js
var PATTERN14 = new RegExp("([^\\d]|^)([0-3]{0,1}[0-9]{1})[\\/\\.\\-]([0-3]{0,1}[0-9]{1})(?:[\\/\\.\\-]([0-9]{4}|[0-9]{2}))?(\\W|$)", "i");
var OPENING_GROUP = 1;
var ENDING_GROUP = 5;
var FIRST_NUMBERS_GROUP = 2;
var SECOND_NUMBERS_GROUP = 3;
var YEAR_GROUP6 = 4;
var SlashDateFormatParser = class {
  constructor(littleEndian) {
    __publicField(this, "groupNumberMonth");
    __publicField(this, "groupNumberDay");
    this.groupNumberMonth = littleEndian ? SECOND_NUMBERS_GROUP : FIRST_NUMBERS_GROUP;
    this.groupNumberDay = littleEndian ? FIRST_NUMBERS_GROUP : SECOND_NUMBERS_GROUP;
  }
  pattern() {
    return PATTERN14;
  }
  extract(context, match) {
    const index = match.index + match[OPENING_GROUP].length;
    const indexEnd = match.index + match[0].length - match[ENDING_GROUP].length;
    if (index > 0) {
      const textBefore = context.text.substring(0, index);
      if (textBefore.match("\\d/?$")) {
        return;
      }
    }
    if (indexEnd < context.text.length) {
      const textAfter = context.text.substring(indexEnd);
      if (textAfter.match("^/?\\d")) {
        return;
      }
    }
    const text = context.text.substring(index, indexEnd);
    if (text.match(/^\d\.\d$/) || text.match(/^\d\.\d{1,2}\.\d{1,2}\s*$/)) {
      return;
    }
    if (!match[YEAR_GROUP6] && text.indexOf("/") < 0) {
      return;
    }
    const result = context.createParsingResult(index, text);
    let month = parseInt(match[this.groupNumberMonth]);
    let day = parseInt(match[this.groupNumberDay]);
    if (month < 1 || month > 12) {
      if (month > 12) {
        if (day >= 1 && day <= 12 && month <= 31) {
          [day, month] = [month, day];
        } else {
          return null;
        }
      }
    }
    if (day < 1 || day > 31) {
      return null;
    }
    result.start.assign("day", day);
    result.start.assign("month", month);
    if (match[YEAR_GROUP6]) {
      const rawYearNumber = parseInt(match[YEAR_GROUP6]);
      const year = findMostLikelyADYear(rawYearNumber);
      result.start.assign("year", year);
    } else {
      const year = findYearClosestToRef(context.refDate, day, month);
      result.start.imply("year", year);
    }
    return result.addTag("parser/SlashDateFormatParser");
  }
};

// node_modules/chrono-node/dist/esm/locales/en/parsers/ENTimeUnitCasualRelativeFormatParser.js
var PATTERN15 = new RegExp(`(this|last|past|next|after|\\+|-)\\s*(${TIME_UNITS_PATTERN})(?=\\W|$)`, "i");
var PATTERN_NO_ABBR = new RegExp(`(this|last|past|next|after|\\+|-)\\s*(${TIME_UNITS_NO_ABBR_PATTERN})(?=\\W|$)`, "i");
var ENTimeUnitCasualRelativeFormatParser = class extends AbstractParserWithWordBoundaryChecking {
  constructor(allowAbbreviations = true) {
    super();
    __publicField(this, "allowAbbreviations");
    this.allowAbbreviations = allowAbbreviations;
  }
  innerPattern() {
    return this.allowAbbreviations ? PATTERN15 : PATTERN_NO_ABBR;
  }
  innerExtract(context, match) {
    const prefix = match[1].toLowerCase();
    let duration = parseDuration(match[2]);
    if (!duration) {
      return null;
    }
    switch (prefix) {
      case "last":
      case "past":
      case "-":
        duration = reverseDuration(duration);
        break;
    }
    return ParsingComponents.createRelativeFromReference(context.reference, duration);
  }
};

// node_modules/chrono-node/dist/esm/locales/en/refiners/ENMergeRelativeAfterDateRefiner.js
function IsPositiveFollowingReference(result) {
  return result.text.match(/^[+-]/i) != null;
}
function IsNegativeFollowingReference(result) {
  return result.text.match(/^-/i) != null;
}
var ENMergeRelativeAfterDateRefiner = class extends MergingRefiner {
  shouldMergeResults(textBetween, currentResult, nextResult) {
    if (!textBetween.match(/^\s*$/i)) {
      return false;
    }
    return IsPositiveFollowingReference(nextResult) || IsNegativeFollowingReference(nextResult);
  }
  mergeResults(textBetween, currentResult, nextResult, context) {
    let timeUnits = parseDuration(nextResult.text);
    if (IsNegativeFollowingReference(nextResult)) {
      timeUnits = reverseDuration(timeUnits);
    }
    const components = ParsingComponents.createRelativeFromReference(ReferenceWithTimezone.fromDate(currentResult.start.date()), timeUnits);
    return new ParsingResult(currentResult.reference, currentResult.index, `${currentResult.text}${textBetween}${nextResult.text}`, components);
  }
};

// node_modules/chrono-node/dist/esm/locales/en/refiners/ENMergeRelativeFollowByDateRefiner.js
function hasImpliedEarlierReferenceDate(result) {
  return result.text.match(/\s+(before|from)$/i) != null;
}
function hasImpliedLaterReferenceDate(result) {
  return result.text.match(/\s+(after|since)$/i) != null;
}
var ENMergeRelativeFollowByDateRefiner = class extends MergingRefiner {
  patternBetween() {
    return /^\s*$/i;
  }
  shouldMergeResults(textBetween, currentResult, nextResult) {
    if (!textBetween.match(this.patternBetween())) {
      return false;
    }
    if (!hasImpliedEarlierReferenceDate(currentResult) && !hasImpliedLaterReferenceDate(currentResult)) {
      return false;
    }
    return !!nextResult.start.get("day") && !!nextResult.start.get("month") && !!nextResult.start.get("year");
  }
  mergeResults(textBetween, currentResult, nextResult) {
    let duration = parseDuration(currentResult.text);
    if (hasImpliedEarlierReferenceDate(currentResult)) {
      duration = reverseDuration(duration);
    }
    const components = ParsingComponents.createRelativeFromReference(ReferenceWithTimezone.fromDate(nextResult.start.date()), duration);
    return new ParsingResult(nextResult.reference, currentResult.index, `${currentResult.text}${textBetween}${nextResult.text}`, components);
  }
};

// node_modules/chrono-node/dist/esm/locales/en/refiners/ENExtractYearSuffixRefiner.js
var YEAR_SUFFIX_PATTERN = new RegExp(`^\\s*(${YEAR_PATTERN})`, "i");
var YEAR_GROUP7 = 1;
var ENExtractYearSuffixRefiner = class {
  refine(context, results) {
    results.forEach(function(result) {
      if (!result.start.isDateWithUnknownYear()) {
        return;
      }
      const suffix = context.text.substring(result.index + result.text.length);
      const match = YEAR_SUFFIX_PATTERN.exec(suffix);
      if (!match) {
        return;
      }
      if (match[0].trim().length <= 3) {
        return;
      }
      context.debug(() => {
        console.log(`Extracting year: '${match[0]}' into : ${result}`);
      });
      const year = parseYear(match[YEAR_GROUP7]);
      if (result.end != null) {
        result.end.assign("year", year);
      }
      result.start.assign("year", year);
      result.text += match[0];
    });
    return results;
  }
};

// node_modules/chrono-node/dist/esm/locales/en/refiners/ENUnlikelyFormatFilter.js
var ENUnlikelyFormatFilter = class extends Filter {
  constructor() {
    super();
  }
  isValid(context, result) {
    const text = result.text.trim();
    if (text === context.text.trim()) {
      return true;
    }
    if (text.toLowerCase() === "may") {
      const textBefore = context.text.substring(0, result.index).trim();
      if (!textBefore.match(/\b(in)$/i)) {
        context.debug(() => {
          console.log(`Removing unlikely result: ${result}`);
        });
        return false;
      }
    }
    if (text.toLowerCase().endsWith("the second")) {
      const textAfter = context.text.substring(result.index + result.text.length).trim();
      if (textAfter.length > 0) {
        context.debug(() => {
          console.log(`Removing unlikely result: ${result}`);
        });
      }
      return false;
    }
    return true;
  }
};

// node_modules/chrono-node/dist/esm/locales/en/configuration.js
var ENDefaultConfiguration = class {
  createCasualConfiguration(littleEndian = false) {
    const option = this.createConfiguration(false, littleEndian);
    option.parsers.push(new ENCasualDateParser());
    option.parsers.push(new ENCasualTimeParser());
    option.parsers.push(new ENMonthNameParser());
    option.parsers.push(new ENRelativeDateFormatParser());
    option.parsers.push(new ENTimeUnitCasualRelativeFormatParser());
    option.refiners.push(new ENUnlikelyFormatFilter());
    return option;
  }
  createConfiguration(strictMode = true, littleEndian = false) {
    const options = includeCommonConfiguration({
      parsers: [
        new SlashDateFormatParser(littleEndian),
        new ENTimeUnitWithinFormatParser(strictMode),
        new ENMonthNameLittleEndianParser(),
        new ENMonthNameMiddleEndianParser(littleEndian),
        new ENWeekdayParser(),
        new ENSlashMonthFormatParser(),
        new ENTimeExpressionParser(strictMode),
        new ENTimeUnitAgoFormatParser(strictMode),
        new ENTimeUnitLaterFormatParser(strictMode),
        new ENYearMonthNameParser()
      ],
      refiners: [new ENMergeDateTimeRefiner()]
    }, strictMode);
    options.parsers.unshift(new ENYearMonthDayParser(strictMode));
    options.refiners.unshift(new ENMergeRelativeFollowByDateRefiner());
    options.refiners.unshift(new ENMergeRelativeAfterDateRefiner());
    options.refiners.unshift(new OverlapRemovalRefiner());
    options.refiners.push(new ENMergeDateTimeRefiner());
    options.refiners.push(new ENExtractYearSuffixRefiner());
    options.refiners.push(new ENMergeDateRangeRefiner());
    return options;
  }
};

// node_modules/chrono-node/dist/esm/chrono.js
var Chrono = class _Chrono {
  constructor(configuration2) {
    __publicField(this, "parsers");
    __publicField(this, "refiners");
    __publicField(this, "defaultConfig", new ENDefaultConfiguration());
    configuration2 = configuration2 || this.defaultConfig.createCasualConfiguration();
    this.parsers = [...configuration2.parsers];
    this.refiners = [...configuration2.refiners];
  }
  clone() {
    return new _Chrono({
      parsers: [...this.parsers],
      refiners: [...this.refiners]
    });
  }
  parseDate(text, referenceDate, option) {
    const results = this.parse(text, referenceDate, option);
    return results.length > 0 ? results[0].start.date() : null;
  }
  parse(text, referenceDate, option) {
    const context = new ParsingContext(text, referenceDate, option);
    let results = [];
    this.parsers.forEach((parser) => {
      const parsedResults = _Chrono.executeParser(context, parser);
      results = results.concat(parsedResults);
    });
    results.sort((a, b) => {
      return a.index - b.index;
    });
    this.refiners.forEach(function(refiner) {
      results = refiner.refine(context, results);
    });
    return results;
  }
  static executeParser(context, parser) {
    const results = [];
    const pattern = parser.pattern(context);
    const originalText = context.text;
    let remainingText = context.text;
    let match = pattern.exec(remainingText);
    while (match) {
      const index = match.index + originalText.length - remainingText.length;
      match.index = index;
      const result = parser.extract(context, match);
      if (!result) {
        remainingText = originalText.substring(match.index + 1);
        match = pattern.exec(remainingText);
        continue;
      }
      let parsedResult = null;
      if (result instanceof ParsingResult) {
        parsedResult = result;
      } else if (result instanceof ParsingComponents) {
        parsedResult = context.createParsingResult(match.index, match[0]);
        parsedResult.start = result;
      } else {
        parsedResult = context.createParsingResult(match.index, match[0], result);
      }
      const parsedIndex = parsedResult.index;
      const parsedText = parsedResult.text;
      context.debug(() => console.log(`${parser.constructor.name} extracted (at index=${parsedIndex}) '${parsedText}'`));
      results.push(parsedResult);
      remainingText = originalText.substring(parsedIndex + parsedText.length);
      match = pattern.exec(remainingText);
    }
    return results;
  }
};
var ParsingContext = class {
  constructor(text, refDate, option) {
    __publicField(this, "text");
    __publicField(this, "option");
    __publicField(this, "reference");
    __publicField(this, "refDate");
    this.text = text;
    this.option = option != null ? option : {};
    this.reference = ReferenceWithTimezone.fromInput(refDate, this.option.timezones);
    this.refDate = this.reference.instant;
  }
  createParsingComponents(components) {
    if (components instanceof ParsingComponents) {
      return components;
    }
    return new ParsingComponents(this.reference, components);
  }
  createParsingResult(index, textOrEndIndex, startComponents, endComponents) {
    const text = typeof textOrEndIndex === "string" ? textOrEndIndex : this.text.substring(index, textOrEndIndex);
    const start = startComponents ? this.createParsingComponents(startComponents) : null;
    const end = endComponents ? this.createParsingComponents(endComponents) : null;
    return new ParsingResult(this.reference, index, text, start, end);
  }
  debug(block) {
    if (this.option.debug) {
      if (this.option.debug instanceof Function) {
        this.option.debug(block);
      } else {
        const handler = this.option.debug;
        handler.debug(block);
      }
    }
  }
};

// node_modules/chrono-node/dist/esm/locales/en/index.js
var configuration = new ENDefaultConfiguration();
var casual = new Chrono(configuration.createCasualConfiguration(false));
var strict = new Chrono(configuration.createConfiguration(true, false));
var GB = new Chrono(configuration.createCasualConfiguration(true));

// node_modules/chrono-node/dist/esm/index.js
var casual2 = casual;
function parse(text, ref, option) {
  return casual2.parse(text, ref, option);
}

// src/date.ts
var import_obsidian = require("obsidian");
var moment = import_obsidian.moment;
var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
var DEFAULT_DATE_FORMAT = "YYYY-MM-DD";
function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function todayIso(now2 = /* @__PURE__ */ new Date()) {
  return formatLocalDate(now2);
}
function tomorrowIso(now2 = /* @__PURE__ */ new Date()) {
  const result = new Date(now2);
  result.setDate(result.getDate() + 1);
  return formatLocalDate(result);
}
function parseDateExpression(value, reference = /* @__PURE__ */ new Date(), dateFormat = DEFAULT_DATE_FORMAT) {
  const trimmed = value.trim();
  if (!trimmed) return void 0;
  if (ISO_DATE.test(trimmed)) {
    const [year, month, day] = trimmed.split("-").map(Number);
    const candidate = new Date(year, month - 1, day);
    if (candidate.getFullYear() === year && candidate.getMonth() === month - 1 && candidate.getDate() === day) {
      return trimmed;
    }
    return void 0;
  }
  const formatted = moment(trimmed, dateFormat, true);
  if (formatted.isValid()) return formatted.format(DEFAULT_DATE_FORMAT);
  const parsed = parse(trimmed, reference, { forwardDate: true }).find(
    (result) => result.index === 0 && result.text.length === trimmed.length
  );
  return parsed ? formatLocalDate(parsed.start.date()) : void 0;
}
function formatDate(iso, dateFormat = DEFAULT_DATE_FORMAT) {
  const parsed = moment(iso, DEFAULT_DATE_FORMAT, true);
  return parsed.isValid() ? parsed.format(dateFormat) : iso;
}
function actionDate(task) {
  var _a;
  if (task.scheduledDate && task.deadline) {
    return task.scheduledDate < task.deadline ? task.scheduledDate : task.deadline;
  }
  return (_a = task.scheduledDate) != null ? _a : task.deadline;
}
function findInputDate(value, reference = /* @__PURE__ */ new Date()) {
  const prose = value.replace(/\{[^}]*\}?|\[\[[\s\S]*?\]\]|`[^`]*`|\[[^\]]*\]\([^)]*\)|https?:\/\/\S+|\b(?:\d+h(?:\d+m)?|\d+m)\b/g, (match) => " ".repeat(match.length));
  const result = parse(prose, reference, { forwardDate: true }).find(
    (match) => !match.end && (match.start.isCertain("day") || match.start.isCertain("weekday") || match.start.isCertain("hour"))
  );
  return result ? { index: result.index, text: result.text, date: formatLocalDate(result.start.date()), ...resultTime(result) ? { time: resultTime(result) } : {} } : void 0;
}
function findInputDeadline(value, reference = /* @__PURE__ */ new Date(), dateFormat) {
  const prose = value.replace(/`[^`]*`|\[\[[\s\S]*?\]\]|\[[^\]]*\]\([^)]*\)/g, (match2) => " ".repeat(match2.length));
  const pattern = /(?:^|\s)\{([^{}[\]]+)\}(?=\s|$)/g;
  let match;
  while (match = pattern.exec(prose)) {
    const date = parseDateTimeExpression(match[1], reference, dateFormat);
    if (date) return { index: match.index, text: match[0], ...date };
  }
  return void 0;
}
function resultTime(result) {
  var _a;
  if (!result.start.isCertain("hour")) return void 0;
  return `${String(result.start.get("hour")).padStart(2, "0")}:${String((_a = result.start.get("minute")) != null ? _a : 0).padStart(2, "0")}`;
}
function parseTimeExpression(value, reference = /* @__PURE__ */ new Date()) {
  const text = value.trim().replace(/^at\s+/i, "");
  const result = parse(text, reference).find(
    (match) => match.index === 0 && match.text.length === text.length && !match.end && !match.start.isCertain("day") && !match.start.isCertain("weekday")
  );
  return result ? resultTime(result) : void 0;
}
function parseDateTimeExpression(value, reference = /* @__PURE__ */ new Date(), dateFormat = DEFAULT_DATE_FORMAT) {
  const text = value.trim();
  const link = /^\[\[([^\]]+)\]\](?:\s+(.+))?$/.exec(text);
  if (link) {
    const date = parseDateExpression(link[1], reference, dateFormat);
    const time = link[2] ? parseTimeExpression(link[2], reference) : void 0;
    return date && (!link[2] || time) ? { date, ...time ? { time } : {} } : void 0;
  }
  for (let index = text.length; index > 0; index--) {
    if (index !== text.length && text[index] !== " ") continue;
    const prefix = text.slice(0, index);
    const strict2 = moment(prefix, [DEFAULT_DATE_FORMAT, dateFormat], true);
    if (!strict2.isValid()) continue;
    const suffix = text.slice(index).trim();
    const time = suffix ? parseTimeExpression(suffix, reference) : void 0;
    if (!suffix || time) return { date: strict2.format(DEFAULT_DATE_FORMAT), ...time ? { time } : {} };
  }
  const result = parse(text, reference, { forwardDate: true }).find(
    (match) => match.index === 0 && match.text.length === text.length && !match.end && (match.start.isCertain("day") || match.start.isCertain("weekday"))
  );
  return result ? { date: formatLocalDate(result.start.date()), ...resultTime(result) ? { time: resultTime(result) } : {} } : void 0;
}
function formatDateTime(date, time, dateFormat) {
  return `${formatDate(date, dateFormat)}${time ? ` ${time}` : ""}`;
}

// src/structure.ts
function bodyLines(content) {
  var _a, _b;
  const result = [];
  const lines = content.split(/\r?\n/);
  let frontmatter = ((_a = lines[0]) == null ? void 0 : _a.trim()) === "---";
  let fence;
  for (let line = 0; line < lines.length; line++) {
    const text = lines[line];
    if (line === 0 && frontmatter) continue;
    if (frontmatter) {
      if (/^(---|\.\.\.)\s*$/.test(text)) frontmatter = false;
      continue;
    }
    const marker = (_b = /^ {0,3}(`{3,}|~{3,})/.exec(text)) == null ? void 0 : _b[1];
    if (fence) {
      if ((marker == null ? void 0 : marker[0]) === fence[0] && marker.length >= fence.length && text.trim() === marker) fence = void 0;
      continue;
    }
    if (marker) {
      fence = marker;
      continue;
    }
    result.push({ text, line });
  }
  return result;
}
function scanHeadings(content) {
  const headings = [];
  const lines = bodyLines(content);
  for (let i = 0; i < lines.length; i++) {
    const { text, line } = lines[i];
    const atx = /^ {0,3}(#{1,6})(?:\s+|$)(.*)$/.exec(text);
    if (atx) {
      headings.push({ name: atx[2].replace(/\s+#+\s*$/, "").trim(), line, endLine: line, level: atx[1].length });
    } else if (/^ {0,3}(=+|-+)\s*$/.test(text) && i > 0) {
      const previous = lines[i - 1];
      if (previous.line === line - 1 && previous.text.trim() && !/^\s*[-*>#]/.test(previous.text)) {
        headings.push({ name: previous.text.trim(), line: line - 1, endLine: line, level: text.trim()[0] === "=" ? 1 : 2 });
      }
    }
  }
  return headings;
}
function splitDestination(value) {
  const target = value.trim().replace(/^~?\[\[|\]\]$/g, "").split("|", 1)[0];
  const separator = target.indexOf("#");
  const path = (separator < 0 ? target : target.slice(0, separator)).trim();
  const heading = separator < 0 ? void 0 : target.slice(separator + 1).trim() || void 0;
  if (!path || /[\r\n]/.test(target)) throw new Error("Enter a destination note.");
  return { path: /\.md$/i.test(path) ? path : `${path}.md`, heading };
}
function destinationString(path, heading) {
  return `${path}${heading ? `#${heading}` : ""}`;
}

// src/parser.ts
var CHECKBOX = /^(\s*)-\s+\[([ xX])\]\s+(.*)$/;
var PRIORITY = /(?:^|\s)p([123])\s*$/i;
var DEADLINE = /(?:^|\s)\{([^{}]+)\}\s*$/;
var SCHEDULED = /(?:^|\s)(\[\[([^\]]+)\]\](?:\s+([^{}[\]]+))?)\s*$/;
var DURATION = /(?:^|\s)((?:\d+h)?(?:\d+m)?)\s*$/i;
var DESTINATION = /(?:^|\s)~\[\[([^\]]+)\]\]\s*$/;
function normalizeDestination(value) {
  try {
    const { path, heading } = splitDestination(value);
    return destinationString(path, heading);
  } catch (e) {
    return void 0;
  }
}
function indentWidth(value) {
  return [...value].reduce((total, character) => total + (character === "	" ? 4 : 1), 0);
}
function durationToMinutes(value) {
  var _a, _b;
  if (!value || !/^((\d+)h)?((\d+)m)?$/i.test(value)) return void 0;
  const hours = (_a = /([0-9]+)h/i.exec(value)) == null ? void 0 : _a[1];
  const minutes = (_b = /([0-9]+)m/i.exec(value)) == null ? void 0 : _b[1];
  const total = Number(hours != null ? hours : 0) * 60 + Number(minutes != null ? minutes : 0);
  return total > 0 ? total : void 0;
}
function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours ? `${hours}h` : ""}${remainder ? `${remainder}m` : ""}`;
}
function parseTaskLine(line, reference = /* @__PURE__ */ new Date(), dateFormat, naturalDates = false, tokenRanges) {
  const checkbox = CHECKBOX.exec(line);
  if (!checkbox) return void 0;
  let remainder = checkbox[3].trimEnd();
  const metadata = {};
  const consumed = /* @__PURE__ */ new Set();
  const recordToken = (kind, match) => {
    const offset = line.length - checkbox[3].length;
    tokenRanges == null ? void 0 : tokenRanges.push({ kind, from: offset + match.index + match[0].search(/\S/), to: offset + remainder.trimEnd().length });
  };
  for (; ; ) {
    let match;
    let changed = false;
    if (!consumed.has("destination") && (match = DESTINATION.exec(remainder))) {
      const destination = normalizeDestination(match[1]);
      if (destination) {
        metadata.destination = destination;
        remainder = remainder.slice(0, match.index).trimEnd();
        consumed.add("destination");
        changed = true;
      }
    } else if (!consumed.has("priority") && (match = PRIORITY.exec(remainder))) {
      metadata.priority = Number(match[1]);
      recordToken("priority", match);
      remainder = remainder.slice(0, match.index).trimEnd();
      consumed.add("priority");
      changed = true;
    } else if (!consumed.has("deadline") && (match = DEADLINE.exec(remainder))) {
      const date = parseDateTimeExpression(match[1], reference, dateFormat);
      if (date) {
        metadata.deadline = date.date;
        if (date.time) metadata.deadlineTime = date.time;
        recordToken("deadline", match);
        remainder = remainder.slice(0, match.index).trimEnd();
        consumed.add("deadline");
        changed = true;
      }
    } else if (!consumed.has("duration") && (match = DURATION.exec(remainder))) {
      const minutes = durationToMinutes(match[1]);
      if (minutes) {
        metadata.durationMinutes = minutes;
        recordToken("durationMinutes", match);
        remainder = remainder.slice(0, match.index).trimEnd();
        consumed.add("duration");
        changed = true;
      }
    } else if (!consumed.has("scheduled") && (match = SCHEDULED.exec(remainder))) {
      const date = parseDateTimeExpression(match[1], reference, dateFormat);
      if (date) {
        metadata.scheduledDate = date.date;
        if (date.time) metadata.scheduledTime = date.time;
        recordToken("scheduledDate", match);
        remainder = remainder.slice(0, match.index).trimEnd();
        consumed.add("scheduled");
        changed = true;
      }
    }
    if (!changed && naturalDates && !consumed.has("deadline")) {
      const date = findInputDeadline(remainder, reference, dateFormat);
      if (date) {
        metadata.deadline = date.date;
        if (date.time) metadata.deadlineTime = date.time;
        remainder = `${remainder.slice(0, date.index)} ${remainder.slice(date.index + date.text.length)}`.replace(/ {2,}/g, " ").trim();
        consumed.add("deadline");
        changed = true;
      }
    }
    if (!changed && naturalDates && !consumed.has("scheduled")) {
      const date = findInputDate(remainder, reference);
      if (date) {
        metadata.scheduledDate = date.date;
        if (date.time) metadata.scheduledTime = date.time;
        remainder = `${remainder.slice(0, date.index)}${remainder.slice(date.index + date.text.length)}`.replace(/ {2,}/g, " ").trim();
        consumed.add("scheduled");
        changed = true;
      }
    }
    if (!changed) break;
  }
  return {
    title: remainder.trim(),
    indent: indentWidth(checkbox[1]),
    completed: checkbox[2].toLowerCase() === "x",
    ...metadata
  };
}
function parseTaskInput(input, reference = /* @__PURE__ */ new Date(), dateFormat, naturalDates = true) {
  const normalized = /^\s*-\s+\[[ xX]\]\s+/.test(input) ? input : `- [ ] ${input}`;
  return parseTaskLine(normalized, reference, dateFormat, naturalDates);
}
function serializeTask(draft, dateFormat) {
  const indent = " ".repeat(Math.max(0, draft.indent));
  const title = draft.title.trim();
  const metadata = [
    draft.scheduledDate ? `[[${formatDate(draft.scheduledDate, dateFormat)}]]${draft.scheduledTime ? ` ${draft.scheduledTime}` : ""}` : "",
    draft.durationMinutes ? formatDuration(draft.durationMinutes) : "",
    draft.deadline ? `{[[${formatDate(draft.deadline, dateFormat)}]]${draft.deadlineTime ? ` ${draft.deadlineTime}` : ""}}` : "",
    draft.priority ? `p${draft.priority}` : ""
  ].filter(Boolean);
  const metadataGap = metadata.length ? " " : "";
  return `${indent}- [${draft.completed ? "x" : " "}] ${title}${metadataGap}${metadata.join(" ")}`;
}
function serializeTaskInput(draft, dateFormat) {
  const { path, heading } = splitDestination(draft.destination);
  const destination = destinationString(path.replace(/\.md$/i, ""), heading);
  return `${serializeTask(draft, dateFormat)} ~[[${destination}]]`;
}
function scanTasks(path, content, reference = /* @__PURE__ */ new Date(), dateFormat) {
  const tasks = [];
  const stack = [];
  const headings = new Map(scanHeadings(content).map((heading) => [heading.line, heading]));
  let section;
  for (const { text: line, line: lineNumber } of bodyLines(content)) {
    const heading = headings.get(lineNumber);
    if (heading) {
      section = heading;
      stack.length = 0;
    }
    const parsed = parseTaskLine(line, reference, dateFormat);
    if (!parsed) continue;
    while (stack.length && stack[stack.length - 1].indent >= parsed.indent) stack.pop();
    const parent = stack[stack.length - 1];
    const task = {
      id: `${path}:${lineNumber}`,
      path,
      line: lineNumber,
      endLine: lineNumber,
      raw: line,
      section: section == null ? void 0 : section.name,
      sectionLine: section == null ? void 0 : section.line,
      childIds: [],
      parentId: parent == null ? void 0 : parent.id,
      ...parsed
    };
    parent == null ? void 0 : parent.childIds.push(task.id);
    tasks.push(task);
    stack.push(task);
  }
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    let endLine = task.line;
    for (let candidateIndex = index + 1; candidateIndex < tasks.length; candidateIndex += 1) {
      const candidate = tasks[candidateIndex];
      if (candidate.sectionLine !== task.sectionLine || candidate.indent <= task.indent) break;
      endLine = candidate.line;
    }
    task.endLine = endLine;
  }
  return tasks;
}

// src/project-properties.ts
function parseProjectProperties(frontmatter, dateFormat) {
  var _a, _b, _c, _d;
  const values = new Map(Object.entries(frontmatter != null ? frontmatter : {}).map(([key, value]) => [key.toLowerCase().replace(/[\s_-]/g, ""), value]));
  const scalar = (value) => {
    if (Array.isArray(value) && value.length === 1) value = value[0];
    return typeof value === "string" || typeof value === "number" ? String(value).trim() : void 0;
  };
  const date = (value) => {
    var _a2;
    const text = scalar(value);
    if (!text) return void 0;
    const link = /^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(text);
    return parseDateExpression((_a2 = link == null ? void 0 : link[1]) != null ? _a2 : text, /* @__PURE__ */ new Date(), dateFormat);
  };
  const rawPriority = (_a = scalar(values.get("priority"))) == null ? void 0 : _a.toLowerCase();
  const priorities = { "1": 1, p1: 1, high: 1, "2": 2, p2: 2, medium: 2, "3": 3, p3: 3, low: 3 };
  const rawDuration = scalar(values.get("duration"));
  const minutes = rawDuration && /^\d+$/.test(rawDuration) ? Number(rawDuration) : void 0;
  const durationMinutes = minutes !== void 0 ? Number.isSafeInteger(minutes) && minutes > 0 ? minutes : void 0 : durationToMinutes((_b = rawDuration == null ? void 0 : rawDuration.replace(/\s+/g, "")) != null ? _b : "");
  return {
    scheduledDate: date((_d = (_c = values.get("date")) != null ? _c : values.get("startdate")) != null ? _d : values.get("scheduleddate")),
    endDate: date(values.get("enddate")),
    deadline: date(values.get("deadline")),
    priority: rawPriority && Object.prototype.hasOwnProperty.call(priorities, rawPriority) ? priorities[rawPriority] : void 0,
    durationMinutes
  };
}
function addProjectProperties(frontmatter) {
  const rawTags = frontmatter.tags;
  const tags = Array.isArray(rawTags) ? [...rawTags] : typeof rawTags === "string" ? rawTags.split(/[,\s]+/).filter(Boolean) : [];
  if (!tags.some((tag) => typeof tag === "string" && /^#?project(?:\/|$)/.test(tag))) tags.push("project");
  frontmatter.tags = tags;
  const keys = new Set(Object.keys(frontmatter).map((key) => key.toLowerCase().replace(/[\s_-]/g, "")));
  for (const [name, aliases] of [
    ["date", ["date", "startdate", "scheduleddate"]],
    ["end date", ["enddate"]],
    ["deadline", ["deadline"]],
    ["priority", ["priority"]],
    ["duration", ["duration"]]
  ]) {
    if (!aliases.some((alias) => keys.has(alias))) frontmatter[name] = null;
  }
}
function parseProjectParent(frontmatter) {
  var _a, _b;
  let value = (_a = Object.entries(frontmatter != null ? frontmatter : {}).find(([key]) => key.trim().toLowerCase() === "parent")) == null ? void 0 : _a[1];
  if (Array.isArray(value)) value = value.length === 1 ? value[0] : void 0;
  if (typeof value !== "string") return void 0;
  const text = value.trim();
  const link = /^\[\[([^\]]+)\]\]$/.exec(text);
  const path = ((_b = link == null ? void 0 : link[1]) != null ? _b : text).split(/[|#]/, 1)[0].trim();
  return path && !/[\r\n\[\]]/.test(path) ? path : void 0;
}
function updateProjectDate(frontmatter, field2, value, expected, dateFormat) {
  var _a, _b, _c;
  if (!parseDateExpression(value)) throw new Error("Invalid project date.");
  const current = parseProjectProperties(frontmatter, dateFormat);
  for (const key2 of ["scheduledDate", "endDate", "deadline"]) {
    if (current[key2] !== expected[key2]) throw new Error("Project dates changed while dragging. Refresh and try again.");
  }
  const aliases = field2 === "scheduledDate" ? ["date", "startdate", "scheduleddate"] : field2 === "endDate" ? ["enddate"] : ["deadline"];
  const keys = Object.keys(frontmatter);
  const matches = aliases.map((alias) => keys.find((key2) => key2.toLowerCase().replace(/[\s_-]/g, "") === alias)).filter((key2) => Boolean(key2));
  const key = (_b = (_a = matches.find((key2) => frontmatter[key2] !== null && frontmatter[key2] !== void 0)) != null ? _a : matches[0]) != null ? _b : field2 === "scheduledDate" ? "date" : field2 === "endDate" ? "end date" : "deadline";
  const original = frontmatter[key];
  const raw = Array.isArray(original) ? original[0] : original;
  const link = typeof raw === "string" ? /^\[\[[^\]|]+(\|[^\]]*)?\]\]$/.exec(raw.trim()) : void 0;
  const formatted = link ? `[[${formatDate(value, dateFormat)}${(_c = link[1]) != null ? _c : ""}]]` : value;
  frontmatter[key] = Array.isArray(original) && original.length === 1 ? [formatted] : formatted;
}
function updateProjectDates(frontmatter, changes, expected, dateFormat) {
  const next = { ...frontmatter };
  let snapshot = expected;
  for (const field2 of ["scheduledDate", "endDate", "deadline"]) {
    const value = changes[field2];
    if (value === void 0) continue;
    updateProjectDate(next, field2, value, snapshot, dateFormat);
    snapshot = parseProjectProperties(next, dateFormat);
  }
  Object.assign(frontmatter, next);
}

// src/gantt-view.ts
var import_obsidian2 = require("obsidian");

// src/calendar.ts
var SLOT_MINUTES = 15;
function localDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}
function addDays(iso, days) {
  const date = localDate(iso);
  date.setDate(date.getDate() + days);
  return formatLocalDate(date);
}
function calendarDate(task) {
  var _a;
  return (_a = task.scheduledDate) != null ? _a : task.deadline;
}
function calendarTime(task) {
  return task.scheduledDate ? task.scheduledTime : task.deadlineTime;
}
function timeMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}
function minuteTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
function selectionPreset(date, first, last) {
  const start = Math.max(0, Math.min(95, Math.min(first, last))) * SLOT_MINUTES;
  const end = (Math.max(0, Math.min(95, Math.max(first, last))) + 1) * SLOT_MINUTES;
  return { scheduledDate: date, scheduledTime: minuteTime(start), durationMinutes: end - start };
}
function calendarDays(anchor, scope) {
  const date = localDate(anchor);
  if (scope === "month") date.setDate(1);
  date.setDate(date.getDate() - (date.getDay() + 6) % 7);
  const start = formatLocalDate(date);
  return Array.from({ length: scope === "week" ? 7 : 42 }, (_, index) => addDays(start, index));
}
function shiftCalendar(anchor, scope, direction) {
  if (scope === "day" || scope === "week") return addDays(anchor, direction * (scope === "week" ? 7 : 1));
  const date = localDate(anchor);
  const day = date.getDate();
  date.setDate(1);
  if (scope === "month") date.setMonth(date.getMonth() + direction);
  else date.setFullYear(date.getFullYear() + direction);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  return formatLocalDate(date);
}
function rescheduledDraft(task, date, time) {
  return {
    ...task,
    scheduledDate: date,
    scheduledTime: time != null ? time : task.scheduledTime,
    destination: destinationString(task.path, task.section)
  };
}
function resizedRange(begin, end, edge, target) {
  const snapped = Math.round(target / SLOT_MINUTES) * SLOT_MINUTES;
  const start = edge === "start" ? Math.max(0, Math.min(end - SLOT_MINUTES, snapped)) : begin;
  const finish = edge === "end" ? Math.min(1440, Math.max(begin + SLOT_MINUTES, snapped)) : end;
  return { start, duration: finish - start };
}

// src/project-hierarchy.ts
function projectHierarchy(projects) {
  var _a, _b, _c;
  const ordered = [...projects].sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  const visible = new Set(ordered.map((project) => project.path));
  const parents = new Map(ordered.map((project) => [project.path, project.parentPath && visible.has(project.parentPath) ? project.parentPath : void 0]));
  const checked = /* @__PURE__ */ new Set();
  for (const project of ordered) {
    const chain = [];
    const positions = /* @__PURE__ */ new Map();
    let path = project.path;
    while (path && !checked.has(path)) {
      const cycle = positions.get(path);
      if (cycle !== void 0) {
        for (const member of chain.slice(cycle)) parents.set(member, void 0);
        break;
      }
      positions.set(path, chain.length);
      chain.push(path);
      path = parents.get(path);
    }
    for (const member of chain) checked.add(member);
  }
  const children = /* @__PURE__ */ new Map();
  for (const project of ordered) {
    const parent = parents.get(project.path);
    const group = (_a = children.get(parent)) != null ? _a : [];
    group.push(project);
    children.set(parent, group);
  }
  const result = [];
  const pending = ((_b = children.get(void 0)) != null ? _b : []).map((project) => ({ project, depth: 0 })).reverse();
  while (pending.length) {
    const entry = pending.pop();
    result.push(entry);
    for (const child of [...(_c = children.get(entry.project.path)) != null ? _c : []].reverse()) pending.push({ project: child, depth: entry.depth + 1 });
  }
  return result;
}

// src/gantt.ts
var GANTT_ZOOMS = {
  week: { days: 14, width: 64 },
  month: { days: 35, width: 32 },
  quarter: { days: 91, width: 18 }
};
function daysBetween(start, end) {
  const utc = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(end) - utc(start)) / 864e5);
}
function ganttRange(project) {
  var _a;
  const start = project.scheduledDate;
  const end = (_a = project.deadline) != null ? _a : project.endDate;
  if (!start || !end || end < start) return void 0;
  return { start, end, finishField: project.deadline ? "deadline" : "endDate", ...project.deadline && project.endDate ? { marker: project.endDate } : {} };
}
function resizeProjectDate(project, handle, delta) {
  const range = ganttRange(project);
  if (!range) throw new Error("Set a start date and a valid end date or deadline first.");
  const field2 = handle === "start" ? "scheduledDate" : handle === "end" ? "endDate" : range.finishField;
  const original = project[field2];
  if (!original) throw new Error("This project has no end date to move.");
  let value = addDays(original, Math.round(delta));
  if (field2 === "scheduledDate") {
    const limit = project.endDate && project.endDate < range.end ? project.endDate : range.end;
    if (value > limit) value = limit;
  } else if (value < range.start) value = range.start;
  return { field: field2, value };
}
function ganttDateAt(anchor, offset, dayWidth, days) {
  return addDays(anchor, Math.max(0, Math.min(days - 1, Math.floor(offset / dayWidth))));
}
function ganttSelection(first, last) {
  return first <= last ? { scheduledDate: first, endDate: last } : { scheduledDate: last, endDate: first };
}

// src/gantt-view.ts
function renderGantt(container, options) {
  const root = container.createDiv({ cls: "tm-gantt" });
  const { days, width } = GANTT_ZOOMS[options.zoom];
  const start = options.anchor;
  const end = addDays(start, days - 1);
  const toolbar = root.createDiv({ cls: "tm-calendar-toolbar" });
  for (const [delta, icon, label] of [[-1, "chevron-left", "Previous period"], [1, "chevron-right", "Next period"]]) {
    const button = toolbar.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label, title: label } });
    (0, import_obsidian2.setIcon)(button, icon);
    button.addEventListener("click", () => options.navigate(addDays(start, delta * days), options.zoom));
  }
  const today2 = toolbar.createEl("button", { text: "Today" });
  today2.addEventListener("click", () => options.navigate(addDays(todayIso(), -2), options.zoom));
  const first = toolbar.createEl("button", { text: "First project" });
  const earliest = options.projects.map((project) => project.scheduledDate).filter((date) => Boolean(date)).sort()[0];
  first.disabled = !earliest;
  first.addEventListener("click", () => {
    if (earliest) options.navigate(addDays(earliest, -1), options.zoom);
  });
  toolbar.createEl("h2", { text: `${formatDate(start, options.dateFormat)} \u2013 ${formatDate(end, options.dateFormat)}` });
  const zoom = toolbar.createEl("select", { attr: { "aria-label": "Gantt zoom" } });
  for (const value of ["week", "month", "quarter"]) zoom.createEl("option", { value, text: value[0].toUpperCase() + value.slice(1) });
  zoom.value = options.zoom;
  zoom.addEventListener("change", () => options.navigate(start, zoom.value));
  const scroll = root.createDiv({ cls: "tm-gantt-scroll", attr: { "aria-label": "Project timeline" } });
  scroll.style.setProperty("--tm-gantt-width", `${days * width}px`);
  scroll.style.setProperty("--tm-gantt-day", `${width}px`);
  const header = scroll.createDiv({ cls: "tm-gantt-row tm-gantt-header" });
  header.createDiv({ cls: "tm-gantt-label", text: "Project" });
  const dates = header.createDiv({ cls: "tm-gantt-dates" });
  for (let index = 0; index < days; index++) {
    const day = addDays(start, index);
    const label = options.zoom === "quarter" ? String(localDate(day).getDate()) : localDate(day).toLocaleDateString(void 0, { month: "short", day: "numeric" });
    dates.createDiv({ cls: `tm-gantt-date${day === todayIso() ? " is-today" : ""}`, text: label, attr: { title: formatDate(day, options.dateFormat) } });
  }
  let busy = false;
  const persist = async (project, changes, rebuild = false) => {
    if (busy) return;
    busy = true;
    root.setAttribute("aria-busy", "true");
    try {
      await options.update(project, changes);
      Object.assign(project, changes);
      if (rebuild && root.isConnected) {
        const left = scroll.scrollLeft;
        const top = scroll.scrollTop;
        root.remove();
        renderGantt(container, options);
        const next = container.querySelector(".tm-gantt-scroll");
        if (next) {
          next.scrollLeft = left;
          next.scrollTop = top;
        }
      }
    } catch (cause) {
      new import_obsidian2.Notice(cause instanceof Error ? cause.message : "Could not update project dates.");
    } finally {
      busy = false;
      root.removeAttribute("aria-busy");
    }
  };
  for (const { project, depth } of projectHierarchy(options.projects)) {
    const row = scroll.createDiv({ cls: `tm-gantt-row${project.archived ? " is-archived" : ""}` });
    const label = row.createEl("button", { cls: "tm-gantt-label", text: project.name, attr: { title: project.path, "aria-label": `Open ${project.name} project note` } });
    label.style.paddingLeft = `${12 + depth * 16}px`;
    label.addEventListener("click", () => options.open(project));
    const track = row.createDiv({ cls: "tm-gantt-track" });
    const todayOffset = daysBetween(start, todayIso());
    if (todayOffset >= 0 && todayOffset < days) {
      const marker = track.createSpan({ cls: "tm-gantt-today" });
      marker.style.left = `${todayOffset * width}px`;
    }
    const range = ganttRange(project);
    if (!range && !project.scheduledDate && !project.endDate && !project.deadline) {
      track.addClass("is-unscheduled");
      track.setAttribute("aria-label", `Drag to schedule ${project.name}`);
      const hint = track.createSpan({ cls: "tm-gantt-undated", text: "Drag to set dates" });
      const selection = track.createDiv({ cls: "tm-gantt-selection" });
      selection.hidden = true;
      let pointer;
      let first2 = "";
      let last = "";
      const dateAt = (event) => ganttDateAt(start, event.clientX - track.getBoundingClientRect().left, width, days);
      const paintSelection = () => {
        const dates2 = ganttSelection(first2, last);
        selection.hidden = false;
        selection.style.left = `${daysBetween(start, dates2.scheduledDate) * width + 2}px`;
        selection.style.width = `${(daysBetween(dates2.scheduledDate, dates2.endDate) + 1) * width - 4}px`;
        selection.setText(`${formatDate(dates2.scheduledDate, options.dateFormat)} \u2013 ${formatDate(dates2.endDate, options.dateFormat)}`);
      };
      const resetSelection = () => {
        pointer = void 0;
        selection.hidden = true;
        hint.hidden = false;
      };
      track.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || busy) return;
        event.preventDefault();
        pointer = event.pointerId;
        first2 = last = dateAt(event);
        hint.hidden = true;
        track.setPointerCapture(event.pointerId);
        paintSelection();
      });
      track.addEventListener("pointermove", (event) => {
        if (pointer !== event.pointerId) return;
        last = dateAt(event);
        paintSelection();
      });
      track.addEventListener("pointerup", (event) => {
        if (pointer !== event.pointerId) return;
        last = dateAt(event);
        const dates2 = ganttSelection(first2, last);
        resetSelection();
        track.releasePointerCapture(event.pointerId);
        void persist(project, dates2, true);
      });
      track.addEventListener("pointercancel", resetSelection);
      track.addEventListener("lostpointercapture", () => {
        if (pointer !== void 0) resetSelection();
      });
      continue;
    }
    if (!range) {
      const missing = !project.scheduledDate ? "Set start date" : !project.deadline && !project.endDate ? "Set end date or deadline" : "Finish is before start";
      const edit = track.createEl("button", { cls: "tm-gantt-jump", text: missing });
      edit.addEventListener("click", () => options.open(project));
      continue;
    }
    const bar = track.createEl("button", { cls: "tm-gantt-bar", text: project.name });
    bar.addEventListener("click", (event) => {
      if (busy) return;
      if (project.endDate || event.detail === 0) {
        options.open(project);
        return;
      }
      const clicked = ganttDateAt(start, event.clientX - track.getBoundingClientRect().left, width, days);
      const date = clicked < range.start ? range.start : clicked > range.end ? range.end : clicked;
      void persist(project, { endDate: date }, true);
    });
    const jump = track.createEl("button", { cls: "tm-gantt-jump", text: `Show ${formatDate(range.start, options.dateFormat)}` });
    jump.addEventListener("click", () => options.navigate(addDays(project.scheduledDate, -1), options.zoom));
    const preview = track.createSpan({ cls: "tm-gantt-preview" });
    preview.hidden = true;
    const handles = /* @__PURE__ */ new Map();
    const fieldFor = (handle) => handle === "start" ? "scheduledDate" : handle === "end" ? "endDate" : project.deadline ? "deadline" : "endDate";
    for (const handle of ["start", "finish", ...range.marker ? ["end"] : []]) {
      const button = track.createEl("button", { cls: `tm-gantt-handle is-${handle}`, attr: { "aria-label": `${project.name}: change ${handle === "start" ? "start date" : handle === "end" || !project.deadline ? "end date" : "deadline"}` } });
      handles.set(handle, button);
    }
    const paint = (candidate) => {
      const span = ganttRange(candidate);
      const from = daysBetween(start, span.start);
      const to = daysBetween(start, span.end) + 1;
      bar.hidden = to <= 0 || from >= days;
      jump.hidden = !bar.hidden;
      bar.style.left = `${Math.max(0, from) * width + 2}px`;
      bar.style.width = `${Math.max(8, (Math.min(days, to) - Math.max(0, from)) * width - 4)}px`;
      bar.setAttribute("title", `${project.name}: ${formatDate(span.start, options.dateFormat)} \u2013 ${formatDate(span.end, options.dateFormat)} (${span.finishField === "deadline" ? "deadline" : "end date"})`);
      for (const [handle, button] of handles) {
        const date = candidate[fieldFor(handle)];
        const offset = daysBetween(start, date);
        button.hidden = offset < 0 || offset >= days;
        button.style.left = `${offset * width + (handle === "finish" ? width - 10 : handle === "end" ? width / 2 - 6 : 2)}px`;
        button.setAttribute("title", `${handle === "start" ? "Start" : fieldFor(handle) === "deadline" ? "Deadline" : "End"}: ${formatDate(date, options.dateFormat)} \u2014 drag or use arrow keys`);
      }
    };
    paint(project);
    for (const [handle, button] of handles) {
      let pointer;
      let origin = 0;
      let delta = 0;
      const reset = () => {
        pointer = void 0;
        delta = 0;
        preview.hidden = true;
        row.removeClass("is-resizing");
        paint(project);
      };
      const save = async (change) => {
        const { field: field2, value } = resizeProjectDate(project, handle, change);
        if (value === project[field2] || busy) return;
        await persist(project, { [field2]: value });
        reset();
      };
      button.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || busy) return;
        event.preventDefault();
        event.stopPropagation();
        pointer = event.pointerId;
        origin = event.clientX;
        delta = 0;
        button.setPointerCapture(event.pointerId);
      });
      button.addEventListener("pointermove", (event) => {
        if (pointer !== event.pointerId) return;
        delta = Math.round((event.clientX - origin) / width);
        const { field: field2, value } = resizeProjectDate(project, handle, delta);
        paint({ ...project, [field2]: value });
        row.addClass("is-resizing");
        preview.hidden = false;
        preview.setText(`${field2 === "scheduledDate" ? "Start" : field2 === "deadline" ? "Deadline" : "End"}: ${formatDate(value, options.dateFormat)}`);
      });
      button.addEventListener("pointerup", (event) => {
        if (pointer !== event.pointerId) return;
        const change = delta;
        reset();
        button.releasePointerCapture(event.pointerId);
        void save(change);
      });
      button.addEventListener("pointercancel", reset);
      button.addEventListener("lostpointercapture", () => {
        if (pointer !== void 0) reset();
      });
      button.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        void save(event.key === "ArrowLeft" ? -1 : 1);
      });
    }
  }
}

// src/task-properties.ts
var TASK_PROPERTIES = [
  { key: "title", label: "Title", kind: "text" },
  { key: "status", label: "Status", kind: "choice" },
  { key: "priority", label: "Priority", kind: "choice" },
  { key: "scheduledDate", label: "Scheduled date", kind: "date" },
  { key: "scheduledTime", label: "Scheduled time", kind: "time" },
  { key: "deadline", label: "Deadline", kind: "date" },
  { key: "deadlineTime", label: "Deadline time", kind: "time" },
  { key: "duration", label: "Duration", kind: "number" },
  { key: "source", label: "Source note / list", kind: "choice" },
  { key: "section", label: "Section", kind: "choice" }
];
function propertyValue(task, property) {
  if (property === "status") return task.completed ? "Completed" : "Open";
  if (property === "source") return task.path;
  if (property === "duration") return task.durationMinutes;
  return task[property];
}
function propertyLabel(property, value) {
  return property === "priority" ? `P${value}` : property === "duration" ? formatDuration(Number(value)) : String(value);
}
function filterOperators(kind) {
  const common = [["has", "Has a value"], ["missing", "Doesn't have a value"], ["is", "Is"], ["isNot", "Is not"]];
  if (kind === "text") common.push(["contains", "Contains"]);
  if (["date", "time", "number"].includes(kind)) common.push(["before", kind === "number" ? "Less than" : "Before"], ["after", kind === "number" ? "Greater than" : "After"], ["between", "Between (inclusive)"]);
  return common;
}
function matchesFilter(task, filter) {
  var _a;
  const value = propertyValue(task, filter.property);
  const present = value !== void 0 && value !== "";
  if (filter.operator === "has") return present;
  if (filter.operator === "missing") return !present;
  if (!present) return false;
  const normalized = String(value).toLocaleLowerCase();
  const values = filter.values.map((item) => item.toLocaleLowerCase());
  if (filter.operator === "is") return values.includes(normalized);
  if (filter.operator === "isNot") return !values.includes(normalized);
  if (filter.operator === "contains") return normalized.includes((_a = values[0]) != null ? _a : "");
  const numeric = filter.property === "duration";
  const actual = numeric ? Number(value) : normalized;
  const lower = numeric ? Number(values[0]) : values[0];
  const upper = numeric ? Number(values[1]) : values[1];
  if (!values[0] || filter.operator === "between" && !values[1]) return false;
  if (filter.operator === "before") return actual < lower;
  if (filter.operator === "after") return actual > lower;
  return actual >= lower && actual <= upper;
}

// src/query.ts
function taskMatchesQuery(task, query, inboxPath, now2 = /* @__PURE__ */ new Date()) {
  var _a, _b;
  if ((_a = query.filters) == null ? void 0 : _a.some((filter) => !matchesFilter(task, filter))) return false;
  if (!query.showCompleted && !((_b = query.filters) == null ? void 0 : _b.some((filter) => filter.property === "status")) && task.completed) return false;
  if (query.sourcePath && task.path !== query.sourcePath) return false;
  if (query.projectPath && task.path !== query.projectPath) return false;
  if (query.priority && task.priority !== query.priority) return false;
  if (query.search && !task.title.toLocaleLowerCase().includes(query.search.toLocaleLowerCase())) return false;
  const today2 = todayIso(now2);
  const date = actionDate(task);
  if (query.dateFilter === "dated" && !date) return false;
  if (query.dateFilter === "undated" && date) return false;
  if (query.dateFilter === "overdue" && (!date || date >= today2)) return false;
  switch (query.mode) {
    case "inbox":
      return task.path === inboxPath;
    case "today":
      return Boolean(date && date <= today2);
    case "upcoming":
      return Boolean(date && date > today2);
    case "project":
      return task.path === query.projectPath;
    case "projects":
      return false;
    case "all":
      return true;
  }
}
function sortTasks(tasks, sort = "date", descending = false) {
  return [...tasks].sort((left, right) => {
    var _a, _b, _c, _d;
    const leftDate = (_a = actionDate(left)) != null ? _a : "9999-12-31";
    const rightDate = (_b = actionDate(right)) != null ? _b : "9999-12-31";
    const leftValue = sort === "date" ? leftDate : propertyValue(left, sort);
    const rightValue = sort === "date" ? rightDate : propertyValue(right, sort);
    if (leftValue === void 0 || leftValue === "") return rightValue === void 0 || rightValue === "" ? 0 : 1;
    if (rightValue === void 0 || rightValue === "") return -1;
    const comparison = (typeof leftValue === "number" && typeof rightValue === "number" ? leftValue - rightValue : String(leftValue).localeCompare(String(rightValue))) || (sort === "source" ? left.line - right.line : sort === "date" ? ((_c = left.priority) != null ? _c : 4) - ((_d = right.priority) != null ? _d : 4) : 0);
    return comparison * (descending ? -1 : 1) || left.path.localeCompare(right.path) || left.line - right.line;
  });
}
function groupTasks(tasks, grouping) {
  var _a;
  const groups = /* @__PURE__ */ new Map();
  for (const task of tasks) {
    const value = grouping === "date" ? actionDate(task) : propertyValue(task, grouping);
    const key = value === void 0 || value === "" ? `No ${grouping === "date" ? "date" : grouping === "scheduledDate" ? "scheduled date" : grouping === "scheduledTime" ? "scheduled time" : grouping === "deadlineTime" ? "deadline time" : grouping}` : grouping === "date" ? String(value) : propertyLabel(grouping, value);
    const group = (_a = groups.get(key)) != null ? _a : [];
    group.push(task);
    groups.set(key, group);
  }
  return groups;
}
function orderTaskTree(tasks) {
  var _a;
  const visibleIds = new Set(tasks.map((task) => task.id));
  const children = /* @__PURE__ */ new Map();
  const roots = [];
  for (const task of tasks) {
    if (task.parentId && visibleIds.has(task.parentId)) {
      const siblings = (_a = children.get(task.parentId)) != null ? _a : [];
      siblings.push(task);
      children.set(task.parentId, siblings);
    } else roots.push(task);
  }
  const result = [];
  const append = (task) => {
    var _a2;
    result.push(task);
    for (const child of (_a2 = children.get(task.id)) != null ? _a2 : []) append(child);
  };
  for (const root of roots) append(root);
  return result;
}

// src/list-drag.ts
function taskGroupTarget(property, exemplar) {
  return {
    property,
    value: property === "date" ? actionDate(exemplar) : propertyValue(exemplar, property),
    destination: property === "source" ? exemplar.path : property === "section" ? destinationString(exemplar.path, exemplar.section) : void 0,
    scheduledDate: exemplar.scheduledDate,
    deadline: exemplar.deadline
  };
}
function draftForGroup(task, group) {
  const draft = { ...task, destination: destinationString(task.path, task.section) };
  if (!group) return draft;
  if (group.destination) draft.destination = group.destination;
  const value = group.value;
  switch (group.property) {
    case "date": {
      const date = value;
      if (!date) {
        draft.scheduledDate = draft.scheduledTime = draft.deadline = draft.deadlineTime = void 0;
      } else {
        const original = actionDate(task);
        if (task.deadline && task.deadline === original) draft.deadline = date;
        else draft.scheduledDate = date;
        if (draft.scheduledDate && draft.scheduledDate < date) draft.scheduledDate = date;
        if (draft.deadline && draft.deadline < date) draft.deadline = date;
      }
      break;
    }
    case "scheduledDate":
      draft.scheduledDate = value;
      if (!value) draft.scheduledTime = void 0;
      break;
    case "deadline":
      draft.deadline = value;
      if (!value) draft.deadlineTime = void 0;
      break;
    case "scheduledTime":
      draft.scheduledTime = value;
      if (value && !draft.scheduledDate) draft.scheduledDate = group.scheduledDate;
      break;
    case "deadlineTime":
      draft.deadlineTime = value;
      if (value && !draft.deadline) draft.deadline = group.deadline;
      break;
    case "priority":
      draft.priority = value;
      break;
    case "duration":
      draft.durationMinutes = value;
      break;
    case "status":
      draft.completed = value === "Completed";
      break;
    case "title":
      if (typeof value === "string") draft.title = value;
      break;
  }
  return draft;
}

// src/kanban.ts
function kanbanColumns(tasks, grouping) {
  if (grouping === "none") return [{ title: "Tasks", tasks }];
  const property = grouping === "default" ? "status" : grouping;
  const groups = groupTasks(tasks, property);
  if (property === "status") return ["Open", "Completed"].map((title) => {
    var _a;
    return { title, tasks: (_a = groups.get(title)) != null ? _a : [], target: { property, value: title } };
  });
  if (property === "priority") return [1, 2, 3, void 0].map((value) => {
    var _a;
    const title = value ? `P${value}` : "No priority";
    return { title, tasks: (_a = groups.get(title)) != null ? _a : [], target: { property, value } };
  });
  return [...groups].map(([title, tasks2]) => ({ title, tasks: tasks2, target: taskGroupTarget(property, tasks2[0]) }));
}

// src/list-drag-view.ts
var import_obsidian3 = require("obsidian");
var ListDragController = class {
  constructor(getTask, drop, allowNesting = true) {
    this.getTask = getTask;
    this.drop = drop;
    this.allowNesting = allowNesting;
    this.busy = false;
    this.targets = /* @__PURE__ */ new Map();
  }
  clear() {
    var _a;
    (_a = this.highlighted) == null ? void 0 : _a.removeAttribute("data-drop-position");
    this.highlighted = void 0;
  }
  mark(element, position) {
    this.clear();
    element.setAttribute("data-drop-position", position);
    this.highlighted = element;
  }
  commit(group, anchor, placement) {
    const original = this.original;
    this.taskId = void 0;
    this.clear();
    if (!original || this.busy) return;
    this.busy = true;
    void this.drop(original, group, anchor, placement).finally(() => {
      this.busy = false;
    });
  }
  group(element, group) {
    this.targets.set(element, () => ({ group, indicator: "group" }));
    element.addEventListener("dragover", (event) => {
      if (!this.taskId || this.busy) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      this.mark(element, "group");
    });
    element.addEventListener("dragleave", (event) => {
      if (!element.contains(event.relatedTarget)) this.clear();
    });
    element.addEventListener("drop", (event) => {
      if (!this.taskId) return;
      event.preventDefault();
      event.stopPropagation();
      this.commit(group);
    });
  }
  row(row, primary, task, group) {
    const handle = primary.createEl("button", { cls: "clickable-icon tm-list-drag-handle", attr: { "aria-label": `Drag ${task.title}`, title: "Drag to reorder; drop to the right to nest, or to the left to outdent" } });
    (0, import_obsidian3.setIcon)(handle, "grip-vertical");
    primary.prepend(handle);
    row.draggable = true;
    row.addEventListener("dragstart", (event) => {
      if (this.busy || event.target instanceof HTMLElement && event.target.closest("input")) {
        event.preventDefault();
        return;
      }
      this.taskId = task.id;
      this.original = task;
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", task.id);
      }
      row.addClass("is-dragging");
    });
    row.addEventListener("dragend", () => {
      this.taskId = void 0;
      row.removeClass("is-dragging");
      this.clear();
    });
    const intent = (event) => {
      const rect = row.getBoundingClientRect();
      const left = primary.getBoundingClientRect().left;
      let anchor = task;
      let placement = this.allowNesting && event.clientX > left + 64 ? "child" : event.clientY < rect.top + rect.height / 2 ? "before" : "after";
      if (this.allowNesting && event.clientX < left - 16 && anchor.parentId) {
        let levels = Math.max(1, Math.floor((left - event.clientX) / 24));
        while (anchor.parentId && levels-- > 0) {
          const parent = this.getTask(anchor.parentId);
          if (!parent) break;
          anchor = parent;
        }
        placement = "after";
      }
      return { anchor, placement };
    };
    this.targets.set(row, (point) => {
      const result = intent(point);
      return { ...result, group, indicator: result.anchor.id !== task.id ? "outdent" : result.placement };
    });
    let pointer;
    let origin = { x: 0, y: 0 };
    let dragging = false;
    const hit = (event) => {
      let element = row.ownerDocument.elementFromPoint(event.clientX, event.clientY);
      while (element) {
        const resolve = this.targets.get(element);
        if (resolve) return { element, target: resolve(event) };
        element = element.parentElement;
      }
      return void 0;
    };
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || this.busy) return;
      event.preventDefault();
      event.stopPropagation();
      pointer = event.pointerId;
      origin = { x: event.clientX, y: event.clientY };
      dragging = false;
      row.draggable = false;
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener("pointermove", (event) => {
      if (pointer !== event.pointerId) return;
      if (!dragging && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 5) return;
      dragging = true;
      this.taskId = task.id;
      this.original = task;
      row.addClass("is-dragging");
      const found = hit(event);
      if (found) this.mark(found.element, found.target.indicator);
      else this.clear();
    });
    const reset = () => {
      pointer = void 0;
      dragging = false;
      row.draggable = true;
      row.removeClass("is-dragging");
      this.taskId = void 0;
      this.clear();
    };
    handle.addEventListener("pointerup", (event) => {
      if (pointer !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const found = dragging ? hit(event) : void 0;
      if (found) this.commit(found.target.group, found.target.anchor, found.target.placement);
      reset();
      handle.releasePointerCapture(event.pointerId);
    });
    handle.addEventListener("pointercancel", reset);
    handle.addEventListener("lostpointercapture", reset);
    row.addEventListener("dragover", (event) => {
      if (!this.taskId || this.busy) return;
      event.preventDefault();
      event.stopPropagation();
      const { anchor, placement } = intent(event);
      this.mark(row, anchor.id !== task.id ? "outdent" : placement);
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    });
    row.addEventListener("dragleave", (event) => {
      if (!row.contains(event.relatedTarget)) this.clear();
    });
    row.addEventListener("drop", (event) => {
      if (!this.taskId) return;
      event.preventDefault();
      event.stopPropagation();
      const { anchor, placement } = intent(event);
      this.commit(group, anchor, placement);
    });
  }
};

// src/calendar-view.ts
var import_obsidian4 = require("obsidian");
function renderCalendar(container, options) {
  var _a, _b, _c, _d, _e;
  const root = container.createDiv({ cls: "tm-calendar" });
  const byDate = /* @__PURE__ */ new Map();
  for (const task of options.tasks) {
    const key = (_a = calendarDate(task)) != null ? _a : "";
    const group = (_b = byDate.get(key)) != null ? _b : [];
    group.push(task);
    byDate.set(key, group);
  }
  let dragged;
  let moving = false;
  const toolbar = root.createDiv({ cls: "tm-calendar-toolbar" });
  for (const [delta, icon, label] of [[-1, "chevron-left", "Previous period"], [1, "chevron-right", "Next period"]]) {
    const button = toolbar.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label, title: label } });
    (0, import_obsidian4.setIcon)(button, icon);
    button.addEventListener("click", () => options.navigate(shiftCalendar(options.anchor, options.scope, delta), options.scope));
  }
  const today2 = toolbar.createEl("button", { text: "Today" });
  today2.addEventListener("click", () => options.navigate(todayIso(), options.scope));
  const date = localDate(options.anchor);
  const days = options.scope === "week" ? calendarDays(options.anchor, "week") : [];
  const title = options.scope === "day" ? formatDate(options.anchor, options.dateFormat) : options.scope === "week" ? `${formatDate(days[0], options.dateFormat)} \u2013 ${formatDate(days[6], options.dateFormat)}` : options.scope === "year" ? String(date.getFullYear()) : date.toLocaleDateString(void 0, { month: "long", year: "numeric" });
  toolbar.createEl("h2", { text: title });
  const scopes = toolbar.createDiv({ cls: "tm-calendar-scopes", attr: { "aria-label": "Calendar scope" } });
  for (const scope of ["day", "week", "month", "year"]) {
    const button = scopes.createEl("button", { text: scope[0].toUpperCase() + scope.slice(1), attr: { "aria-pressed": String(options.scope === scope) } });
    button.addEventListener("click", () => options.navigate(options.anchor, scope));
  }
  const dropTarget = (element, targetDate, getTime) => {
    element.addEventListener("dragover", (event) => {
      if (!dragged || moving) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      element.addClass("is-drop-target");
    });
    element.addEventListener("dragleave", () => element.removeClass("is-drop-target"));
    element.addEventListener("drop", (event) => {
      element.removeClass("is-drop-target");
      if (!dragged || moving) return;
      event.preventDefault();
      event.stopPropagation();
      const task = dragged;
      dragged = void 0;
      moving = true;
      void options.move(task, targetDate, getTime == null ? void 0 : getTime(event)).catch((cause) => {
        new import_obsidian4.Notice(cause instanceof Error ? cause.message : "Could not reschedule task.");
      }).finally(() => {
        moving = false;
      });
    });
  };
  const taskCard = (parent, task) => {
    const time = calendarTime(task);
    const card = parent.createEl("button", {
      cls: `tm-calendar-task${task.completed ? " is-completed" : ""}`,
      text: `${time ? `${time} ` : ""}${task.title}`,
      attr: { title: `${task.title}${task.durationMinutes ? ` \xB7 ${formatDuration(task.durationMinutes)}` : ""}`, "aria-label": `Edit ${task.title}` }
    });
    card.draggable = true;
    card.addEventListener("click", (event) => {
      event.stopPropagation();
      options.edit(task);
    });
    card.addEventListener("dragstart", (event) => {
      dragged = task;
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", task.id);
      }
    });
    card.addEventListener("dragend", () => {
      dragged = void 0;
      root.querySelectorAll(".is-drop-target").forEach((el) => el.removeClass("is-drop-target"));
    });
    return card;
  };
  const dateCell = (parent, day, compact = false, outside = false) => {
    var _a2;
    const cell = parent.createDiv({ cls: `tm-calendar-cell${day === todayIso() ? " is-today" : ""}${outside ? " is-outside" : ""}` });
    const tasks = (_a2 = byDate.get(day)) != null ? _a2 : [];
    const button = cell.createEl("button", { cls: "tm-calendar-date", text: String(localDate(day).getDate()), attr: { "aria-label": `New task on ${formatDate(day, options.dateFormat)}` } });
    button.addEventListener("click", () => options.create({ scheduledDate: day }));
    cell.addEventListener("click", (event) => {
      if (event.target === cell) options.create({ scheduledDate: day });
    });
    dropTarget(cell, day);
    if (compact) {
      if (tasks.length) {
        const count = cell.createEl("button", { cls: "tm-calendar-count", text: String(tasks.length), attr: { "aria-label": `Show ${tasks.length} tasks on ${day}` } });
        count.addEventListener("click", () => options.navigate(day, "day"));
      }
    } else for (const task of tasks) taskCard(cell, task);
  };
  const monthGrid = (parent, anchor, compact) => {
    const grid = parent.createDiv({ cls: `tm-calendar-grid${compact ? " is-compact" : ""}` });
    for (const weekday of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) grid.createDiv({ cls: "tm-calendar-weekday", text: weekday });
    for (const day of calendarDays(anchor, "month")) dateCell(grid, day, compact, day.slice(0, 7) !== anchor.slice(0, 7));
  };
  const renderHours = (timeline) => {
    for (let hour = 0; hour < 24; hour++) {
      const label = timeline.createDiv({ cls: "tm-calendar-hour", text: minuteTime(hour * 60) });
      label.style.top = `${hour * 48}px`;
    }
  };
  const renderDayLane = (timeline, day) => {
    var _a2;
    const tasks = (_a2 = byDate.get(day)) != null ? _a2 : [];
    const lane = timeline.createDiv({ cls: "tm-calendar-lane", attr: { "aria-label": `Daily schedule for ${day}` } });
    for (let slot = 0; slot < 96; slot++) {
      const button = lane.createEl("button", { cls: "tm-calendar-slot", attr: { "aria-label": `Create task on ${day} at ${minuteTime(slot * 15)}` } });
      button.addEventListener("click", (event) => {
        if (event.detail === 0) options.create(selectionPreset(day, slot, slot));
      });
    }
    const slotAt = (clientY) => Math.max(0, Math.min(95, Math.floor((clientY - lane.getBoundingClientRect().top) / 12)));
    let start;
    let selection;
    const paint = (end) => {
      if (start === void 0 || !selection) return;
      const preset = selectionPreset(day, start, end);
      selection.style.top = `${Math.min(start, end) * 12}px`;
      selection.style.height = `${preset.durationMinutes / 15 * 12}px`;
      selection.setText(`${preset.scheduledTime} \xB7 ${formatDuration(preset.durationMinutes)}`);
    };
    lane.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !(event.target instanceof HTMLElement) || !event.target.hasClass("tm-calendar-slot")) return;
      event.preventDefault();
      start = slotAt(event.clientY);
      lane.setPointerCapture(event.pointerId);
      selection = lane.createDiv({ cls: "tm-calendar-selection" });
      paint(start);
    });
    lane.addEventListener("pointermove", (event) => paint(slotAt(event.clientY)));
    lane.addEventListener("pointerup", (event) => {
      if (start === void 0) return;
      const preset = selectionPreset(day, start, slotAt(event.clientY));
      start = void 0;
      selection == null ? void 0 : selection.remove();
      lane.releasePointerCapture(event.pointerId);
      options.create(preset);
    });
    lane.addEventListener("pointercancel", () => {
      start = void 0;
      selection == null ? void 0 : selection.remove();
    });
    dropTarget(lane, day, (event) => minuteTime(slotAt(event.clientY) * 15));
    const timed = tasks.filter((task) => calendarTime(task)).sort((a, b) => timeMinutes(calendarTime(a)) - timeMinutes(calendarTime(b)));
    const ends = [];
    const placements = timed.map((task) => {
      var _a3;
      const begin = timeMinutes(calendarTime(task));
      const end = Math.min(1440, begin + ((_a3 = task.durationMinutes) != null ? _a3 : 30));
      let column = ends.findIndex((value) => value <= begin);
      if (column < 0) column = ends.length;
      ends[column] = end;
      return { task, begin, end, column };
    });
    for (const { task, begin, end, column } of placements) {
      const card = taskCard(lane, task);
      card.addClass("is-timed");
      card.style.top = `${begin / 15 * 12}px`;
      card.style.height = `${Math.max(12, (end - begin) / 15 * 12)}px`;
      card.style.left = `calc(${column / ends.length * 85}% + 2px)`;
      card.style.width = `calc(${85 / ends.length}% - 4px)`;
      const preview = card.createSpan({ cls: "tm-calendar-resize-preview" });
      const restore = () => {
        card.style.top = `${begin / 15 * 12}px`;
        card.style.height = `${Math.max(12, (end - begin) / 15 * 12)}px`;
        card.removeClass("is-resizing");
        card.draggable = true;
        preview.setText("");
      };
      for (const edge of ["start", "end"]) {
        const handle = card.createSpan({ cls: `tm-calendar-resize-handle is-${edge}`, attr: {
          role: "slider",
          tabindex: "0",
          "aria-label": `Resize ${edge === "start" ? "start time" : "end time"} of ${task.title}`,
          "aria-valuemin": "0",
          "aria-valuemax": "1440",
          "aria-valuenow": String(edge === "start" ? begin : end),
          "aria-valuetext": minuteTime(edge === "start" ? begin : end),
          "aria-orientation": "vertical"
        } });
        let pointer;
        let initialY = 0;
        let range = { start: begin, duration: end - begin };
        const update = (target) => {
          range = resizedRange(begin, end, edge, target);
          card.style.top = `${range.start / 15 * 12}px`;
          card.style.height = `${Math.max(12, range.duration / 15 * 12)}px`;
          preview.setText(`${minuteTime(range.start)} \xB7 ${formatDuration(range.duration)}`);
          const boundary = edge === "start" ? range.start : range.start + range.duration;
          handle.setAttribute("aria-valuenow", String(boundary));
          handle.setAttribute("aria-valuetext", minuteTime(boundary));
        };
        const save = () => {
          if (range.start === begin && range.duration === end - begin) {
            restore();
            return;
          }
          moving = true;
          card.setAttribute("aria-busy", "true");
          void options.resize(task, day, minuteTime(range.start), range.duration).catch((cause) => {
            restore();
            new import_obsidian4.Notice(cause instanceof Error ? cause.message : "Could not resize task.");
          }).finally(() => {
            moving = false;
            card.removeAttribute("aria-busy");
            restore();
          });
        };
        handle.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
        handle.addEventListener("pointerdown", (event) => {
          if (event.button !== 0 || moving) return;
          event.preventDefault();
          event.stopPropagation();
          pointer = event.pointerId;
          initialY = event.clientY;
          range = { start: begin, duration: end - begin };
          card.draggable = false;
          card.addClass("is-resizing");
          handle.setPointerCapture(event.pointerId);
        });
        handle.addEventListener("pointermove", (event) => {
          if (pointer !== event.pointerId) return;
          event.stopPropagation();
          if (Math.abs(event.clientY - initialY) < 3) return;
          update((event.clientY - lane.getBoundingClientRect().top) / 12 * 15);
        });
        handle.addEventListener("pointerup", (event) => {
          if (pointer !== event.pointerId) return;
          event.preventDefault();
          event.stopPropagation();
          pointer = void 0;
          handle.releasePointerCapture(event.pointerId);
          save();
        });
        const cancel = () => {
          if (pointer !== void 0) {
            pointer = void 0;
            restore();
          }
        };
        handle.addEventListener("pointercancel", cancel);
        handle.addEventListener("lostpointercapture", cancel);
        handle.addEventListener("keydown", (event) => {
          if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          if (moving) return;
          update((edge === "start" ? begin : end) + (event.key === "ArrowUp" ? -15 : 15));
          save();
        });
      }
    }
  };
  if (options.scope === "day" || options.scope === "week") {
    if (options.scope === "day") {
      const allDay = root.createDiv({ cls: "tm-calendar-allday" });
      allDay.createSpan({ text: "No time" });
      for (const task of ((_c = byDate.get(options.anchor)) != null ? _c : []).filter((task2) => !calendarTime(task2))) taskCard(allDay, task);
      const scroll = root.createDiv({ cls: "tm-calendar-day-scroll" });
      const timeline = scroll.createDiv({ cls: "tm-calendar-timeline" });
      renderHours(timeline);
      renderDayLane(timeline, options.anchor);
    } else {
      const scroll = root.createDiv({ cls: "tm-calendar-day-scroll tm-calendar-week-scroll" });
      const week = scroll.createDiv({ cls: "tm-calendar-week" });
      const header = week.createDiv({ cls: "tm-calendar-week-header" });
      header.createSpan({ cls: "tm-calendar-week-gutter", text: "No time" });
      for (const day of days) {
        const column = header.createDiv({ cls: `tm-calendar-week-heading${day === todayIso() ? " is-today" : ""}` });
        const button = column.createEl("button", { cls: "tm-calendar-date", text: localDate(day).toLocaleDateString(void 0, { weekday: "short", day: "numeric", month: "short" }), attr: { "aria-label": `New task on ${formatDate(day, options.dateFormat)}` } });
        button.addEventListener("click", () => options.create({ scheduledDate: day }));
        for (const task of ((_d = byDate.get(day)) != null ? _d : []).filter((task2) => !calendarTime(task2))) taskCard(column, task);
        dropTarget(column, day);
      }
      const timeline = week.createDiv({ cls: "tm-calendar-timeline tm-calendar-week-timeline" });
      renderHours(timeline);
      const columns = timeline.createDiv({ cls: "tm-calendar-week-columns" });
      for (const day of days) {
        const column = columns.createDiv({ cls: "tm-calendar-week-day" });
        renderDayLane(column, day);
      }
    }
  } else if (options.scope === "month") monthGrid(root, options.anchor, false);
  else {
    const year = root.createDiv({ cls: "tm-calendar-year" });
    for (let month = 0; month < 12; month++) {
      const section = year.createDiv();
      const anchor = `${date.getFullYear()}-${String(month + 1).padStart(2, "0")}-01`;
      section.createEl("h3", { text: localDate(anchor).toLocaleDateString(void 0, { month: "long" }) });
      monthGrid(section, anchor, true);
      const monthTasks = options.tasks.filter((task) => {
        var _a2;
        return ((_a2 = calendarDate(task)) == null ? void 0 : _a2.slice(0, 7)) === anchor.slice(0, 7);
      });
      if (monthTasks.length) {
        const list = section.createEl("details", { cls: "tm-calendar-month-tasks" });
        list.createEl("summary", { text: `${monthTasks.length} tasks \u2014 expand to drag` });
        for (const task of monthTasks) taskCard(list, task);
      }
    }
  }
  const unscheduled = (_e = byDate.get("")) != null ? _e : [];
  if (unscheduled.length) {
    const tray = root.createEl("section", { cls: "tm-calendar-unscheduled" });
    tray.createEl("h3", { text: "Unscheduled \u2014 drag onto a date" });
    for (const task of unscheduled) taskCard(tray, task);
  }
}

// src/task-view.ts
var import_obsidian5 = require("obsidian");
var TASK_MAIN_VIEW = "task-manager-main";
var TITLES = {
  inbox: "Inbox",
  today: "Today",
  upcoming: "Upcoming",
  all: "All Tasks",
  projects: "Projects"
};
var TaskMainView = class extends import_obsidian5.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.state = { mode: "today" };
    this.layout = "list";
    this.projectLayout = "list";
    this.ganttAnchor = addDays(todayIso(), -2);
    this.ganttZoom = "month";
    this.calendarScope = "month";
    this.calendarAnchor = todayIso();
    this.showCompleted = false;
    this.showArchivedProjects = false;
    this.search = "";
    this.propertyFilters = [];
    this.sort = "date";
    this.descending = false;
    this.grouping = "default";
    this.filtersExpanded = false;
  }
  get pagePath() {
    var _a;
    return (_a = this.state.pagePath) != null ? _a : this.state.projectPath;
  }
  getViewType() {
    return TASK_MAIN_VIEW;
  }
  getDisplayText() {
    var _a;
    if (this.pagePath) return (_a = this.pagePath.replace(/\.md$/i, "").split("/").pop()) != null ? _a : "Project";
    return TITLES[this.state.mode];
  }
  getIcon() {
    return this.state.mode === "projects" ? "folder-kanban" : "circle-check-big";
  }
  getState() {
    return { ...this.state, layout: this.layout, projectLayout: this.projectLayout, ganttAnchor: this.ganttAnchor, ganttZoom: this.ganttZoom, calendar: this.layout === "calendar", calendarScope: this.calendarScope, calendarAnchor: this.calendarAnchor };
  }
  async setState(state) {
    const mode = state.mode;
    if (state.projectLayout === "list" || state.projectLayout === "gantt") this.projectLayout = state.projectLayout;
    if (state.ganttZoom === "week" || state.ganttZoom === "month" || state.ganttZoom === "quarter") this.ganttZoom = state.ganttZoom;
    if (typeof state.ganttAnchor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(state.ganttAnchor) && parseDateExpression(state.ganttAnchor)) this.ganttAnchor = state.ganttAnchor;
    if (state.layout === "list" || state.layout === "calendar" || state.layout === "kanban") this.layout = state.layout;
    else if (typeof state.calendar === "boolean") this.layout = state.calendar ? "calendar" : "list";
    if (["day", "week", "month", "year"].includes(String(state.calendarScope))) this.calendarScope = state.calendarScope;
    if (typeof state.calendarAnchor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(state.calendarAnchor) && parseDateExpression(state.calendarAnchor)) this.calendarAnchor = state.calendarAnchor;
    if (this.state.mode !== mode || this.state.projectPath !== state.projectPath || this.state.pagePath !== state.pagePath) {
      this.search = "";
      this.propertyFilters = [];
      this.sort = "date";
      this.descending = false;
      this.grouping = "default";
      this.filtersExpanded = false;
    }
    if (typeof mode === "string" && mode in TITLES) this.state.mode = mode;
    this.state.pagePath = typeof state.pagePath === "string" ? state.pagePath : void 0;
    this.state.markdownState = state.markdownState && typeof state.markdownState === "object" ? state.markdownState : void 0;
    this.state.projectPath = typeof state.projectPath === "string" ? state.projectPath : void 0;
    this.render();
  }
  async onOpen() {
    this.unsubscribe = this.plugin.index.subscribe(() => this.render());
    this.render();
  }
  async onClose() {
    var _a;
    (_a = this.unsubscribe) == null ? void 0 : _a.call(this);
  }
  render() {
    const container = this.containerEl.children[1];
    container.empty();
    this.taskResults = void 0;
    container.addClass("tm-main-view");
    container.classList.toggle("is-calendar-view", this.layout === "calendar" && (this.state.mode !== "projects" || Boolean(this.pagePath)));
    container.classList.toggle("is-kanban-view", this.layout === "kanban" && (this.state.mode !== "projects" || Boolean(this.pagePath)));
    if (this.state.mode === "projects" && !this.pagePath) {
      this.renderProjectList(container);
      return;
    }
    this.renderHeader(container);
    this.renderFilters(container);
    this.taskResults = container.createDiv({ cls: "tm-task-results" });
    this.renderTaskResults();
  }
  renderTaskResults() {
    var _a, _b;
    const container = this.taskResults;
    if (!container) return;
    container.empty();
    this.listDrag = new ListDragController((id) => this.plugin.index.taskById(id), (id, group, anchor, placement) => this.dropListTask(id, group, anchor, placement), this.layout !== "kanban");
    const query = {
      mode: this.pagePath ? "project" : this.layout === "calendar" && (this.state.mode === "today" || this.state.mode === "upcoming") ? "all" : this.state.mode,
      showCompleted: this.showCompleted || this.layout === "kanban",
      projectPath: this.pagePath,
      filters: this.propertyFilters,
      search: this.search || void 0
    };
    const tasks = sortTasks(this.plugin.index.query(query), this.sort, this.descending);
    if (this.layout === "calendar") {
      renderCalendar(container, {
        anchor: this.calendarAnchor,
        scope: this.calendarScope,
        tasks,
        dateFormat: this.plugin.dateFormat(),
        navigate: (anchor, scope) => {
          this.calendarAnchor = anchor;
          this.calendarScope = scope;
          this.renderTaskResults();
        },
        create: (preset) => this.plugin.openEditor({ ...this.state, preset }),
        edit: (task) => this.plugin.openEditor({ ...this.state, task }),
        resize: async (task, date, time, duration) => {
          const latest = this.plugin.index.taskById(task.id);
          if (!latest) throw new Error("Task no longer exists. Refresh the view and try again.");
          await this.plugin.store.update(latest, { ...rescheduledDraft(latest, date, time), durationMinutes: duration });
          await this.plugin.index.refreshPath(latest.path);
        },
        move: async (task, date, time) => {
          const latest = this.plugin.index.taskById(task.id);
          if (!latest) throw new Error("Task no longer exists. Refresh the view and try again.");
          await this.plugin.store.update(latest, rescheduledDraft(latest, date, time));
          await this.plugin.index.refreshPath(latest.path);
        }
      });
      return;
    }
    if (this.layout === "kanban") {
      this.renderKanban(container, tasks);
      return;
    }
    if (!tasks.length) {
      if (this.pagePath && this.grouping === "default" && !this.search && !this.propertyFilters.length) {
        this.renderProjectSections(container, this.pagePath, tasks);
      } else this.renderEmpty(container);
      return;
    }
    if (this.grouping === "none") {
      this.renderTaskList(container, tasks);
      return;
    }
    if (this.grouping !== "default") {
      for (const [key, group] of groupTasks(tasks, this.grouping)) {
        const title = this.grouping === "date" && key !== "No date" ? formatDate(key, this.plugin.dateFormat()) : this.grouping === "source" ? key.replace(/\.md$/i, "") : key;
        this.renderSection(container, title, group, void 0, taskGroupTarget(this.grouping, group[0]));
      }
      return;
    }
    if (this.pagePath) {
      this.renderProjectSections(container, this.pagePath, tasks);
      return;
    }
    if (this.state.mode === "today") {
      const today2 = todayIso();
      this.renderSection(container, "Overdue", tasks.filter((task) => {
        var _a2;
        return ((_a2 = actionDate(task)) != null ? _a2 : today2) < today2;
      }), "alert", { property: "date", value: addDays(today2, -1) });
      this.renderSection(container, "Today", tasks.filter((task) => actionDate(task) === today2), void 0, { property: "date", value: today2 });
    } else if (this.state.mode === "upcoming") {
      for (const [date, group] of groupTasks(tasks, "date")) this.renderSection(container, formatDate(date, this.plugin.dateFormat()), group, void 0, taskGroupTarget("date", group[0]));
    } else if (this.state.mode === "all") {
      const groups = /* @__PURE__ */ new Map();
      for (const task of tasks) groups.set(task.path, [...(_a = groups.get(task.path)) != null ? _a : [], task]);
      for (const [path, group] of groups) {
        if (this.plugin.index.isProject(path)) {
          const project = container.createEl("section", { cls: "tm-section" });
          project.createEl("h2", { text: path.replace(/\.md$/i, "") });
          (_b = this.listDrag) == null ? void 0 : _b.group(project, { destination: path });
          this.renderProjectSections(project, path, group);
        } else this.renderSection(container, path.replace(/\.md$/i, ""), group, void 0, { destination: path });
      }
    } else {
      this.renderTaskList(container, tasks);
    }
  }
  renderKanban(container, tasks) {
    var _a, _b;
    const columns = kanbanColumns(tasks, this.grouping);
    if (!columns.length) {
      this.renderEmpty(container);
      return;
    }
    const board = container.createDiv({ cls: "tm-kanban", attr: { "aria-label": "Task board" } });
    for (const column of columns) {
      const section = board.createEl("section", { cls: "tm-kanban-column" });
      const header = section.createDiv({ cls: "tm-kanban-column-header" });
      const title = ((_a = column.target) == null ? void 0 : _a.property) && ["date", "scheduledDate", "deadline"].includes(column.target.property) && typeof column.target.value === "string" ? formatDate(column.target.value, this.plugin.dateFormat()) : column.title;
      header.createEl("h2", { text: title });
      header.createSpan({ cls: "tm-section-count", text: String(column.tasks.length) });
      const add = header.createEl("button", { cls: "clickable-icon", attr: { "aria-label": `Add task to ${title}`, title: `Add task to ${title}` } });
      (0, import_obsidian5.setIcon)(add, "plus");
      add.addEventListener("click", () => {
        var _a2;
        const blank = { id: "", path: (_a2 = this.pagePath) != null ? _a2 : this.plugin.settings.inboxPath, title: "", completed: false, line: 0, endLine: 0, raw: "", indent: 0, childIds: [] };
        const preset = draftForGroup(blank, column.target);
        this.plugin.openEditor({ ...this.state, preset });
      });
      if (column.target) (_b = this.listDrag) == null ? void 0 : _b.group(section, column.target);
      this.renderTaskList(section, column.tasks, column.target);
      if (!column.tasks.length) section.createDiv({ cls: "tm-kanban-empty", text: "No tasks" });
    }
  }
  renderProjectSections(container, path, tasks) {
    var _a;
    this.renderTaskList(container, tasks.filter((task) => task.sectionLine === void 0), { destination: path });
    for (const heading of this.plugin.index.headingsForPath(path)) {
      const group = tasks.filter((task) => task.sectionLine === heading.line);
      const section = container.createEl("section", { cls: "tm-section" });
      const title = section.createEl("h2", { text: heading.name });
      title.createSpan({ cls: "tm-section-count", text: String(group.length) });
      const target = { destination: `${path}#${heading.name}` };
      (_a = this.listDrag) == null ? void 0 : _a.group(section, target);
      this.renderTaskList(section, group, target);
    }
    if (!tasks.length && !this.plugin.index.headingsForPath(path).length) this.renderEmpty(container);
  }
  renderHeader(container) {
    const header = container.createDiv({ cls: "tm-view-header" });
    const titleGroup = header.createDiv({ cls: "tm-title-group" });
    if (this.state.projectPath && !this.state.pagePath) {
      const back = titleGroup.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Back to projects" } });
      (0, import_obsidian5.setIcon)(back, "arrow-left");
      back.addEventListener("click", () => void this.plugin.openTaskView({ mode: "projects" }));
    }
    const heading = titleGroup.createDiv();
    heading.createEl("h1", { text: this.getDisplayText() });
    const actions = header.createDiv({ cls: "tm-header-actions" });
    const layouts = actions.createDiv({ cls: "tm-layout-controls", attr: { "aria-label": "Task view layout" } });
    for (const [layout, icon2, label] of [["list", "list", "List"], ["calendar", "calendar-days", "Calendar"], ["kanban", "columns-3", "Kanban"]]) {
      const button = layouts.createEl("button", { cls: "clickable-icon", attr: { "aria-label": `${label} view`, title: `${label} view`, "aria-pressed": String(this.layout === layout) } });
      (0, import_obsidian5.setIcon)(button, icon2);
      button.addEventListener("click", () => {
        this.layout = layout;
        this.render();
      });
    }
    const add = actions.createEl("button", { cls: "mod-cta tm-add-task" });
    const icon = add.createSpan();
    (0, import_obsidian5.setIcon)(icon, "plus");
    add.createSpan({ text: "Add task" });
    add.addEventListener("click", () => this.plugin.openEditor(this.state));
  }
  renderFilters(container) {
    var _a, _b;
    const filters = container.createDiv({ cls: "tm-filters" });
    const search = filters.createEl("input", { type: "search", attr: { placeholder: "Search tasks\u2026", "aria-label": "Search tasks" } });
    search.value = this.search;
    search.addEventListener("input", () => {
      this.search = search.value;
      this.renderTaskResults();
    });
    const toggle = filters.createEl("button", { cls: "tm-filter-toggle" });
    const menu = filters.createDiv({ cls: "tm-property-menu" });
    const sync = () => {
      toggle.setText(`Filter${this.propertyFilters.length ? ` (${this.propertyFilters.length})` : ""}`);
      toggle.setAttribute("aria-expanded", String(this.filtersExpanded));
      menu.hidden = !this.filtersExpanded;
    };
    toggle.addEventListener("click", () => {
      this.filtersExpanded = !this.filtersExpanded;
      sync();
    });
    menu.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this.filtersExpanded = false;
        sync();
        toggle.focus();
      }
    });
    sync();
    menu.createDiv({ text: "Match all property filters", cls: "tm-filter-hint" });
    const clear = menu.createEl("button", { text: "Clear all filters" });
    clear.addEventListener("click", () => {
      this.propertyFilters = [];
      this.render();
    });
    for (const property of TASK_PROPERTIES) {
      const active = this.propertyFilters.find((filter) => filter.property === property.key);
      const submenu = menu.createDiv({ cls: "tm-property-submenu" });
      const summary = submenu.createSpan({ cls: "tm-property-name", text: `${property.label}${active ? " \u2022" : ""}` });
      const panel = submenu.createDiv({ cls: "tm-property-conditions" });
      const operator = panel.createEl("select", { attr: { "aria-label": `${property.label} condition` } });
      operator.createEl("option", { value: "", text: "Any value" });
      for (const [value, label] of filterOperators(property.kind)) operator.createEl("option", { value, text: label });
      operator.value = (_a = active == null ? void 0 : active.operator) != null ? _a : "";
      const inputs = panel.createDiv({ cls: "tm-filter-values" });
      let values = [...(_b = active == null ? void 0 : active.values) != null ? _b : []];
      const apply = () => {
        const op = operator.value;
        const needsValue = op && op !== "has" && op !== "missing";
        const valid = !needsValue || values.length > 0 && values[0] !== "" && (op !== "between" || Boolean(values[1]));
        this.propertyFilters = this.propertyFilters.filter((filter) => filter.property !== property.key);
        if (op && valid) this.propertyFilters.push({ property: property.key, operator: op, values: [...values] });
        summary.setText(`${property.label}${op && valid ? " \u2022" : ""}`);
        sync();
        this.renderTaskResults();
      };
      const renderValues = () => {
        var _a2;
        inputs.empty();
        if (!operator.value || ["has", "missing"].includes(operator.value)) return;
        if (property.kind === "choice") {
          const choices = property.key === "priority" ? ["1", "2", "3"] : property.key === "status" ? ["Open", "Completed"] : [...new Set(this.plugin.index.allTasks().map((task) => propertyValue(task, property.key)).filter((value) => value !== void 0 && value !== "").map(String))].sort();
          for (const value of choices) {
            const label = inputs.createEl("label");
            const check = label.createEl("input", { type: "checkbox" });
            check.checked = values.includes(value);
            label.createSpan({ text: propertyLabel(property.key, value) });
            check.addEventListener("change", () => {
              values = check.checked ? [...values, value] : values.filter((item) => item !== value);
              apply();
            });
          }
        } else {
          for (let i = 0; i < (operator.value === "between" ? 2 : 1); i++) {
            const input = inputs.createEl("input", { type: property.kind === "number" ? "number" : property.kind, attr: {
              "aria-label": `${property.label} ${i ? "upper bound" : "value"}`,
              ...property.kind === "number" ? { min: "0", step: "1", placeholder: "Minutes" } : {}
            } });
            input.value = (_a2 = values[i]) != null ? _a2 : "";
            input.addEventListener("input", () => {
              if (!input.validity.valid) return;
              values[i] = input.value;
              apply();
            });
          }
          if (property.kind === "number") inputs.createSpan({ text: "Duration in minutes", cls: "tm-filter-hint" });
        }
      };
      operator.addEventListener("change", () => {
        values = [];
        renderValues();
        apply();
      });
      renderValues();
    }
    const ordering = filters.createDiv({ cls: "tm-order-controls" });
    const iconButton = (icon, label) => {
      const button = ordering.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label, title: label } });
      (0, import_obsidian5.setIcon)(button, icon);
      return button;
    };
    const sort = iconButton("list-filter", `Sort: ${this.sort}`);
    sort.addEventListener("click", (event) => {
      const options = new import_obsidian5.Menu();
      for (const property of [{ key: "date", label: "Action date" }, ...TASK_PROPERTIES]) {
        options.addItem((item) => item.setTitle(property.label).setChecked(this.sort === property.key).onClick(() => {
          this.sort = property.key;
          sort.setAttribute("aria-label", `Sort: ${property.label}`);
          sort.setAttribute("title", `Sort: ${property.label}`);
          this.renderTaskResults();
        }));
      }
      options.showAtMouseEvent(event);
    });
    const direction = iconButton(this.descending ? "arrow-down" : "arrow-up", this.descending ? "Descending" : "Ascending");
    direction.addEventListener("click", () => {
      this.descending = !this.descending;
      (0, import_obsidian5.setIcon)(direction, this.descending ? "arrow-down" : "arrow-up");
      direction.setAttribute("aria-label", this.descending ? "Descending" : "Ascending");
      direction.setAttribute("title", this.descending ? "Descending" : "Ascending");
      this.renderTaskResults();
    });
    const grouping = iconButton("group", `Group: ${this.grouping}`);
    grouping.addEventListener("click", (event) => {
      const options = new import_obsidian5.Menu();
      for (const property of [{ key: "default", label: "View default" }, { key: "none", label: "None" }, { key: "date", label: "Action date" }, ...TASK_PROPERTIES]) {
        options.addItem((item) => item.setTitle(property.label).setChecked(this.grouping === property.key).onClick(() => {
          this.grouping = property.key;
          grouping.setAttribute("aria-label", `Group: ${property.label}`);
          grouping.setAttribute("title", `Group: ${property.label}`);
          this.renderTaskResults();
        }));
      }
      options.showAtMouseEvent(event);
    });
  }
  renderProjectList(container) {
    const header = container.createDiv({ cls: "tm-view-header" });
    const title = header.createDiv({ cls: "tm-title-group" }).createDiv();
    title.createEl("h1", { text: "Projects" });
    const actions = header.createDiv({ cls: "tm-header-actions" });
    const layouts = actions.createDiv({ cls: "tm-layout-controls", attr: { "aria-label": "Projects layout" } });
    for (const [layout, icon] of [["list", "list"], ["gantt", "chart-gantt"]]) {
      const button = layouts.createEl("button", { cls: "clickable-icon", attr: { "aria-label": `${layout === "gantt" ? "Gantt" : "List"} projects view`, "aria-pressed": String(this.projectLayout === layout), title: `${layout === "gantt" ? "Gantt" : "List"} view` } });
      (0, import_obsidian5.setIcon)(button, icon);
      button.addEventListener("click", () => {
        this.projectLayout = layout;
        this.render();
      });
    }
    const toggle = actions.createEl("label", { cls: "tm-completed-toggle" });
    const checkbox = toggle.createEl("input", { type: "checkbox" });
    checkbox.checked = this.showArchivedProjects;
    toggle.createSpan({ text: "Show archived projects" });
    checkbox.addEventListener("change", () => {
      this.showArchivedProjects = checkbox.checked;
      this.render();
    });
    const projects = this.plugin.index.projects();
    const active = projects.filter((project) => !project.archived);
    const archived = projects.filter((project) => project.archived);
    if (!active.length && (!this.showArchivedProjects || !archived.length)) {
      const empty = container.createDiv({ cls: "tm-empty" });
      const icon = empty.createDiv({ cls: "tm-empty-icon" });
      (0, import_obsidian5.setIcon)(icon, "folder-kanban");
      empty.createEl("h3", { text: archived.length ? "No active projects" : "No projects yet" });
      empty.createEl("p", { text: archived.length ? "Enable Show archived projects to see your archived projects." : "Add #project to a note or include project in its frontmatter tags." });
      return;
    }
    if (this.projectLayout === "gantt") {
      renderGantt(container, {
        projects: this.showArchivedProjects ? projects : active,
        anchor: this.ganttAnchor,
        zoom: this.ganttZoom,
        dateFormat: this.plugin.dateFormat(),
        navigate: (anchor, zoom) => {
          this.ganttAnchor = anchor;
          this.ganttZoom = zoom;
          this.render();
        },
        open: (project) => {
          const file = this.app.vault.getAbstractFileByPath(project.path);
          if (file instanceof import_obsidian5.TFile) void this.app.workspace.getLeaf("tab").openFile(file);
        },
        update: async (project, changes) => {
          const file = this.app.vault.getAbstractFileByPath(project.path);
          if (!(file instanceof import_obsidian5.TFile)) throw new Error("Project note no longer exists.");
          await this.app.fileManager.processFrontMatter(file, (frontmatter) => updateProjectDates(frontmatter, changes, project, this.plugin.dateFormat()));
          await this.plugin.index.refreshPath(project.path);
        }
      });
      return;
    }
    this.renderProjectGroup(container, "Active", active);
    if (this.showArchivedProjects) this.renderProjectGroup(container, "Archived", archived);
  }
  renderProjectGroup(container, title, projects) {
    if (!projects.length) return;
    const section = container.createEl("section", { cls: "tm-section" });
    const heading = section.createEl("h2", { text: title });
    heading.createSpan({ cls: "tm-section-count", text: String(projects.length) });
    const list = section.createDiv({ cls: "tm-task-list", attr: { role: "list" } });
    for (const { project, depth } of projectHierarchy(projects)) {
      const row = list.createDiv({ cls: "tm-task-row tm-project-row", attr: { role: "listitem" } });
      row.style.setProperty("--tm-depth", String(depth));
      const icon = row.createSpan({ cls: "tm-project-icon" });
      (0, import_obsidian5.setIcon)(icon, project.archived ? "archive" : "folder");
      const content = row.createDiv({ cls: "tm-task-content" });
      const primary = content.createDiv({ cls: "tm-task-primary" });
      const button = primary.createEl("button", { cls: "tm-task-title", text: project.name, attr: { title: project.path } });
      button.addEventListener("click", () => void this.plugin.openTaskView({ mode: "projects", projectPath: project.path }));
      const metadata = content.createDiv({ cls: "tm-task-metadata tm-project-metadata" });
      this.renderProperties(metadata, project);
      if (project.endDate) this.badge(metadata, "calendar-check", `End: ${formatDate(project.endDate, this.plugin.dateFormat())}`);
      if (!metadata.childElementCount) metadata.remove();
      const total = project.openTasks + project.completedTasks;
      const percentage = total ? Math.round(project.completedTasks / total * 100) : 0;
      const progress = content.createDiv({ cls: "tm-project-progress", attr: {
        role: "progressbar",
        "aria-label": `${project.name}: ${project.completedTasks} of ${total} tasks completed`,
        "aria-valuemin": "0",
        "aria-valuemax": "100",
        "aria-valuenow": String(percentage),
        title: `${project.completedTasks} of ${total} tasks completed`
      } });
      const track = progress.createSpan({ cls: "tm-project-progress-track" });
      track.createSpan({ cls: "tm-project-progress-fill" }).style.width = `${percentage}%`;
      progress.createSpan({ cls: "tm-project-percentage", text: `${percentage}%` });
      const open = row.createEl("button", { cls: "clickable-icon tm-row-menu", attr: { "aria-label": `Open ${project.name}` } });
      (0, import_obsidian5.setIcon)(open, "chevron-right");
      open.addEventListener("click", () => void this.plugin.openTaskView({ mode: "projects", projectPath: project.path }));
    }
  }
  renderSection(container, title, tasks, variant, target) {
    var _a;
    if (!tasks.length && !target) return;
    const section = container.createEl("section", { cls: `tm-section${variant ? ` is-${variant}` : ""}` });
    const heading = section.createEl("h2");
    heading.createSpan({ text: title });
    heading.createSpan({ cls: "tm-section-count", text: String(tasks.length) });
    if (target) (_a = this.listDrag) == null ? void 0 : _a.group(section, target);
    this.renderTaskList(section, tasks, target);
  }
  renderTaskList(container, tasks, target) {
    var _a;
    const list = container.createDiv({ cls: "tm-task-list", attr: { role: "list" } });
    if (target) (_a = this.listDrag) == null ? void 0 : _a.group(list, target);
    const visibleIds = new Set(tasks.map((task) => task.id));
    for (const task of orderTaskTree(tasks)) {
      const relativeDepth = this.depthWithin(task, visibleIds);
      this.renderTaskRow(list, task, relativeDepth, target);
    }
  }
  async dropListTask(original, group, originalAnchor, placement) {
    var _a;
    try {
      const task = this.plugin.index.taskById(original.id);
      if (!task || task.raw !== original.raw) throw new Error("Task changed while dragging. Refresh and try again.");
      const draft = draftForGroup(task, group);
      if (this.layout === "kanban" && group) {
        const previous = group.property ? taskGroupTarget(group.property, task) : void 0;
        if (group.value !== (previous == null ? void 0 : previous.value) || group.destination && group.destination !== draftForGroup(task).destination) {
          originalAnchor = void 0;
          placement = void 0;
        }
      }
      const anchor = originalAnchor ? this.plugin.index.taskById(originalAnchor.id) : void 0;
      if (originalAnchor && (!anchor || anchor.raw !== originalAnchor.raw)) throw new Error("Drop target changed while dragging. Refresh and try again.");
      if (anchor && placement) {
        await this.plugin.store.relocate(task, anchor, placement, draft);
        this.sort = "source";
        this.descending = false;
      } else await this.plugin.store.update(task, draft);
      const destination = (_a = anchor == null ? void 0 : anchor.path) != null ? _a : splitDestination(draft.destination).path;
      await this.plugin.index.refreshPath(task.path);
      if (destination !== task.path) await this.plugin.index.refreshPath(destination);
      this.render();
    } catch (cause) {
      new import_obsidian5.Notice(cause instanceof Error ? cause.message : "Could not move task.");
    }
  }
  depthWithin(task, visibleIds) {
    var _a;
    let depth = 0;
    let parentId = task.parentId;
    while (parentId && visibleIds.has(parentId)) {
      depth += 1;
      parentId = (_a = this.plugin.index.taskById(parentId)) == null ? void 0 : _a.parentId;
    }
    return depth;
  }
  renderTaskRow(list, task, depth, target) {
    var _a;
    const row = list.createDiv({ cls: `tm-task-row${task.completed ? " is-completed" : ""}`, attr: { role: "listitem" } });
    row.style.setProperty("--tm-depth", String(depth));
    const checkboxTarget = row.createEl("label", { cls: "tm-checkbox-target" });
    const checkbox = checkboxTarget.createEl("input", { type: "checkbox", cls: "tm-task-checkbox", attr: { "aria-label": `Complete ${task.title}` } });
    checkbox.checked = task.completed;
    const toggleTask = async () => {
      checkbox.disabled = true;
      try {
        await this.plugin.store.toggle(task, checkbox.checked);
      } catch (cause) {
        checkbox.checked = !checkbox.checked;
        checkbox.disabled = false;
        new import_obsidian5.Notice(cause instanceof Error ? cause.message : "Could not update the task.");
      }
    };
    checkbox.addEventListener("change", () => {
      void toggleTask();
    });
    const content = row.createDiv({ cls: "tm-task-content" });
    const primary = content.createDiv({ cls: "tm-task-primary" });
    (_a = this.listDrag) == null ? void 0 : _a.row(row, primary, task, target);
    const title = primary.createEl("button", { cls: "tm-task-title", text: task.title });
    title.addEventListener("click", () => this.plugin.openEditor({ ...this.state, task }));
    if (task.childIds.length) {
      const children = task.childIds.map((id) => this.plugin.index.taskById(id)).filter((child) => Boolean(child));
      primary.createSpan({ cls: "tm-progress", text: `${children.filter((child) => child.completed).length}/${children.length}` });
    }
    const metadata = content.createDiv({ cls: "tm-task-metadata" });
    const source = metadata.createEl("button", { cls: "tm-source", text: task.path.replace(/\.md$/i, "") });
    source.addEventListener("click", () => void this.openSource(task));
    this.renderProperties(metadata, task);
    const menuButton = row.createEl("button", { cls: "clickable-icon tm-row-menu", attr: { "aria-label": "Task actions" } });
    (0, import_obsidian5.setIcon)(menuButton, "more-horizontal");
    menuButton.addEventListener("click", (event) => this.openMenu(event, task));
  }
  renderProperties(parent, properties) {
    if (properties.scheduledDate) this.badge(parent, "calendar-days", `${formatDate(properties.scheduledDate, this.plugin.dateFormat())}${properties.scheduledTime ? ` ${properties.scheduledTime}` : ""}`);
    if (properties.deadline) this.badge(parent, "flag", `${formatDate(properties.deadline, this.plugin.dateFormat())}${properties.deadlineTime ? ` ${properties.deadlineTime}` : ""}`, properties.deadline < todayIso() ? "danger" : void 0);
    if (properties.durationMinutes) this.badge(parent, "clock-3", formatDuration(properties.durationMinutes));
    if (properties.priority) this.badge(parent, "signal", `P${properties.priority}`, `p${properties.priority}`);
  }
  badge(parent, iconName, text, variant) {
    const badge = parent.createSpan({ cls: `tm-meta${variant ? ` is-${variant}` : ""}` });
    const icon = badge.createSpan();
    (0, import_obsidian5.setIcon)(icon, iconName);
    badge.createSpan({ text });
  }
  openMenu(event, task) {
    const menu = new import_obsidian5.Menu();
    menu.addItem((item) => item.setTitle("Edit task").setIcon("pencil").onClick(() => this.plugin.openEditor({ ...this.state, task })));
    menu.addItem((item) => item.setTitle("Open source note").setIcon("file-text").onClick(() => void this.openSource(task)));
    menu.showAtMouseEvent(event);
  }
  async openSource(task) {
    const file = this.app.vault.getAbstractFileByPath(task.path);
    if (file instanceof import_obsidian5.TFile) {
      await this.app.workspace.getLeaf("tab").openFile(file, { eState: { line: task.line } });
    }
  }
  renderEmpty(container) {
    const empty = container.createDiv({ cls: "tm-empty" });
    const icon = empty.createDiv({ cls: "tm-empty-icon" });
    (0, import_obsidian5.setIcon)(icon, "circle-check-big");
    empty.createEl("h3", { text: "Nothing here" });
    empty.createEl("p", { text: this.search || this.propertyFilters.length ? "No tasks match the current filters." : this.showCompleted ? "No tasks match this view." : "You're caught up. Completed tasks are hidden." });
  }
};

// src/task-mode.ts
var TaskModeController = class {
  constructor(app, enabled, isProject) {
    this.app = app;
    this.enabled = enabled;
    this.isProject = isProject;
    this.pending = false;
    this.disposed = false;
  }
  sync() {
    if (this.disposed) return Promise.resolve();
    this.pending = true;
    if (!this.running) this.running = Promise.resolve().then(() => this.drain()).finally(() => {
      this.running = void 0;
      if (this.pending && !this.disposed) return this.sync();
      return void 0;
    });
    return this.running;
  }
  dispose() {
    this.disposed = true;
    this.pending = false;
  }
  async drain() {
    while (this.pending && !this.disposed) {
      this.pending = false;
      const leaves = [...this.app.workspace.getLeavesOfType("markdown"), ...this.app.workspace.getLeavesOfType(TASK_MAIN_VIEW)];
      for (const leaf of leaves) {
        if (this.disposed) return;
        const view = leaf.view;
        if (view instanceof import_obsidian6.MarkdownView && view.file && this.enabled() && this.isProject(view.file.path)) {
          const path = view.file.path;
          const markdownState = view.getState();
          await leaf.setViewState({ type: TASK_MAIN_VIEW, state: { mode: "all", pagePath: path, markdownState } });
        } else if (view instanceof TaskMainView) {
          const state = view.getState();
          const path = typeof state.pagePath === "string" ? state.pagePath : void 0;
          if (!path || this.enabled() && this.isProject(path)) continue;
          const file = this.app.vault.getAbstractFileByPath(path);
          if (!(file instanceof import_obsidian6.TFile)) continue;
          const markdownState = state.markdownState && typeof state.markdownState === "object" ? state.markdownState : {};
          await leaf.setViewState({ type: "markdown", state: { ...markdownState, file: file.path } });
        }
      }
    }
  }
};

// src/note-token-editor.ts
var import_obsidian7 = require("obsidian");
var import_view = require("@codemirror/view");

// src/task-tokens.ts
function taskTokens(line, dateFormat) {
  const ranges = [];
  const parsed = parseTaskLine(line, /* @__PURE__ */ new Date(), dateFormat, false, ranges);
  if (!parsed) return [];
  return ranges.sort((a, b) => a.from - b.from).map((range) => {
    var _a, _b;
    const source = line.slice(range.from, range.to);
    const date = (_b = (_a = /\[\[([^\]]+)\]\]/.exec(source)) == null ? void 0 : _a[1]) != null ? _b : source.replace(/^\{|\}$/g, "").trim();
    switch (range.kind) {
      case "scheduledDate":
        return { ...range, label: `${date}${parsed.scheduledTime ? ` ${parsed.scheduledTime}` : ""}`, description: `Scheduled: ${date}${parsed.scheduledTime ? ` ${parsed.scheduledTime}` : ""}`, linkText: date };
      case "deadline":
        return { ...range, label: `Due ${date}${parsed.deadlineTime && source.includes("[[") ? ` ${parsed.deadlineTime}` : ""}`, description: `Deadline: ${date}${parsed.deadlineTime && source.includes("[[") ? ` ${parsed.deadlineTime}` : ""}`, linkText: source.includes("[[") ? date : void 0 };
      case "durationMinutes":
        return { ...range, label: formatDuration(parsed.durationMinutes), description: `Duration: ${formatDuration(parsed.durationMinutes)}` };
      case "priority":
        return { ...range, label: `P${parsed.priority}`, description: `Priority ${parsed.priority}`, priority: parsed.priority };
    }
  });
}
function tokenClass(token) {
  return `tm-note-token tm-note-token-${token.kind}${token.priority ? ` is-p${token.priority}` : ""}`;
}

// src/note-token-editor.ts
function noteTokenMarks(tokens, viewport, selections) {
  const pills = [];
  const syntax = [];
  for (const { from, to, token } of tokens) {
    if (from >= viewport.to || to <= viewport.from) continue;
    if (selections.some((range) => range.from <= to && range.to >= from)) continue;
    pills.push(import_view.Decoration.mark({
      class: `${tokenClass(token)} tm-note-token-editor`,
      attributes: { title: token.description }
    }).range(from, to));
    if (token.kind === "deadline") {
      syntax.push(import_view.Decoration.mark({ class: "tm-note-token-brace" }).range(from, from + 1));
      syntax.push(import_view.Decoration.mark({ class: "tm-note-token-brace" }).range(to - 1, to));
    }
  }
  return { pills: import_view.Decoration.set(pills, true), syntax: import_view.Decoration.set(syntax, true) };
}
function noteTokenEditor(getDateFormat) {
  return import_view.ViewPlugin.fromClass(class {
    constructor(view) {
      this.pills = import_view.Decoration.none;
      this.syntax = import_view.Decoration.none;
      this.tokens = [];
      this.format = "";
      this.rebuildTokens(view);
      this.decorate(view);
    }
    update(update) {
      const formatChanged = this.format !== getDateFormat();
      if (update.docChanged || formatChanged) this.rebuildTokens(update.view);
      if (update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged || formatChanged || update.transactions.length) this.decorate(update.view);
    }
    rebuildTokens(view) {
      this.format = getDateFormat();
      this.tokens = [];
      for (const { text, line } of bodyLines(view.state.doc.toString())) {
        if (!/^\s*-\s+\[[ xX]\]/.test(text)) continue;
        const offset = view.state.doc.line(line + 1).from;
        for (const token of taskTokens(text, this.format)) this.tokens.push({ from: offset + token.from, to: offset + token.to, token });
      }
    }
    decorate(view) {
      if (!view.state.field(import_obsidian7.editorLivePreviewField, false)) {
        this.pills = this.syntax = import_view.Decoration.none;
        return;
      }
      const marks = noteTokenMarks(this.tokens, view.viewport, view.state.selection.ranges);
      this.pills = marks.pills;
      this.syntax = marks.syntax;
    }
  }, {
    decorations: (plugin) => plugin.syntax,
    // Keep one pill wrapper outside Obsidian's link and syntax decorations.
    provide: (plugin) => import_view.EditorView.outerDecorations.of((view) => {
      var _a, _b;
      return (_b = (_a = view.plugin(plugin)) == null ? void 0 : _a.pills) != null ? _b : import_view.Decoration.none;
    })
  });
}

// src/note-task-edit.ts
var import_obsidian8 = require("obsidian");
var import_view2 = require("@codemirror/view");
function handleTaskEditClick(event, resolve, open) {
  var _a;
  if (!(import_obsidian8.Platform.isMacOS ? event.metaKey : event.ctrlKey) || event.button !== 0) return;
  const target = event.target;
  const checkbox = (_a = target == null ? void 0 : target.closest) == null ? void 0 : _a.call(target, 'input[type="checkbox"]');
  if (!checkbox) return;
  const task = resolve(checkbox);
  if (!task) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  open(task);
}
function bindNoteTaskEdit(root, resolve, open) {
  let timer;
  let press;
  let held;
  let suppressUntil = 0;
  const cancel = () => {
    clearTimeout(timer);
    timer = void 0;
    press = void 0;
  };
  const block = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const start = (event) => {
    var _a, _b;
    cancel();
    held = void 0;
    if (event.touches.length !== 1) return;
    const checkbox = (_b = (_a = event.target) == null ? void 0 : _a.closest) == null ? void 0 : _b.call(_a, 'input[type="checkbox"]');
    if (!checkbox || !resolve(checkbox)) return;
    const touch = event.touches[0];
    press = { checkbox, id: touch.identifier, x: touch.clientX, y: touch.clientY };
    timer = setTimeout(() => {
      if (!press || !checkbox.isConnected) return;
      const task = resolve(checkbox);
      if (!task) return;
      held = checkbox;
      suppressUntil = Date.now() + 1500;
      cancel();
      open(task);
    }, 500);
  };
  const move = (event) => {
    if (!press) return;
    const touch = Array.from(event.touches).find((touch2) => touch2.identifier === press.id);
    if (event.touches.length !== 1 || !touch || Math.hypot(touch.clientX - press.x, touch.clientY - press.y) > 10) cancel();
  };
  const end = (event) => {
    cancel();
    if (held && event.target === held) {
      suppressUntil = Date.now() + 1500;
      block(event);
    }
  };
  const click = (event) => {
    if (held && Date.now() <= suppressUntil && event.target === held) {
      block(event);
      held = void 0;
      return;
    }
    handleTaskEditClick(event, resolve, open);
  };
  const contextMenu = (event) => {
    if (event.target === (press == null ? void 0 : press.checkbox) || event.target === held && Date.now() <= suppressUntil) block(event);
  };
  const document = root.ownerDocument;
  root.addEventListener("click", click, true);
  root.addEventListener("touchstart", start, { capture: true, passive: true });
  root.addEventListener("contextmenu", contextMenu, true);
  document.addEventListener("touchmove", move, { capture: true, passive: true });
  document.addEventListener("touchend", end, { capture: true, passive: false });
  document.addEventListener("touchcancel", cancel, true);
  return () => {
    cancel();
    held = void 0;
    root.removeEventListener("click", click, true);
    root.removeEventListener("touchstart", start, true);
    root.removeEventListener("contextmenu", contextMenu, true);
    document.removeEventListener("touchmove", move, true);
    document.removeEventListener("touchend", end, true);
    document.removeEventListener("touchcancel", cancel, true);
  };
}
function noteTaskEditEditor(getDateFormat, open) {
  return import_view2.ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
      this.resolve = (checkbox) => {
        var _a, _b;
        const path = (_b = (_a = this.view.state.field(import_obsidian8.editorInfoField, false)) == null ? void 0 : _a.file) == null ? void 0 : _b.path;
        if (!path) return;
        const line = this.view.state.doc.lineAt(this.view.posAtDOM(checkbox)).number - 1;
        return scanTasks(path, this.view.state.doc.toString(), /* @__PURE__ */ new Date(), getDateFormat()).find((task) => task.line === line);
      };
      this.dispose = bindNoteTaskEdit(view.dom, this.resolve, open);
    }
    destroy() {
      this.dispose();
    }
  });
}
function registerNoteTaskEdit(root, context, getDateFormat, open) {
  const child = new import_obsidian8.MarkdownRenderChild(root);
  context.addChild(child);
  child.register(bindNoteTaskEdit(root, (checkbox) => {
    const item = checkbox.closest("li.task-list-item");
    if (!item) return;
    const section = context.getSectionInfo(item);
    if (!section) return;
    const relativeLine = item.getAttribute("data-line");
    if (relativeLine === null || !/^\d+$/.test(relativeLine)) return;
    const line = section.lineStart + Number(relativeLine);
    return scanTasks(context.sourcePath, section.text, /* @__PURE__ */ new Date(), getDateFormat()).find((task) => task.line === line);
  }, open));
}

// src/note-token-reading.ts
function renderNoteTokens(root, dateFormat) {
  var _a;
  const items = Array.from(root.querySelectorAll("li.task-list-item"));
  if (root.matches("li.task-list-item")) items.unshift(root);
  for (const item of items) {
    const content = (_a = Array.from(item.children).find((child) => child.tagName === "P")) != null ? _a : item;
    if (Array.from(content.querySelectorAll(".tm-note-token")).some((pill) => pill.closest("li") === item)) continue;
    let source = "- [ ] ";
    const segments = [];
    const walk = (node) => {
      var _a2, _b, _c;
      const element = node.nodeType === 1 ? node : void 0;
      if (element == null ? void 0 : element.matches("ul, ol, input, button")) return;
      if (node.nodeType === 3) {
        const text = (_a2 = node.textContent) != null ? _a2 : "";
        segments.push({ node, from: source.length, to: source.length + text.length, atomic: false });
        source += text;
      } else if (element == null ? void 0 : element.matches("a.internal-link")) {
        const text = `[[${(_c = (_b = element.getAttribute("data-href")) != null ? _b : element.getAttribute("href")) != null ? _c : element.textContent}]]`;
        segments.push({ node, from: source.length, to: source.length + text.length, atomic: true });
        source += text;
      } else if (element == null ? void 0 : element.matches("code, strong, em, del, s, mark, a, .internal-embed")) {
        source += `\`${element.textContent}\``;
      } else {
        for (const child of Array.from(node.childNodes)) walk(child);
      }
    };
    for (const child of Array.from(content.childNodes)) walk(child);
    for (const token of taskTokens(source, dateFormat).reverse()) {
      const first = segments.find((segment) => segment.from <= token.from && segment.to > token.from);
      const last = segments.find((segment) => segment.from < token.to && segment.to >= token.to);
      if (!first || !last) continue;
      const document = item.ownerDocument;
      const range = document.createRange();
      if (first.atomic) range.setStartBefore(first.node);
      else range.setStart(first.node, token.from - first.from);
      if (last.atomic) range.setEndAfter(last.node);
      else range.setEnd(last.node, token.to - last.from);
      const fragment = range.extractContents();
      const win = document.win;
      const pill = win.createFragment().createSpan({
        cls: tokenClass(token),
        title: token.description,
        attr: { "aria-label": token.description }
      });
      const link = fragment.querySelector("a.internal-link");
      if (link) {
        if (token.kind === "deadline") pill.appendChild(document.createTextNode("Due "));
        pill.appendChild(link);
      } else pill.textContent = token.label;
      range.insertNode(pill);
    }
  }
}

// src/main.ts
var import_obsidian14 = require("obsidian");

// src/mobile-layout.ts
function trackModalViewport(modal, content) {
  const win = modal.ownerDocument.defaultView;
  const container = modal.parentElement;
  if (!win || !container) return () => {
  };
  container.classList.add("tm-editor-container");
  const viewport = win.visualViewport;
  let frame = 0;
  const update = () => {
    var _a, _b;
    container.style.setProperty("--tm-viewport-height", `${(_a = viewport == null ? void 0 : viewport.height) != null ? _a : win.innerHeight}px`);
    container.style.setProperty("--tm-viewport-top", `${(_b = viewport == null ? void 0 : viewport.offsetTop) != null ? _b : 0}px`);
    win.cancelAnimationFrame(frame);
    frame = win.requestAnimationFrame(() => {
      if (!modal.ownerDocument.body.classList.contains("is-mobile") && !win.matchMedia("(max-width: 700px)").matches) return;
      const focused = modal.ownerDocument.activeElement;
      if (!focused || !content.contains(focused)) return;
      const field2 = focused.getBoundingClientRect();
      const area = content.getBoundingClientRect();
      if (focused.classList.contains("tm-editor-raw") && field2.bottom - area.top + content.scrollTop <= area.height - 12) {
        content.scrollTop = 0;
        return;
      }
      if (field2.bottom > area.bottom - 12) content.scrollTop += field2.bottom - area.bottom + 12;
      else if (field2.top < area.top + 12) content.scrollTop -= area.top + 12 - field2.top;
    });
  };
  viewport == null ? void 0 : viewport.addEventListener("resize", update);
  viewport == null ? void 0 : viewport.addEventListener("scroll", update);
  win.addEventListener("resize", update);
  content.addEventListener("focusin", update);
  update();
  return () => {
    win.cancelAnimationFrame(frame);
    viewport == null ? void 0 : viewport.removeEventListener("resize", update);
    viewport == null ? void 0 : viewport.removeEventListener("scroll", update);
    win.removeEventListener("resize", update);
    content.removeEventListener("focusin", update);
    container.classList.remove("tm-editor-container");
    container.style.removeProperty("--tm-viewport-height");
    container.style.removeProperty("--tm-viewport-top");
  };
}

// src/task-editor.ts
var import_obsidian9 = require("obsidian");
function initialDraft(options) {
  var _a;
  if (options.task) {
    return {
      title: options.task.title,
      scheduledDate: options.task.scheduledDate,
      scheduledTime: options.task.scheduledTime,
      deadline: options.task.deadline,
      deadlineTime: options.task.deadlineTime,
      durationMinutes: options.task.durationMinutes,
      priority: options.task.priority,
      completed: options.task.completed,
      destination: destinationString(options.task.path, options.task.section),
      indent: options.task.indent
    };
  }
  return {
    title: "",
    scheduledDate: options.mode === "today" ? todayIso() : options.mode === "upcoming" ? tomorrowIso() : void 0,
    completed: false,
    destination: (_a = options.projectPath) != null ? _a : options.settings.inboxPath,
    indent: 0,
    ...options.preset
  };
}
function field(parent, label, input) {
  const row = parent.createDiv({ cls: "tm-editor-field" });
  const caption = row.createEl("label", { text: label });
  input.setAttribute("aria-label", label);
  caption.addEventListener("click", () => input.focus());
  row.appendChild(input);
}
var TaskEditorModal = class extends import_obsidian9.Modal {
  constructor(app, options) {
    super(app);
    this.options = options;
    this.rawDirty = false;
    this.draft = initialDraft(options);
  }
  onOpen() {
    var _a;
    this.modalEl.addClass("tm-editor-modal");
    const { contentEl } = this;
    contentEl.empty();
    const header = contentEl.createDiv({ cls: "tm-editor-header" });
    header.createEl("h2", { text: this.options.task ? "Edit task" : "New task" });
    const rawField = contentEl.createDiv({ cls: "tm-editor-raw-field" });
    this.rawInput = rawField.createEl("textarea", { cls: "tm-editor-raw" });
    this.rawInput.setAttribute("aria-label", "Task text");
    this.rawInput.placeholder = "Task today at 9pm {tomorrow at noon} 30m p1 ~[[Project#Heading]]";
    this.rawInput.rows = 2;
    this.rawInput.value = this.serializeDraft(this.draft);
    this.titleInput = contentEl.createEl("input", { type: "text", cls: "tm-editor-title" });
    this.titleInput.placeholder = "What needs to be done?";
    this.titleInput.value = this.draft.title;
    field(contentEl, "Title", this.titleInput);
    this.scheduledInput = contentEl.createEl("input", { type: "text" });
    this.scheduledInput.placeholder = `Tomorrow, next Friday, or ${formatDate(todayIso(), this.options.dateFormat)}`;
    this.scheduledInput.value = this.draft.scheduledDate ? formatDateTime(this.draft.scheduledDate, this.draft.scheduledTime, this.options.dateFormat) : "";
    field(contentEl, "Scheduled date and time", this.scheduledInput);
    this.deadlineInput = contentEl.createEl("input", { type: "text" });
    this.deadlineInput.placeholder = "Tomorrow at noon";
    this.deadlineInput.value = this.draft.deadline ? formatDateTime(this.draft.deadline, this.draft.deadlineTime, this.options.dateFormat) : "";
    field(contentEl, "Deadline", this.deadlineInput);
    this.durationInput = contentEl.createEl("input", { type: "text" });
    this.durationInput.placeholder = "For example 1h30m";
    this.durationInput.value = this.draft.durationMinutes ? formatDuration(this.draft.durationMinutes) : "";
    field(contentEl, "Duration", this.durationInput);
    this.priorityInput = contentEl.createEl("select");
    for (const [value, label] of [["", "No priority"], ["1", "P1 \u2014 High"], ["2", "P2 \u2014 Medium"], ["3", "P3 \u2014 Low"]]) {
      this.priorityInput.createEl("option", { value, text: label });
    }
    this.priorityInput.value = this.draft.priority ? String(this.draft.priority) : "";
    field(contentEl, "Priority", this.priorityInput);
    this.destinationInput = contentEl.createEl("select");
    const destinations = /* @__PURE__ */ new Set([this.options.settings.inboxPath, this.draft.destination]);
    for (const project of this.options.projects) {
      destinations.add(project.path);
      for (const heading of (_a = project.headings) != null ? _a : []) destinations.add(destinationString(project.path, heading.name));
    }
    for (const path of [...destinations].sort()) this.destinationInput.createEl("option", { value: path, text: path });
    this.destinationInput.value = this.draft.destination;
    field(contentEl, "Destination", this.destinationInput);
    const error = contentEl.createDiv({ cls: "tm-editor-error" });
    const syncFromStructured = () => {
      this.rawDirty = false;
      error.empty();
      const next = this.readStructured(false);
      if (next) {
        this.draft = next;
        this.rawInput.value = this.serializeDraft(next);
      }
    };
    const structuredInputs = [
      this.titleInput,
      this.scheduledInput,
      this.deadlineInput,
      this.durationInput,
      this.priorityInput,
      this.destinationInput
    ];
    for (const input of structuredInputs) {
      input.addEventListener("input", syncFromStructured);
    }
    for (const [input, label] of [
      [this.scheduledInput, "scheduled date"],
      [this.deadlineInput, "deadline"]
    ]) {
      input.addEventListener("blur", () => {
        if (!input.value.trim()) return;
        const resolved = parseDateTimeExpression(input.value, /* @__PURE__ */ new Date(), this.options.dateFormat);
        if (!resolved) {
          error.setText(`Could not understand the ${label}.`);
          return;
        }
        input.value = formatDateTime(resolved.date, resolved.time, this.options.dateFormat);
        syncFromStructured();
      });
    }
    this.rawInput.addEventListener("input", () => {
      var _a2;
      this.rawDirty = true;
      const parsed = parseTaskInput(this.rawInput.value, /* @__PURE__ */ new Date(), this.options.dateFormat, !this.options.task);
      if (!parsed) {
        error.setText("Raw text must be one valid checklist line.");
        return;
      }
      error.empty();
      this.titleInput.value = parsed.title;
      this.scheduledInput.value = parsed.scheduledDate ? formatDateTime(parsed.scheduledDate, parsed.scheduledTime, this.options.dateFormat) : "";
      this.deadlineInput.value = parsed.deadline ? formatDateTime(parsed.deadline, parsed.deadlineTime, this.options.dateFormat) : "";
      this.durationInput.value = parsed.durationMinutes ? formatDuration(parsed.durationMinutes) : "";
      this.priorityInput.value = parsed.priority ? String(parsed.priority) : "";
      const destination = (_a2 = parsed.destination) != null ? _a2 : this.options.settings.inboxPath;
      if (destination) {
        if (!Array.from(this.destinationInput.options).some((option) => option.value === destination)) {
          this.destinationInput.createEl("option", { value: destination, text: destination });
        }
        this.destinationInput.value = destination;
      }
    });
    const actions = this.modalEl.createDiv({ cls: "tm-editor-actions" });
    this.actions = actions;
    const deleteButton = this.options.task && this.options.onDelete ? actions.createEl("button", { text: "Delete task", cls: "tm-delete-task", attr: { title: this.options.task.childIds.length ? "Delete this task and its subtasks" : "Delete this task" } }) : void 0;
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const save = actions.createEl("button", { text: "Save task", cls: "mod-cta" });
    const saveIcon = save.createSpan({ cls: "tm-button-icon" });
    (0, import_obsidian9.setIcon)(saveIcon, "check");
    const saveTask = async () => {
      if (save.disabled) return;
      try {
        const next = this.rawDirty ? this.readRaw() : this.readStructured(true);
        if (!next) return;
        save.disabled = true;
        if (deleteButton) deleteButton.disabled = true;
        await this.options.onSave(next);
        this.close();
      } catch (cause) {
        save.disabled = false;
        if (deleteButton) deleteButton.disabled = false;
        const message = cause instanceof Error ? cause.message : "Could not save the task.";
        error.setText(message);
        new import_obsidian9.Notice(message);
      }
    };
    save.addEventListener("click", () => {
      void saveTask();
    });
    const deleteTask = async () => {
      if (!deleteButton || deleteButton.disabled || save.disabled || !this.options.onDelete) return;
      deleteButton.disabled = true;
      save.disabled = true;
      try {
        await this.options.onDelete();
        this.close();
      } catch (cause) {
        deleteButton.disabled = false;
        save.disabled = false;
        const message = cause instanceof Error ? cause.message : "Could not delete the task.";
        error.setText(message);
        new import_obsidian9.Notice(message);
      }
    };
    deleteButton == null ? void 0 : deleteButton.addEventListener("click", () => {
      void deleteTask();
    });
    contentEl.onkeydown = (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      if (event.target instanceof HTMLButtonElement) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat && !save.disabled) save.click();
    };
    this.stopViewportTracking = trackModalViewport(this.modalEl, contentEl);
    this.focusTimer = window.setTimeout(() => {
      this.rawInput.focus({ preventScroll: true });
      const titleStart = this.rawInput.value.indexOf("] ") + 2;
      this.rawInput.setSelectionRange(titleStart, titleStart + this.draft.title.length);
      contentEl.scrollTop = 0;
      this.modalEl.scrollTop = 0;
    }, 0);
  }
  onClose() {
    var _a, _b;
    window.clearTimeout(this.focusTimer);
    (_a = this.stopViewportTracking) == null ? void 0 : _a.call(this);
    (_b = this.actions) == null ? void 0 : _b.remove();
    this.contentEl.onkeydown = null;
    this.contentEl.empty();
  }
  serializeDraft(draft) {
    return draft.destination === this.options.settings.inboxPath ? serializeTask(draft, this.options.dateFormat) : serializeTaskInput(draft, this.options.dateFormat);
  }
  readRaw() {
    var _a;
    const parsed = parseTaskInput(this.rawInput.value, /* @__PURE__ */ new Date(), this.options.dateFormat, !this.options.task);
    if (!parsed || !parsed.title) {
      new import_obsidian9.Notice("Raw text must be one valid checklist line with a title.");
      return void 0;
    }
    return { ...parsed, destination: (_a = parsed.destination) != null ? _a : this.options.settings.inboxPath };
  }
  readStructured(notify) {
    var _a;
    const title = this.titleInput.value.trim();
    if (!title) {
      if (notify) new import_obsidian9.Notice("Enter a task title.");
      return void 0;
    }
    const scheduledDate = this.readDate(this.scheduledInput.value, "scheduled date", notify);
    if (this.scheduledInput.value.trim() && !scheduledDate) return void 0;
    const deadline = this.readDate(this.deadlineInput.value, "deadline", notify);
    if (this.deadlineInput.value.trim() && !deadline) return void 0;
    let durationMinutes;
    if (this.durationInput.value.trim()) {
      durationMinutes = (_a = parseTaskLine(`- [ ] Task ${this.durationInput.value.trim()}`, /* @__PURE__ */ new Date(), this.options.dateFormat)) == null ? void 0 : _a.durationMinutes;
      if (!durationMinutes) {
        if (notify) new import_obsidian9.Notice("Use a duration such as 45m, 2h, or 1h30m.");
        return void 0;
      }
    }
    return {
      title,
      scheduledDate: scheduledDate == null ? void 0 : scheduledDate.date,
      scheduledTime: scheduledDate == null ? void 0 : scheduledDate.time,
      deadline: deadline == null ? void 0 : deadline.date,
      deadlineTime: deadline == null ? void 0 : deadline.time,
      durationMinutes,
      priority: this.priorityInput.value ? Number(this.priorityInput.value) : void 0,
      completed: this.draft.completed,
      destination: this.destinationInput.value,
      indent: this.draft.indent
    };
  }
  readDate(value, label, notify) {
    if (!value.trim()) return void 0;
    const parsed = parseDateTimeExpression(value, /* @__PURE__ */ new Date(), this.options.dateFormat);
    if (!parsed && notify) new import_obsidian9.Notice(`Could not understand the ${label}.`);
    return parsed;
  }
};

// src/task-index.ts
var import_obsidian10 = require("obsidian");
var TaskIndex = class {
  constructor(app, getSettings, getDateFormat) {
    this.app = app;
    this.getSettings = getSettings;
    this.getDateFormat = getDateFormat;
    this.tasksByPath = /* @__PURE__ */ new Map();
    this.headingsByPath = /* @__PURE__ */ new Map();
    this.projectProperties = /* @__PURE__ */ new Map();
    this.archivedPaths = /* @__PURE__ */ new Set();
    this.projectPaths = /* @__PURE__ */ new Set();
    this.listeners = /* @__PURE__ */ new Set();
    this.eventRefs = [];
  }
  async initialize() {
    await Promise.all(this.app.vault.getMarkdownFiles().map((file) => this.scanFile(file)));
    this.refreshProjects();
    this.eventRefs.push(
      this.app.vault.on("create", (file) => {
        if (file instanceof import_obsidian10.TFile && file.extension === "md") void this.refreshFile(file);
      }),
      this.app.vault.on("modify", (file) => {
        if (file instanceof import_obsidian10.TFile && file.extension === "md") void this.refreshFile(file);
      }),
      this.app.vault.on("delete", (file) => {
        if (file instanceof import_obsidian10.TFile && file.extension === "md") {
          this.tasksByPath.delete(file.path);
          this.headingsByPath.delete(file.path);
          this.projectPaths.delete(file.path);
          this.projectProperties.delete(file.path);
          this.archivedPaths.delete(file.path);
          this.emit();
        }
      }),
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof import_obsidian10.TFile && file.extension === "md") {
          this.tasksByPath.delete(oldPath);
          this.headingsByPath.delete(oldPath);
          this.projectPaths.delete(oldPath);
          this.projectProperties.delete(oldPath);
          this.archivedPaths.delete(oldPath);
          void this.refreshFile(file);
        }
      }),
      this.app.metadataCache.on("changed", (file) => {
        if (file.extension === "md") {
          this.updateProjectStatus(file);
          this.emit();
        }
      })
    );
  }
  destroy() {
    for (const eventRef of this.eventRefs) this.app.vault.offref(eventRef);
    this.eventRefs.length = 0;
    this.listeners.clear();
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  allTasks() {
    return sortTasks([...this.tasksByPath.values()].flat());
  }
  tasksForPath(path) {
    var _a;
    return (_a = this.tasksByPath.get(path)) != null ? _a : [];
  }
  taskById(id) {
    return this.allTasks().find((task) => task.id === id);
  }
  query(query, now2 = /* @__PURE__ */ new Date()) {
    return sortTasks(
      this.allTasks().filter((task) => taskMatchesQuery(task, query, this.getSettings().inboxPath, now2))
    );
  }
  projects() {
    return [...this.projectPaths].map((path) => {
      var _a, _b, _c;
      const tasks = this.tasksForPath(path);
      const properties = this.projectProperties.get(path);
      const parentPath = (properties == null ? void 0 : properties.parent) ? (_a = this.app.metadataCache.getFirstLinkpathDest(properties.parent, path)) == null ? void 0 : _a.path : void 0;
      return {
        ...properties,
        parentPath,
        path,
        name: (_c = (_b = path.split("/").pop()) == null ? void 0 : _b.replace(/\.md$/i, "")) != null ? _c : path,
        headings: this.headingsForPath(path),
        archived: this.archivedPaths.has(path),
        openTasks: tasks.filter((task) => !task.completed).length,
        completedTasks: tasks.filter((task) => task.completed).length
      };
    }).sort((left, right) => left.name.localeCompare(right.name));
  }
  headingsForPath(path) {
    var _a;
    return (_a = this.headingsByPath.get(path)) != null ? _a : [];
  }
  isProject(path) {
    return this.projectPaths.has(path);
  }
  async refreshPath(path) {
    const file = this.app.vault.getAbstractFileByPath(splitDestination(path).path);
    if (file instanceof import_obsidian10.TFile) await this.refreshFile(file);
  }
  async refreshFile(file) {
    await this.scanFile(file);
    this.updateProjectStatus(file);
    this.emit();
  }
  async scanFile(file) {
    const content = await this.app.vault.cachedRead(file);
    this.headingsByPath.set(file.path, scanHeadings(content));
    this.tasksByPath.set(file.path, scanTasks(file.path, content, /* @__PURE__ */ new Date(), this.getDateFormat()));
  }
  refreshProjects() {
    this.projectPaths.clear();
    this.projectProperties.clear();
    this.archivedPaths.clear();
    for (const file of this.app.vault.getMarkdownFiles()) this.updateProjectStatus(file);
  }
  updateProjectStatus(file) {
    const cache = this.app.metadataCache.getFileCache(file);
    const tags = cache ? (0, import_obsidian10.getAllTags)(cache) : null;
    if (tags == null ? void 0 : tags.includes("#archived")) this.archivedPaths.add(file.path);
    else this.archivedPaths.delete(file.path);
    if (tags == null ? void 0 : tags.some((tag) => tag === "#project" || tag.startsWith("#project/"))) {
      this.projectPaths.add(file.path);
      this.projectProperties.set(file.path, { ...parseProjectProperties(cache == null ? void 0 : cache.frontmatter, this.getDateFormat()), parent: parseProjectParent(cache == null ? void 0 : cache.frontmatter) });
    } else {
      this.projectPaths.delete(file.path);
      this.projectProperties.delete(file.path);
    }
  }
  emit() {
    for (const listener of this.listeners) listener();
  }
};

// src/navigation-view.ts
var import_obsidian11 = require("obsidian");
var TASK_NAV_VIEW = "task-manager-navigation";
var NAV_ITEMS = [
  { mode: "inbox", label: "Inbox", icon: "inbox" },
  { mode: "today", label: "Today", icon: "calendar-days" },
  { mode: "upcoming", label: "Upcoming", icon: "calendar-clock" },
  { mode: "all", label: "All Tasks", icon: "list-checks" },
  { mode: "projects", label: "Projects", icon: "folder-kanban" }
];
var TaskNavigationView = class extends import_obsidian11.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.activeMode = "today";
  }
  getViewType() {
    return TASK_NAV_VIEW;
  }
  getDisplayText() {
    return "Tasks";
  }
  getIcon() {
    return "circle-check-big";
  }
  async onOpen() {
    this.render();
  }
  setActive(mode) {
    this.activeMode = mode;
    this.render();
  }
  refresh() {
    this.render();
  }
  render() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("tm-navigation");
    const header = container.createDiv({ cls: "tm-nav-header" });
    header.createEl("h3", { text: "Tasks" });
    const newButton = header.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "New task" } });
    (0, import_obsidian11.setIcon)(newButton, "plus");
    newButton.addEventListener("click", () => this.plugin.openEditor({ mode: this.activeMode }));
    const mode = container.createEl("label", { cls: "tm-global-task-mode" });
    const toggle = mode.createEl("input", { type: "checkbox" });
    toggle.checked = this.plugin.settings.taskMode;
    mode.createSpan({ text: "Task mode" });
    toggle.addEventListener("change", () => {
      toggle.disabled = true;
      void this.plugin.setTaskMode(toggle.checked).catch((error) => {
        new import_obsidian11.Notice(String(error));
        this.render();
      });
    });
    const nav = container.createDiv({ cls: "tm-nav-list" });
    for (const item of NAV_ITEMS) {
      const button = nav.createEl("button", {
        cls: `tm-nav-item${item.mode === this.activeMode ? " is-active" : ""}`,
        attr: { "aria-current": item.mode === this.activeMode ? "page" : "false" }
      });
      const icon = button.createSpan({ cls: "tm-nav-icon" });
      (0, import_obsidian11.setIcon)(icon, item.icon);
      button.createSpan({ text: item.label });
      button.addEventListener("click", () => void this.plugin.openTaskView({ mode: item.mode }));
    }
  }
};

// src/markdown.ts
function lineEnding(content) {
  return content.includes("\r\n") ? "\r\n" : "\n";
}
function findLiveLine(lines, task) {
  if (lines[task.line] === task.raw) return task.line;
  const matches = [];
  lines.forEach((line, index) => {
    if (line === task.raw) matches.push(index);
  });
  if (!matches.length) throw new Error("The task changed in its note. Refresh the view and try again.");
  return matches.reduce(
    (nearest, candidate) => Math.abs(candidate - task.line) < Math.abs(nearest - task.line) ? candidate : nearest
  );
}
function toggleTaskInContent(content, task, completed) {
  const eol = lineEnding(content);
  const lines = content.split(/\r?\n/);
  const liveLine = findLiveLine(lines, task);
  lines[liveLine] = lines[liveLine].replace(/^(\s*-\s+\[)[ xX](\])/, `$1${completed ? "x" : " "}$2`);
  return lines.join(eol);
}
function updateTaskInContent(content, task, draft, dateFormat) {
  const eol = lineEnding(content);
  const lines = content.split(/\r?\n/);
  const liveLine = findLiveLine(lines, task);
  lines[liveLine] = serializeTask({ ...draft, indent: task.indent }, dateFormat);
  return lines.join(eol);
}
function removeTaskBlockFromContent(content, task, blockLength) {
  const eol = lineEnding(content);
  const lines = content.split(/\r?\n/);
  const liveLine = findLiveLine(lines, task);
  lines.splice(liveLine, blockLength);
  return lines.join(eol);
}
function insertIntoDestination(content, block, heading, position = "top") {
  var _a, _b, _c, _d, _e;
  const eol = lineEnding(content);
  const lines = content ? content.split(/\r?\n/) : [];
  let insertion = 0;
  const headings = scanHeadings(content);
  let scopeEnd = (_b = (_a = headings[0]) == null ? void 0 : _a.line) != null ? _b : lines.length;
  if (heading) {
    const target = headings.find((item) => item.name.toLocaleLowerCase() === heading.toLocaleLowerCase());
    if (!target) throw new Error(`Cannot find heading: ${heading}`);
    insertion = target.endLine + 1;
    scopeEnd = (_d = (_c = headings.find((item) => item.line > target.line)) == null ? void 0 : _c.line) != null ? _d : lines.length;
  } else if (((_e = lines[0]) == null ? void 0 : _e.trim()) === "---") {
    const end = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line));
    if (end < 0) throw new Error("The destination has unclosed YAML frontmatter.");
    insertion = end + 1;
  }
  const firstTask = bodyLines(content).find(
    ({ text, line }) => line >= insertion && line < scopeEnd && /^[ \t]*-\s+\[[ xX]\]\s+/.test(text)
  );
  if (firstTask) {
    insertion = firstTask.line;
    const indent = /^[ \t]*/.exec(firstTask.text)[0];
    const width = (value) => [...value].reduce((sum, char) => sum + (char === "	" ? 4 : 1), 0);
    const rootWidth = width(indent);
    block = block.map((line) => indent + line);
    if (position === "bottom") {
      let end = insertion + 1;
      for (let cursor = end; cursor < scopeEnd; cursor++) {
        const line = lines[cursor];
        if (!line.trim()) continue;
        const leading = /^[ \t]*/.exec(line)[0];
        const depth = width(leading);
        const listItem = /^[ \t]*(?:[-+*]|\d+[.)])\s+/.test(line);
        if (depth < rootWidth || depth === rootWidth && !listItem) break;
        end = cursor + 1;
      }
      insertion = end;
    }
  }
  lines.splice(insertion, 0, ...block);
  return lines.join(eol) + (insertion + block.length === lines.length ? eol : "");
}

// src/task-block.ts
var indentation = (line) => {
  var _a, _b;
  return [...(_b = (_a = /^[ \t]*/.exec(line)) == null ? void 0 : _a[0]) != null ? _b : ""].reduce((width, char) => width + (char === "	" ? 4 : 1), 0);
};
function liveTaskBlock(content, task, dateFormat) {
  const lines = content.split(/\r?\n/);
  const start = findLiveLine(lines, task);
  const live = scanTasks(task.path, content, /* @__PURE__ */ new Date(), dateFormat).find((candidate) => candidate.line === start);
  if (!live) throw new Error("Task is no longer a checklist item. Refresh and try again.");
  let end = start + 1;
  for (let cursor = end; cursor < lines.length; cursor++) {
    if (!lines[cursor].trim()) continue;
    if (indentation(lines[cursor]) <= live.indent) break;
    end = cursor + 1;
  }
  if (live.endLine >= end) throw new Error("Task structure changed. Check its indentation in the note before moving it.");
  return { start, end, indent: live.indent, lines: lines.slice(start, end) };
}
function rewriteBlock(block, draft, indent, dateFormat) {
  return [serializeTask({ ...draft, indent }, dateFormat), ...block.lines.slice(1).map((line) => {
    if (!line.trim()) return line;
    return " ".repeat(Math.max(0, indentation(line) - block.indent + indent)) + line.replace(/^[ \t]*/, "");
  })];
}
function placeTaskBlock(content, task, anchor, placement, block, dateFormat) {
  const target = liveTaskBlock(content, anchor, dateFormat);
  const source = task ? liveTaskBlock(content, task, dateFormat) : void 0;
  if (source && target.start >= source.start && target.start < source.end) throw new Error("A task cannot be moved into itself or its subtasks.");
  let insertion = placement === "before" ? target.start : target.end;
  const lines = content.split(/\r?\n/);
  if (source) {
    lines.splice(source.start, source.end - source.start);
    if (insertion >= source.end) insertion -= source.end - source.start;
  }
  lines.splice(insertion, 0, ...block);
  return lines.join(lineEnding(content));
}

// src/task-store.ts
var import_obsidian12 = require("obsidian");
var TaskStore = class {
  constructor(app, getDateFormat, getNewTaskPosition = () => "top") {
    this.app = app;
    this.getDateFormat = getDateFormat;
    this.getNewTaskPosition = getNewTaskPosition;
  }
  async toggle(task, completed) {
    const file = this.requireFile(task.path);
    await this.app.vault.process(file, (content) => toggleTaskInContent(content, task, completed));
  }
  async delete(task) {
    const file = this.requireFile(task.path);
    await this.app.vault.process(file, (content) => {
      const block = liveTaskBlock(content, task, this.getDateFormat());
      return removeTaskBlockFromContent(content, task, block.lines.length);
    });
  }
  async create(draft) {
    const { path, heading } = splitDestination(draft.destination);
    const file = heading ? this.requireFile(path) : await this.ensureFile(path);
    const rootDraft = { ...draft, indent: 0 };
    await this.app.vault.process(
      file,
      (content) => insertIntoDestination(content, [serializeTask(rootDraft, this.getDateFormat())], heading, this.getNewTaskPosition())
    );
  }
  async update(task, draft) {
    const destination = splitDestination(draft.destination);
    if ((0, import_obsidian12.normalizePath)(destination.path) !== task.path || destination.heading !== task.section) {
      await this.move(task, draft);
      return;
    }
    const file = this.requireFile(task.path);
    await this.app.vault.process(file, (content) => updateTaskInContent(content, task, draft, this.getDateFormat()));
  }
  async relocate(task, anchor, placement, draft) {
    const source = this.requireFile(task.path);
    const target = this.requireFile(anchor.path);
    if (source.path === target.path) {
      await this.app.vault.process(source, (content2) => {
        const block2 = liveTaskBlock(content2, task, this.getDateFormat());
        const destination = liveTaskBlock(content2, anchor, this.getDateFormat());
        const indent = destination.indent + (placement === "child" ? 2 : 0);
        return placeTaskBlock(content2, task, anchor, placement, rewriteBlock(block2, draft, indent, this.getDateFormat()), this.getDateFormat());
      });
      return;
    }
    const content = await this.app.vault.read(source);
    const block = liveTaskBlock(content, task, this.getDateFormat());
    let before = "";
    let after = "";
    await this.app.vault.process(target, (current) => {
      before = current;
      const destination = liveTaskBlock(current, anchor, this.getDateFormat());
      after = placeTaskBlock(current, void 0, anchor, placement, rewriteBlock(block, draft, destination.indent + (placement === "child" ? 2 : 0), this.getDateFormat()), this.getDateFormat());
      return after;
    });
    try {
      await this.app.vault.process(source, (current) => {
        const latest = liveTaskBlock(current, task, this.getDateFormat());
        if (latest.lines.join("\n") !== block.lines.join("\n")) throw new Error("Task changed while moving. Try again.");
        return removeTaskBlockFromContent(current, task, latest.lines.length);
      });
    } catch (cause) {
      await this.app.vault.process(target, (current) => {
        if (current !== after) throw new Error("Source task was kept, but the destination changed during the move. Check the destination for a duplicate.");
        return before;
      });
      throw cause;
    }
  }
  async move(task, draft) {
    const source = this.requireFile(task.path);
    const { path, heading } = splitDestination(draft.destination);
    const target = heading ? this.requireFile(path) : await this.ensureFile(path);
    if (source.path === target.path) {
      await this.app.vault.process(source, (content2) => {
        const block2 = liveTaskBlock(content2, task, this.getDateFormat());
        return insertIntoDestination(
          removeTaskBlockFromContent(content2, task, block2.lines.length),
          rewriteBlock(block2, draft, 0, this.getDateFormat()),
          heading,
          this.getNewTaskPosition()
        );
      });
      return;
    }
    const content = await this.app.vault.read(source);
    const block = liveTaskBlock(content, task, this.getDateFormat());
    let before = "";
    let after = "";
    await this.app.vault.process(target, (current) => {
      before = current;
      after = insertIntoDestination(current, rewriteBlock(block, draft, 0, this.getDateFormat()), heading, this.getNewTaskPosition());
      return after;
    });
    try {
      await this.app.vault.process(source, (current) => {
        const latest = liveTaskBlock(current, task, this.getDateFormat());
        if (latest.lines.join("\n") !== block.lines.join("\n")) throw new Error("Task changed while moving. Try again.");
        return removeTaskBlockFromContent(current, task, latest.lines.length);
      });
    } catch (cause) {
      await this.app.vault.process(target, (current) => {
        if (current !== after) throw new Error("Source task was kept, but the destination changed during the move. Check the destination for a duplicate.");
        return before;
      });
      throw cause;
    }
  }
  requireFile(path) {
    const file = this.app.vault.getAbstractFileByPath((0, import_obsidian12.normalizePath)(path));
    if (!(file instanceof import_obsidian12.TFile)) throw new Error(`Cannot find note: ${path}`);
    return file;
  }
  async ensureFile(path) {
    const normalized = (0, import_obsidian12.normalizePath)(path.endsWith(".md") ? path : `${path}.md`);
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing instanceof import_obsidian12.TFile) return existing;
    if (existing) throw new Error(`${normalized} is not a Markdown file.`);
    const parts = normalized.split("/");
    parts.pop();
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const folder = this.app.vault.getAbstractFileByPath(current);
      if (!folder) await this.app.vault.createFolder(current);
      else if (!(folder instanceof import_obsidian12.TFolder)) throw new Error(`${current} is not a folder.`);
    }
    return this.app.vault.create(normalized, "");
  }
};

// src/types.ts
var DEFAULT_SETTINGS = {
  taskMode: false,
  inboxPath: "Inbox.md",
  tasksHeading: "Tasks",
  newTaskPosition: "top"
};

// src/settings.ts
var import_obsidian13 = require("obsidian");
var TaskManagerSettingTab = class extends import_obsidian13.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  getSettingDefinitions() {
    return [
      {
        name: "Task mode",
        desc: "Open project notes in task view across all tabs. Turning this off restores their Markdown views.",
        render: (setting) => {
          setting.addToggle((toggle) => toggle.setValue(this.plugin.settings.taskMode).onChange((value) => this.plugin.setTaskMode(value)));
        }
      },
      {
        name: "Inbox note",
        desc: "Quick-created tasks are inserted into this Markdown note\u2019s checklist.",
        render: (setting) => this.renderInboxSetting(setting)
      },
      {
        name: "New task position",
        desc: "Insert added or moved tasks at the top or bottom of the first checklist in the destination file or heading. If there is no checklist, insert at the start of the scope.",
        render: (setting) => this.renderPositionSetting(setting)
      }
    ];
  }
  // Obsidian versions before 1.13 use this imperative settings page.
  display() {
    var _a;
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian13.Setting(containerEl).setName("Task defaults").setHeading();
    for (const definition of this.getSettingDefinitions()) {
      const setting = new import_obsidian13.Setting(containerEl).setName(definition.name).setDesc((_a = definition.desc) != null ? _a : "");
      definition.render(setting);
    }
  }
  renderInboxSetting(setting) {
    setting.addText((text) => text.setPlaceholder("Inbox.md").setValue(this.plugin.settings.inboxPath).onChange(async (value) => {
      const path = value.trim() || "Inbox.md";
      this.plugin.settings.inboxPath = path.endsWith(".md") ? path : `${path}.md`;
      await this.plugin.saveSettings();
      this.plugin.refreshViews();
    }));
  }
  renderPositionSetting(setting) {
    setting.addDropdown((dropdown) => dropdown.addOption("top", "Top").addOption("bottom", "Bottom").setValue(this.plugin.settings.newTaskPosition).onChange(async (value) => {
      this.plugin.settings.newTaskPosition = value === "bottom" ? "bottom" : "top";
      await this.plugin.saveSettings();
    }));
  }
};

// src/daily-notes.ts
function dailyNoteDateFormat(app) {
  var _a, _b, _c, _d, _e;
  const plugin = (_b = (_a = app.internalPlugins) == null ? void 0 : _a.getPluginById) == null ? void 0 : _b.call(_a, "daily-notes");
  return ((_e = (_d = (_c = plugin == null ? void 0 : plugin.instance) == null ? void 0 : _c.options) == null ? void 0 : _d.format) == null ? void 0 : _e.trim()) || DEFAULT_DATE_FORMAT;
}

// src/main.ts
var TaskManagerPlugin = class extends import_obsidian14.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULT_SETTINGS };
  }
  async onload() {
    await this.loadSettings();
    this.index = new TaskIndex(this.app, () => this.settings, () => this.dateFormat());
    this.store = new TaskStore(this.app, () => this.dateFormat(), () => this.settings.newTaskPosition);
    this.registerView(TASK_NAV_VIEW, (leaf) => new TaskNavigationView(leaf, this));
    this.registerView(TASK_MAIN_VIEW, (leaf) => new TaskMainView(leaf, this));
    this.registerEditorExtension(noteTokenEditor(() => this.dateFormat()));
    this.registerEditorExtension(noteTaskEditEditor(() => this.dateFormat(), (task) => this.openEditor({ mode: "all", task })));
    this.registerMarkdownPostProcessor((element, context) => {
      renderNoteTokens(element, this.dateFormat());
      registerNoteTaskEdit(element, context, () => this.dateFormat(), (task) => this.openEditor({ mode: "all", task }));
    });
    this.addSettingTab(new TaskManagerSettingTab(this.app, this));
    this.addRibbonIcon("circle-check-big", "Open task manager", () => void this.activateNavigation().catch((error) => new import_obsidian14.Notice(String(error))));
    const commands = [
      ["inbox", "Open Inbox", "open-inbox"],
      ["today", "Open Today", "open-today"],
      ["upcoming", "Open Upcoming", "open-upcoming"],
      ["all", "Open All Tasks", "open-all-tasks"],
      ["projects", "Open Projects", "open-projects"]
    ];
    for (const [mode, name, id] of commands) {
      this.addCommand({ id, name, callback: () => void this.openTaskView({ mode }).catch((error) => new import_obsidian14.Notice(String(error))) });
    }
    for (const [scope, layouts] of [["task", ["list", "calendar", "kanban"]], ["projects", ["list", "gantt"]]]) {
      for (const layout of layouts) {
        this.addCommand({
          id: `switch-${scope}-view-${layout}`,
          name: `Switch ${scope} view to ${layout}`,
          checkCallback: (checking) => {
            const view = this.app.workspace.getActiveViewOfType(TaskMainView);
            if (!view) return false;
            const state = view.getState();
            const isProjects = state.mode === "projects" && !view.pagePath;
            if (isProjects !== (scope === "projects")) return false;
            if (!checking) {
              void view.setState({ ...state, [isProjects ? "projectLayout" : "layout"]: layout }).then(() => this.app.workspace.requestSaveLayout()).catch((error) => new import_obsidian14.Notice(String(error)));
            }
            return true;
          }
        });
      }
    }
    this.addCommand({ id: "new-task", name: "Create new task", callback: () => this.openEditor({ mode: "inbox" }) });
    this.addRibbonIcon("plus", "Create new task", () => this.openEditor({ mode: "inbox" }));
    this.addCommand({ id: "toggle-task-mode", name: "Toggle task mode", callback: () => {
      void this.setTaskMode(!this.settings.taskMode).catch((error) => new import_obsidian14.Notice(String(error)));
    } });
    this.taskModeRibbon = this.addRibbonIcon("list-checks", "Task mode", () => {
      void this.setTaskMode(!this.settings.taskMode).catch((error) => new import_obsidian14.Notice(String(error)));
    });
    this.updateTaskModeControls();
    this.addCommand({
      id: "convert-to-project",
      name: "Convert to project",
      checkCallback: (checking) => {
        var _a, _b;
        const view = (_a = this.app.workspace.getActiveViewOfType(TaskMainView)) != null ? _a : this.app.workspace.getActiveViewOfType(import_obsidian14.MarkdownView);
        const path = view instanceof TaskMainView ? view.pagePath : view instanceof import_obsidian14.MarkdownView ? (_b = view.file) == null ? void 0 : _b.path : void 0;
        const file = path ? this.app.vault.getAbstractFileByPath(path) : void 0;
        if (!(file instanceof import_obsidian14.TFile) || file.extension !== "md") return false;
        if (!checking) void this.convertToProject(file);
        return true;
      }
    });
    await this.index.initialize();
    this.taskModeController = new TaskModeController(this.app, () => this.settings.taskMode, (path) => this.index.isProject(path));
    const syncTaskMode = () => {
      var _a;
      void ((_a = this.taskModeController) == null ? void 0 : _a.sync().catch((error) => new import_obsidian14.Notice(String(error))));
    };
    this.registerEvent(this.app.workspace.on("file-open", syncTaskMode));
    this.registerEvent(this.app.workspace.on("active-leaf-change", syncTaskMode));
    this.registerEvent(this.app.workspace.on("layout-change", syncTaskMode));
    this.register(this.index.subscribe(syncTaskMode));
    this.app.workspace.onLayoutReady(() => {
      syncTaskMode();
      void this.activateNavigation(false).catch((error) => new import_obsidian14.Notice(String(error)));
    });
  }
  onunload() {
    var _a;
    (_a = this.taskModeController) == null ? void 0 : _a.dispose();
    this.index.destroy();
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.taskMode = this.settings.taskMode === true;
    if (!this.settings.inboxPath.endsWith(".md")) this.settings.inboxPath = `${this.settings.inboxPath}.md`;
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  async activateNavigation(reveal = true) {
    var _a;
    let leaf = this.app.workspace.getLeavesOfType(TASK_NAV_VIEW)[0];
    if (!leaf) {
      leaf = (_a = this.app.workspace.getLeftLeaf(false)) != null ? _a : void 0;
      if (!leaf) return;
      await leaf.setViewState({ type: TASK_NAV_VIEW, active: true });
    }
    if (reveal) await this.app.workspace.revealLeaf(leaf);
  }
  async openTaskView(state) {
    await this.activateNavigation(false);
    let leaf = this.app.workspace.getLeavesOfType(TASK_MAIN_VIEW).find((candidate) => !candidate.view.getState().pagePath);
    const existingView = leaf == null ? void 0 : leaf.view;
    if (!leaf) leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: TASK_MAIN_VIEW, active: true, state: { ...state } });
    const currentView = leaf.view;
    if (currentView instanceof TaskMainView) await currentView.setState({ ...state });
    else if (existingView instanceof TaskMainView) await existingView.setState({ ...state });
    await this.app.workspace.revealLeaf(leaf);
    for (const navLeaf of this.app.workspace.getLeavesOfType(TASK_NAV_VIEW)) {
      const view = navLeaf.view;
      if (view instanceof TaskNavigationView) view.setActive(state.mode);
    }
  }
  async setTaskMode(enabled) {
    var _a;
    const previous = this.settings.taskMode;
    this.settings.taskMode = enabled;
    try {
      await this.saveSettings();
    } catch (cause) {
      this.settings.taskMode = previous;
      throw cause;
    }
    this.updateTaskModeControls();
    await ((_a = this.taskModeController) == null ? void 0 : _a.sync());
  }
  updateTaskModeControls() {
    var _a, _b, _c, _d;
    const enabled = this.settings.taskMode;
    (_a = this.taskModeRibbon) == null ? void 0 : _a.setAttribute("aria-label", `Task mode: ${enabled ? "On" : "Off"}`);
    (_b = this.taskModeRibbon) == null ? void 0 : _b.setAttribute("title", `Task mode: ${enabled ? "On" : "Off"}`);
    (_c = this.taskModeRibbon) == null ? void 0 : _c.setAttribute("aria-pressed", String(enabled));
    (_d = this.taskModeRibbon) == null ? void 0 : _d.classList.toggle("is-active", enabled);
    for (const leaf of this.app.workspace.getLeavesOfType(TASK_NAV_VIEW)) {
      if (leaf.view instanceof TaskNavigationView) leaf.view.refresh();
    }
  }
  async convertToProject(file) {
    try {
      await this.app.fileManager.processFrontMatter(file, addProjectProperties);
      await this.index.refreshPath(file.path);
      new import_obsidian14.Notice(`Converted ${file.basename} to a project.`);
    } catch (error) {
      new import_obsidian14.Notice(error instanceof Error ? error.message : "Could not convert the note to a project.");
    }
  }
  openEditor(state) {
    var _a;
    const options = {
      ...state,
      projectPath: (_a = state.pagePath) != null ? _a : state.projectPath,
      projects: this.index.projects(),
      settings: this.settings,
      dateFormat: this.dateFormat(),
      onDelete: state.task ? async () => {
        await this.store.delete(state.task);
        await this.index.refreshPath(state.task.path);
      } : void 0,
      onSave: async (draft) => {
        try {
          if (state.task) await this.store.update(state.task, draft);
          else await this.store.create(draft);
          await this.index.refreshPath(draft.destination);
          if (state.task && state.task.path !== draft.destination) await this.index.refreshPath(state.task.path);
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Could not save the task.";
          new import_obsidian14.Notice(message);
          throw cause;
        }
      }
    };
    new TaskEditorModal(this.app, options).open();
  }
  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(TASK_MAIN_VIEW)) {
      const view = leaf.view;
      if (view instanceof TaskMainView) view.render();
    }
  }
  dateFormat() {
    return dailyNoteDateFormat(this.app);
  }
};
