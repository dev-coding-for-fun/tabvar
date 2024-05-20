import { Button, Container, FileInput, Group, MultiSelect, Radio, Stack, Text, Textarea, rem } from "@mantine/core";
import { IconPhotoUp } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import RouteSearchBox from "~/components/routeSearchBox";


const issueTypes = [
  { value: 'bolts', label: 'Bolts (#)' },
  { value: 'allBolts', label: 'All Bolts' },
  { value: 'anchor', label: 'Anchor' },
  { value: 'rock', label: 'Rock' },
];

const subIssues = [
  { value: 'Loose nut', label: 'Loose nut' },
  { value: 'Loose bolt', label: 'Loose bolt' },
  { value: 'Loose Glue-in', label: 'Loose Glue-in' },
  { value: 'Rusted', label: 'Rusted' },
  { value: 'Outdated', label: 'Outdated' },
  { value: 'Worn', label: 'Worn' },
  { value: 'Missing (bolt and hanger)', label: 'Missing (bolt and hanger)' },
  { value: 'Missing (hanger)', label: 'Missing (hanger)' },
  { value: 'Loose block', label: 'Loose block' },
  { value: 'Loose flake', label: 'Loose flake' },
  { value: 'Other', label: 'Other' },
];

const subIssuesByType = {
  bolts: ['Loose nut', 'Loose bolt', 'Loose Glue-in', 'Rusted', 'Outdated', 'Worn', 'Missing (bolt and hanger)', 'Missing (hanger)', 'Other'],
  allBolts: ['Loose nut', 'Loose bolt', 'Loose Glue-in', 'Rusted', 'Outdated', 'Worn', 'Missing (bolt and hanger)', 'Missing (hanger)', 'Other'],
  anchor: ['Loose nut', 'Loose bolt', 'Loose Glue-in', 'Rusted', 'Outdated', 'Worn', 'Missing (bolt and hanger)', 'Missing (hanger)', 'Other'],
  rock: ['Loose block', 'Loose flake', 'Other'],
};

type IssueType = keyof typeof subIssuesByType;

export default function CreateIssue() {
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIssueType, setSelectedIssueType] = useState<IssueType | null>(null);
  const [selectedSubIssue, setSelectedSubIssue] = useState<string | null>(null);
  const [selectedBolts, setSelectedBolts] = useState<string[]>([]);
  const [notes, setNotes] = useState<string>('');
  const [files, setFiles] = useState<File[]>([]);

  const handleSubmit = () => {
    if (!selectedRoute) {
      setError('Please select a route.');
      return;
    }

    // Add form submission logic here

    setError(null); // Clear error if validation passes
    console.log('Form submitted', { selectedRoute, selectedIssueType, selectedSubIssue, selectedBolts, notes, files });
  };

  const isSubIssueDisabled = (subIssue: string) => {
    if (!selectedIssueType) return true;
    return !subIssuesByType[selectedIssueType].includes(subIssue);
  };

  const icon = <IconPhotoUp style={{ width: rem(18), height: rem(18) }} stroke={1.5} />;

  const boltOptions = Array.from({ length: 10 }, (_, i) => ({ value: `${i + 1}`, label: `Bolt ${i + 1}` }));
  boltOptions.push({ value: "Anchor", label: "Anchor" });

  useEffect(() => {
    if (selectedIssueType && selectedSubIssue) {
      if (!subIssuesByType[selectedIssueType].includes(selectedSubIssue)) {
        setSelectedSubIssue(null);
      }
    }
  }, [selectedIssueType, selectedSubIssue]);

  return (
    <Container size="md" p="md">
      <Text>Submit an issue</Text>
      <RouteSearchBox
        label="Route"
        name="route"
        required={true}
        onChange={setSelectedRoute}
      />
      <Stack>
        <Radio.Group
          label="Select what is affected by the issue"
          description="for multi-pitch routes, detail affected pitch(es) in the notes"
          value={selectedIssueType ?? ''}
          onChange={(value: string) => setSelectedIssueType(value as IssueType)}
        ><Group mt="xs">
            {issueTypes.map((issue) => (
              <Radio key={issue.value} value={issue.value} label={issue.label} />
            ))}
          </Group></Radio.Group>
        {selectedIssueType === 'bolts' && (
          <MultiSelect
            data={boltOptions}
            placeholder="Select bolt numbers"
            value={selectedBolts}
            onChange={setSelectedBolts}
          />
        )}
        <Radio.Group
          label="Select the nature or type of the issue"
          value={selectedSubIssue}
          onChange={setSelectedSubIssue}
        ><Stack>
            {subIssues.map((subIssue) => (

              <Radio
                key={subIssue.value}
                value={subIssue.value}
                label={subIssue.label}
                disabled={isSubIssueDisabled(subIssue.value)}
              />
            ))}
          </Stack>
        </Radio.Group>
        <Textarea
          placeholder="Add any additional notes"
          value={notes}
          onChange={(event) => setNotes(event.currentTarget.value)}
          autosize
          minRows={3}
        />
        <FileInput
          placeholder="Upload photos"
          leftSection={icon}
          multiple
          value={files}
          onChange={setFiles}
          accept="image/png,image/jpeg,image/gif,image/webp,video/mpeg,video/mp4,video/x-mp4,video/webm,video/3gpp,video/3ggp2"
        />
        <Group p="md" mt="xl">
          <Button onClick={handleSubmit}>Submit</Button>
        </Group>
      </Stack>
    </Container>
  )
}
