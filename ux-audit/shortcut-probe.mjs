import { chromium } from '@playwright/test';
const BASE='http://127.0.0.1:4173/';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1440,height:900},permissions:['clipboard-read','clipboard-write']});
const page=await ctx.newPage();
await page.goto(BASE,{waitUntil:'networkidle'});await page.waitForTimeout(1500);
await page.locator('dialog[open] .dialog-head button').first().click();await page.waitForTimeout(400);
await page.locator('.editor-body').click();await page.keyboard.insertText('$q = "abc"\n');await page.waitForTimeout(2000);
console.log('focused element in editor:',await page.evaluate(()=>document.activeElement.tagName+'.'+String(document.activeElement.className).slice(0,30)));
const before=await page.evaluate(()=>document.querySelector('.editor-body').innerText);
// type a question mark inside the CODE editor
await page.keyboard.press('End');
await page.keyboard.type('?',{delay:30});
await page.waitForTimeout(600);
const dlg=await page.locator('dialog[open]').count();
const after=await page.evaluate(()=>document.querySelector('.editor-body').innerText);
console.log('after typing "?" in the code editor -> dialog[open] count =',dlg);
console.log('  dialog title:',dlg?await page.locator('dialog[open] h2').innerText():'-');
console.log('  did "?" reach the code?',after!==before, JSON.stringify(after.slice(-30)));
if(dlg){await page.keyboard.press('Escape');await page.waitForTimeout(400);}
// same in the plain textarea (narrow) - and in a normal input
await page.goto(BASE+'#/projects');await page.waitForTimeout(1000);
const search=page.locator('.search-wrap input').first();
if(await search.count()){await search.fill('');await search.type('?',{delay:30});await page.waitForTimeout(500);
 console.log('typing "?" in the project search input -> dialog count =',await page.locator('dialog[open]').count(),' value=',JSON.stringify(await search.inputValue()));}
// ctrl+s / ctrl+p passthrough check
await page.goto(BASE+'#/');await page.waitForTimeout(800);
await page.locator('.editor-body').click();
await page.keyboard.press('Control+p');await page.waitForTimeout(600);
console.log('Ctrl+P from editor -> dialog:',await page.locator('dialog[open]').count(), await page.locator('dialog[open] h2').innerText().catch(()=>'-'));
await b.close();
