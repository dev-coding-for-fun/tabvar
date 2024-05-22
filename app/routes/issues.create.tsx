import { Button, Container, FileInput, Group, MultiSelect, Radio, Stack, Text, Textarea, rem } from "@mantine/core";
import { ActionFunction, json } from "@remix-run/cloudflare";
import { Form } from "@remix-run/react";
import { IconPhotoUp } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import RouteSearchBox from "~/components/routeSearchBox";
import { issueTypes, subIssues, subIssuesByType } from "~/lib/constants";
import { getDB } from "~/lib/db";

type IssueType = keyof typeof subIssuesByType;

const validateRoute = (routeId: string) => {
  if (!routeId) {
    return "Route selection is required";
  }
  else if (Number(routeId) <= 0) {
    return "Invalid Route. Something went wrong";
  }
}

const validateIssueType = (issueType: string) => {
  if (!issueTypes.some(type => type.value === issueType)) {
    return "Issue type missing, please select one";
  }
}

export const action: ActionFunction = async ({ request, context }) => {
  const formData = await request.formData();
  const routeId = formData.get("route")?.toString() ?? '';
  const issueType = formData.get("issueType")?.toString() ?? '';
  const subIssueType = formData.get("subIssueType")?.toString() ?? '';
  const notes = formData.get("notes")?.toString() ?? '';
  //const files = formData.getAll("files")?.toString() ?? '';

  const errors = {
    routeId: validateRoute(routeId),
    issueType: validateIssueType(issueType),
  };
  if (Object.values(errors).some(Boolean)) {
    return json(errors, {status: 400});
  }

  const db = getDB(context);
  const result = await db
  .insertInto('issue')
  .values({
    route_id: Number(routeId),
    issue_type: issueType,
    sub_issue_type: subIssueType,
    description: notes,
    status: "submitted",
  })
  .executeTakeFirst();
  console.log(result.insertId);
  return 1;
}

export default function CreateIssue() {
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [selectedIssueType, setSelectedIssueType] = useState<IssueType | null>(null);
  const [selectedSubIssue, setSelectedSubIssue] = useState<string | null>(null);
  const [selectedBolts, setSelectedBolts] = useState<string[]>([]);
  const [notes, setNotes] = useState<string>('');
  const [files, setFiles] = useState<File[]>([]);

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
      <Form method="post" encType="multipart/form-data">
        <Text>Submit an issue</Text>
        <RouteSearchBox
          label="Route"
          name="route"
          required={true}
          onChange={setSelectedRoute}
          value={selectedRoute}
        />
        <Stack>
          <Radio.Group
            label="Select what is affected by the issue"
            name="issueType"
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
              name="boltNumbers"
              data={boltOptions}
              placeholder="Select bolt numbers"
              value={selectedBolts}
              onChange={setSelectedBolts}
            />
          )}
          <Radio.Group
            label="Select the nature or type of the issue"
            name="subIssueType"
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
            name="notes"
            placeholder="Add any additional notes"
            value={notes}
            onChange={(event) => setNotes(event.currentTarget.value)}
            autosize
            minRows={3}
          />
          <FileInput
            name="photos"
            placeholder="Upload photos"
            leftSection={icon}
            multiple
            value={files}
            onChange={setFiles}
            accept="image/png,image/jpeg,image/gif,image/webp,video/mpeg,video/mp4,video/x-mp4,video/webm,video/3gpp,video/3ggp2"
          />
          <Group p="md" mt="xl">
            <Button type="submit">Submit</Button>
          </Group>
        </Stack>
      </Form>
    </Container>
  )
}
