// Automated end-to-end check, used by `npm run test:app` (scripts/smoke-test.mjs).
// Only runs when the app is started with --smoke=<dir>. It drives the real
// windows through their states, captures screenshots and writes report.json.

import { app, desktopCapturer, screen } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runSmokeTest({ outDir, prompter, scripts, settings, speech, panels, command, shortcutStatus }) {
  mkdirSync(outDir, { recursive: true });
  const report = { ok: true, steps: [], console: [], errors: [] };
  const win = prompter.win;
  const wc = win.webContents;
  const step = (name, data = {}) => { report.steps.push({ name, t: Date.now(), ...data }); console.log('[smoke]', name, JSON.stringify(data)); };
  const fail = (msg) => { report.ok = false; report.errors.push(msg); console.error('[smoke] FAIL', msg); };
  const js = (code) => wc.executeJavaScript(code, true);
  const shot = async (name, w = win) => {
    // capturePage waits for a new frame; nudge one and never wait forever.
    w.webContents.invalidate();
    const img = await Promise.race([w.webContents.capturePage(), sleep(4000).then(() => null)]);
    if (img) writeFileSync(join(outDir, `${name}.png`), img.toPNG());
    else report.console.push({ window: 'smoke', level: 'warning', message: `screenshot ${name} timed out` });
  };

  // What the user really sees: the composited desktop around the prompter.
  const desktopShot = async (name) => {
    const d = prompter.display();
    const sf = d.scaleFactor;
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(d.size.width * sf), height: Math.round(d.size.height * sf) } });
    const src = sources.find((x) => x.display_id === String(d.id)) || sources[0];
    if (!src) return;
    const b = win.getBounds();
    const crop = { x: Math.round((b.x - d.bounds.x) * sf), y: 0, width: Math.round(b.width * sf), height: Math.round(b.height * sf) };
    writeFileSync(join(outDir, `${name}.png`), src.thumbnail.crop(crop).toPNG());
  };

  const watchConsole = (contents, label) => {
    contents.on('console-message', (e) => {
      const level = e.level ?? 'info';
      const entry = { window: label, level, message: e.message, source: `${e.sourceId || ''}:${e.lineNumber || ''}` };
      report.console.push(entry);
      if (level === 'error' || level === 3) report.errors.push(`${label}: ${e.message}`);
    });
  };
  watchConsole(wc, 'prompter');
  wc.on('preload-error', (_e, p, err) => fail(`preload error ${p}: ${err}`));

  try {
    if (wc.isLoading()) await new Promise((r) => wc.once('did-finish-load', r));
    while (!prompter.readyAt) await sleep(50);
    const processStart = Date.now() - process.uptime() * 1000;
    report.startupMs = Math.round(prompter.readyAt - processStart);
    step('startup', { msToFirstPaint: report.startupMs });
    await sleep(2200);
    const state0 = await js('({ vis: __yalti.app.visibility, words: __yalti.view.wordCount, lines: __yalti.view.lines.length, title: __yalti.app.script && __yalti.app.script.title, visible: true })');
    step('loaded', state0);
    if (!state0.words) fail('welcome script has no words');
    if (state0.vis !== 'expanded') fail(`expected expanded, got ${state0.vis}`);
    await shot('01-expanded');
    if (process.env.YALTI_SMOKE_PAUSE_MS) {
      // Lets external tools (e.g. a click-through probe) inspect the live window.
      writeFileSync(join(outDir, 'window.json'), JSON.stringify(win.getBounds()));
      await sleep(Number(process.env.YALTI_SMOKE_PAUSE_MS));
    }
    await desktopShot('01-desktop-expanded');

    await js("document.body.classList.add('controls-visible')");
    await sleep(500);
    await shot('02-controls');
    await js("document.body.classList.remove('controls-visible')");

    await js("__yalti.command('collapse')");
    await sleep(1200);
    await shot('03-compact');
    await desktopShot('03-desktop-compact');
    const compact = await js('({ vis: __yalti.app.visibility, w: __yalti.island.w.value, h: __yalti.island.h.value })');
    step('compact', compact);
    if (compact.vis !== 'compact' || compact.h > 60) fail('collapse did not produce a compact island');

    await js("__yalti.island.showToast('Loaded “Rebuilding Onboarding”')");
    await sleep(700);
    await shot('04-toast');
    await sleep(2600);

    // Open the test fixture and expand.
    const fixture = join(process.env.YALTI_SMOKE_ROOT || process.cwd(), 'test', 'fixtures', 'keynote.md');
    scripts.openFile(fixture);
    await sleep(400);
    await js("__yalti.command('expand')");
    await sleep(1300);
    const loaded = await js('({ title: __yalti.app.script.title, words: __yalti.view.wordCount, tokens: __yalti.app.model.tokens.length })');
    step('fixture', loaded);
    if (loaded.title !== 'Rebuilding Onboarding') fail(`wrong title ${loaded.title}`);
    await shot('05-script');

    // Simulated recognizer output drives the tracker and the view.
    await js(`(() => {
      const y = __yalti;
      y.tracker.setPosition(-1);
      y.app.settings.highlightSpoken = true;
      const words = 'good morning everyone and thank you for joining us today over the next few minutes i want to walk you through how our team rebuilt the onboarding'.split(' ');
      let seg = [];
      for (const w of words) { seg.push(w); y.voice.active = true; y.onSpeechResult('partial', seg.join(' ')); }
      y.voice.active = false;
      return true;
    })()`);
    await sleep(900);
    const tracked = await js('({ pos: __yalti.tracker.position, word: __yalti.app.model.tokens[__yalti.tracker.position].word, text: __yalti.app.model.words[__yalti.app.model.tokens[__yalti.tracker.position].word].text, anchor: __yalti.view.anchorWord })');
    step('simulated-voice', tracked);
    if (!/onboarding/i.test(tracked.text)) fail(`tracking ended on "${tracked.text}"`);
    await shot('06-tracking');

    // Real speech: Chromium's fake microphone plays a WAV file into the app.
    if (process.env.YALTI_FAKE_MIC) {
      await js('__yalti.view.jumpToWord(0, { instant: true }); __yalti.tracker.setPosition(-1); true');
      await js("__yalti.command('toggleVoice')");
      const t0 = Date.now();
      let last = null;
      while (Date.now() - t0 < 25000) {
        await sleep(1000);
        last = await js('({ voice: __yalti.app.voiceState, track: __yalti.app.trackState, pos: __yalti.tracker.position, speech: __yalti.app.speechStatus.state, stats: __yalti.voice.stats })');
        if (last.pos >= 40) break;
      }
      step('fake-mic', last);
      if (!last || last.pos < 20) fail(`real speech did not advance the prompter (${JSON.stringify(last)})`);
      await shot('07-voice');
      await js("__yalti.command('toggleVoice')");
      await sleep(500);
    }

    // Auto-scroll moves the text.
    settings.update({ scrollMode: 'auto', countdown: 0 });
    await sleep(300);
    await js("__yalti.view.jumpToWord(0, { instant: true }); true");
    const before = await js('__yalti.view.offset.value');
    await js("__yalti.command('playPause')");
    await sleep(1500);
    const after = await js('__yalti.view.offset.value');
    await js("__yalti.command('playPause')");
    step('auto-scroll', { before, after, mode: settings.get().scrollMode });
    if (!(after > before)) fail('auto-scroll did not move');

    // Keyboard and mouse input reach the prompter.
    settings.update({ scrollMode: 'voice' });
    await js("__yalti.view.jumpToWord(0, { instant: true }); true");
    win.focus();
    wc.focus();
    await sleep(200);
    const a0 = await js('__yalti.view.anchorWord');
    for (const keyCode of ['Down', 'Down', 'Down']) {
      wc.sendInputEvent({ type: 'keyDown', keyCode });
      wc.sendInputEvent({ type: 'keyUp', keyCode });
      await sleep(80);
    }
    await sleep(500);
    const a1 = await js('__yalti.view.anchorWord');
    step('keyboard', { before: a0, after: a1 });
    if (!(a1 > a0)) fail('arrow keys did not scroll');
    const b = win.getBounds();
    wc.sendInputEvent({ type: 'mouseMove', x: Math.round(b.width / 2), y: 120 });
    wc.sendInputEvent({ type: 'mouseWheel', x: Math.round(b.width / 2), y: 120, deltaX: 0, deltaY: -360 });
    await sleep(700);
    const a2 = await js('__yalti.view.anchorWord');
    step('wheel', { before: a1, after: a2 });
    if (!(a2 > a1)) fail('mouse wheel did not scroll');
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'F1' });
    await sleep(300);
    const help = await js("!document.getElementById('help').hidden");
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await sleep(300);
    const helpClosed = await js("document.getElementById('help').hidden");
    const stillExpanded = await js("__yalti.app.visibility === 'expanded'");
    if (!stillExpanded) fail('closing help with Escape also collapsed the island');
    step('help', { opened: help, closed: helpClosed });
    if (!help || !helpClosed) fail('help overlay did not open and close');

    // Hide, then show again while the island is still retracting.
    await js("__yalti.command('expand')");
    await sleep(900);
    command('toggleVisible');
    await sleep(120);
    command('toggleVisible');
    await sleep(1500);
    const race = await js('({ vis: __yalti.app.visibility, h: __yalti.island.h.value })');
    step('hide-show-race', { ...race, windowVisible: win.isVisible() });
    if (!win.isVisible() || race.vis !== 'expanded') fail('prompter did not come back after a quick hide/show');

    // Size changes from settings resize the window and the island.
    const w0 = win.getBounds().width;
    settings.update({ width: 640 });
    await sleep(900);
    const w1 = win.getBounds().width;
    const iw = await js('__yalti.island.w.value');
    step('resize', { before: w0, after: w1, island: Math.round(iw) });
    if (!(w1 < w0) || Math.abs(iw - 640) > 2) fail('width change did not apply');
    settings.update({ width: 780 });
    await sleep(600);

    step('shortcuts', shortcutStatus());
    if (Object.values(shortcutStatus()).some((v) => v !== 'ok')) report.console.push({ window: 'smoke', level: 'warning', message: 'some global shortcuts could not be registered: ' + JSON.stringify(shortcutStatus()) });

    // A long script (about 20 000 words) loads and lays out quickly.
    const para = readFileSync(join(process.env.YALTI_SMOKE_ROOT || process.cwd(), 'test', 'fixtures', 'keynote.md'), 'utf8').replace(/^#.*$/gm, '');
    const long = Array.from({ length: 52 }, (_, i) => `## Part ${i + 1}\n\n${para}`).join('\n\n');
    const tLong = Date.now();
    scripts.openText(long, { title: 'Long script' });
    let longWords = 0;
    while (Date.now() - tLong < 20000) {
      longWords = await js('__yalti.view.wordCount');
      if (longWords > 15000) break;
      await sleep(50);
    }
    const longMs = Date.now() - tLong;
    await js("__yalti.view.jumpToWord(__yalti.view.wordCount - 50); true");
    await sleep(600);
    await shot('10-long-script-end');
    step('long-script', { words: longWords, msToLoadAndLayout: longMs });
    if (longWords < 15000 || longMs > 5000) fail(`long script too slow or incomplete (${longWords} words in ${longMs} ms)`);
    const t2 = Date.now();
    await js(`(() => { const y = __yalti; y.tracker.setPosition(y.app.model.tokens.length - 400); const t = performance.now();
      let seg = []; for (const w of 'six months later the median time to first invoice dropped from nineteen days to under two hours'.split(' ')) { seg.push(w); y.tracker.pushResult(seg.join(' '), false); }
      return performance.now() - t; })()`).then((ms) => step('long-script-tracking', { msFor16Updates: Math.round(ms), perUpdate: Math.round(ms / 16 * 10) / 10 }));
    scripts.openFile(fixture);
    await sleep(500);

    // Idle cost: nothing should be running while the prompter just sits there.
    await sleep(2500);
    app.getAppMetrics();
    await sleep(4000);
    const idle = app.getAppMetrics().map((m) => ({ type: m.type, name: m.name || '', cpu: Math.round(m.cpu.percentCPUUsage * 10) / 10, memMB: Math.round(m.memory.workingSetSize / 1024) }));
    const idleCpu = idle.reduce((sum, m) => sum + m.cpu, 0);
    step('idle', { totalCpuPercent: Math.round(idleCpu * 10) / 10, totalMemMB: idle.reduce((sum, m) => sum + m.memMB, 0), processes: idle });
    if (idleCpu > 3) fail(`idle CPU too high: ${idleCpu}%`);

    // Appearance settings apply live.
    settings.update({ bezelStyle: 'floating', highlightColor: '#5ee2a0', fontId: 'literata', fontSize: 30 });
    await sleep(900);
    await shot('08-floating-literata');
    await desktopShot('08-desktop-floating-literata');
    settings.update({ bezelStyle: 'liquid', highlightColor: '#ffd166', fontId: 'inter', fontSize: 34 });
    await sleep(900);
    await desktopShot('08b-desktop-restored');

    // Settings and editor windows.
    for (const name of ['settings', 'editor']) {
      const w = panels.open(name);
      watchConsole(w.webContents, name);
      await new Promise((r) => (w.webContents.isLoading() ? w.webContents.once('did-finish-load', r) : r()));
      await sleep(1200);
      if (name === 'editor') {
        // Screenshots end up in the public docs: never show local folder or user names.
        const neutral = JSON.stringify('Documents\\Talks\\keynote.md');
        await w.webContents.executeJavaScript(`document.getElementById('doc-state').textContent = ${neutral}; true`);
        await sleep(400);
      }
      await shot(`09-${name}`, w);
      if (name === 'settings') {
        for (const section of ['script', 'colors', 'display', 'reading', 'voice', 'shortcuts', 'general', 'about']) {
          await w.webContents.executeJavaScript(`document.querySelector('#nav [data-id="${section}"]').click(); true`);
          await sleep(500);
          const ok = await w.webContents.executeJavaScript("document.querySelector('#content h1, #content .about-head') !== null");
          if (!ok) fail(`settings section ${section} did not render`);
          await shot(`09-settings-${section}`, w);
        }
      }
      w.close();
    }

    // Closing the prompter window (Alt+F4) only hides it; the app keeps running.
    await js("__yalti.command('expand')");
    await sleep(800);
    win.close();
    await sleep(1500);
    step('alt-f4', { destroyed: win.isDestroyed(), visible: !win.isDestroyed() && win.isVisible() });
    if (win.isDestroyed()) { fail('closing the prompter destroyed it'); throw new Error('prompter destroyed'); }
    if (win.isVisible()) fail('closing the prompter did not hide it');
    command('toggleVisible');
    await sleep(1500);
    if (!win.isVisible()) fail('prompter did not come back after being closed');

    // Hide retracts into the edge and hides the window.
    await js("__yalti.command('hide')");
    await sleep(1500);
    step('hidden', { visible: win.isVisible() });
    if (win.isVisible()) fail('window still visible after hide');

    const mem = await app.getAppMetrics();
    report.metrics = mem.map((m) => ({ type: m.type, name: m.name, memMB: Math.round((m.memory?.workingSetSize || 0) / 1024), cpu: m.cpu?.percentCPUUsage }));
    report.speech = speech.status;
  } catch (err) {
    fail(`exception: ${err.stack || err}`);
  }

  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`[smoke] ${report.ok ? 'PASS' : 'FAIL'} — ${report.errors.length} errors`);
  setTimeout(() => app.exit(report.ok ? 0 : 1), 300);
}
