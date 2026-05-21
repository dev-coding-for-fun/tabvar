import { useFetcher } from "react-router";
import { SelectProps, Group, Select, Text, Badge, Stack, Box } from "@mantine/core";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { RouteSearchResults } from "~/lib/models";

interface RouteSearchBoxProps {
    label: string;
    name: string;
    required?: boolean;
    onChange?: (selected: { value: string | null; boltCount: number | null }) => void;
    value: string | null;
    searchMode?: 'allObjects' | 'routesOnly' | 'global' | undefined;
    selectedItem?: RouteSearchResults | null;
    pinnedItems?: RouteSearchResults[];
    initialItems?: RouteSearchResults[];
}

export type SearchBoxRef = { 
  reset: () => void;
};

export const getRouteSearchItemDisplayName = (item: RouteSearchResults) => {
  switch (item.type) {
    case 'route':
      return item.routeName || 'Unnamed Route';
    case 'sector':
      return item.sectorName || item.routeName || 'Unnamed Sector';
    case 'crag':
      return item.cragName || item.routeName || 'Unnamed Crag';
    default:
      return 'Unknown';
  }
};

export const getRouteSearchItemSelectedLabel = (item: RouteSearchResults) => {
  const labelParts = [
    getRouteSearchItemDisplayName(item),
    item.type === 'route' ? item.gradeYds : null,
    item.type !== 'crag' ? item.sectorName : null,
    item.cragName,
  ];

  return labelParts.filter(Boolean).join(' · ');
};

export const getRouteSearchItemValue = (item: RouteSearchResults) => {
  const cragPath = item.cragSlug ?? item.cragId;

  if (item.type === 'route') {
    return `${item.type}:${item.routeId}:${cragPath}`;
  }
  else if (item.type === 'sector') {
    return `${item.type}:${item.sectorId}:${cragPath}`;
  }
  else if (item.type === 'crag') {
    return `${item.type}:${item.cragId}:${cragPath}`;
  }
  else throw new Error(`Unknown item type: ${item.type}`);
};

export const mergeRouteSearchItems = (...itemGroups: Array<RouteSearchResults[] | undefined>) => {
  const seen = new Set<string>();
  const merged: RouteSearchResults[] = [];

  for (const items of itemGroups) {
    for (const item of items ?? []) {
      const value = getRouteSearchItemValue(item);
      if (!seen.has(value)) {
        seen.add(value);
        merged.push(item);
      }
    }
  }

  return merged;
};

export const RouteSearchOptionBadge = ({ type }: { type: string }) => {
  switch (type) {
    case 'route':
      return <Badge size="xs" variant="light" color="blue" style={{ flexShrink: 0 }}>Route</Badge>;
    case 'sector':
      return <Badge size="xs" variant="light" color="green" style={{ flexShrink: 0 }}>Sector</Badge>;
    case 'crag':
      return <Badge size="xs" variant="light" color="orange" style={{ flexShrink: 0 }}>Crag</Badge>;
    default:
      return null;
  }
};

const RouteSearchOptionWrapper = ({
  children,
  type,
}: React.PropsWithChildren<{ type: string }>) => (
  <Group gap="xs" wrap="nowrap" align="flex-start" style={{ width: '100%' }}>
    <RouteSearchOptionBadge type={type} />
    {children}
  </Group>
);

export const RouteSearchOption = ({ item }: { item: RouteSearchResults }) => {
  if (item.type === 'route') {
    return (
      <RouteSearchOptionWrapper type={item.type}>
        <Box style={{ flexGrow: 1, minWidth: 0 }}>
          {/* Mobile Layout for Route */}
          <Stack
            gap="xs"
            hiddenFrom="sm"
          >
            <Group wrap="wrap" gap="xs" align="flex-start">
              <Text size="sm" fw={500} lineClamp={1} title={getRouteSearchItemDisplayName(item)} style={{ flexGrow: 1, minWidth: '50px' /* Allow some space before wrapping grade */ }}>
                {getRouteSearchItemDisplayName(item)}
              </Text>
              {item.gradeYds && (
                <Badge size="xs" variant="outline" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {item.gradeYds}
                </Badge>
              )}
            </Group>
            {(item.sectorName || item.cragName) && (
              <Group gap="xs" wrap="nowrap">
                {item.sectorName && <Text size="xs" opacity={0.7}>{item.sectorName}</Text>}
                {item.cragName && <Text size="xs" opacity={0.7}>{item.cragName}</Text>}
              </Group>
            )}
          </Stack>

          {/* Desktop Layout for Route */}
          <Group
            wrap="nowrap"
            justify="space-between"
            align="flex-start"
            visibleFrom="sm"
            style={{
              flexGrow: 1,
            }}
          >
            {/* Left part: Route Name + Grade */}
            <Group
              wrap="nowrap"
              gap="xs"
              align="center"
              style={{ flexGrow: 1, minWidth: 0, marginRight: 'var(--mantine-spacing-xs)' }}
            >
              <Text
                size="sm"
                fw={500}
                lineClamp={1}
                title={getRouteSearchItemDisplayName(item)}
                style={{ minWidth: 0 }}
              >
                {getRouteSearchItemDisplayName(item)}
              </Text>
              {item.gradeYds && (
                <Badge
                  size="xs"
                  variant="outline"
                  style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  {item.gradeYds}
                </Badge>
              )}
            </Group>

            {/* Right part: Sector + Crag (only if they exist) */}
            {(item.sectorName || item.cragName) && (
              <Group
                wrap="nowrap"
                gap="xs"
                style={{ flexShrink: 0 }}
                align="center"
              >
                {item.sectorName && <Text size="xs" opacity={0.7}>{item.sectorName}</Text>}
                {item.cragName && <Text size="xs" opacity={0.7}>{item.cragName}</Text>}
              </Group>
            )}
          </Group>
        </Box>
      </RouteSearchOptionWrapper>
    );
  }

  if (item.type === 'sector') {
    return (
      <RouteSearchOptionWrapper type={item.type}>
        <Text size="sm" fw={500} lineClamp={1} title={getRouteSearchItemDisplayName(item)} style={{ flexGrow: 1, minWidth: 0 }}>
          {getRouteSearchItemDisplayName(item)}
        </Text>
        {item.cragName && (
          <Text size="xs" opacity={0.7} lineClamp={1} title={item.cragName} style={{ flexShrink: 0, marginLeft: 'var(--mantine-spacing-xs)' }}>
            {item.cragName}
          </Text>
        )}
      </RouteSearchOptionWrapper>
    );
  }

  if (item.type === 'crag') {
    return (
      <RouteSearchOptionWrapper type={item.type}>
        <Text size="sm" fw={500} lineClamp={1} title={getRouteSearchItemDisplayName(item)} style={{ flexGrow: 1, minWidth: 0 }}>
          {getRouteSearchItemDisplayName(item)}
        </Text>
      </RouteSearchOptionWrapper>
    );
  }

  return (
    <RouteSearchOptionWrapper type={item.type}>
      <Text size="sm">{getRouteSearchItemDisplayName(item)}</Text>
    </RouteSearchOptionWrapper>
  );
};

const RouteSearchBox = forwardRef<SearchBoxRef, RouteSearchBoxProps>(({
  label,
  name,
  required = false,
  onChange = () => { },
  searchMode = 'global',
  value,
  selectedItem,
  pinnedItems = [],
  initialItems,
}, _ref) => {
  const fetcher = useFetcher<RouteSearchResults[]>();
  const [query, setQuery] = useState('');

  const items = useMemo(() => {
    const searchResults = Array.isArray(fetcher.data) ? fetcher.data : [];
    return mergeRouteSearchItems(
      selectedItem ? [selectedItem] : undefined,
      pinnedItems,
      initialItems,
      searchResults
    );
  }, [fetcher.data, initialItems, pinnedItems, selectedItem]);

  useImperativeHandle(_ref, () => ({
    reset() {
      setQuery('');
    },
  }));

  const renderSelectOption: SelectProps['renderOption'] = ({ option }) => {
    const item = items.find(item => getRouteSearchItemValue(item) === option.value);
    if (!item) return null;

    return <RouteSearchOption item={item} />;
  };

  useEffect(() => {
    const debounceTime = query.length < 2 ? 1000 : 300;
    const handler = setTimeout(() => {
      if (query.trim().length > 1) {
        fetcher.load(`/api/search?query=${encodeURIComponent(query)}&searchMode=${searchMode}`);
      }
    }, debounceTime);

    return () => {
      clearTimeout(handler);
    };
  }, [fetcher, query, searchMode]);

  // Check if we have a value but the corresponding item isn't in our items array
  useEffect(() => {
    // Only fetch if idle, to prevent re-triggering fetches on re-renders while a fetch is in-flight.
    if (value && fetcher.state === 'idle') {
      const itemExists = items.find(item => getRouteSearchItemValue(item) === value);
      if (!itemExists) {
        // Extract routeId from value format "route:routeId:cragPath"
        const parts = value.split(':');
        if (parts.length >= 2 && parts[0] === 'route') {
          const routeId = parts[1];
          // Use a form submission to fetch route data by ID
          const formData = new FormData();
          formData.append('routeId', routeId);
          fetcher.submit(formData, {
            method: 'post',
            action: '/api/route'
          });
        }
      }
    }
  }, [fetcher, items, value]);

  const handleSearchChange = (q: string) => {
    setQuery(q);
  };

  const handleChange = (value: string | null) => {
    if (!value) {
      onChange({ value: null, boltCount: null });
      return;
    }

    const item = items.find(item => getRouteSearchItemValue(item) === value);
    if (item) {
      const boltCount = item.type === 'route' ? Number(item.boltCount) : null;
      onChange({ value: getRouteSearchItemValue(item), boltCount });
    }
  };

  return (
    <Select
      label={label}
      name={name}
      data={items.map(item => ({ 
        value: getRouteSearchItemValue(item),
        label: getRouteSearchItemSelectedLabel(item)
      }))}
      searchable
      searchValue={query}
      onSearchChange={handleSearchChange}
      placeholder="Type to search..."
      nothingFoundMessage="No results found"
      clearable
      renderOption={renderSelectOption}
      required={required}
      onChange={handleChange}
      value={value}
      maxDropdownHeight={600}
      comboboxProps={{ width: 'auto' }}
      styles={(theme) => ({
        dropdown: {
          width: 'auto',
          // Mobile-first defaults
          maxWidth: '100%', 
          minWidth: '280px',
          
          // Styles for larger screens (sm breakpoint and up)
          [`@media (minWidth: ${theme.breakpoints.sm})`]: {
            minWidth: '600px',
            maxWidth: '800px',
          },
        },
        option: {
          padding: '12px 12px',
          '& + &': {
            borderTop: '1px solid var(--mantine-color-gray-3)',
          },
          '&:hover': {
            backgroundColor: 'var(--mantine-color-gray-0)',
          }
        }
      })}
    />
  )
});

RouteSearchBox.displayName = 'RouteSearchBox';

export default RouteSearchBox;