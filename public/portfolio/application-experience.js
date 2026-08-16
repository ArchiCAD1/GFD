(() => {
  const root = document.documentElement;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let pointerX = 0;
  let pointerY = 0;
  let frame = 0;

  const render = () => {
    frame = 0;
    root.style.setProperty("--app-parallax-x", `${pointerX * 9}px`);
    root.style.setProperty("--app-parallax-y", `${pointerY * 6}px`);
    root.style.setProperty("--app-light-x", `${pointerX * 34}px`);
    const scrollable = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    root.style.setProperty("--app-night", Math.min(1, Math.max(0, scrollY / scrollable)).toFixed(3));
  };

  const queueRender = () => { if (!frame) frame = requestAnimationFrame(render); };

  addEventListener("scroll", queueRender, { passive: true });
  addEventListener("resize", queueRender, { passive: true });
  addEventListener("pointermove", event => {
    if (reduceMotion.matches || event.pointerType === "touch") return;
    pointerX = event.clientX / innerWidth - .5;
    pointerY = event.clientY / innerHeight - .5;
    queueRender();
  }, { passive: true });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) queueRender(); });
  reduceMotion.addEventListener("change", () => {
    if (reduceMotion.matches) { pointerX = 0; pointerY = 0; }
    queueRender();
  });
  render();
})();
