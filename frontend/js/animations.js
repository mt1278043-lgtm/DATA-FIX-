/**
 * animations.js
 * -----------------------------------------------------------------------
 * All non-data motion lives here: loading screen, navbar scroll state,
 * hero word-by-word reveal, scroll-triggered reveals (GSAP + ScrollTrigger
 * when available, IntersectionObserver fallback otherwise so the site is
 * never broken if the CDN script fails), animated counters, magnetic
 * buttons, button ripples, the hero particle/node canvas, and the custom
 * cursor. Every heavy effect checks prefers-reduced-motion and disables
 * itself on touch/mobile.
 * -----------------------------------------------------------------------
 */

const Motion = (() => {
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  const isNarrow = window.innerWidth < 860;
  const fancyOK = !prefersReduced && !isTouch && !isNarrow;

  if (!fancyOK) document.body.classList.add("no-fancy");

  const hasGSAP = typeof window.gsap !== "undefined";
  if (hasGSAP && window.ScrollTrigger) {
    gsap.registerPlugin(ScrollTrigger);
  }

  /* ---- Loading screen ---- */
  function initLoadingScreen() {
    const screen = document.getElementById("loadingScreen");
    if (!screen) return;
    const dismiss = () => {
      screen.classList.add("hidden");
      setTimeout(() => screen.remove(), 500);
    };
    if (prefersReduced) {
      dismiss();
      return;
    }
    // Keep it brief — long enough to read, never annoying.
    window.addEventListener("load", () => setTimeout(dismiss, 550));
    setTimeout(dismiss, 2200); // hard ceiling in case load never fires cleanly
  }

  /* ---- Navbar: transparent -> glass on scroll ---- */
  function initNavbar() {
    const nav = document.querySelector(".navbar");
    if (!nav) return;
    const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---- Hero headline: wrap words in spans for staggered reveal ---- */
  function initHeroHeadline() {
    const h1 = document.querySelector(".hero h1[data-split]");
    if (!h1) return;
    const text = h1.textContent.trim();
    h1.innerHTML = text
      .split(" ")
      .map((word, i) => `<span class="word" style="--word-i:${i}">${word}</span>`)
      .join(" ");
  }

  /* ---- Scroll reveals: IntersectionObserver drives .in-view;
     CSS (animations.css) or GSAP does the actual tween. ---- */
  function initReveals() {
    const groups = document.querySelectorAll("[data-reveal-group]");
    groups.forEach((group) => {
      const children = group.querySelectorAll("[data-reveal], [data-reveal-scale]");
      children.forEach((child, i) => child.style.setProperty("--stagger-i", i));
    });

    const targets = document.querySelectorAll("[data-reveal], [data-reveal-scale]");
    if (targets.length === 0) return;

    if (prefersReduced) {
      targets.forEach((t) => t.classList.add("in-view"));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" }
    );
    targets.forEach((t) => io.observe(t));
  }

  /* ---- Animated counters: <span data-count="12540" data-suffix="+"> ---- */
  function animateCounter(el) {
    const target = parseFloat(el.dataset.count);
    if (isNaN(target)) return;
    const suffix = el.dataset.suffix || "";
    const decimals = el.dataset.decimals ? parseInt(el.dataset.decimals, 10) : 0;
    const duration = 1400;
    const start = performance.now();

    if (prefersReduced) {
      el.textContent = target.toLocaleString(undefined, { maximumFractionDigits: decimals }) + suffix;
      return;
    }

    function tick(now) {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      const value = target * eased;
      el.textContent = value.toLocaleString(undefined, { maximumFractionDigits: decimals }) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function initCounters() {
    const counters = document.querySelectorAll("[data-count]");
    if (counters.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            animateCounter(entry.target);
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.4 }
    );
    counters.forEach((c) => io.observe(c));
  }

  /**
   * Animate an SVG ring's stroke-dashoffset from 0 -> target percentage.
   * Used for the hero preview score ring and can be reused by dashboard.js.
   */
  function animateRing(circleEl, percent, radius) {
    const circumference = 2 * Math.PI * radius;
    circleEl.style.strokeDasharray = `${circumference}`;
    if (prefersReduced) {
      circleEl.style.strokeDashoffset = `${circumference - (percent / 100) * circumference}`;
      return;
    }
    circleEl.style.strokeDashoffset = `${circumference}`;
    requestAnimationFrame(() => {
      circleEl.style.transition = "stroke-dashoffset 1.3s cubic-bezier(0.16,1,0.3,1)";
      circleEl.style.strokeDashoffset = `${circumference - (percent / 100) * circumference}`;
    });
  }

  function initHeroRing() {
    const ring = document.getElementById("hvRingFill");
    if (!ring) return;
    const wrap = ring.closest(".hv-ring-wrap");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            animateRing(ring, 82, 32);
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.5 }
    );
    io.observe(wrap);
  }

  /* ---- Button ripple ---- */
  function initRipples() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".btn");
      if (!btn || prefersReduced) return;
      const rect = btn.getBoundingClientRect();
      const ripple = document.createElement("span");
      const size = Math.max(rect.width, rect.height) * 1.4;
      ripple.className = "btn-ripple";
      ripple.style.width = ripple.style.height = size + "px";
      ripple.style.left = e.clientX - rect.left - size / 2 + "px";
      ripple.style.top = e.clientY - rect.top - size / 2 + "px";
      btn.appendChild(ripple);
      setTimeout(() => ripple.remove(), 650);
    });
  }

  /* ---- Magnetic buttons ---- */
  function initMagneticButtons() {
    if (!fancyOK) return;
    const buttons = document.querySelectorAll(".btn-primary, .btn-secondary");
    buttons.forEach((btn) => {
      btn.classList.add("magnetic-btn");
      const strength = 14;
      btn.addEventListener("mousemove", (e) => {
        const rect = btn.getBoundingClientRect();
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;
        const dx = (x / rect.width) * strength;
        const dy = (y / rect.height) * strength;
        if (hasGSAP) {
          gsap.to(btn, { x: dx, y: dy, duration: 0.35, ease: "power2.out" });
        } else {
          btn.style.transform = `translate(${dx}px, ${dy}px)`;
        }
      });
      btn.addEventListener("mouseleave", () => {
        if (hasGSAP) {
          gsap.to(btn, { x: 0, y: 0, duration: 0.5, ease: "elastic.out(1, 0.5)" });
        } else {
          btn.style.transform = "";
        }
      });
    });
  }

  /* ---- Feature card cursor-follow glow ---- */
  function initCardGlow() {
    document.querySelectorAll(".feature-card").forEach((card) => {
      card.addEventListener("mousemove", (e) => {
        const rect = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${((e.clientX - rect.left) / rect.width) * 100}%`);
        card.style.setProperty("--my", `${((e.clientY - rect.top) / rect.height) * 100}%`);
      });
    });
  }

  /* ---- Custom cursor ---- */
  function initCustomCursor() {
    if (!fancyOK) return;
    const dot = document.createElement("div");
    const ring = document.createElement("div");
    dot.className = "cursor-dot";
    ring.className = "cursor-ring";
    document.body.append(dot, ring);

    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let ringX = mouseX;
    let ringY = mouseY;

    window.addEventListener("mousemove", (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      dot.style.left = mouseX + "px";
      dot.style.top = mouseY + "px";
    });

    function loop() {
      ringX += (mouseX - ringX) * 0.18;
      ringY += (mouseY - ringY) * 0.18;
      ring.style.left = ringX + "px";
      ring.style.top = ringY + "px";
      requestAnimationFrame(loop);
    }
    loop();

    const hoverTargets = "a, button, .btn, input, select, .feature-card, .price-card, .stat-card, .issue-card, .clean-action-card";
    document.addEventListener("mouseover", (e) => {
      if (e.target.closest(hoverTargets)) ring.classList.add("hovering");
    });
    document.addEventListener("mouseout", (e) => {
      if (e.target.closest(hoverTargets)) ring.classList.remove("hovering");
    });
  }

  /* ---- Hero particle / node canvas ---- */
  function initHeroCanvas() {
    const canvas = document.getElementById("heroCanvas");
    if (!canvas || !fancyOK) return;
    const ctx = canvas.getContext("2d");
    let w, h, particles;

    function resize() {
      w = canvas.width = canvas.offsetWidth * devicePixelRatio;
      h = canvas.height = canvas.offsetHeight * devicePixelRatio;
    }

    function makeParticles() {
      const count = Math.min(46, Math.floor((canvas.offsetWidth * canvas.offsetHeight) / 22000));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.18 * devicePixelRatio,
        vy: (Math.random() - 0.5) * 0.18 * devicePixelRatio,
        r: (Math.random() * 1.6 + 0.6) * devicePixelRatio,
      }));
    }

    function step() {
      ctx.clearRect(0, 0, w, h);
      const linkDist = 130 * devicePixelRatio;

      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
      });

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < linkDist) {
            ctx.strokeStyle = `rgba(56, 189, 248, ${0.12 * (1 - dist / linkDist)})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      particles.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(94, 234, 212, 0.55)";
        ctx.fill();
      });

      requestAnimationFrame(step);
    }

    resize();
    makeParticles();
    step();
    window.addEventListener("resize", () => {
      resize();
      makeParticles();
    });
  }

  function initAll() {
    initLoadingScreen();
    initNavbar();
    initHeroHeadline();
    initReveals();
    initCounters();
    initHeroRing();
    initRipples();
    initMagneticButtons();
    initCardGlow();
    initCustomCursor();
    initHeroCanvas();
  }

  return { initAll, animateRing, animateCounter, fancyOK, prefersReduced };
})();

document.addEventListener("DOMContentLoaded", () => Motion.initAll());
