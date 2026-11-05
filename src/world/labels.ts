import { createContext, type RefObject } from 'react';
export const LabelPortal = createContext<RefObject<HTMLDivElement> | undefined>(undefined);
