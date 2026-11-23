function chassisMotion() {
  const track = document.querySelector(".scene-track");
  const model = document.querySelector(".chassis");
  if (!track || !model) return;

  const media = matchMedia("(prefers-reduced-motion: reduce)");
  const blades = [...model.querySelectorAll(".blade")];
  let raf = 0;
  const start = performance.now();
  let intro = true;

  function draw(time) {
    raf = 0;
    if (media.matches) {
      model.style.removeProperty("transform");
      for (const blade of blades) blade.style.removeProperty("transform");
      return;
    }

    const rect = track.getBoundingClientRect();
    const distance = innerWidth > 740
      ? Math.max(300, rect.height - innerHeight)
      : Math.max(180, rect.height * 0.68);
    const progress = Math.min(1, Math.max(0, (75 - rect.top) / distance));
    const reveal = intro ? Math.min(1, (time - start) / 1450) : 1;
    const easing = 1 - Math.pow(1 - reveal, 3);

    model.style.transform = `translateY(${(1 - easing) * 24 - progress * 9}px) rotateX(${-21 + 10 * progress}deg) rotateY(${-59 + 28 * easing + 69 * progress}deg) scale(${0.8 + 0.2 * easing + 0.09 * progress})`;
    blades.forEach((blade, index) => {
      const progressIn = Math.min(1, Math.max(0, (reveal - index * 0.09) / 0.73));
      blade.style.transform = `translateX(${(1 - progressIn) * (-16 - index * 2)}%)`;
    });

    if (reveal < 1) raf = requestAnimationFrame(draw);
    else intro = false;
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(draw);
  }

  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  media.addEventListener("change", schedule);
  schedule();
}

chassisMotion();

function smoothMouseWheel() {
  const root = document.documentElement;
  let targetY = window.scrollY;
  let frame = 0;
  let previousTime = 0;
  let previousScrollBehavior = "";

  function animate(time) {
    const elapsed = Math.min(50, time - previousTime);
    previousTime = time;
    const currentY = window.scrollY;
    const remaining = targetY - currentY;
    const nextY = currentY + remaining * (1 - Math.exp(-elapsed / 60));

    window.scrollTo(0, Math.abs(remaining) < 0.6 ? targetY : nextY);
    if (Math.abs(remaining) < 0.6) {
      frame = 0;
      root.style.scrollBehavior = previousScrollBehavior;
      return;
    }

    frame = requestAnimationFrame(animate);
  }

  window.addEventListener("wheel", (event) => {
    if (event.ctrlKey || !event.cancelable || event.deltaY === 0) return;

    const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 40
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? window.innerHeight
        : 1;
    const maximumY = root.scrollHeight - window.innerHeight;
    const baseY = frame ? targetY : window.scrollY;
    const nextTarget = Math.min(maximumY, Math.max(0, baseY + event.deltaY * multiplier));
    if (nextTarget === baseY) return;

    event.preventDefault();
    targetY = nextTarget;
    if (!frame) {
      previousScrollBehavior = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      previousTime = performance.now();
      frame = requestAnimationFrame(animate);
    }
  }, { passive: false });
}

smoothMouseWheel();

document.addEventListener("contextmenu", (event) => event.preventDefault());
document.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  const modifier = event.ctrlKey || event.metaKey;
  const developerShortcut = modifier && event.shiftKey && ["i", "j", "c", "k"].includes(key);
  const blocked = event.key === "F12"
    || developerShortcut
    || (modifier && ["s", "u"].includes(key));

  if (blocked) {
    event.preventDefault();
    event.stopPropagation();
  }
});
