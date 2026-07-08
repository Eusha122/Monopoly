// Visual check: drives the real UI in Edge, screenshots home, lobby, and the board mid-game.
import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = 'http://localhost:4000';
const shots = 'test/shots';
import { mkdirSync } from 'fs';
mkdirSync(shots, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  defaultViewport: { width: 1600, height: 900 },
  args: ['--no-first-run'],
});

const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('PAGE ERROR:', m.text()); });
page.on('pageerror', (e) => console.log('PAGE EXCEPTION:', e.message));

await page.goto(URL, { waitUntil: 'networkidle0' });
await page.screenshot({ path: `${shots}/1-home.png` });

// create room
await page.type('#home-name', 'Alice');
await page.click('#btn-create');
await page.waitForSelector('#screen-lobby.active', { timeout: 5000 });
await sleep(400);

// add a second local player via dialog override
page.on('dialog', async (d) => d.accept('Bob'));
await page.click('#btn-add-local');
await sleep(400);
await page.screenshot({ path: `${shots}/2-lobby.png` });

// start game
await page.click('#btn-start');
await page.waitForSelector('#screen-game.active', { timeout: 5000 });
await sleep(1000);
await page.screenshot({ path: `${shots}/3-board.png` });

// roll once to see dice + movement
const rolled = await page.evaluate(() => {
  const b = document.querySelector('[data-act="roll"]');
  if (b) { b.click(); return true; }
  return false;
});
await sleep(2600);
await page.screenshot({ path: `${shots}/4-after-roll.png` });
console.log('rolled:', rolled);

// open a deed
await page.evaluate(() => document.querySelector('[data-tile="39"]').click());
await sleep(400);
await page.screenshot({ path: `${shots}/5-deed.png` });

await browser.close();
console.log('screenshots written to', shots);
