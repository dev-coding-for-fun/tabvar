import React, { createContext, useContext, useEffect, useState } from 'react';
import { Button, Checkbox, Space, Text } from '@mantine/core';
import { useUser } from '~/lib/hooks/useUser';

const GUEST_DISCLAIMER_ACK_KEY = 'tabvar.disclaimerAcknowledgedAt';

export const DISCLAIMER_TITLE = 'Important Safety Notice';
export const DISCLAIMER_MESSAGE = "Rock climbing is a potentially dangerous sport, and anyone who does not fully recognize this fact should not use any of the information provided herein. The information only provides the location and approximate path followed by the various climbs and offers no advice, expressed or implied, as to how they may be safely ascended or descended. The contents of the information provided are subject to errors and omissions and to changes that may take place over time. Anyone in doubt of their ability to safely climb and descend from any of these routes is strongly advised to not go on the route or to use the services of a registered mountain guide.";
export const DISCLAIMER_ACKNOWLEDGEMENT_LABEL = 'I have read and understand this safety notice.';

interface DisclaimerAcknowledgementContextValue {
  isAcknowledged: boolean;
  isReady: boolean;
  isAcknowledging: boolean;
  error: string | null;
  acknowledge: () => Promise<boolean>;
}

const DisclaimerAcknowledgementContext = createContext<DisclaimerAcknowledgementContextValue | null>(null);

function hasGuestDisclaimerAcknowledgement() {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return !!window.localStorage.getItem(GUEST_DISCLAIMER_ACK_KEY);
  } catch {
    return false;
  }
}

function storeGuestDisclaimerAcknowledgement() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(GUEST_DISCLAIMER_ACK_KEY, new Date().toISOString());
  } catch {
    // Keep the acknowledgement for the current render session when storage is unavailable.
  }
}

export function DisclaimerAcknowledgementProvider({ children }: React.PropsWithChildren) {
  const user = useUser();
  const [isAcknowledged, setIsAcknowledged] = useState(() => !!user?.disclaimerAckDate);
  const [isReady, setIsReady] = useState(!!user);
  const [isAcknowledging, setIsAcknowledging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setIsAcknowledged(!!user.disclaimerAckDate);
      setIsReady(true);
      return;
    }

    setIsAcknowledged(hasGuestDisclaimerAcknowledgement());
    setIsReady(true);
  }, [user]);

  const acknowledge = async () => {
    if (isAcknowledged) {
      return true;
    }

    setError(null);

    if (!user) {
      storeGuestDisclaimerAcknowledgement();
      setIsAcknowledged(true);
      return true;
    }

    setIsAcknowledging(true);
    try {
      const response = await fetch('/action/acknowledge-disclaimer', {
        method: 'POST',
        credentials: 'same-origin',
      });

      if (!response.ok) {
        throw new Error('Failed to update disclaimer acknowledgement.');
      }

      setIsAcknowledged(true);
      return true;
    } catch (error) {
      console.error('Failed to acknowledge disclaimer:', error);
      setError('Failed to update disclaimer acknowledgement.');
      return false;
    } finally {
      setIsAcknowledging(false);
    }
  };

  return (
    <DisclaimerAcknowledgementContext.Provider
      value={{
        isAcknowledged,
        isReady,
        isAcknowledging,
        error,
        acknowledge,
      }}
    >
      {children}
    </DisclaimerAcknowledgementContext.Provider>
  );
}

export function useDisclaimerAcknowledgement() {
  const context = useContext(DisclaimerAcknowledgementContext);

  if (!context) {
    throw new Error('useDisclaimerAcknowledgement must be used within a DisclaimerAcknowledgementProvider');
  }

  return context;
}

interface DisclaimerAcknowledgementFormProps {
  buttonLabel?: string;
  onAcknowledged?: () => void;
}

export function DisclaimerMessage() {
  return <Text>{DISCLAIMER_MESSAGE}</Text>;
}

export function DisclaimerAcknowledgementForm({
  buttonLabel = 'Acknowledge & Hide',
  onAcknowledged,
}: DisclaimerAcknowledgementFormProps) {
  const { acknowledge, error, isAcknowledging } = useDisclaimerAcknowledgement();
  const [hasReadDisclaimer, setHasReadDisclaimer] = useState(false);

  const handleAcknowledge = async () => {
    if (!hasReadDisclaimer) {
      return;
    }

    const didAcknowledge = await acknowledge();
    if (didAcknowledge) {
      onAcknowledged?.();
    }
  };

  return (
    <>
      <Space h="md" />
      <Checkbox
        checked={hasReadDisclaimer}
        onChange={(event) => setHasReadDisclaimer(event.currentTarget.checked)}
        label={DISCLAIMER_ACKNOWLEDGEMENT_LABEL}
      />
      <Space h="sm" />
      <Button
        onClick={handleAcknowledge}
        variant="outline"
        color="red"
        size="xs"
        disabled={!hasReadDisclaimer}
        loading={isAcknowledging}
      >
        {buttonLabel}
      </Button>
      {error && (
        <Text c="red" size="sm" mt="xs">Error: {error}</Text>
      )}
    </>
  );
}
