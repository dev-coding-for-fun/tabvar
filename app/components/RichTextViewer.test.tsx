import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RichTextViewer } from "./RichTextViewer";

function renderRichText(content: string) {
  return render(<MantineProvider><RichTextViewer content={content} /></MantineProvider>);
}

describe("RichTextViewer", () => {
  it("preserves editor formatting and safe links", () => {
    renderRichText('<h3>Approach</h3><p><strong>Steep</strong> <em>slab</em> <a href="https://example.com/route">route</a></p>');

    expect(screen.getByRole("heading", { name: "Approach" })).toBeInTheDocument();
    expect(screen.getByText("Steep").tagName).toBe("STRONG");
    expect(screen.getByText("slab").tagName).toBe("EM");
    expect(screen.getByRole("link", { name: "route" })).toHaveAttribute("href", "https://example.com/route");
  });

  it("removes executable markup, attributes, and unsafe link destinations", () => {
    const { container } = renderRichText('<p onclick="alert(1)">Notes <img src="x" onerror="alert(1)"><script>alert(1)</script><svg onload="alert(1)"></svg><a href="java&#x73;cript:alert(1)" target="_blank">bad link</a><a href="/topos/1">internal link</a></p>');

    expect(container.querySelector("script, img, svg, [onclick], [onerror], [onload], [target]")).toBeNull();
    expect(container).not.toHaveTextContent("alert(1)");
    expect(screen.getByText("bad link").closest("a")).not.toHaveAttribute("href");
    expect(screen.getByRole("link", { name: "internal link" })).toHaveAttribute("href", "/topos/1");
  });

  it("renders plain text as text", () => {
    const { container } = renderRichText('A note with < and "quotes"');

    expect(container).toHaveTextContent('A note with < and "quotes"');
    expect(container.querySelector("a, script")).toBeNull();
  });
});
