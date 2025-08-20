import { describe, it, expect } from "vitest";
import { validateBotTokenFormat } from "../utils/tokens";
import { encrypt, decrypt } from "../utils/crypto";

describe("token utilities", () => {
  it("validates token format", () => {
    const good = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghiJKL"; // >=35 chars after colon
    expect(validateBotTokenFormat(good)).toBe(true);
    expect(validateBotTokenFormat("bad")).toBe(false);
    expect(validateBotTokenFormat("123:short")).toBe(false);
  });

  it("encrypts and decrypts symmetrically", () => {
    const sample = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghiJKL";
    const enc = encrypt(sample);
    expect(enc).not.toEqual(sample);
    const dec = decrypt(enc);
    expect(dec).toEqual(sample);
  });
});
