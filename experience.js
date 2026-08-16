(() => {
  const root = document.documentElement;
  const atmosphere = document.querySelector('.atmosphere');
  const canvas = document.querySelector('.atmosphere-weather');
  const approachArt = document.querySelector('.approach-art');
  const logoCard = document.querySelector('.contact-logo-card');
  if (!atmosphere || !canvas) return;

  const ctx = canvas.getContext('2d', { alpha: true });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;
  let width = 1;
  let height = 1;
  let dpr = 1;
  let progress = 0;
  let targetProgress = 0;
  let pointerX = 0;
  let pointerY = 0;
  let lastTime = performance.now();
  let active = true;

  const quality = coarse ? 0.55 : 1;
  const dust = Array.from({ length: Math.round(72 * quality) }, (_, i) => ({
    x: (i * 0.61803398875) % 1,
    y: (i * 0.41421356237) % 1,
    size: 0.7 + (i % 4) * 0.5,
    speed: 0.08 + (i % 5) * 0.018,
    phase: i * 0.73
  }));
  const rain = Array.from({ length: Math.round(170 * quality) }, (_, i) => ({
    x: (i * 0.754877666) % 1,
    y: (i * 0.56984029) % 1,
    speed: 0.6 + (i % 7) * 0.09,
    length: 10 + (i % 9) * 2
  }));
  const stars = Array.from({ length: Math.round(105 * quality) }, (_, i) => ({
    x: (i * 0.683281573) % 1,
    y: ((i * 0.371390676) % 1) * 0.68,
    size: 0.4 + (i % 5) * 0.27,
    phase: i * 0.81
  }));

  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
  const range = (value, start, end) => clamp((value - start) / (end - start));
  const smooth = value => value * value * (3 - 2 * value);

  const resize = () => {
    width = innerWidth;
    height = innerHeight;
    dpr = Math.min(devicePixelRatio || 1, coarse ? 1.25 : 1.75);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const updateScroll = () => {
    const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    targetProgress = clamp(scrollY / max);
  };

  const updateAtmosphere = () => {
    const cloud = smooth(range(progress, 0.18, 0.42));
    const rainIn = smooth(range(progress, 0.38, 0.48));
    const rainOut = 1 - smooth(range(progress, 0.58, 0.68));
    const rainAlpha = rainIn * rainOut;
    const sunset = smooth(range(progress, 0.57, 0.73)) * (1 - smooth(range(progress, 0.76, 0.88)));
    const night = smooth(range(progress, 0.72, 0.94));
    const interior = smooth(range(progress, 0.62, 0.88)) * 0.72;

    root.style.setProperty('--scene-x', `${pointerX * -18}px`);
    root.style.setProperty('--scene-y', `${pointerY * -10 + progress * -16}px`);
    root.style.setProperty('--day-brightness', String(1.02 - cloud * 0.34 - night * 0.48 + sunset * 0.12));
    root.style.setProperty('--day-saturation', String(1.08 - cloud * 0.16 + sunset * 0.35 - night * 0.28));
    root.style.setProperty('--exterior-alpha', String(1 - interior * 0.34));
    root.style.setProperty('--interior-alpha', String(interior));
    root.style.setProperty('--night-brightness', String(0.46 + night * 0.24));
    root.style.setProperty('--sun-alpha', String(clamp(1 - cloud * 0.72 - night)));
    root.style.setProperty('--sun-x', `${74 - progress * 33}%`);
    root.style.setProperty('--sun-y', `${23 + progress * 9}%`);
    root.style.setProperty('--wet-alpha', String(rainAlpha * 0.82));
    root.style.setProperty('--night-alpha', String(night * 0.88));
    if (approachArt) {
      approachArt.style.setProperty('--approach-x', String(pointerX * -6));
      approachArt.style.setProperty('--approach-y', String(pointerY * -4));
    }
  };

  const drawWeather = time => {
    ctx.clearRect(0, 0, width, height);
    const cloud = smooth(range(progress, 0.18, 0.42));
    const rainIn = smooth(range(progress, 0.38, 0.48));
    const rainOut = 1 - smooth(range(progress, 0.58, 0.68));
    const rainAlpha = rainIn * rainOut;
    const night = smooth(range(progress, 0.72, 0.94));
    const dustAlpha = (1 - cloud) * (1 - night) * 0.55;
    const dt = Math.min(0.04, (time - lastTime) / 1000);

    if (dustAlpha > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      dust.forEach(p => {
        if (!reduced) {
          p.y = (p.y + p.speed * dt) % 1;
          p.x = (p.x + Math.sin(time * 0.0004 + p.phase) * dt * 0.006 + 1) % 1;
        }
        ctx.fillStyle = `rgba(239,219,171,${dustAlpha * (0.22 + p.size * 0.08)})`;
        ctx.beginPath();
        ctx.arc(p.x * width, p.y * height, p.size, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }

    if (rainAlpha > 0.01) {
      ctx.save();
      ctx.lineWidth = 0.75;
      ctx.strokeStyle = `rgba(196,224,229,${0.18 + rainAlpha * 0.34})`;
      rain.forEach(drop => {
        if (!reduced) {
          drop.y += drop.speed * dt * 1.8;
          drop.x += (0.07 + pointerX * 0.05) * dt;
          if (drop.y > 1.08) { drop.y = -0.08; drop.x = (drop.x + 0.37) % 1; }
          if (drop.x > 1.05) drop.x = -0.04;
        }
        const x = drop.x * width;
        const y = drop.y * height;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 4 - pointerX * 7, y + drop.length);
        ctx.stroke();
      });
      ctx.restore();
    }

    if (night > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      stars.forEach(star => {
        const twinkle = reduced ? 0.7 : 0.42 + Math.sin(time * 0.0017 + star.phase) * 0.28;
        ctx.fillStyle = `rgba(222,235,227,${night * twinkle})`;
        ctx.fillRect(star.x * width, star.y * height, star.size, star.size);
      });
      ctx.restore();
    }
    lastTime = time;
  };

  const animate = time => {
    if (!active) return;
    progress += (targetProgress - progress) * (reduced ? 1 : 0.055);
    updateAtmosphere();
    drawWeather(time);
    requestAnimationFrame(animate);
  };

  addEventListener('resize', resize, { passive: true });
  addEventListener('scroll', updateScroll, { passive: true });
  addEventListener('pointermove', event => {
    pointerX = event.clientX / innerWidth - 0.5;
    pointerY = event.clientY / innerHeight - 0.5;
  }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    const wasActive = active;
    active = !document.hidden;
    if (active && !wasActive) {
      lastTime = performance.now();
      requestAnimationFrame(animate);
    }
  });

  if (logoCard && !coarse && !reduced) {
    logoCard.addEventListener('pointermove', event => {
      const rect = logoCard.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      logoCard.style.setProperty('--logo-rx', `${y * -9}deg`);
      logoCard.style.setProperty('--logo-ry', `${x * 11}deg`);
    });
    logoCard.addEventListener('pointerleave', () => {
      logoCard.style.setProperty('--logo-rx', '0deg');
      logoCard.style.setProperty('--logo-ry', '0deg');
    });
  }

  resize();
  updateScroll();
  requestAnimationFrame(animate);
})();
