/* About bento — Cleopatra Closet.
   No libraries. No scroll listeners. No resize listeners.
   Everything is queried inside the section it belongs to, so two
   instances on one page never share nodes, observers or loops. */
(() => {
  'use strict';
  const RM = matchMedia('(prefers-reduced-motion: reduce)');
  /* With CSS scroll-driven animations the parallax runs off the main
     thread from the stylesheet and none of the code below is used. */
  const VIEW = !!window.CSS?.supports?.('animation-timeline', 'view()');
  const live = [];
  const px = (el, p) => parseFloat(getComputedStyle(el).getPropertyValue(p)) || 0;
  const settle = t => { t.style.willChange = 'auto'; t.classList.add('ab-done'); };

  function countUp(inst, tile) {
    const items = [];
    for (const el of tile.querySelectorAll('[data-ab-metric]')) {
      const m = (el.dataset.abValue || '').match(/^(\D*)(.*\d)(\D*)$/);
      /* no digits at all: the merchant's text is printed exactly as typed */
      if (m) items.push({
        el, pre: m[1], post: m[3], to: +m[2].replace(/\D/g, ''),
        /* The grouping character is taken from what the merchant typed rather
           than from toLocaleString: that keeps "2,400" a comma on an Arabic
           or German storefront, and avoids the ~10ms one-off ICU warm-up on
           the first counting frame. "2400" never gains a separator. */
        sep: (m[2].match(/\D/) || [''])[0]
      });
    }
    if (!items.length) return;
    /* The markup already holds the final value, so its rendered width can be
       measured once, here, and pinned. That stops the suffix sliding while
       the digits grow. One batched read pass, then one write pass — never
       interleaved, and never inside the animation loop. */
    const widths = items.map(it => it.el.offsetWidth);
    items.forEach((it, i) => { it.el.style.minWidth = widths[i] + 'px'; });
    let t0 = 0;
    const step = now => {
      t0 ||= now;
      const p = Math.min((now - t0) / 1200, 1), e = 1 - (1 - p) ** 3;
      for (const it of items) {
        const n = String(Math.round(it.to * e));
        it.el.textContent = it.pre + (it.sep ? n.replace(/\B(?=(\d{3})+(?!\d))/g, it.sep) : n) + it.post;
      }
      inst.cRaf = p < 1 ? requestAnimationFrame(step) : 0;
    };
    inst.cRaf = requestAnimationFrame(step);
  }

  function reveal(inst, tile) {
    if (tile.classList.contains('is-in')) return;
    tile.classList.add('is-in');
    tile.addEventListener('transitionend', () => settle(tile), { once: true });
    if (inst.count && tile.querySelector('[data-ab-metric]')) countUp(inst, tile);
  }

  /* One loop for the whole section. Rects are read from the static
     wrapper, never from the element being transformed, so the offset
     can never feed back into its own measurement. */
  function frame(inst) {
    const l = inst.par, r = inst.rects, n = l.length;
    for (let i = 0; i < n; i++) r[i] = l[i].read.getBoundingClientRect();
    for (let i = 0; i < n; i++) {
      const p = Math.min(Math.max((inst.vh - r[i].top) / (inst.vh + r[i].height), 0), 1);
      const o = Math.round((p - 0.5) * 2 * l[i].s * 10) / 10;
      if (o !== l[i].v) l[i].write.style.transform = `translate3d(0,${l[i].v = o}px,0)`;
    }
    inst.pRaf = requestAnimationFrame(() => frame(inst));
  }

  function pump(inst) {
    if (!inst.par) return;
    const run = inst.act > 0 && document.visibilityState !== 'hidden';
    if (run && !inst.pRaf) frame(inst);
    else if (!run && inst.pRaf) { cancelAnimationFrame(inst.pRaf); inst.pRaf = 0; }
  }

  function initPar(inst) {
    if (VIEW) return;
    const l = [];
    for (const el of inst.root.querySelectorAll('[data-ab-par]')) {
      const s = px(el, '--ab-par');
      /* strength 0 at this breakpoint: no observer and no loop is created */
      if (s > 0) l.push(el._ab = { write: el, read: el.parentNode, s, v: null, vis: false });
    }
    if (!l.length) return;
    inst.par = l;
    inst.rects = new Array(l.length);
    inst.pObs = new IntersectionObserver(es => {
      for (const e of es) {
        const it = e.target._ab;
        if (it && it.vis !== e.isIntersecting) inst.act += (it.vis = e.isIntersecting) ? 1 : -1;
      }
      pump(inst);
    });
    for (const p of l) inst.pObs.observe(p.write);
  }

  const tick = i => i.ticker &&
    i.ticker.classList.toggle('is-running', i.tv && document.visibilityState !== 'hidden');

  function init(root) {
    if (root._abInst) return;
    const inst = root._abInst = {
      root, obs: null, par: null, rects: null, pObs: null, pRaf: 0, cRaf: 0, act: 0,
      vh: innerHeight, ticker: null, tObs: null, tv: false,
      anim: root.dataset.abAnim === 'on' && !RM.matches,
      count: root.dataset.abCount === 'on' && !RM.matches
    };
    live.push(inst);
    const tiles = root.querySelectorAll('.ab-tile');
    if (!inst.anim) {
      for (const t of tiles) { t.classList.add('is-in'); settle(t); }
      return;
    }
    inst.obs = new IntersectionObserver(es => {
      for (const e of es) if (e.isIntersecting) {
        inst.obs.unobserve(e.target); /* reveals happen once, never on scroll back up */
        reveal(inst, e.target);
      }
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
    for (const t of tiles) inst.obs.observe(t);
    initPar(inst);
    const tk = root.classList.contains('ab--no-tick') ? null : root.querySelector('[data-ab-ticker]');
    if (!tk) return;
    inst.ticker = tk;
    inst.tObs = new IntersectionObserver(es => { inst.tv = es[es.length - 1].isIntersecting; tick(inst); });
    inst.tObs.observe(tk);
  }

  function destroy(root) {
    const i = root._abInst;
    if (!i) return;
    i.obs?.disconnect(); i.pObs?.disconnect(); i.tObs?.disconnect();
    cancelAnimationFrame(i.pRaf); cancelAnimationFrame(i.cRaf);
    live.splice(live.indexOf(i), 1);
    root._abInst = null;
  }

  const boot = scope => { for (const r of (scope || document).querySelectorAll('[data-ab-root]')) init(r); };

  /* Theme editor: show whatever is being edited in its finished state. */
  function revealAll(root) {
    const inst = root?._abInst;
    if (!inst) return;
    for (const t of root.querySelectorAll('.ab-tile')) { inst.obs?.unobserve(t); reveal(inst, t); }
  }

  boot();
  const d = document;
  d.addEventListener('shopify:section:load', e => boot(e.target));
  d.addEventListener('shopify:section:unload', e => {
    for (const r of e.target.querySelectorAll('[data-ab-root]')) destroy(r);
  });
  d.addEventListener('shopify:section:select', e => revealAll(e.target.querySelector('[data-ab-root]')));
  d.addEventListener('shopify:block:select', e => {
    const root = e.target.closest?.('[data-ab-root]');
    if (!root) return;
    revealAll(root);
    e.target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: RM.matches ? 'auto' : 'smooth' });
  });
  d.addEventListener('visibilitychange', () => live.forEach(i => { pump(i); tick(i); }));
  /* The only non-observer listener. Media queries cover every other size
     change; this just refreshes the cached viewport height. */
  addEventListener('orientationchange', () => live.forEach(i => {
    i.vh = innerHeight;
    if (i.par) for (const p of i.par) p.s = px(p.write, '--ab-par');
  }));
})();
