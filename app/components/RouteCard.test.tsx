import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MantineProvider, DEFAULT_THEME } from "@mantine/core";
import { MemoryRouter } from "react-router";
import type { Route, Issue } from "~/lib/models";
import { RouteCard } from "./RouteCard";

vi.mock("~/components/TopoGallery", () => ({
  TopoGallery: () => <div data-testid="topo-gallery" />,
}));

vi.mock("~/components/RichTextViewer", () => ({
  RichTextViewer: ({ content }: { content: string }) => <div data-testid="rich-text">{content}</div>,
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useFetcher: () => ({
      state: "idle",
      submit: vi.fn(),
    }),
  };
});

const theme = DEFAULT_THEME;

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <MantineProvider theme={theme}>
      <MemoryRouter>{ui}</MemoryRouter>
    </MantineProvider>
  );
}

describe("RouteCard issue display and popup modal", () => {
  const baseRoute: Route = {
    id: 101,
    name: "Classic Crack",
    gradeYds: "5.10a",
    climbStyle: "Trad",
    boltCount: 0,
    issues: [],
    attachments: [],
  };

  it("does not render any issue badge when the route has no issues", () => {
    renderWithProviders(<RouteCard route={baseRoute} theme={theme} />);

    expect(screen.getByText("Classic Crack")).toBeDefined();
    expect(screen.getByText("5.10a")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Issue/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Safety Notice/i })).toBeNull();
  });

  it("does not display issue details inline by default, but displays a clickable issue badge", () => {
    const routeWithIssue: Route = {
      ...baseRoute,
      issues: [
        {
          id: 1,
          routeId: 101,
          issueType: "Bolts",
          subIssueType: "Loose bolt",
          status: "open",
          description: "Second bolt is spinning and very loose.",
          isFlagged: true,
          flaggedMessage: "Extreme fall hazard on bolt 2",
          attachments: [
            {
              id: 11,
              issueId: 1,
              url: "https://example.com/photos/bolt.jpg",
              type: "image/jpeg",
              name: "bolt.jpg",
            },
          ],
        },
      ],
    };

    renderWithProviders(<RouteCard route={routeWithIssue} theme={theme} />);

    // In-line issue description and safety notice should NOT be visible by default
    expect(screen.queryByText("Second bolt is spinning and very loose.")).toBeNull();
    expect(screen.queryByText("Extreme fall hazard on bolt 2")).toBeNull();

    // The compact issue badge is displayed
    const issueBadge = screen.getByRole("button", { name: /Safety Notice/i });
    expect(issueBadge).toBeDefined();

    // Clicking the badge opens the read-only modal with details and attachments
    fireEvent.click(issueBadge);

    // Modal contents are now visible
    expect(screen.getByText(/Issue Details – Classic Crack/i)).toBeDefined();
    expect(screen.getByText("Second bolt is spinning and very loose.")).toBeDefined();
    expect(screen.getByText("Extreme fall hazard on bolt 2")).toBeDefined();
    expect(screen.getByText(/Attachments \(1\)/i)).toBeDefined();
    expect(screen.getByRole("img", { name: "bolt.jpg" })).toBeDefined();

    // Clicking Close closes the modal
    const closeBtn = screen.getByRole("button", { name: "Close" });
    fireEvent.click(closeBtn);

    expect(screen.queryByText("Second bolt is spinning and very loose.")).toBeNull();
  });

  it("handles multiple issues on a route and displays counts in badge and modal", () => {
    const routeWithMultipleIssues: Route = {
      ...baseRoute,
      issues: [
        {
          id: 1,
          routeId: 101,
          issueType: "Rock",
          subIssueType: "Loose block",
          status: "open",
          description: "Chossy block near the chains.",
          isFlagged: false,
        },
        {
          id: 2,
          routeId: 101,
          issueType: "Anchor",
          subIssueType: "Worn",
          status: "in_progress",
          description: "Grooved cold shut.",
          isFlagged: false,
        },
      ],
    };

    renderWithProviders(<RouteCard route={routeWithMultipleIssues} theme={theme} />);

    // Compact badge shows issue count
    const badge = screen.getByRole("button", { name: "2 Issues" });
    expect(badge).toBeDefined();

    // In-line descriptions must not be visible by default
    expect(screen.queryByText("Chossy block near the chains.")).toBeNull();
    expect(screen.queryByText("Grooved cold shut.")).toBeNull();

    // Open modal
    fireEvent.click(badge);

    // Title and both issues are displayed
    expect(screen.getByText("Issues for Classic Crack (2)")).toBeDefined();
    expect(screen.getByText("Chossy block near the chains.")).toBeDefined();
    expect(screen.getByText("Grooved cold shut.")).toBeDefined();
  });
});
