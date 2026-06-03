import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "~/lib/models";

const userState = vi.hoisted(() => ({
  user: null as User | null,
}));

vi.mock("~/lib/hooks/useUser", () => ({
  useUser: () => userState.user,
}));

vi.mock("@mantine/core", () => ({
  Alert: ({ children, title }: React.PropsWithChildren<{ title?: string }>) => (
    <section aria-label={title}>{children}</section>
  ),
  Button: ({
    children,
    disabled,
    loading,
    onClick,
  }: React.PropsWithChildren<{
    disabled?: boolean;
    loading?: boolean;
    onClick?: () => void;
  }>) => (
    <button disabled={disabled || loading} onClick={onClick}>
      {children}
    </button>
  ),
  Checkbox: ({
    checked,
    label,
    onChange,
  }: {
    checked: boolean;
    label: string;
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  }) => (
    <label>
      <input type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  ),
  Space: () => <div />,
  Text: ({ children }: React.PropsWithChildren) => <p>{children}</p>,
}));

vi.mock("@tabler/icons-react", () => ({
  IconAlertTriangle: () => <span />,
}));

import { DisclaimerAcknowledgementProvider } from "./DisclaimerAcknowledgement";
import GlobalBanner from "./GlobalBanner";

const user = (overrides: Partial<User> = {}): User => ({
  uid: "user-1",
  email: "user@example.com",
  displayName: "Test User",
  ...overrides,
});

const renderBanner = () => render(
  <DisclaimerAcknowledgementProvider>
    <GlobalBanner />
  </DisclaimerAcknowledgementProvider>
);

const renderBannerToString = () => renderToString(
  <DisclaimerAcknowledgementProvider>
    <GlobalBanner />
  </DisclaimerAcknowledgementProvider>
);

describe("GlobalBanner", () => {
  beforeEach(() => {
    userState.user = null;
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  it("lets guests dismiss the disclaimer after checking the acknowledgement", () => {
    renderBanner();

    const dismissButton = screen.getByRole("button", { name: "Acknowledge & Hide" });
    expect(dismissButton).toBeDisabled();

    fireEvent.click(screen.getByLabelText("I have read and understand this safety notice."));
    fireEvent.click(dismissButton);

    expect(screen.queryByLabelText("Important Safety Notice")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("tabvar.disclaimerAcknowledgedAt")).toEqual(expect.any(String));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not server-render the guest banner before stored acknowledgement can be checked", () => {
    const html = renderBannerToString();

    expect(html).not.toContain("Important Safety Notice");
    expect(html).not.toContain("Rock climbing is a potentially dangerous sport");
  });

  it("keeps the same acknowledgement gate before acknowledging for logged-in users", async () => {
    userState.user = user();

    renderBanner();

    const dismissButton = screen.getByRole("button", { name: "Acknowledge & Hide" });
    fireEvent.click(dismissButton);
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("I have read and understand this safety notice."));
    fireEvent.click(dismissButton);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/action/acknowledge-disclaimer", {
        method: "POST",
        credentials: "same-origin",
      });
    });
    expect(window.localStorage.getItem("tabvar.disclaimerAcknowledgedAt")).toBeNull();
  });

  it("does not show the disclaimer again when a guest has already acknowledged it", async () => {
    window.localStorage.setItem("tabvar.disclaimerAcknowledgedAt", new Date().toISOString());

    renderBanner();

    await waitFor(() => {
      expect(screen.queryByLabelText("Important Safety Notice")).not.toBeInTheDocument();
    });
  });

  it("does not show the disclaimer to users who have acknowledged it online", () => {
    userState.user = user({ disclaimerAckDate: new Date().toISOString() });

    renderBanner();

    expect(screen.queryByLabelText("Important Safety Notice")).not.toBeInTheDocument();
  });
});
