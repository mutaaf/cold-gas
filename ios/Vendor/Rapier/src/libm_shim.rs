//! The engine's transcendental calls, computed the way the WASM build computes them.
//!
//! `enhanced-determinism` routes simba's and glam's math through the `libm` crate, but parry and rapier also call
//! `f32::acos`, `.sin()`, `.powf()`… directly. On wasm32 Rust's std implements those with the same pure-Rust `libm`
//! (a musl port); on macOS and iOS they call Apple's libm, which can differ by an ulp. A convex hull touching the floor
//! took that path and the native engine's answer drifted from the browser's by a few ulps (0150, docs/NATIVE.md §3).
//! Defining the symbols here, in the same static library, makes the linker resolve the engine's calls to `libm`
//! instead of the system's: the native engine computes what the WASM engine computes.
//! The list is what `nm -u` shows the engine importing; ios/scripts/rapier.sh checks no other libm call appears.

#[no_mangle] pub extern "C" fn sinf(x: f32) -> f32 { libm::sinf(x) }
#[no_mangle] pub extern "C" fn cosf(x: f32) -> f32 { libm::cosf(x) }
#[no_mangle] pub extern "C" fn asinf(x: f32) -> f32 { libm::asinf(x) }
#[no_mangle] pub extern "C" fn acosf(x: f32) -> f32 { libm::acosf(x) }
#[no_mangle] pub extern "C" fn expf(x: f32) -> f32 { libm::expf(x) }
#[no_mangle] pub extern "C" fn powf(x: f32, y: f32) -> f32 { libm::powf(x, y) }
#[no_mangle] pub extern "C" fn log2f(x: f32) -> f32 { libm::log2f(x) }
#[no_mangle] pub extern "C" fn cbrt(x: f64) -> f64 { libm::cbrt(x) }
#[no_mangle] pub extern "C" fn exp(x: f64) -> f64 { libm::exp(x) }
#[no_mangle] pub extern "C" fn log(x: f64) -> f64 { libm::log(x) }
/// Apple's struct-return sincos, which LLVM forms from a sinf and a cosf of the same argument. The WASM computes the two
/// separately, so this does too.
#[repr(C)] pub struct SinCosF { pub sin: f32, pub cos: f32 }
#[no_mangle] pub extern "C" fn __sincosf_stret(x: f32) -> SinCosF { SinCosF { sin: libm::sinf(x), cos: libm::cosf(x) } }
