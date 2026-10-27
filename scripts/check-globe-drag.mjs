// Globe input check: hover must not rotate, left-drag must, right-drag must not.
// Usage: BASE_URL=http://localhost:3000 node scripts/check-globe-drag.mjs
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1536, height: 864 }, reducedMotion: 'reduce' });
await p.goto((process.env.BASE_URL || 'http://localhost:3000') + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
const c = await p.$('.gwrap canvas'); const bb = await c.boundingBox();
const cx = bb.x + bb.width/2, cy = bb.y + bb.height/2;
const hash = () => p.evaluate(() => { const c=document.querySelector('.gwrap canvas'); return c.toDataURL().length + ':' + c.toDataURL().slice(-200); });
await p.mouse.move(cx-150, cy); const h0 = await hash();
for (let i=0;i<30;i++) await p.mouse.move(cx-150+i*10, cy+i*3);
await p.waitForTimeout(300); const h1 = await hash();
console.log('hover changed rotation:', h0!==h1);
await p.mouse.down(); for (let i=0;i<20;i++) await p.mouse.move(cx+150-i*10, cy); await p.mouse.up();
await p.waitForTimeout(1500); const h2 = await hash();
console.log('drag changed rotation:', h1!==h2);
// after release, hover again must not rotate
await p.waitForTimeout(3000); const h3 = await hash();
for (let i=0;i<30;i++) await p.mouse.move(cx-150+i*10, cy-i*3);
await p.waitForTimeout(300); const h4 = await hash();
console.log('hover after drag changed rotation:', h3!==h4);
// right-button drag must not rotate
await p.mouse.down({button:'right'}); for (let i=0;i<20;i++) await p.mouse.move(cx-100+i*10, cy); await p.mouse.up({button:'right'});
await p.waitForTimeout(300); const h5 = await hash();
console.log('right-drag changed rotation:', h4!==h5);
await p.mouse.move(cx, cy+200); await p.mouse.down(); for (let i=0;i<40;i++) await p.mouse.move(cx, cy+200-i*12); await p.mouse.up();
await p.mouse.move(cx, cy-200); await p.mouse.down(); for (let i=0;i<60;i++) await p.mouse.move(cx, cy-200+i*12); await p.mouse.up();
await b.close();
