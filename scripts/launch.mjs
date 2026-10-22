// Chromium launch options for the audit scripts: the GPU flags on a Mac (ANGLE on Metal), plain
// headless elsewhere (the Metal flag hangs the page on Linux), and CG_CHROMIUM to point at a
// browser Playwright didn't install (cloud sandboxes: /opt/pw-browsers/chromium-1194/chrome-linux/chrome).
export const launchOpts = () => ({
  args: process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--enable-gpu', '--ignore-gpu-blocklist'],
  ...(process.env.CG_CHROMIUM ? { executablePath: process.env.CG_CHROMIUM } : {}),
});
