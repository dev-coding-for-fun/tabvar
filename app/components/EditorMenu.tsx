import { ActionIcon, Group, Stack, Tooltip } from "@mantine/core";
import { IconFileUpload, IconDatabase, IconUsers, IconDownload } from "@tabler/icons-react";
import { Link } from "@remix-run/react";
import { useUser } from "~/lib/hooks/useUser";

export function EditorMenu() {
  const user = useUser();
  
  // Only show for admin or member users
  if (!user || (user.role !== 'admin' && user.role !== 'member')) {
    return null;
  }

  return (
    <Stack 
      gap="xs" 
      pos="fixed" 
      left={0} 
      top="50%"
      p="xs"
      bg="white"
      style={{
        transform: 'translateY(-50%)',
        borderTopRightRadius: '8px',
        borderBottomRightRadius: '8px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}
    >
      <Tooltip label="Upload Topos" position="right">
        <ActionIcon
          component={Link}
          to="/topos/attach"
          variant="light"
          color="blue"
          size="lg"
        >
          <IconFileUpload size={20} />
        </ActionIcon>
      </Tooltip>

      {user.role === 'admin' && (
        <>
          <Tooltip label="User Management" position="right">
            <ActionIcon
              component={Link}
              to="/users"
              variant="light"
              color="violet"
              size="lg"
            >
              <IconUsers size={20} />
            </ActionIcon>
          </Tooltip>

          <Tooltip label="SQL Query Tool" position="right">
            <ActionIcon
              component={Link}
              to="/admin/query"
              variant="light"
              color="red"
              size="lg"
            >
              <IconDatabase size={20} />
            </ActionIcon>
          </Tooltip>
        </>
      )}
    </Stack>
  );
}
