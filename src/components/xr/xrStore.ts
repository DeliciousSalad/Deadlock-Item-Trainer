import { createXRStore } from '@react-three/xr';

// Single shared XR store, created in its own module so that
// XRButton can import it without pulling in the entire Three.js /
// R3F / drei dependency chain that XRScene uses.
export const xrStore = createXRStore();
