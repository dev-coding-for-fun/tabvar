import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TopoAttachment, User } from "~/lib/models";

const userState = vi.hoisted(() => ({
  user: null as User | null,
}));

vi.mock("~/lib/hooks/useUser", () => ({
  useUser: () => userState.user,
}));

vi.mock("react-router", () => ({
  useFetcher: () => ({
    state: "idle",
    submit: vi.fn(),
  }),
}));

vi.mock("@mantine/notifications", () => ({
  notifications: {
    show: vi.fn(),
  },
}));

vi.mock("~/contexts/MapboxContext", () => ({
  useMapboxContext: () => ({
    mapboxAccessToken: "token",
    mapboxStyleUrl: "style",
  }),
}));

vi.mock("yet-another-react-lightbox-lite", () => ({
  default: () => null,
}));

vi.mock("yet-another-react-lightbox-lite/styles.css", () => ({}));

vi.mock("./GpxMapViewer", () => ({
  GpxMapViewer: () => <div>GPX map</div>,
}));

vi.mock("@tabler/icons-react", () => ({
  IconDownload: () => <span />,
  IconFileTypePdf: () => <span />,
  IconPaperclip: () => <span />,
  IconPhoto: () => <span />,
  IconRoute: () => <span />,
  IconX: () => <span />,
}));

vi.mock("@mantine/core", () => ({
  ActionIcon: ({
    children,
    onClick,
    title,
  }: React.PropsWithChildren<{ onClick?: React.MouseEventHandler<HTMLButtonElement>; title?: string }>) => (
    <button aria-label={title} onClick={onClick}>
      {children}
    </button>
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
  FileButton: ({ children }: { children: (props: Record<string, never>) => React.ReactNode }) => children({}),
  Group: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Image: ({ alt }: { alt?: string }) => <img alt={alt} />,
  LoadingOverlay: () => null,
  Modal: ({
    children,
    onClose,
    opened,
    title,
  }: React.PropsWithChildren<{
    onClose: () => void;
    opened: boolean;
    title: string;
  }>) => opened ? (
    <section aria-label={title}>
      <button onClick={onClose}>Close</button>
      {children}
    </section>
  ) : null,
  Paper: ({
    children,
    component,
    href,
    onClick,
    rel,
    target,
  }: React.PropsWithChildren<{
    component?: string;
    href?: string;
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
    rel?: string;
    target?: string;
  }>) => component === "a" ? (
    <a href={href} onClick={onClick} rel={rel} target={target}>
      {children}
    </a>
  ) : (
    <div>{children}</div>
  ),
  Space: () => <div />,
  Stack: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Text: ({ children }: React.PropsWithChildren) => <p>{children}</p>,
  useMantineTheme: () => ({
    colors: {
      blue: ["", "", "", "", "", "", "blue"],
      gray: ["gray", "", "", "", "gray", "", "gray"],
      green: ["", "", "", "", "", "", "green"],
      red: ["", "", "", "", "", "", "red"],
    },
  }),
}));

import { DisclaimerAcknowledgementProvider } from "./DisclaimerAcknowledgement";
import { TopoGallery } from "./TopoGallery";

const attachment = (overrides: Partial<TopoAttachment> = {}): TopoAttachment => ({
  id: 1,
  url: "https://example.com/topo.pdf",
  type: "application/pdf",
  name: "topo.pdf",
  routes: [],
  sectors: [],
  crags: [],
  ...overrides,
});

const user = (overrides: Partial<User> = {}): User => ({
  uid: "user-1",
  email: "user@example.com",
  displayName: "Test User",
  ...overrides,
});

const renderGallery = () => render(
  <DisclaimerAcknowledgementProvider>
    <TopoGallery attachments={[attachment()]} />
  </DisclaimerAcknowledgementProvider>
);

describe("TopoGallery disclaimer downloads", () => {
  beforeEach(() => {
    userState.user = null;
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  it("does not download when the disclaimer modal is dismissed", () => {
    const clickSpy = vi.spyOn(HTMLElement.prototype, "click");

    renderGallery();

    fireEvent.click(screen.getByRole("link"));
    expect(screen.getByLabelText("Important Safety Notice")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Close"));

    expect(screen.queryByLabelText("Important Safety Notice")).not.toBeInTheDocument();
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it("continues the pending download after acknowledgement", async () => {
    const clickSpy = vi.spyOn(HTMLElement.prototype, "click");

    renderGallery();

    fireEvent.click(screen.getByRole("link"));
    fireEvent.click(screen.getByLabelText("I have read and understand this safety notice."));
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge & Download" }));

    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalledTimes(1);
    });
    expect(window.localStorage.getItem("tabvar.disclaimerAcknowledgedAt")).toEqual(expect.any(String));
    expect(screen.queryByLabelText("Important Safety Notice")).not.toBeInTheDocument();
  });

  it("does not continue a server-backed acknowledgement if the modal closes first", async () => {
    userState.user = user();
    let resolveAcknowledgement: (value: { ok: boolean }) => void = () => {};
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveAcknowledgement = resolve;
    })));
    const clickSpy = vi.spyOn(HTMLElement.prototype, "click");

    renderGallery();

    fireEvent.click(screen.getByRole("link"));
    fireEvent.click(screen.getByLabelText("I have read and understand this safety notice."));
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge & Download" }));
    fireEvent.click(screen.getByText("Close"));

    expect(fetch).toHaveBeenCalledWith("/action/acknowledge-disclaimer", {
      method: "POST",
      credentials: "same-origin",
    });
    resolveAcknowledgement({ ok: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.queryByLabelText("Important Safety Notice")).not.toBeInTheDocument();
    expect(clickSpy).not.toHaveBeenCalled();
  });
});
