// The entry of a portal build (scripts/portal-html.mjs swaps it into index.html for src/main.js): the portal first,
// then the game exactly as on the web.
//
// The game is a dynamic import on purpose. boot.js waits (top-level await) for the portal's SDK and reads the saves
// out of its data module; modules the game imports statically would otherwise be evaluated alongside it (the
// browser runs a module's other static dependencies while one of them awaits), and some read their saves as they
// load. The stylesheets the game's first screen needs are imported here, so they still land inlined in index.html
// and the title paints at once (vite.config.js inlineCss); tests/unit/portal.test.js keeps this list in step.
import '@fontsource/michroma/latin-400.css';
import '@fontsource-variable/geist/wght.css';
import '@fontsource/geist-mono/latin-400.css';
import '../styles.css';
import '../comeback.css';
import '../thumb-aim.css';
import '../medals.css';
import '../damage-view.css';
import './boot.js';

import('../main.js');
