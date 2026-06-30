import { describe, expect, it } from "vitest";
import { parseJsonArray } from "./utils.js";

describe("market field parsing", () => {
  it("parses polymarket JSON string arrays", () => {
    expect(parseJsonArray<string>('["Yes","No"]')).toEqual(["Yes", "No"]);
    expect(parseJsonArray<string>('["0.42","0.58"]')).toEqual(["0.42", "0.58"]);
    expect(parseJsonArray<string>('bad', ["fallback"])).toEqual(["fallback"]);
  });
});
