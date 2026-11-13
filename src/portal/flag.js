// Which build this is: 'none' (mutaafaziz.com, the default), 'crazygames' or 'gamedistribution' (npm run build:<portal>,
// vite.config.js sets VITE_CG_PORTAL). A constant: in the default build every `ON_PORTAL` branch is dead code.
// `?.`: Node (scripts/vectors-lib.mjs) imports modules that read it with no Vite env.
export const PORTAL = import.meta.env?.VITE_CG_PORTAL || 'none';
export const ON_PORTAL = PORTAL !== 'none';
/** The portal's own word on the device ('desktop' | 'tablet' | 'mobile'), set by src/portal/boot.js before the game
 *  loads; null off a portal or when its SDK didn't load. CrazyGames asks for this instead of touch detection. */
export const portalDevice = () => (ON_PORTAL ? globalThis.__cgPortalDevice || null : null);
