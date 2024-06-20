import { useEffect } from "react";
import { showNotification, hideNotification } from "@mantine/notifications";
import { IconX } from "@tabler/icons-react";

export function useErrorNotification(error?: string) {
  useEffect(() => {
    if (error) {
      showNotification({
        title: 'Error',
        id: 'errorNotice',
        message: error,
        color: 'red',
        icon: <IconX />,
      });
    }
    return () => {
      hideNotification('errorNotice');
    };
  }, [error]);
}