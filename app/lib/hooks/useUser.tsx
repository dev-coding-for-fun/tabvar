import { createContext, useContext } from 'react';
import type { User } from '~/lib/models';

const UserContext = createContext<User | null>(null);

interface UserProviderProps {
  children: React.ReactNode;
  user: User | null;
}

export function UserProvider({ children, user }: UserProviderProps) {
  return (
    <UserContext.Provider value={user}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const user = useContext(UserContext);
  if (user === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return user;
}
