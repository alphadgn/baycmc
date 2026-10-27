import { describe, expect, it } from "vitest";
import {
  applyMention,
  mentionAtCaret,
  splitMentions,
  type MemberHit,
} from "@/lib/members/memberSearch";

const m = (id: string, username: string): MemberHit => ({
  id,
  username,
  avatar_url: null,
  wallet_display: null,
});
const members = [
  m("1", "Grateful Ape"),
  m("2", "Phillyape"),
  m("3", "fake customer service alphadgn"),
  m("4", "Ape"),
];

describe("mention parsing", () => {
  it("finds the @partial at the caret, including spaces", () => {
    expect(mentionAtCaret("hi @Grat", 8)).toEqual({ start: 3, query: "Grat" });
    expect(mentionAtCaret("hi @Grateful A", 14)).toEqual({ start: 3, query: "Grateful A" });
    expect(mentionAtCaret("@", 1)).toEqual({ start: 0, query: "" });
  });

  it("ignores emails, line breaks and a space right after @", () => {
    expect(mentionAtCaret("me@mail", 7)).toBeNull();
    expect(mentionAtCaret("@a\nb", 4)).toBeNull();
    expect(mentionAtCaret("@ hello", 7)).toBeNull();
  });

  it("inserts the picked username and moves the caret after it", () => {
    const r = applyMention("hi @Gr and more", 3, 6, "Grateful Ape");
    expect(r.text).toBe("hi @Grateful Ape and more");
    expect(r.caret).toBe("hi @Grateful Ape ".length);
  });

  it("highlights multi-word usernames, longest match first", () => {
    const parts = splitMentions("yo @fake customer service alphadgn and @Ape!", members);
    const mentions = parts.filter((p) => p.kind === "mention");
    expect(mentions.map((p) => p.kind === "mention" && p.member.id)).toEqual(["3", "4"]);
    expect(parts.map((p) => p.text).join("")).toBe("yo @fake customer service alphadgn and @Ape!");
  });

  it("is case-insensitive and needs a word boundary", () => {
    const parts = splitMentions("@grateful ape hi @Apex", members);
    expect(parts[0]).toMatchObject({ kind: "mention", member: { id: "1" } });
    expect(parts.filter((p) => p.kind === "mention")).toHaveLength(1);
  });

  it("leaves unknown names and emails as text", () => {
    expect(splitMentions("mail me@ape.com or @nobody", members)).toEqual([
      { kind: "text", text: "mail me@ape.com or @nobody" },
    ]);
  });
});
