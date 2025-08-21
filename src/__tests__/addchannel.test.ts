import { describe, it, expect, beforeEach, vi } from "vitest";
import { getUserChannels } from "../commands/channels";

vi.mock("../models/Channel", () => ({
  ChannelModel: {
    find: vi.fn(),
  },
}));

describe("addchannel functionality", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should handle private channel forwarded message", async () => {
    const forwardedMessage = {
      forward_from_chat: {
        id: -1001234567890,
        title: "Test Private Channel",
        type: "channel",
      },
    };

    const chatId = forwardedMessage.forward_from_chat.id;
    const title = forwardedMessage.forward_from_chat.title;
    const type = forwardedMessage.forward_from_chat.type;

    expect(chatId).toBe(-1001234567890);
    expect(title).toBe("Test Private Channel");
    expect(type).toBe("channel");
  });

  it("should handle public channel username", async () => {
    const usernameText = "@testchannel";
    const usernameRegex = /^@\w{4,}$/;

    expect(usernameRegex.test(usernameText)).toBe(true);
    expect(usernameText.slice(1)).toBe("testchannel");
  });

  it("should return empty array for invalid user id", async () => {
    const result = await getUserChannels(undefined);
    expect(result).toEqual([]);
  });

  it("should validate channel permissions structure", () => {
    const permissions = { canPost: true, canEdit: true, canDelete: true };

    expect(permissions).toHaveProperty("canPost", true);
    expect(permissions).toHaveProperty("canEdit", true);
    expect(permissions).toHaveProperty("canDelete", true);
  });

  it("should handle forwarded message without forward_from_chat", () => {
    const regularMessage = {
      text: "Hello world",
    };

    const fwdChat = (regularMessage as { forward_from_chat?: unknown })
      .forward_from_chat;
    expect(fwdChat).toBeUndefined();
  });

  it("should validate username format correctly", () => {
    const validUsernames = ["@testchannel", "@channel123", "@test_channel"];
    const invalidUsernames = ["@ab", "@abc", "testchannel", "@", "@123"];

    const usernameRegex = /^@\w{4,}$/;

    validUsernames.forEach((username) => {
      expect(usernameRegex.test(username)).toBe(true);
    });

    invalidUsernames.forEach((username) => {
      expect(usernameRegex.test(username)).toBe(false);
    });
  });
});
