/* chart.js · canvas charts, devicePixelRatio aware. LineChart: balance + marks that never overlap. Candles: 1-minute. */
(function () {
  const C = { green: "#00d35a", red: "#ff453a", blue: "#0a84ff", orange: "#ff9f0a", ter: "rgba(235,235,245,0.3)",
              sec: "rgba(235,235,245,0.6)" };
  const MARK = { blue: C.blue, green: C.green, red: C.red };
  const reduced = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function setup(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  class LineChart {
    constructor(canvas) { this.c = canvas; this.data = null; this.anim = null; this.key = null;
      window.addEventListener("resize", () => this.draw(1)); }
    set(data, key) {
      const prev = this.data;
      this.data = data;
      const grew = prev && key === this.key && data.points.length > 0 && prev.points.length > 0 &&
        data.points[data.points.length - 1].t > prev.points[prev.points.length - 1].t;
      this.key = key;
      if (grew && !reduced()) {           // a new point slides in, 250ms
        const t0 = performance.now(); cancelAnimationFrame(this.anim);
        const step = (now) => { const p = Math.min(1, (now - t0) / 250); this.draw(1 - Math.pow(1 - p, 3));
          if (p < 1) this.anim = requestAnimationFrame(step); };
        this.anim = requestAnimationFrame(step);
      } else this.draw(1);
    }
    draw(progress) {
      if (!this.data) return;
      const { ctx, w, h } = setup(this.c);
      const pts = this.data.points.slice();
      const start = this.data.startBalance;
      if (!pts.length) return;
      if (pts.length === 1) pts.unshift({ t: pts[0].t - 60, v: pts[0].v });
      const padL = 16, padR = 16, top = 70, bottom = 12;   // room above the line for 2-3 rows of marks
      const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
      let lo = Math.min(...pts.map(p => p.v)), hi = Math.max(...pts.map(p => p.v));
      if (start != null) { lo = Math.min(lo, start); hi = Math.max(hi, start); }
      if (hi - lo < 1e-9) { hi += Math.max(1, hi * 0.01); lo -= Math.max(1, Math.abs(lo) * 0.01); }
      const X = t => padL + (w - padL - padR) * ((t - t0) / Math.max(1, t1 - t0));
      const Y = v => top + (h - top - bottom) * (1 - (v - lo) / (hi - lo));
      // the last segment slides in
      const xy = pts.map(p => [X(p.t), Y(p.v)]);
      if (progress < 1 && xy.length > 1) {
        const a = xy[xy.length - 2], b = xy[xy.length - 1];
        xy[xy.length - 1] = [a[0] + (b[0] - a[0]) * progress, a[1] + (b[1] - a[1]) * progress];
      }
      // dashed start line
      if (start != null) {
        ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = C.ter; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, Y(start)); ctx.lineTo(w, Y(start)); ctx.stroke(); ctx.restore();
      }
      // gradient under the line
      const g = ctx.createLinearGradient(0, top, 0, h);
      g.addColorStop(0, "rgba(0,211,90,0.28)"); g.addColorStop(1, "rgba(0,211,90,0)");
      ctx.beginPath(); ctx.moveTo(xy[0][0], h);
      xy.forEach(p => ctx.lineTo(p[0], p[1])); ctx.lineTo(xy[xy.length - 1][0], h); ctx.closePath();
      ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); xy.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
      ctx.strokeStyle = C.green; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke();
      const e = xy[xy.length - 1];
      ctx.beginPath(); ctx.arc(e[0], e[1], 4, 0, Math.PI * 2); ctx.fillStyle = C.green; ctx.fill();
      // marks above the line: a later mark that would overlap moves up a row, never overlaps
      const lineY = (x) => { for (let i = 1; i < xy.length; i++) { if (xy[i][0] >= x) { const a = xy[i - 1], b = xy[i];
        const f = (x - a[0]) / Math.max(1e-6, b[0] - a[0]); return a[1] + (b[1] - a[1]) * f; } } return xy[xy.length - 1][1]; };
      ctx.font = "600 12px -apple-system, system-ui, sans-serif"; ctx.textBaseline = "middle";
      const placed = [];
      (this.data.marks || []).slice().sort((a, b) => a.t - b.t).forEach(m => {
        if (m.t < t0 || m.t > t1 + 1) return;
        const x = X(m.t), ly = lineY(x), tw = ctx.measureText(m.label).width + 14, bh = 20;
        let bx = Math.min(Math.max(2, x - tw / 2), w - tw - 2);
        let row = 0, rect;
        const overlaps = r => placed.some(p => r.x < p.x + p.w + 4 && r.x + r.w + 4 > p.x && r.y < p.y + p.h + 2 && r.y + r.h + 2 > p.y);
        do { rect = { x: bx, y: Math.max(2, ly - 12 - bh - row * (bh + 4)), w: tw, h: bh }; row++; }
        while (overlaps(rect) && row < 12);
        placed.push(rect);
        const col = MARK[m.color] || C.blue;
        ctx.strokeStyle = col; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, ly - 4); ctx.lineTo(x, rect.y + rect.h); ctx.stroke(); ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(x, ly, 3.5, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
        ctx.fillStyle = "#1c1c1e"; rr(ctx, rect.x, rect.y, rect.w, rect.h, 10); ctx.fill();
        ctx.fillStyle = col; ctx.fillText(m.label, rect.x + 7, rect.y + rect.h / 2 + 0.5);
      });
    }
  }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function candles(canvas, list, exitLine, exitLabel) {
    const { ctx, w, h } = setup(canvas);
    if (!list || !list.length) return;
    const pad = 10, top = 10, bottom = 14;
    let lo = Math.min(...list.map(c => c.l)), hi = Math.max(...list.map(c => c.h));
    if (exitLine != null) { lo = Math.min(lo, exitLine); hi = Math.max(hi, exitLine); }
    if (hi - lo < 1e-15) { hi *= 1.01; lo *= 0.99; }
    const Y = v => top + (h - top - bottom) * (1 - (v - lo) / (hi - lo));
    const n = Math.max(list.length, 30), cw = (w - pad * 2) / n, bw = Math.max(1.5, cw * 0.62);
    list.forEach((c, i) => {
      const x = pad + cw * (i + (n - list.length)) + cw / 2, up = c.c >= c.o, col = up ? C.green : C.red;
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, Y(c.h)); ctx.lineTo(x, Y(c.l)); ctx.stroke();
      const y1 = Y(Math.max(c.o, c.c)), y2 = Y(Math.min(c.o, c.c));
      ctx.fillStyle = col; ctx.fillRect(x - bw / 2, y1, bw, Math.max(1, y2 - y1));
    });
    if (exitLine != null) {
      const y = Y(exitLine);
      ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = C.orange; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); ctx.restore();
      if (exitLabel) { ctx.font = "600 12px -apple-system, system-ui, sans-serif"; ctx.fillStyle = C.orange;
        ctx.textBaseline = "bottom"; ctx.fillText(exitLabel, 4, y - 3); }
    }
  }

  function ring(score, size) {
    const s = size || 56, r = s / 2 - 4, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, score || 0));
    const col = v >= 70 ? C.green : C.red;
    return `<svg class="ring" viewBox="0 0 ${s} ${s}"><circle cx="${s/2}" cy="${s/2}" r="${r}" fill="none" stroke="#2c2c2e" stroke-width="5"/>` +
      `<circle cx="${s/2}" cy="${s/2}" r="${r}" fill="none" stroke="${col}" stroke-width="5" stroke-linecap="round" ` +
      `stroke-dasharray="${(c * v / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${s/2} ${s/2})"/>` +
      `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="17" font-weight="600" ` +
      `style="font-variant-numeric:tabular-nums">${Math.round(v)}</text></svg>`;
  }

  window.DeskCharts = { LineChart, candles, ring };
})();
