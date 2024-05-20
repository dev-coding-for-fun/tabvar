import { Form, useFetcher } from "@remix-run/react";
import { SelectProps, Container, Group, Select, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import { RouteSearchResults } from "~/routes/api.search";


interface RouteSearchBoxProps {
    label: string;
    name: string;
    required?: boolean;
    onChange?: (value: string | null) => void;
}

const RouteSearchBox: React.FC<RouteSearchBoxProps> = ({
  label,
  name,
  required = false,
  onChange,
}) => {
    const fetcher = useFetcher<RouteSearchResults[]>();
    const [query, setQuery] = useState('');
    const [value, setValue] = useState<string | null>(null);
    const [items, setItems] = useState<RouteSearchResults[]>([]);
  
    const renderSelectOption: SelectProps['renderOption'] = ({ option }) => {
        const route = items.find(item => item.id.toString() === option.value);  // Find the route by id
        return (
            <Group flex="1" gap="lg">
                <Text size="sm">{route ? route.name : 'Unknown Route'}</Text>
                <Text size="xs" opacity={0.7}>{route ? route.sector_name : ''}</Text>
                <Text size="xs" opacity={0.7}>{route ? route.crag_name : ''}</Text>
            </Group>
        );
    };

    useEffect(() => {
      const debounceTime = query.length < 2 ? 1000 : 300;
      const handler = setTimeout(() => {
        if (query.trim().length > 1) {
          fetcher.load(`/api/search?query=${encodeURIComponent(query)}`);
        }
      }, debounceTime);
  
      return () => {
        clearTimeout(handler);
      };
    }, [query, fetcher]);
  
    useEffect(() => {
      if (fetcher.data) {
        setItems(fetcher.data as RouteSearchResults[]);
      }
    }, [fetcher.data]);
  
    const handleSearchChange = (q: string) => {
      setQuery(q);
      if (!q) setValue(null);
    };

    const handleChange = (value: string | null) => {
      setValue(value);
      if (onChange) {
        onChange(value);
      }
    };
  
    return (
      <Container size="md" p="md">
        <Form id="issue-create-form" method="post">
          <Select
            label={label}
            name={name}
            data={items.map(item => ({ value: item.id.toString(), label: item.name ?? '' }))}
            searchable
            onSearchChange={handleSearchChange}
            placeholder="Type to search..."
            nothingFoundMessage="No routes found"
            clearable
            renderOption={renderSelectOption}
            required={required}
            onChange={handleChange}
          />
        </Form>
      </Container>
    )
  };

  export default RouteSearchBox;