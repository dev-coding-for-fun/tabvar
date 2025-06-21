import { useFetcher } from "@remix-run/react";
import { SelectProps, Group, Select, Text, Badge, Stack, Box } from "@mantine/core";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { RouteSearchResults } from "~/lib/models";

interface RouteSearchBoxProps {
    label: string;
    name: string;
    required?: boolean;
    onChange?: (selected: { value: string | null; boltCount: number | null }) => void;
    value: string | null;
    searchMode?: 'allObjects' | 'routesOnly' | 'global' | undefined;
}

export type SearchBoxRef = { 
  reset: () => void;
};

const RouteSearchBox = forwardRef<SearchBoxRef, RouteSearchBoxProps>(({
  label,
  name,
  required = false,
  onChange = () => { },
  searchMode = 'global',
  value,
}, _ref) => {
  const fetcher = useFetcher<RouteSearchResults[]>();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<RouteSearchResults[]>([]);

  useImperativeHandle(_ref, () => ({
    reset() {
      setQuery('');
    },
  }));

  const getItemDisplayName = (item: RouteSearchResults) => {
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

  const getItemValue = (item: RouteSearchResults) => {
    if (item.type === 'route') { 
      return `${item.type}:${item.routeId}:${item.cragId}`; 
    }
    else if (item.type === 'sector') { 
      return `${item.type}:${item.sectorId}:${item.cragId}`; 
    }
    else if (item.type === 'crag') { 
      return `${item.type}:${item.cragId}:${item.cragId}`; 
    }
    else throw new Error(`Unknown item type: ${item.type}`);
  };

  const renderSelectOption: SelectProps['renderOption'] = ({ option }) => {
    const item = items.find(item => getItemValue(item) === option.value);
    if (!item) return null;

    const getTypeBadge = (type: string) => {
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

    // Common wrapper for all item types
    const ItemWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
      <Group gap="xs" wrap="nowrap" align="flex-start" style={{ width: '100%' }}>
        {getTypeBadge(item.type)}
        {children}
      </Group>
    );
    
    if (item.type === 'route') {
      return (
        <ItemWrapper>
          <Box style={{ flexGrow: 1, minWidth: 0 }}>
            {/* Mobile Layout for Route */}
            <Stack
              gap="xs"
              hiddenFrom="sm"
            >
              <Group wrap="wrap" gap="xs" align="flex-start">
                <Text size="sm" fw={500} lineClamp={1} title={getItemDisplayName(item)} style={{ flexGrow: 1, minWidth: '50px' /* Allow some space before wrapping grade */ }}>
                  {getItemDisplayName(item)}
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
                  title={getItemDisplayName(item)} 
                  style={{ minWidth: 0 }}
                >
                  {getItemDisplayName(item)}
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
        </ItemWrapper>
      );
    }

    if (item.type === 'sector') {
      return (
        <ItemWrapper>
          <Text size="sm" fw={500} lineClamp={1} title={getItemDisplayName(item)} style={{ flexGrow: 1, minWidth: 0 }}>
            {getItemDisplayName(item)}
          </Text>
          {item.cragName && (
            <Text size="xs" opacity={0.7} lineClamp={1} title={item.cragName} style={{ flexShrink: 0, marginLeft: 'var(--mantine-spacing-xs)' }}>
              {item.cragName}
            </Text>
          )}
        </ItemWrapper>
      );
    }

    if (item.type === 'crag') {
      return (
        <ItemWrapper>
          <Text size="sm" fw={500} lineClamp={1} title={getItemDisplayName(item)} style={{ flexGrow: 1, minWidth: 0 }}>
            {getItemDisplayName(item)}
          </Text>
        </ItemWrapper>
      );
    }

    // Fallback for unknown type (should not happen with current data structure)
    return (
      <ItemWrapper>
        <Text size="sm">{getItemDisplayName(item)}</Text>
      </ItemWrapper>
    );
  };

  useEffect(() => {
    console.log('Search useEffect triggered with query:', query);
    const debounceTime = query.length < 2 ? 1000 : 300;
    const handler = setTimeout(() => {
      if (query.trim().length > 1) {
        console.log('Making API call for query:', query);
        fetcher.load(`/api/search?query=${encodeURIComponent(query)}&searchMode=${searchMode}`);
      }
    }, debounceTime);

    return () => {
      clearTimeout(handler);
    };
  }, [query, searchMode]);

  useEffect(() => {
    if (fetcher.data) {
      console.log('Fetcher data updated:', fetcher.data);
      setItems(fetcher.data as RouteSearchResults[]);
    }
  }, [fetcher.data]);

  useEffect(() => {
    console.log('Items state updated:', items);
  }, [items]);

  const handleSearchChange = (q: string) => {
    console.log('handleSearchChange called with:', q);
    setQuery(q);
  };

  const handleChange = (value: string | null) => {
    console.log('handleChange called with:', value);
    if (!value) {
      console.log('handleChange: clearing selection');
      onChange({ value: null, boltCount: null });
      return;
    }

    const item = items.find(item => getItemValue(item) === value);
    console.log('handleChange: found item:', item);
    if (item) {
      const boltCount = item.type === 'route' ? Number(item.boltCount) : null;
      console.log('handleChange: calling onChange with:', { value: getItemValue(item), boltCount });
      onChange({ value: getItemValue(item), boltCount });
    } else {
      console.log('handleChange: item not found in items array');
    }
  };

  return (
    <Select
      label={label}
      name={name}
      data={items.map(item => ({ 
        value: getItemValue(item),
        label: getItemDisplayName(item)
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