import base from './playwright.config.js';
export default { ...base, use: { ...base.use, launchOptions: { ...base.use.launchOptions, executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' } }, webServer: { ...base.webServer, reuseExistingServer: false } };
