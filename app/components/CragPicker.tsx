import { Stack, Select, Button, Group } from "@mantine/core";
import { useFetcher } from "@remix-run/react";
import { useEffect, useState } from "react";
import type { Crag } from "~/lib/models";

interface CragPickerProps {
  currentCragId: number;
  onSelect: (cragId: string) => void;
  onCancel: () => void;
}

export function CragPicker({ currentCragId, onSelect, onCancel }: CragPickerProps) {
  const [availableCrags, setAvailableCrags] = useState<{ value: string; label: string; }[]>([]);
  const [selectedCragId, setSelectedCragId] = useState<string | null>(null);
  const cragsFetcher = useFetcher();

  useEffect(() => {
    cragsFetcher.load('/api/crags');
  }, []);

  useEffect(() => {
    if (cragsFetcher.data) {
      const crags = cragsFetcher.data as Pick<Crag, 'id' | 'name'>[];
      // Filter out the current crag
      const filteredCrags = crags.filter(
        (crag) => crag.id !== currentCragId
      );
      setAvailableCrags(
        filteredCrags.map((crag) => ({
          value: crag.id.toString(),
          label: crag.name
        }))
      );
    }
  }, [cragsFetcher.data, currentCragId]);

  const handleConfirm = () => {
    if (selectedCragId) {
      onSelect(selectedCragId);
    }
  };

  return (
    <Stack>
      <Select
        label="Select destination crag"
        placeholder="Choose a crag"
        data={availableCrags}
        value={selectedCragId}
        onChange={setSelectedCragId}
        searchable
      />
      <Group justify="flex-end" mt="md">
        <Button variant="subtle" onClick={onCancel}>
          Cancel
        </Button>
        <Button 
          color="blue" 
          onClick={handleConfirm}
          disabled={!selectedCragId}
        >
          Move
        </Button>
      </Group>
    </Stack>
  );
} 