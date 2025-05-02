import React, { createContext, useContext, ReactNode } from 'react';

interface MapboxContextType {
  mapboxAccessToken: string | undefined;
  mapboxStyleUrl: string | undefined;
}

const MapboxContext = createContext<MapboxContextType | undefined>(undefined);

interface MapboxProviderProps {
  children: ReactNode;
  accessToken: string | undefined;
  styleUrl: string | undefined;
}

export const MapboxProvider: React.FC<MapboxProviderProps> = ({ children, accessToken, styleUrl }) => {
  return (
    <MapboxContext.Provider value={{ mapboxAccessToken: accessToken, mapboxStyleUrl: styleUrl }}>
      {children}
    </MapboxContext.Provider>
  );
};

export const useMapboxContext = (): MapboxContextType => {
  const context = useContext(MapboxContext);
  if (context === undefined) {
    throw new Error('useMapboxContext must be used within a MapboxProvider');
  }
  return context;
}; 