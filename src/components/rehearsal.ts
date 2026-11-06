import { createContext, useContext } from 'react';
/** True inside the pit rehearsal: actions that would leave the pit get a quick stand-in. */
export const RehearsalCtx = createContext(false);
export const useRehearsal = () => useContext(RehearsalCtx);
