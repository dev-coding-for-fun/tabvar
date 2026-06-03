import React, { createContext, useContext, useEffect, useState } from 'react';
import { Button, Checkbox, Space, Text } from '@mantine/core';
import { useUser } from '~/lib/hooks/useUser';

const GUEST_DISCLAIMER_ACK_KEY = 'tabvar.disclaimerAcknowledgedAt';

export const DISCLAIMER_TITLE = 'Important Safety Notice';
export const DISCLAIMER_MESSAGE = "WARNING: CLIMBING IS INHERENTLY DANGEROUS. TABVAR and its volunteers work hard to fund and maintain fixed hardware in the Bow Valley, but due to the scale of the area and limited resources, we cannot guarantee the safety of any route. Fixed hardware degrades, rock is dynamic, and bolts can fail without warning. Route descriptions are user-submitted and not vetted. Your safety is entirely your own responsibility. By using this guide, you assume all risks of injury or death and explicitly release the author, TABVAR, and its volunteers from all liability, INCLUDING LIABILITY ARISING FROM THEIR NEGLIGENCE.";
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
