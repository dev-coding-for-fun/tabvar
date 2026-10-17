import React from "react";
import { MantineProvider } from "@mantine/core";
import { render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { UserProvider } from "~/lib/hooks/useUser";
import type { ChangeView } from "~/lib/submissionView.server";
import { createUser } from "~/test/helpers";
import AdminSubmissions from "./admin.submissions";

const summary = {
  id: "sub-1",
  uid: "submitter",
  source: "topobuilder",
  error: null as string | null,
  createdAt: "2026-10-16 12:00:00",
  submitterName: "Sam Submitter",
  submitterEmail: "sam@example.com",
  counts: { creates: 1, edits: 1 },
  conflictCounts: { conflicts: 0, warnings: 0 },
};

const changes: ChangeView[] = [
  {
    index: 0,
    entity: "sector",
    op: "create",
    ref: "s1",
    id: null,
    title: "New sector “Main Wall”",
    location: null,
    fields: [{ name: "name", label: "Name", proposed: { kind: "text", text: "Main Wall" } }],
    unchangedCount: 0,
    missing: false,
  },
  {
    index: 1,
    entity: "route",
    op: "update",
    ref: null,
    id: 100,
    title: "Edit route “Me & My Shadow”",
    location: "Grassi Lakes › Golf Course",
    fields: [{
      name: "gradeYds",
      label: "Grade",
      current: { kind: "text", text: "5.10b" },
      proposed: { kind: "text", text: "5.10c" },
    }],
    unchangedCount: 1,
    missing: false,
  },
];

function renderPage(loaderData: unknown, url = "/admin/submissions?id=sub-1") {
  const Routes = createRoutesStub([
    {
      path: "/admin/submissions",
      Component: AdminSubmissions,
      HydrateFallback: () => null,
      loader: () => loaderData,
    },
  ]);

  return render(
    <MantineProvider env="test">
      <UserProvider user={createUser({ role: "admin" })}>
        <Routes initialEntries={[url]} />
      </UserProvider>
    </MantineProvider>
  );
}

describe("submissions review page", () => {
  it("shows the selected submission's changes with current and proposed values", async () => {
    renderPage({ submissions: [summary], selected: { id: "sub-1", changes, conflicts: {} } });

    expect(await screen.findByText("Edit route “Me & My Shadow”")).toBeInTheDocument();
    expect(screen.getByText("Grassi Lakes › Golf Course")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Current" })).toBeInTheDocument();
    expect(screen.getByText("5.10b")).toBeInTheDocument();
    expect(screen.getByText("5.10c")).toBeInTheDocument();
    expect(screen.getByText("1 proposed field already matches the current record.")).toBeInTheDocument();
    expect(screen.getByText("New sector “Main Wall”")).toBeInTheDocument();
    expect(screen.getAllByText("1 new · 1 edit").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled();
    expect(document.querySelector("a[aria-current]")).toHaveTextContent("Sam Submitter");
  });

  it("explains a failed approval and a record that's gone", async () => {
    renderPage({
      submissions: [{ ...summary, error: "route 100 no longer exists." }],
      selected: { id: "sub-1", changes: [{ ...changes[1], fields: [], missing: true, unchangedCount: 0 }], conflicts: {} },
    });

    const failure = await screen.findByText("The last approval attempt failed");
    expect(within(failure.closest("[role=alert]") as HTMLElement).getByText(/route 100 no longer exists/)).toBeInTheDocument();
    expect(screen.getByText("This route no longer exists, so approving will fail.")).toBeInTheDocument();
    expect(screen.getByText("approval failed")).toBeInTheDocument();
  });

  it("shows conflicts and the record-changed warning on the affected change", async () => {
    renderPage({
      submissions: [{ ...summary, conflictCounts: { conflicts: 2, warnings: 1 } }],
      selected: {
        id: "sub-1",
        changes,
        conflicts: {
          1: {
            fieldConflicts: [{
              field: "gradeYds", label: "Grade", at: "2026-10-16 13:00:00",
              authorName: "Alex", reviewerName: null, before: "5.10b", after: "5.10c",
            }],
            overlaps: [{ submissionId: "sub-2", submitterName: "Kim", fields: ["Grade"] }],
            recordChanged: { kind: "otherFields", fields: ["Name"] },
          },
        },
      },
    });

    expect(await screen.findByText("Conflicts")).toBeInTheDocument();
    expect(screen.getByText(/5.10b → 5.10c, by Alex/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "a submission from Kim" })).toHaveAttribute("href", "/admin/submissions?id=sub-2");
    expect(screen.getByText(/Other fields changed after the submitter last saw this record: Name./)).toBeInTheDocument();
    expect(screen.getByText("2 conflicts")).toBeInTheDocument();
    expect(screen.getByText("record changed")).toBeInTheDocument();
    expect(screen.getByText("Conflict")).toBeInTheDocument();
  });

  it("shows an empty queue", async () => {
    renderPage({ submissions: [], selected: null }, "/admin/submissions");

    expect(await screen.findByText("No submissions are waiting for review.")).toBeInTheDocument();
  });
});
