import { describe, expect, it } from "vitest";
import { formatPublicError } from "../../src/control/errorFormatting";

describe("formatPublicError", () => {
  it("returns an Error message with control and newline characters removed", () => {
    const error = new Error("first\nsecond\r\u0000third\u007ffourth");

    expect(formatPublicError(error, "fallback")).toBe("firstsecondthirdfourth");
  });

  it("caps public Error messages at 200 characters", () => {
    expect(formatPublicError(new Error("x".repeat(201)), "fallback")).toBe("x".repeat(200));
  });

  it.each([
    ["U+202E right-to-left override", "\u202e"],
    ["U+2066 left-to-right isolate", "\u2066"],
    ["U+200B zero-width space", "\u200b"],
    ["U+2028 line separator", "\u2028"],
    ["U+2029 paragraph separator", "\u2029"]
  ])("removes %s by exact code point", (_label, control) => {
    expect(formatPublicError(new Error(`left${control}right`), "fallback")).toBe(
      "leftright"
    );
  });

  it("removes related bidi and zero-width format controls", () => {
    const controls = [
      "\u00ad",
      "\u061c",
      "\u180e",
      "\u200c",
      "\u200d",
      "\u200e",
      "\u200f",
      "\u202a",
      "\u202b",
      "\u202c",
      "\u202d",
      "\u2060",
      "\u2067",
      "\u2068",
      "\u2069",
      "\ufeff"
    ].join("");

    expect(formatPublicError(new Error(`before${controls}after`), "fallback")).toBe(
      "beforeafter"
    );
  });

  it("removes controls before applying the final 200-character cap", () => {
    expect(
      formatPublicError(new Error(`${"x".repeat(199)}\u202eZ`), "fallback")
    ).toBe(`${"x".repeat(199)}Z`);
  });

  it("preserves ordinary Unicode and caps by complete code points", () => {
    const ordinary = "Résumé İstanbul 中文 العربية 🐓";

    expect(formatPublicError(new Error(ordinary), "fallback")).toBe(ordinary);
    expect(formatPublicError(new Error("🐓".repeat(201)), "fallback")).toBe(
      "🐓".repeat(200)
    );
  });

  it("uses the stable fallback for unknown values and never serializes them", () => {
    const value = {
      message: "<b>private</b>",
      stack: "private stack",
      toJSON: () => ({ private: true })
    };

    expect(formatPublicError(value, "Operation failed")).toBe("Operation failed");
    expect(formatPublicError("private string", "Operation failed")).toBe("Operation failed");
  });

  it("uses the fallback when an Error-shaped object rejects message inspection", () => {
    const hostileError = new Proxy(new Error("private"), {
      get: (target, property, receiver) => {
        if (property === "message") {
          throw new Error("message getter failed");
        }
        return Reflect.get(target, property, receiver);
      }
    });

    expect(formatPublicError(hostileError, "Operation failed")).toBe("Operation failed");
  });

  it("uses the fallback when sanitizing leaves an empty Error message", () => {
    expect(formatPublicError(new Error("\n\r\u0000"), "Operation failed")).toBe(
      "Operation failed"
    );
  });
});
