import { Button, Container, FileInput, Group, LoadingOverlay, MultiSelect, Radio, Stack, Text, Textarea, rem } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { showNotification } from "@mantine/notifications";
import { ActionFunction, json } from "@remix-run/cloudflare";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { IconCheck, IconPhotoUp, IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
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
  if (result.insertId) {
    return json({ success: true, message: 'Issue submitted successfully' });
  } else {
    return json({ success: false, message: 'Failed to submit issue' }, { status: 500 });
  }
}

export default function CreateIssue() {
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [selectedIssueType, setSelectedIssueType] = useState<IssueType | null>(null);
  const [selectedSubIssue, setSelectedSubIssue] = useState<string | null>(null);
  const [selectedBolts, setSelectedBolts] = useState<string[]>([]);
  const navigation = useNavigation();
  const [overlayVisible, { open, close }] = useDisclosure(false);
  const formRef = useRef<HTMLFormElement>(null);
  const actionData = useActionData<{ [key: string]: string }>();

  const isSubmitting = navigation.state === 'loading' || navigation.state === 'submitting';

  const isSubIssueDisabled = (subIssue: string) => {
    if (!selectedIssueType) return true;
    return !subIssuesByType[selectedIssueType].includes(subIssue);
  };

  const icon = <IconPhotoUp style={{ width: rem(18), height: rem(18) }} stroke={1.5} />;

  const boltOptions = Array.from({ length: 10 }, (_, i) => ({ value: `${i + 1}`, label: `Bolt ${i + 1}` }));
  boltOptions.push({ value: "Anchor", label: "Anchor" });

  useEffect(() => {
    if (isSubmitting) {
      open();
      formRef.current?.reset();
      setSelectedSubIssue(null);
      setSelectedIssueType(null);
      setSelectedRoute(null);

      if (formRef.current) console.log(formRef.current.enctype);
    }
    else {
      close();
    }
  }, [isSubmitting, open, close]);

  useEffect(() => {
    if (selectedIssueType && selectedSubIssue) {
      if (!subIssuesByType[selectedIssueType].includes(selectedSubIssue)) {
        setSelectedSubIssue(null);
      }
    }
  }, [selectedIssueType, selectedSubIssue]);

  useEffect(() => {
    if (actionData) {
      if (actionData.success) {
        showNotification({
          title: 'Success',
          message: actionData.message,
          color: 'green',
          icon: <IconCheck />,
          autoClose: 5000,
        });
      } else {
        showNotification({
          title: 'Error',
          message: actionData.message,
          color: 'red',
          icon: <IconX />,
          autoClose: 5000,
        });
      }
    }
  }, [actionData]);

  return (
    <Container size="md" p="md">
      <Form method="post" ref={formRef} encType="multipart/form-data">
        <LoadingOverlay visible={overlayVisible} zIndex={1000} overlayProps={{ radius: "sm", blur: 2}} /> 
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
          {selectedIssueType === 'Bolts' && (
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
            autosize
            minRows={3}
          />
          <FileInput
            name="photos"
            placeholder="Upload photos"
            leftSection={icon}
            multiple
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
