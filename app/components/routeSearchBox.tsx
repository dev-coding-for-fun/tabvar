import { useFetcher } from "@remix-run/react";
import { SelectProps, Container, Group, Select, Text } from "@mantine/core";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { RouteSearchResults } from "~/routes/api.search";


interface RouteSearchBoxProps {
    label: string;
    name: string;
    required?: boolean;
    onChange?: (selected: { value: string | null; boltCount: number | null }) => void;
    value: string | null;
}

export type SearchBoxRef = { 
  reset: () => void;
};

const RouteSearchBox = forwardRef<SearchBoxRef, RouteSearchBoxProps>(({
  label,
  name,
  required = false,
  onChange = () => { },
}, _ref) => {
  const { load, ...fetcher } = useFetcher<RouteSearchResults[]>();
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

  const renderSelectOption: SelectProps['renderOption'] = ({ option }) => {
    const route = items.find(item => item.id.toString() === option.value);  // Find the route by id
    return (
      <Group flex="1" gap="lg">
        <Text size="sm">{route ? route.name : 'Unknown Route'}</Text>
        <Text size="xs" opacity={0.7}>{route ? route.sector_name : ''}</Text>
        <Text size="xs" opacity={0.7}>{route ? route.crag_name : ''}</Text>
        <Text size="xs" opacity={0.7}>{route ? route.grade_yds : ''}</Text>
      </Group>
    );
  };

  useEffect(() => {
    if (selectedLabelRef.current) return;
    const debounceTime = query.length < 2 ? 1000 : 300;
    const handler = setTimeout(() => {
      if (query.trim().length > 1) {
        load(`/api/search?query=${encodeURIComponent(query)}`);
      }
    }, debounceTime);

    return () => {
      clearTimeout(handler);
    };
  }, [query, load]);

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
    const boltCount: number = +(items.find(item => item.id.toString() === value)?.bolt_count ?? '');
    onChange({ value, boltCount });
    isSelectedRef.current = true;
  };

  return (
    <Container size="md" p="md">
      <Select
        label={label}
        name={name}
        data={items.map(item => ({ value: item.id.toString(), label: item.name ?? '' }))}
        searchable
        searchValue={query}
        onSearchChange={handleSearchChange}
        filter={({ options }) => { return options }}
        placeholder="Type to search..."
        nothingFoundMessage="No routes found"
        clearable
        renderOption={renderSelectOption}
        required={required}
        onChange={handleChange}
      />
    </Container>
  )
});

RouteSearchBox.displayName = 'RouteSearchBox';

  export default RouteSearchBox;