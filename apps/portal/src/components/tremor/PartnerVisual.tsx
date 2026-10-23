import { createContext, useContext, useEffect, type ReactNode } from 'react';
import './partner.css';

const PartnerVisual = createContext(false);
export const usePartnerVisual = () => useContext(PartnerVisual);

/** Visual scope only. Authentication, routes and tenant branding stay owned by Shell. */
export function PartnerVisualProvider({ active, children }: { active: boolean; children: ReactNode }) {
  useEffect(() => {
    if (active) document.documentElement.dataset.portalVisual = 'tremor-partner';
    return () => { if (active) delete document.documentElement.dataset.portalVisual; };
  }, [active]);
  return <PartnerVisual.Provider value={active}>{children}</PartnerVisual.Provider>;
}
