// Every unit test runs after the physics engine's WASM is up (src/sim/engine.js).
import { initPhysics } from '../../src/sim/engine.js';

await initPhysics();
