import { useFetcher } from "@remix-run/react";
import { SelectProps, Group, Select, Text, Badge, Stack } from "@mantine/core";
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
  const isSelectedRef = useRef(false);
  const selectedLabelRef = useRef('');

  useImperativeHandle(_ref, () => ({
    reset() {
      isSelectedRef.current = false;
      selectedLabelRef.current = '';
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
          return <Badge size="xs" variant="light" color="blue">Route</Badge>;
        case 'sector':
          return <Badge size="xs" variant="light" color="green">Sector</Badge>;
        case 'crag':
          return <Badge size="xs" variant="light" color="orange">Crag</Badge>;
        default:
          return null;
      }
    };

    return (
      <Group gap="xs" wrap="nowrap" align="flex-start">
        {getTypeBadge(item.type)}
        <Text size="sm" fw={500} style={{ flexShrink: 0 }}>{getItemDisplayName(item)}</Text>
        {item.type === 'route' && (
          <Group gap="xs" wrap="nowrap" style={{ flex: 1, justifyContent: 'flex-end' }}>
            {item.gradeYds && <Badge size="xs" variant="outline">{item.gradeYds}</Badge>}
            {item.sectorName && <Text size="xs" opacity={0.7}>{item.sectorName}</Text>}
            {item.cragName && <Text size="xs" opacity={0.7}>{item.cragName}</Text>}
          </Group>
        )}
        {item.type === 'sector' && item.cragName && (
          <Text size="xs" opacity={0.7} style={{ flex: 1, textAlign: 'right' }}>{item.cragName}</Text>
        )}
      </Group>
    );
  };

  useEffect(() => {
    if (selectedLabelRef.current) return;
    const debounceTime = query.length < 2 ? 1000 : 300;
    const handler = setTimeout(() => {
      if (query.trim().length > 1) {
        fetcher.load(`/api/search?query=${encodeURIComponent(query)}&searchMode=${searchMode}`);
      }
    }, debounceTime);

    return () => {
      clearTimeout(handler);
    };
  }, [query, fetcher, searchMode]);

  useEffect(() => {
    if (fetcher.data) {
      setItems(fetcher.data as RouteSearchResults[]);
    }
  }, [fetcher.data]);

  const handleSearchChange = (q: string) => {
    setQuery(q);
    if (isSelectedRef.current) {
      selectedLabelRef.current = q;
      isSelectedRef.current = false;
    }
    else if (q != selectedLabelRef.current) {
      isSelectedRef.current = false;
      selectedLabelRef.current = '';
    }
  };

  const handleChange = (value: string | null) => {
    if (!value) {
      onChange({ value: null, boltCount: null });
      return;
    }

    const item = items.find(item => getItemValue(item) === value);
    if (item) {
      const boltCount = item.type === 'route' ? Number(item.boltCount) : null;
      onChange({ value: getItemValue(item), boltCount });
      isSelectedRef.current = true;
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
      filter={({ options }) => options}
      placeholder="Type to search..."
      nothingFoundMessage="No results found"
      clearable
      renderOption={renderSelectOption}
      required={required}
      onChange={handleChange}
      value={value}
      maxDropdownHeight={400}
      styles={{
        dropdown: {
          maxWidth: '800px',
          width: '100%'
        },
        option: {
          padding: '8px 12px',
          '& + &': {
            borderTop: '1px solid var(--mantine-color-gray-3)',
          },
          '&:hover': {
            backgroundColor: 'var(--mantine-color-gray-0)',
          }
        }
      }}
    />
  )
});

RouteSearchBox.displayName = 'RouteSearchBox';

export default RouteSearchBox;