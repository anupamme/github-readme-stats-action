import { describe, expect, test } from "vitest";

import { parseOptions } from "../action.js";

describe("parseOptions", () => {
  describe("empty input", () => {
    test.each([
      ["undefined", undefined],
      ["null", null],
      ["empty string", ""],
      ["whitespace only", "   "],
    ])("returns an empty object for %s", (_name, value) => {
      expect(parseOptions(value)).toEqual({});
    });
  });

  describe("query string input", () => {
    test("parses multiple key/value pairs", () => {
      expect(
        parseOptions("username=rickstaa&show_icons=true&langs_count=6"),
      ).toEqual({
        username: "rickstaa",
        show_icons: "true",
        langs_count: "6",
      });
    });

    test("joins repeated keys with a comma", () => {
      expect(parseOptions("hide=stars&hide=issues&hide=prs")).toEqual({
        hide: "stars,issues,prs",
      });
    });

    test("decodes percent encoded values", () => {
      expect(parseOptions("custom_title=My%20Stats%20%26%20Langs")).toEqual({
        custom_title: "My Stats & Langs",
      });
    });

    test("keeps keys without a value as an empty string", () => {
      expect(parseOptions("username=rickstaa&show_icons")).toEqual({
        username: "rickstaa",
        show_icons: "",
      });
    });

    test("trims surrounding whitespace", () => {
      expect(parseOptions("  username=rickstaa  ")).toEqual({
        username: "rickstaa",
      });
    });

    test("ignores a leading question mark", () => {
      expect(parseOptions("?username=rickstaa")).toEqual({
        username: "rickstaa",
      });
    });
  });

  describe("JSON input", () => {
    test("parses a flat object", () => {
      expect(parseOptions('{"username":"rickstaa"}')).toEqual({
        username: "rickstaa",
      });
    });

    test("stringifies non string values", () => {
      expect(
        parseOptions(
          '{"username":"rickstaa","show_icons":true,"langs_count":6,"ratio":1.5}',
        ),
      ).toEqual({
        username: "rickstaa",
        show_icons: "true",
        langs_count: "6",
        ratio: "1.5",
      });
    });

    test("joins array values with a comma", () => {
      expect(parseOptions('{"hide":["stars","issues","prs"]}')).toEqual({
        hide: "stars,issues,prs",
      });
    });

    test("joins numeric array values with a comma", () => {
      expect(parseOptions('{"exclude":[1,2,3]}')).toEqual({
        exclude: "1,2,3",
      });
    });

    test("drops null values", () => {
      expect(
        parseOptions('{"username":"rickstaa","theme":null,"locale":"en"}'),
      ).toEqual({
        username: "rickstaa",
        locale: "en",
      });
    });

    test("parses JSON surrounded by whitespace", () => {
      expect(parseOptions('  {"username":"rickstaa"}  ')).toEqual({
        username: "rickstaa",
      });
    });

    test("returns an empty object for an empty JSON object", () => {
      expect(parseOptions("{}")).toEqual({});
    });

    test("throws for invalid JSON", () => {
      expect(() => parseOptions('{"username":}')).toThrow(
        "Invalid JSON in options.",
      );
    });
  });
});
