import { defineMcp } from "@lovable.dev/mcp-js";
import echoTool from "./tools/echo";

export default defineMcp({
  name: "baycmc-mcp",
  title: "BAYCMC MCP",
  version: "0.1.0",
  instructions:
    "Tools for the BAYCMC app. Use `echo` to verify connectivity.",
  tools: [echoTool],
});
