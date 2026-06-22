import { describe, it, expect } from "vitest";
import type { BotNode } from "@copilotkit/bot-ui";
import {
  renderAdaptiveCard,
  isPlainText,
  collectPlainText,
} from "./adaptive-card.js";

const text = (value: string): BotNode => ({ type: "text", props: { value } });
const el = (type: string, children: BotNode[], props = {}): BotNode => ({
  type,
  props: { ...props, children },
});

describe("renderAdaptiveCard", () => {
  it("emits a versioned AdaptiveCard envelope", () => {
    const card = renderAdaptiveCard([text("hi")]);
    expect(card.type).toBe("AdaptiveCard");
    expect(card.version).toBe("1.5");
    expect(Array.isArray(card.body)).toBe(true);
  });

  it("renders a header as a bold large TextBlock", () => {
    const card = renderAdaptiveCard([el("header", [text("Title")])]);
    expect(card.body[0]).toMatchObject({
      type: "TextBlock",
      text: "Title",
      weight: "Bolder",
      size: "Large",
    });
  });

  it("renders section/markdown as wrapped TextBlocks", () => {
    const card = renderAdaptiveCard([el("section", [text("Body copy")])]);
    expect(card.body[0]).toMatchObject({
      type: "TextBlock",
      text: "Body copy",
      wrap: true,
    });
  });

  it("renders <Fields> as a FactSet, splitting 'k: v' into title/value", () => {
    const card = renderAdaptiveCard([
      el("fields", [
        el("field", [text("Status: Open")]),
        el("field", [text("just a value")]),
      ]),
    ]);
    expect(card.body[0]).toMatchObject({
      type: "FactSet",
      facts: [
        { title: "Status", value: "Open" },
        { title: "", value: "just a value" },
      ],
    });
  });

  it("renders a <Button> as a top-level Action.Submit carrying the opaque id", () => {
    const card = renderAdaptiveCard([
      el("actions", [
        el("button", [text("Approve")], {
          onClick: { id: "ck:approve" },
          value: { decision: "yes" },
          style: "primary",
        }),
      ]),
    ]);
    expect(card.body).toHaveLength(0);
    expect(card.actions).toEqual([
      {
        type: "Action.Submit",
        title: "Approve",
        data: { ckActionId: "ck:approve", value: { decision: "yes" } },
        style: "positive",
      },
    ]);
  });

  it("renders <Select>/<Input> as body inputs", () => {
    const card = renderAdaptiveCard([
      el("select", [], {
        onSelect: { id: "ck:pick" },
        placeholder: "Choose",
        options: [
          { label: "One", value: "1" },
          { label: "Two", value: "2" },
        ],
      }),
      el("input", [], { onSubmit: { id: "ck:txt" }, multiline: true }),
    ]);
    expect(card.body[0]).toMatchObject({
      type: "Input.ChoiceSet",
      id: "ck:pick",
      placeholder: "Choose",
      choices: [
        { title: "One", value: "1" },
        { title: "Two", value: "2" },
      ],
    });
    expect(card.body[1]).toMatchObject({
      type: "Input.Text",
      id: "ck:txt",
      isMultiline: true,
    });
  });

  it("renders a <Table> as a native Table with a header row", () => {
    const card = renderAdaptiveCard([
      el(
        "table",
        [el("row", [el("cell", [text("a1")]), el("cell", [text("b1")])])],
        {
          columns: [{ header: "A" }, { header: "B", align: "right" }],
        },
      ),
    ]);
    const table = card.body[0] as Record<string, unknown>;
    expect(table.type).toBe("Table");
    expect(table.firstRowAsHeader).toBe(true);
    const rows = table.rows as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2); // header + 1 data row
    expect(rows[0]!.type).toBe("TableRow");
  });

  it("clamps top-level actions to the Teams ceiling", () => {
    const buttons = Array.from({ length: 10 }, (_, i) =>
      el("button", [text(`b${i}`)], { onClick: { id: `ck:${i}` } }),
    );
    const card = renderAdaptiveCard([el("actions", buttons)]);
    expect(card.actions).toHaveLength(6);
  });

  it("skips unknown intrinsics without throwing", () => {
    const card = renderAdaptiveCard([el("mystery", [text("x")])]);
    expect(card.body).toHaveLength(0);
  });
});

describe("isPlainText", () => {
  it("is true for text-only trees", () => {
    expect(isPlainText([text("hi")])).toBe(true);
    expect(isPlainText([el("message", [el("section", [text("hi")])])])).toBe(
      true,
    );
  });

  it("is false once any rich element appears", () => {
    expect(isPlainText([el("header", [text("hi")])])).toBe(false);
    expect(isPlainText([el("actions", [el("button", [text("x")])])])).toBe(
      false,
    );
  });
});

describe("collectPlainText", () => {
  it("joins block text depth-first", () => {
    const ir = [el("message", [el("section", [text("a")]), text("b")])];
    expect(collectPlainText(ir)).toBe("ab");
  });
});
