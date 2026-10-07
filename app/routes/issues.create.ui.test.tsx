import React from "react";
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import CreateIssue from "./issues.create";

const fontsDescriptor = Object.getOwnPropertyDescriptor(document, "fonts");

beforeAll(() => {
  // Mantine's autosizing textarea listens for font loading; happy-dom lacks this API.
  Object.defineProperty(document, "fonts", { configurable: true, value: new EventTarget() });
});

afterAll(() => {
  if (fontsDescriptor) Object.defineProperty(document, "fonts", fontsDescriptor);
  else Reflect.deleteProperty(document, "fonts");
});

function renderCreateIssue() {
  const Routes = createRoutesStub([
    {
      path: "/issues/create",
      Component: CreateIssue,
      HydrateFallback: () => null,
      loader: () => ({ initialRoute: null }),
    },
  ]);

  return render(
    <MantineProvider env="test">
      <Routes initialEntries={["/issues/create"]} />
    </MantineProvider>
  );
}

describe("hardware provenance selection", () => {
  it.each(["Bolts (#)", "All Bolts", "Anchor"])(
    "allows hardware provenance for %s and clears it when switching to Rock",
    async (issueType) => {
      renderCreateIssue();
      const provenance = await screen.findByRole("radio", { name: "Hardware provenance" });
      expect(provenance).toBeDisabled();
      expect(screen.getByText(
        "Documents uncertified, custom, or unusual route hardware to track its origin and long-term durability."
      )).toBeInTheDocument();

      fireEvent.click(screen.getByRole("radio", { name: issueType }));
      expect(provenance).toBeEnabled();
      fireEvent.click(provenance);
      expect(provenance).toBeChecked();

      fireEvent.click(screen.getByRole("radio", { name: "Rock" }));
      expect(provenance).toBeDisabled();
      expect(provenance).not.toBeChecked();
    }
  );
});
