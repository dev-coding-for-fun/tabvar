import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteSearchResults } from "~/lib/models";

const fetcher = vi.hoisted(() => ({
  data: undefined as RouteSearchResults[] | undefined,
  load: vi.fn(),
  state: "idle",
  submit: vi.fn(),
}));

vi.mock("react-router", () => ({
  useFetcher: () => fetcher,
}));

vi.mock("@mantine/core", () => ({
  Badge: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
  Box: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Group: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Stack: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Text: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
  Select: ({
    data,
    label,
    name,
    onChange,
    onSearchChange,
    searchValue,
    value,
  }: {
    data: Array<{ value: string; label: string }>;
    label: string;
    name: string;
    onChange: (value: string | null) => void;
    onSearchChange: (value: string) => void;
    searchValue: string;
    value: string | null;
  }) => (
    <div>
      {label && <label htmlFor={name}>{label}</label>}
      <input
        aria-label={`${name}-search`}
        value={searchValue}
        onChange={(event) => onSearchChange(event.currentTarget.value)}
      />
      <select
        aria-label={name}
        value={value ?? ""}
        onChange={(event) => onChange(event.currentTarget.value || null)}
      >
        <option value="">Choose</option>
        {data.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    </div>
  ),
}));

import RouteSearchBox, {
  getRouteSearchItemDisplayName,
  getRouteSearchItemSelectedLabel,
  getRouteSearchItemValue,
  mergeRouteSearchItems,
} from "./routeSearchBox";

const route = (overrides: Partial<RouteSearchResults> = {}): RouteSearchResults => ({
  routeId: 2185,
  sectorId: 21,
  cragId: 7,
  cragSlug: "test-crag",
  type: "route",
  routeName: "Solar Flare",
  routeAltNames: null,
  sectorName: "Main Wall",
  cragName: "Test Crag",
  gradeYds: "5.10a",
  boltCount: "8",
  pitchCount: "1",
  ...overrides,
});

describe("RouteSearchBox", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetcher.data = undefined;
    fetcher.load.mockReset();
    fetcher.submit.mockReset();
    fetcher.state = "idle";
  });

  it("renders the selected initial item label", () => {
    render(
      <RouteSearchBox
        label="Route"
        name="route"
        value="route:2185:test-crag"
        initialItems={[route()]}
      />
    );

    expect(screen.getByRole("option", { name: "Solar Flare · 5.10a · Main Wall · Test Crag" })).toBeInTheDocument();
    expect(screen.getByLabelText("route")).toHaveValue("route:2185:test-crag");
  });

  it("renders a selected item that arrives after the first render", () => {
    const { rerender } = render(<RouteSearchBox label="Route" name="route" value={null} />);

    rerender(
      <RouteSearchBox
        label="Route"
        name="route"
        value="route:2185:test-crag"
        selectedItem={route()}
      />
    );

    expect(screen.getByRole("option", { name: "Solar Flare · 5.10a · Main Wall · Test Crag" })).toBeInTheDocument();
    expect(screen.getByLabelText("route")).toHaveValue("route:2185:test-crag");
  });

  it("loads search results after the debounce", () => {
    render(<RouteSearchBox label="Route" name="route" value={null} searchMode="routesOnly" />);

    fireEvent.change(screen.getByLabelText("route-search"), { target: { value: "solar" } });
    vi.advanceTimersByTime(299);
    expect(fetcher.load).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fetcher.load).toHaveBeenCalledWith("/api/search?query=solar&searchMode=routesOnly");
  });

  it("looks up a route when the selected value is missing from options", () => {
    render(<RouteSearchBox label="Route" name="route" value="route:2185:test-crag" />);

    expect(fetcher.submit).toHaveBeenCalledWith(expect.any(FormData), {
      method: "post",
      action: "/api/route",
    });
    expect(fetcher.submit.mock.calls[0][0].get("routeId")).toBe("2185");
  });

  it("reports the selected route value and bolt count", () => {
    const onChange = vi.fn();
    render(
      <RouteSearchBox
        label="Route"
        name="route"
        value={null}
        initialItems={[route()]}
        onChange={onChange}
      />
    );

    fireEvent.change(screen.getByLabelText("route"), { target: { value: "route:2185:test-crag" } });

    expect(onChange).toHaveBeenCalledWith({
      value: "route:2185:test-crag",
      boltCount: 8,
    });
  });
});

describe("route search item helpers", () => {
  it("builds stable values and labels for supported item types", () => {
    expect(getRouteSearchItemValue(route())).toBe("route:2185:test-crag");
    expect(getRouteSearchItemDisplayName(route())).toBe("Solar Flare");
    expect(getRouteSearchItemSelectedLabel(route())).toBe("Solar Flare · 5.10a · Main Wall · Test Crag");
    expect(getRouteSearchItemValue(route({ type: "sector", routeId: null }))).toBe("sector:21:test-crag");
    expect(getRouteSearchItemDisplayName(route({ type: "crag", routeName: null }))).toBe("Test Crag");
  });

  it("merges item groups without duplicating matching values", () => {
    const selected = route();
    const duplicateSearchResult = route({ routeName: "Duplicate Name" });
    const otherRoute = route({ routeId: 2186, routeName: "Lunar Flare" });

    expect(mergeRouteSearchItems([selected], [duplicateSearchResult, otherRoute])).toEqual([
      selected,
      otherRoute,
    ]);
  });
});
