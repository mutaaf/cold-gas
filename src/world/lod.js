// Level-of-detail decisions for the endless world (pure, 0052).

// The detailed spruces: a level-0 tile whose centre is within hiR + 64 m (half a tile) of the
// camera takes them, and gives them back only once it is HI_BAND further out. Without the band a
// camera resting on the ring's edge swapped a tile's trees between the pools on every plan.
export const HI_BAND = 32;
export const wantHi = (dist, hiR, was) => hiR > 0 && dist < hiR + 64 + (was ? HI_BAND : 0);
