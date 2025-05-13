import { Title, Paper, Stack, Center, Text, Image, Button, Container } from "@mantine/core";
import { Form, useSearchParams } from "@remix-run/react";

export default function Login() {
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo");

  return (
    <Container size={420} my={40}>
      <Title ta="center" fw={900}>
        TABVAR Login
      </Title>
      <Text c="dimmed" size="sm" ta="center" mt={5}>
        Sign in to access route and issue management
      </Text>

      <Paper withBorder shadow="md" p={30} mt={30} radius="md">
        <Form action="/auth/google" method="post">
          <Stack>
            {redirectTo && <input type="hidden" name="redirectTo" value={redirectTo} />}
            <Center>
            <Button
                leftSection={<Image src="/google.png" alt="Google logo" width={30} height={30} />}
                variant="default"
                color="gray"
                type="submit"
                fullWidth
                style={{ maxWidth: '240px' }}
              >
                Continue with Google
              </Button>
            </Center>
          </Stack>
        </Form>
      </Paper>
    </Container>
  );
}