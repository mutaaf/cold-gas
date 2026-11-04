# wide 1.7.1, patched for the native app (0150)

The unmodified crate from crates.io, with every `target_feature="neon"` branch renamed to a feature no target has
(`neon_off_for_wasm_parity`), so on arm64 `wide` takes the same scalar fallback the web's WASM build takes (wasm32
without simd128). The NEON paths aren't the same arithmetic: `f32x4::mul_add` is a fused `vfmaq_f32` there and
`(a * b) + c` in the fallback, which moved the engine's contact solve by a few ulps (docs/NATIVE.md §3). Licence as
upstream (Zlib OR Apache-2.0 OR MIT). Re-apply on a `wide` bump: copy the new version and run the same sed.
