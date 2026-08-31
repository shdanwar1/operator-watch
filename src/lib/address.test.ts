import { describe, expect, it } from "vitest";
import { cleanAddress, streetFromPlaceLabel } from "./address";

describe("cleanAddress", () => {
  it("strips postcode and city", () => {
    expect(cleanAddress("Grüntaler Str. 18, 13357 Berlin")).toBe("Grüntaler Str. 18");
  });
  it("strips a trailing city-only segment after a street", () => {
    expect(cleanAddress("Kaiserin-Augusta-Allee 10, Berlin")).toBe(
      "Kaiserin-Augusta-Allee 10",
    );
  });
  it("keeps a plain street address untouched", () => {
    expect(cleanAddress("Grüntaler Str. 18")).toBe("Grüntaler Str. 18");
  });
  it("keeps a bare place name untouched", () => {
    expect(cleanAddress("Dance Masterclass Studio")).toBe("Dance Masterclass Studio");
  });
  it("handles multi-segment addresses (district after street is dropped too)", () => {
    expect(cleanAddress("Osloer Str. 12, Gesundbrunnen, 13357 Berlin")).toBe(
      "Osloer Str. 12",
    );
  });
});

describe("streetFromPlaceLabel", () => {
  it("finds the street segment in a place slug", () => {
    expect(
      streetFromPlaceLabel("Dance Masterclass, Kaiserin-Augusta-Allee 10, 10553 Berlin"),
    ).toBe("Kaiserin-Augusta-Allee 10");
  });
  it("returns the street when the slug is street-only", () => {
    expect(streetFromPlaceLabel("Grüntaler Str. 18, 13357 Berlin")).toBe(
      "Grüntaler Str. 18",
    );
  });
  it("returns null for a business-name-only slug", () => {
    expect(streetFromPlaceLabel("Dance Masterclass Studio")).toBeNull();
  });
  it("does not mistake a bare postcode for a street", () => {
    expect(streetFromPlaceLabel("Dance Masterclass, 10553 Berlin")).toBeNull();
  });
});
