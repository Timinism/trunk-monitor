import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sbcRestBase } from "../lib/sbc-url";

describe("sbcRestBase", () => {
  it("builds an https REST root from a host and port", () => {
    assert.equal(sbcRestBase("192.0.2.10", 443), "https://192.0.2.10/rest");
    assert.equal(sbcRestBase("sbc.example.com", 8443), "https://sbc.example.com:8443/rest");
  });

  it("keeps an explicit port on the host", () => {
    assert.equal(sbcRestBase("sbc.example.com:8443", 443), "https://sbc.example.com:8443/rest");
  });

  it("accepts a full URL that already includes /rest", () => {
    assert.equal(sbcRestBase("https://sbc.example.com/rest", 443), "https://sbc.example.com/rest");
  });

  it("wraps IPv6 hosts", () => {
    assert.equal(sbcRestBase("[2001:db8::10]", 443), "https://[2001:db8::10]/rest");
  });
});
