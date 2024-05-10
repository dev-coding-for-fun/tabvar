import { LoaderFunctionArgs, json } from "@remix-run/cloudflare";
import { Form, useFetcher, useLoaderData } from "@remix-run/react";
import { Container, Group, Select, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import { Route } from "~/lib/dbTypes";

// Loader to fetch initial data if needed, like user authentication status
export const loader = async ({ params, }: LoaderFunctionArgs) => {
  return json({});
};

function routeItem(props: { cragName: string, sectorName: string, routeName: string, elementRef: React.RefObject<HTMLDivElement> }) {
  const { cragName, sectorName, routeName, elementRef } = props;
  return (
    <div ref={elementRef}>
      <Group>
        <Text>{cragName}</Text>
        <Text>{sectorName}</Text>
        <Text>{routeName}</Text>
      </Group>
    </div>
  );
}

export interface SearchRoutesResponse {
  routes: Route[];
}

export default function CreateIssue() {
const fetcher = useFetcher<SearchRoutesResponse>();
const [query, setQuery] = useState('');
const [value, setValue] = useState<string | null>(null);
const [items, setItems] = useState<{ value: string; label: string; }[]>([]);

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
if (fetcher.data && fetcher.data.routes) {
setItems(fetcher.data.routes.map(route => ({
value: route.id.toString(),
label: route.name
})));
}
}, [fetcher.data]);

const handleSearchChange = (q: string) => {
setQuery(q);
if (!q) setValue(null);
};

return (
<Container size="md" p="md">
<Form id="issue-create-form" method="post">
<Select
label="Route"
name="route"
data={items}
searchable
onSearchChange={handleSearchChange}
placeholder="Type to search..."
nothingFoundMessage="No routes found"
clearable
/>
</Form>
</Container>
)
}

