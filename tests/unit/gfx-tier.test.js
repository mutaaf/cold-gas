// The boot tier per device (src/gfx-tier.js, 0037) and the device class obs reports.
import { describe, it, expect } from 'vitest';
import { pickDeviceTier, pickAA, deviceKind, isIOS, isSoftwareRenderer } from '../../src/gfx-tier.js';
import { deviceClass } from '../../src/obs/index.js';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipadOld: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  ipados: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  pixel: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36',
  tab: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
};

describe('pickDeviceTier', () => {
  // 0097: a phone or tablet draws what a desktop draws. Touch devices boot 'high' (the same effects,
  // shadows, film look, reflection and mist); the resolution governor and the ledger keep the frame.
  it('boots an iPhone with 4 cores and no deviceMemory at high', () => {
    expect(pickDeviceTier({ coarse: true, ua: UA.iphone, maxTouchPoints: 5 }).tier).toBe('high');
  });
  it('boots an iPad (old UA and the iPadOS desktop UA) at high', () => {
    expect(pickDeviceTier({ coarse: true, ua: UA.ipadOld, maxTouchPoints: 5 }).tier).toBe('high');
    expect(pickDeviceTier({ coarse: true, ua: UA.ipados, maxTouchPoints: 5 }).tier).toBe('high');
    // An iPad with a trackpad attached reports a fine primary pointer: still a touch device, still high.
    expect(pickDeviceTier({ coarse: false, ua: UA.ipados, maxTouchPoints: 5 }).tier).toBe('high');
  });
  it('boots an Android phone or tablet with 3 GB or more (or no reading) at high', () => {
    for (const deviceMemory of [3, 4, 8, undefined]) {
      expect(pickDeviceTier({ coarse: true, ua: UA.pixel, maxTouchPoints: 5, deviceMemory }).tier).toBe('high');
      expect(pickDeviceTier({ coarse: true, ua: UA.tab, maxTouchPoints: 5, deviceMemory }).tier).toBe('high');
    }
  });
  it('starts a phone reporting 2 GB or less at low (the floor)', () => {
    expect(pickDeviceTier({ coarse: true, ua: UA.pixel, maxTouchPoints: 5, deviceMemory: 2 })).toMatchObject({ tier: 'low' });
    expect(pickDeviceTier({ coarse: true, ua: UA.pixel, maxTouchPoints: 5, deviceMemory: 1 })).toMatchObject({ tier: 'low' });
  });
  it('boots a fine pointer at high', () => {
    expect(pickDeviceTier({ coarse: false, ua: UA.mac, maxTouchPoints: 0, deviceMemory: 8 }).tier).toBe('high');
    expect(pickDeviceTier({}).tier).toBe('high');
  });
  it('always gives a reason', () => {
    for (const d of [{}, { coarse: true }, { coarse: true, deviceMemory: 1 }, { ua: UA.iphone, coarse: true }]) expect(pickDeviceTier(d).reason).toBeTruthy();
  });
});

describe('pickAA', () => {
  // 0097: the edge filter is the one thing besides pixels a touch device may draw differently, chosen by the
  // flicker probe: SMAA on the high look raised phone flicker, FXAA lowered it.
  it('desktop high draws SMAA, touch high FXAA, mid FXAA', () => {
    expect(pickAA({ tier: 'high', touch: false })).toBe('smaa');
    expect(pickAA({ tier: 'high', touch: true })).toBe('fxaa');
    expect(pickAA({ tier: 'mid', touch: false })).toBe('fxaa');
    expect(pickAA({ tier: 'mid', touch: true })).toBe('fxaa');
  });
});

describe('deviceKind', () => {
  it('tells phones, tablets and desktops apart', () => {
    expect(deviceKind({ ua: UA.iphone, coarse: true, maxTouchPoints: 5 })).toBe('phone');
    expect(deviceKind({ ua: UA.ipadOld, coarse: true, maxTouchPoints: 5 })).toBe('tablet');
    expect(deviceKind({ ua: UA.ipados, coarse: true, maxTouchPoints: 5 })).toBe('tablet');
    expect(deviceKind({ ua: UA.pixel, coarse: true })).toBe('phone');
    expect(deviceKind({ ua: UA.tab, coarse: true })).toBe('tablet');
    expect(deviceKind({ ua: UA.mac, coarse: false })).toBe('desktop');
    expect(deviceKind({ ua: 'x', coarse: true, screenW: 820, screenH: 1180 })).toBe('tablet');
    expect(deviceKind({ ua: 'x', coarse: true, screenW: 390, screenH: 844 })).toBe('phone');
  });
  it('knows iOS from iPadOS touch points', () => {
    expect(isIOS({ ua: UA.ipados, maxTouchPoints: 5 })).toBe(true);
    expect(isIOS({ ua: UA.mac, maxTouchPoints: 0 })).toBe(false);
  });
});

describe('deviceClass', () => {
  it('labels tablets as tablet', () => {
    expect(deviceClass({ hardwareConcurrency: 4 }, true, 'tablet')).toBe('tablet-lo');
    expect(deviceClass({ hardwareConcurrency: 8, deviceMemory: 8 }, true)).toBe('phone-hi');
    expect(deviceClass({ hardwareConcurrency: 8, deviceMemory: 8 }, false)).toBe('desktop-hi');
  });
});

describe('software rasterizers skip canvas MSAA', () => {
  it('names the CPU renderers and only those', () => {
    for (const r of ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', 'llvmpipe (LLVM 15.0.7, 256 bits)', 'Microsoft Basic Render Driver', 'Google SwiftShader']) expect(isSoftwareRenderer(r)).toBe(true);
    for (const r of ['Apple GPU', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', 'Adreno (TM) 740', 'Mali-G710', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', '']) expect(isSoftwareRenderer(r)).toBe(false);
  });
});
