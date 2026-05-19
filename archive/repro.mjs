import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'net';
import { writeFileSync } from 'fs';

function G() { return new Promise((ok,no) => { var s = createServer(); s.listen(0, ()=>{ ok(s.address().port); s.close(); }); s.on('error',no); }); }
function W(u) { return new Promise((ok,no) => { function c(){ fetch(u+'/api/status').then(r=>r.ok?ok():setTimeout(c,100)).catch(()=>setTimeout(c,100)); } c(); setTimeout(()=>no(new Error('t')),15000); }); }

async function M(pg) {
  return JSON.parse(await pg.evaluate(`(function(){
    var IDs = {app:'app',panes:'panes',tb:'toolbar',tp:'terminal-pane',pp:'preview-pane'};
    var QS = {x:'.xterm',vp:'.xterm-viewport',sc:'.xterm-screen',rw:'.xterm-rows'};
    var R = {};
    Object.keys(IDs).forEach(function(k){ var e=document.getElementById(IDs[k]); if(e){ var b=e.getBoundingClientRect(); R[k]={w:b.width,h:b.height,t:b.top,b:b.bottom}; }});
    Object.keys(QS).forEach(function(k){ var e=document.querySelector(QS[k]); if(e){ var b=e.getBoundingClientRect(); R[k]={w:b.width,h:b.height,t:b.top,b:b.bottom}; }});
    R.wh = window.innerHeight;
    return JSON.stringify(R);
  })()`));
}

async function main() {
  var f = '/tmp/pt.md';
  writeFileSync(f, '# T\n\nC.\n');
  var p = await G();
  var pr = spawn('npx', ['tsx', 'server/cli.ts', f, '--port', ''+p, '--no-open'], {cwd:'/home/dzack/gitclones/pandoc-preview', env:Object.assign({},process.env,{NO_OPEN:'1'}), stdio:'pipe'});
  await W('http://localhost:'+p);

  var br = await chromium.launch({ headless: true });

  var sizes = [
    { w:1280, h:600, l:'600' },
    { w:1280, h:800, l:'800' },
    { w:1280, h:1080, l:'1080' },
    { w:1920, h:1080, l:'1920x1080' },
  ];

  for (var i=0; i<sizes.length; i++) {
    var s = sizes[i];
    var pg = await br.newPage({ viewport: {width:s.w, height:s.h} });
    await pg.goto('http://localhost:'+p);
    await pg.waitForSelector('#terminal-pane', {timeout:10000});
    await pg.waitForSelector('.xterm', {timeout:5000});
    await pg.waitForTimeout(1500);

    var m = await M(pg);
    var fi = m.tp && m.x ? (m.x.h / m.tp.h * 100).toFixed(1) : '?';
    console.log(s.l+': tp='+m.tp.h+' x='+m.x.h+' sc='+m.sc.h+' fill='+fi+'% win='+m.wh);

    // Resize to next size
    var n = sizes[(i+1) % sizes.length];
    await pg.setViewportSize({width:n.w, height:n.h});
    await pg.waitForTimeout(800);
    var m2 = await M(pg);
    var fi2 = m2.tp && m2.x ? (m2.x.h / m2.tp.h * 100).toFixed(1) : '?';
    console.log('  -> '+n.l+': tp='+m2.tp.h+' x='+m2.x.h+' fill='+fi2+'%');

    await pg.close();
  }

  // Load small then expand
  console.log('\n--- load small -> expand large ---');
  var pg = await br.newPage({ viewport:{width:800,height:500} });
  await pg.goto('http://localhost:'+p);
  await pg.waitForSelector('#terminal-pane', {timeout:10000});
  await pg.waitForSelector('.xterm', {timeout:5000});
  await pg.waitForTimeout(1500);
  var m = await M(pg);
  console.log('800x500: tp='+m.tp.h+' x='+m.x.h+' fill='+(m.tp&&m.x?(m.x.h/m.tp.h*100).toFixed(1)+'%':'?'));

  await pg.setViewportSize({width:1920,height:1080});
  await pg.waitForTimeout(1500);
  var m2 = await M(pg);
  console.log('1920x1080: tp='+m2.tp.h+' x='+m2.x.h+' fill='+(m2.tp&&m2.x?(m2.x.h/m2.tp.h*100).toFixed(1)+'%':'?'));
  await pg.screenshot({path:'/tmp/pandoc-expand.png'});

  // Test: scroll into view
  await pg.evaluate('window.scrollTo(0,0)');
  await pg.waitForTimeout(300);
  var m3 = await M(pg);
  console.log('after scrollTo(0,0): fill='+(m3.tp&&m3.x?(m3.x.h/m3.tp.h*100).toFixed(1)+'%':'?'));

  // Test: trigger resize event manually
  await pg.evaluate('window.dispatchEvent(new Event("resize"))');
  await pg.waitForTimeout(500);
  var m4 = await M(pg);
  console.log('after dispatch resize: fill='+(m4.tp&&m4.x?(m4.x.h/m4.tp.h*100).toFixed(1)+'%':'?'));

  await pg.screenshot({path:'/tmp/pandoc-final.png'});

  await br.close();
  pr.kill('SIGTERM');
  console.log('\nScreenshots: /tmp/pandoc-expand.png, /tmp/pandoc-final.png');
}
main().catch(function(e) { console.error(e); process.exit(1); });
