// Shared yarn-thread renderer for Wefty Run and Wefty Climb.
// Exposes window.WeftyThread = { PALETTES, GUIDE_PALETTE, loadYarnPattern,
// drawThread, strokePath } so both mini-games can draw the same look
// without copy-paste drift.
(function (global) {
    const PALETTES = [
        { main: '#EC4899', light: '#F9A8D4', dark: '#9D174D' },
        { main: '#10B981', light: '#6EE7B7', dark: '#065F46' },
        { main: '#F59E0B', light: '#FCD34D', dark: '#92400E' },
        { main: '#6366F1', light: '#A5B4FC', dark: '#3730A3' },
        { main: '#06B6D4', light: '#67E8F9', dark: '#155E75' },
    ];
    const GUIDE_PALETTE = {
        main: 'rgba(255,255,255,0.10)',
        light: 'rgba(255,255,255,0.18)',
        dark: 'rgba(255,255,255,0.05)',
    };

    function strokePath(ctx, pts) {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke();
    }

    // Loads /yarn_texture.png and invokes onReady(pattern). Callers keep
    // the returned pattern around and pass it to drawThread on each draw.
    function loadYarnPattern(ctx, src, onReady) {
        const img = new Image();
        img.onload = () => onReady(ctx.createPattern(img, 'repeat'));
        img.onerror = () => onReady(null);
        img.src = src || 'yarn_texture.png';
    }

    // Multi-pass braided-yarn stroke. `yarnPattern` is optional — pass
    // null/undefined to skip the texture overlay.
    function drawThread(ctx, pts, palette, baseWidth, yarnPattern) {
        if (!pts || pts.length < 2) return;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // 1. Soft halo
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = baseWidth * 0.5;
        ctx.strokeStyle = palette.dark;
        ctx.lineWidth = baseWidth * 1.15;
        strokePath(ctx, pts);
        ctx.restore();

        // 2. Dark outline
        ctx.strokeStyle = palette.dark;
        ctx.lineWidth = baseWidth * 1.08;
        strokePath(ctx, pts);

        // 3. Main fill
        ctx.strokeStyle = palette.main;
        ctx.lineWidth = baseWidth * 0.9;
        strokePath(ctx, pts);

        // 4. Yarn texture (optional) — multiplied + screen pass
        if (yarnPattern) {
            ctx.save();
            ctx.globalCompositeOperation = 'multiply';
            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = yarnPattern;
            ctx.lineWidth = baseWidth * 0.9;
            strokePath(ctx, pts);
            ctx.restore();

            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.globalAlpha = 0.35;
            ctx.strokeStyle = yarnPattern;
            ctx.lineWidth = baseWidth * 0.78;
            strokePath(ctx, pts);
            ctx.restore();
        }

        // 5. Highlight band
        ctx.save();
        ctx.translate(-baseWidth * 0.12, -baseWidth * 0.18);
        ctx.strokeStyle = palette.light;
        ctx.lineWidth = baseWidth * 0.35;
        ctx.globalAlpha = 0.85;
        strokePath(ctx, pts);
        ctx.restore();

        // 5b. Braid twist — second offset dark ply on the opposite
        // side for a rounded two-ply yarn look (Phase 6).
        ctx.save();
        ctx.translate(baseWidth * 0.10, baseWidth * 0.08);
        ctx.strokeStyle = palette.dark;
        ctx.lineWidth = baseWidth * 0.22;
        ctx.globalAlpha = 0.55;
        strokePath(ctx, pts);
        ctx.restore();

        // 6. Dashed fiber stitches — thicker + tighter than before
        // (Phase 6) so the weave reads at a glance.
        ctx.save();
        ctx.setLineDash([baseWidth * 0.18, baseWidth * 0.42]);
        ctx.strokeStyle = palette.dark;
        ctx.lineWidth = baseWidth * 1.05;
        ctx.globalAlpha = 0.45;
        strokePath(ctx, pts);
        ctx.restore();
    }

    global.WeftyThread = { PALETTES, GUIDE_PALETTE, loadYarnPattern, drawThread, strokePath };
})(window);
