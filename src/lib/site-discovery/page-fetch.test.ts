import { describe, expect, it } from "vitest";
import { extractReadableText } from "./page-fetch";

describe("extractReadableText", () => {
  it("strips tags and collapses whitespace", () => {
    const html = "<html><body><h1>Dive Site</h1>\n\n<p>Located at   18.42 N.</p></body></html>";
    expect(extractReadableText(html)).toBe("Dive Site Located at 18.42 N.");
  });

  it("removes script and style blocks entirely, including their content", () => {
    const html = "<style>.x{color:red}</style><script>var x = 1;</script><p>Real text</p>";
    expect(extractReadableText(html)).toBe("Real text");
  });

  it("removes HTML comments", () => {
    expect(extractReadableText("<p>Before</p><!-- a comment --><p>After</p>")).toBe("Before After");
  });

  it("decodes common HTML entities", () => {
    expect(extractReadableText("Fish &amp; chips &quot;quoted&quot; &lt;tag&gt; &#39;s &nbsp; end")).toBe(
      'Fish & chips "quoted" <tag> \'s end',
    );
  });

  it("returns an empty string for input with no text content", () => {
    expect(extractReadableText("<div><span></span></div>")).toBe("");
  });

  it("handles malformed/unclosed tags without throwing", () => {
    expect(() => extractReadableText("<div><p>Unclosed")).not.toThrow();
  });
});
