(() => {
  const form = document.getElementById("join-form");
  const input = document.getElementById("room-input");
  const randomBtn = document.getElementById("random-btn");
  const modePublic = document.getElementById("mode-public");
  const modePrivate = document.getElementById("mode-private");
  const modeHint = document.getElementById("mode-hint");
  const roomsList = document.getElementById("rooms-list");
  const roomsEmpty = document.getElementById("rooms-empty");

  const HINTS = {
    public: "Sala pública aparece na lista — qualquer um entra pelo link.",
    private: "Vamos gerar um código de 6 dígitos: só entra quem tiver ele.",
  };

  let mode = "public";

  const WORDS = [
    "maratona", "pelada", "zoeira", "boss", "ranqueada", "pipoca",
    "estudo", "cafezinho", "caos", "vibe", "coding", "sprint",
    "relax", "gaming", "cozy", "turma",
  ];

  function slug(value) {
    return value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 48);
  }

  function setMode(next) {
    mode = next;
    const isPublic = mode === "public";
    modePublic.classList.toggle("active", isPublic);
    modePrivate.classList.toggle("active", !isPublic);
    modePublic.setAttribute("aria-pressed", String(isPublic));
    modePrivate.setAttribute("aria-pressed", String(!isPublic));
    modeHint.textContent = HINTS[mode];
  }

  modePublic.addEventListener("click", () => setMode("public"));
  modePrivate.addEventListener("click", () => setMode("private"));

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const room = slug(input.value);
    if (!room) {
      input.focus();
      return;
    }
    let url = `/room.html?r=${encodeURIComponent(room)}`;
    if (mode === "private") {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      url += `&c=${code}`;
    }
    location.href = url;
  });

  randomBtn.addEventListener("click", () => {
    const word = WORDS[Math.floor(Math.random() * WORDS.length)];
    const num = Math.floor(Math.random() * 900) + 100;
    input.value = `${word}-${num}`;
    input.focus();
  });

  async function fetchRooms() {
    try {
      const res = await fetch("/api/rooms", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      renderRooms(data.rooms || []);
    } catch {}
  }

  function renderRooms(rooms) {
    roomsList.innerHTML = "";
    roomsEmpty.style.display = rooms.length ? "none" : "block";
    for (const room of rooms) {
      const card = document.createElement("a");
      card.className = "room-card";
      card.href = `/room.html?r=${encodeURIComponent(room.name)}`;

      const name = document.createElement("span");
      name.className = "r-name";
      name.textContent = `#${room.name}`;

      const meta = document.createElement("span");
      meta.className = "r-meta";
      const count = document.createElement("span");
      count.className = "r-count";
      count.textContent = `${room.count} ${room.count === 1 ? "pessoa" : "pessoas"}`;
      meta.append(count);
      if (room.priv) {
        const lock = document.createElement("span");
        lock.className = "r-lock";
        lock.textContent = "🔒";
        meta.append(lock);
      }

      const go = document.createElement("span");
      go.className = "r-go";
      go.textContent = "Entrar →";

      card.append(name, meta, go);
      roomsList.append(card);
    }
  }

  fetchRooms();
  setInterval(() => {
    if (document.visibilityState === "visible") fetchRooms();
  }, 15000);
})();
