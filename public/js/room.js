(() => {
  const qs = new URLSearchParams(location.search);
  const ROOM = (qs.get("r") || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 48);
  let CODE = (qs.get("c") || "").replace(/\D/g, "").slice(0, 6);
  if (!ROOM) {
    location.replace("/");
    return;
  }

  const RTC_CONFIG = {
    iceServers: [
      { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] },
      { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
      { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
      { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
      { urls: "turns:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
      { urls: "turns:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
    ],
    iceCandidatePoolSize: 10,
  };

  const els = {
    roomName: document.getElementById("room-name"),
    roomCount: document.getElementById("room-count"),
    copyBtn: document.getElementById("copy-link-btn"),
    leaveBtn: document.getElementById("leave-btn"),
    tiles: document.getElementById("tiles"),
    empty: document.getElementById("empty-state"),
    banner: document.getElementById("banner"),
    tabPeople: document.getElementById("tab-people"),
    tabChat: document.getElementById("tab-chat"),
    peoplePanel: document.getElementById("people-panel"),
    chatPanel: document.getElementById("chat-panel"),
    peopleList: document.getElementById("people-list"),
    chatMessages: document.getElementById("chat-messages"),
    chatForm: document.getElementById("chat-form"),
    chatInput: document.getElementById("chat-input"),
    screenBtn: document.getElementById("screen-btn"),
    camBtn: document.getElementById("cam-btn"),
    micBtn: document.getElementById("mic-btn"),
    statsBtn: document.getElementById("stats-btn"),
    modoSelect: document.getElementById("modo-select"),
    qualitySelect: document.getElementById("quality-select"),
    fpsSelect: document.getElementById("fps-select"),
    overlay: document.getElementById("join-overlay"),
    joinForm: document.getElementById("join-room-form"),
    nameInput: document.getElementById("name-input"),
    codeWrap: document.getElementById("code-wrap"),
    codeInput: document.getElementById("code-input"),
    joinError: document.getElementById("join-error"),
    privBadge: document.getElementById("priv-badge"),
    toasts: document.getElementById("toasts"),
  };

  let ws = null;
  let myId = null;
  let myName = "";
  let manualLeave = false;
  let retries = 0;
  let statsOn = false;
  let statsTimer = null;
  let bitrateAlvo = 4000000;
  let fpsAlvo = 30;
  let audioCtx = null;
  const meters = new Map();
  let minimizadoTimer = null;

  const peers = new Map();
  const pubs = new Map();
  const subsOfMe = new Map();
  const tiles = new Map();
  const local = { screen: null, cam: null, mic: null };
  const myKinds = new Set();

  els.roomName.textContent = `#${ROOM}`;
  els.nameInput.value = localStorage.getItem("sc:name") || "";

  els.joinForm.addEventListener("submit", (e) => {
    e.preventDefault();
    myName = els.nameInput.value.trim().slice(0, 24) || "convidado";
    localStorage.setItem("sc:name", myName);
    if (!els.codeWrap.classList.contains("hidden")) {
      const code = els.codeInput.value.replace(/\D/g, "").slice(0, 6);
      if (code.length !== 6) {
        showJoinError("Digite o código de 6 dígitos pra entrar.");
        els.codeInput.focus();
        return;
      }
      CODE = code;
    }
    els.joinError.classList.add("hidden");
    els.overlay.classList.add("hidden");
    connect();
  });

  function showJoinError(text) {
    els.joinError.textContent = text;
    els.joinError.classList.remove("hidden");
    els.overlay.classList.remove("hidden");
  }

  function wsSend(msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  function signal(to, data) {
    wsSend({ type: "signal", to, data });
  }

  function connect() {
    manualLeave = false;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws?room=${encodeURIComponent(ROOM)}`);

    ws.addEventListener("open", () => {
      retries = 0;
      els.banner.classList.add("hidden");
      wsSend({ type: "join", name: myName, code: CODE });
    });

    ws.addEventListener("message", (evt) => {
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      onMessage(msg);
    });

    ws.addEventListener("close", () => {
      if (manualLeave) return;
      els.banner.classList.remove("hidden");
      if (retries < 5) {
        retries++;
        setTimeout(connect, 2000 * retries);
      }
    });
  }

  function onMessage(msg) {
    switch (msg.type) {
      case "welcome":
        myId = msg.id;
        if (msg.priv) els.privBadge.classList.remove("hidden");
        peers.clear();
        for (const p of msg.peers) peers.set(p.id, { name: p.name, kinds: p.kinds });
        for (const p of msg.peers) {
          if (p.kinds && p.kinds.length) signal(p.id, { cmd: "subscribe" });
        }
        if (Array.isArray(msg.history)) {
          for (const h of msg.history) appendChat(h.id === myId, h.name, h.text);
        }
        sysChat("Você entrou na sala");
        refresh();
        break;
      case "peer-joined":
        peers.set(msg.peer.id, { name: msg.peer.name, kinds: msg.peer.kinds });
        sysChat(`${msg.peer.name} entrou`);
        if (msg.peer.kinds && msg.peer.kinds.length) signal(msg.peer.id, { cmd: "subscribe" });
        refresh();
        break;
      case "peer-left": {
        const who = peers.get(msg.id);
        sysChat(`${who ? who.name : "Alguém"} saiu`);
        peers.delete(msg.id);
        dropPeerConnections(msg.id);
        refresh();
        break;
      }
      case "publish": {
        if (msg.id === myId) break;
        const peer = peers.get(msg.id);
        if (!peer) break;
        peer.kinds = msg.kinds;
        dropRecv(msg.id);
        if (msg.kinds && msg.kinds.length) signal(msg.id, { cmd: "subscribe" });
        refresh();
        break;
      }
      case "chat": {
        const mine = msg.id === myId;
        appendChat(mine, mine ? "Você" : msg.name, msg.text);
        if (!mine) beep();
        break;
      }
      case "rename": {
        if (msg.id === myId) {
          if (msg.name !== myName) {
            myName = msg.name;
            localStorage.setItem("sc:name", myName);
          }
        } else {
          const peer = peers.get(msg.id);
          if (peer) {
            sysChat(`${peer.name} agora é ${msg.name}`);
            peer.name = msg.name;
          }
        }
        refresh();
        renderTiles();
        break;
      }
      case "flood":
        toast("Calma no flood 😉", true);
        break;
      case "signal":
        handleSignal(msg.from, msg.data);
        break;
      case "error":
        manualLeave = true;
        if (msg.reason === "cheia") {
          els.codeWrap.classList.add("hidden");
          showJoinError("Essa sala está cheia (máx. 10 pessoas).");
        } else if (msg.reason === "codigo") {
          els.codeWrap.classList.remove("hidden");
          showJoinError("Essa sala é privada — precisa do código de acesso.");
          els.codeInput.focus();
        }
        break;
    }
  }

  async function handleSignal(from, data) {
    if (data.cmd === "subscribe") {
      await createOfferTo(from);
      return;
    }

    if (data.cmd === "offer") {
      const peer = peers.get(from);
      if (!peer) return;
      dropRecv(from);
      const rec = {
        pc: new RTCPeerConnection(RTC_CONFIG),
        pending: [],
        streams: new Map(),
        streamKinds: data.streams || {},
      };
      pubs.set(from, rec);
      rec.pc.ontrack = (e) => {
        for (const r of e.receivers || []) {
          if (r.jitterBufferTarget !== undefined) r.jitterBufferTarget = 500;
          if (r.playoutDelayHint !== undefined) r.playoutDelayHint = 0;
        }
        const stream = e.streams[0];
        if (!stream) return;
        rec.streams.set(stream.id, stream);
        renderTiles();
      };
      rec.pc.onconnectionstatechange = () => {
        if (rec.pc.connectionState === "connected") forcarKeyframe(rec.pc);
      };
      rec.pc.onicecandidate = (e) => {
        if (e.candidate) signal(from, { cmd: "ice", role: "answerer", candidate: e.candidate.toJSON() });
      };
      await rec.pc.setRemoteDescription({ type: "offer", sdp: data.sdp });
      if (pubs.get(from) !== rec) {
        try { rec.pc.close(); } catch {}
        return;
      }
      const pending = rec.pending;
      rec.pending = null;
      for (const c of pending) {
        try { await rec.pc.addIceCandidate(c); } catch {}
      }
      const answer = await rec.pc.createAnswer();
      await rec.pc.setLocalDescription(answer);
      if (pubs.get(from) !== rec) {
        try { rec.pc.close(); } catch {}
        return;
      }
      signal(from, { cmd: "answer", sdp: answer.sdp });
      return;
    }

    if (data.cmd === "answer") {
      const mine = subsOfMe.get(from);
      if (!mine) return;
      await mine.pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
      const pending = mine.pending;
      mine.pending = null;
      for (const c of pending) {
        try { await mine.pc.addIceCandidate(c); } catch {}
      }
      return;
    }

    if (data.cmd === "ice") {
      const cand = data.candidate;
      if (data.role === "offerer") {
        const rec = pubs.get(from);
        if (!rec) return;
        if (rec.pending) rec.pending.push(cand);
        else {
          try { await rec.pc.addIceCandidate(cand); } catch {}
        }
      } else {
        const mine = subsOfMe.get(from);
        if (!mine) return;
        if (mine.pending) mine.pending.push(cand);
        else {
          try { await mine.pc.addIceCandidate(cand); } catch {}
        }
      }
    }
  }

  async function createOfferTo(peerId) {
    if (!hasAnythingToShare()) return;
    dropSendTo(peerId);
    const mine = { pc: new RTCPeerConnection(RTC_CONFIG), pending: [], nota: "" };
    subsOfMe.set(peerId, mine);
    const streamsMap = {};
    for (const [stream, label] of collectMyStreams()) {
      streamsMap[stream.id] = label;
      for (const track of stream.getTracks()) addTrackHighQuality(mine.pc, track, stream);
    }
    preferVideoCodecs(mine.pc);
    monitorarQualidade(mine);
    mine.pc.onicecandidate = (e) => {
      if (e.candidate) signal(peerId, { cmd: "ice", role: "offerer", candidate: e.candidate.toJSON() });
    };
    const offer = await mine.pc.createOffer();
    await mine.pc.setLocalDescription(offer);
    if (subsOfMe.get(peerId) !== mine) {
      try { mine.pc.close(); } catch {}
      return;
    }
    signal(peerId, { cmd: "offer", sdp: offer.sdp, streams: streamsMap });
  }

  function addTrackHighQuality(pc, track, stream) {
    const sender = pc.addTrack(track, stream);
    const params = sender.getParameters();
    if (track.kind === "video") {
      const jogo = els.modoSelect.value === "jogo";
      try {
        if ("contentHint" in track) track.contentHint = jogo ? "motion" : "text";
      } catch {}
      if (!params.encodings || !params.encodings.length) params.encodings = [{}];
      while (params.encodings.length < 3) params.encodings.push({});
      const base = Math.floor(bitrateAlvo * 0.8);
      params.encodings[0].maxBitrate = base;
      params.encodings[0].maxFramerate = fpsAlvo;
      params.encodings[0].priority = "high";
      params.encodings[1].maxBitrate = Math.max(Math.floor(base * 0.6), 200000);
      params.encodings[1].scaleResolutionDownBy = 2;
      params.encodings[1].maxFramerate = fpsAlvo;
      params.encodings[2].maxBitrate = Math.max(Math.floor(base * 0.3), 100000);
      params.encodings[2].scaleResolutionDownBy = 4;
      params.encodings[2].maxFramerate = Math.floor(fpsAlvo / 2);
      params.encodings.forEach((enc) => { enc.networkPriority = "high"; });
      params.degradationPreference = jogo ? "maintain-framerate" : "balanced";
      sender.setParameters(params).catch(() => {});
    } else {
      if (!params.encodings || !params.encodings.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = 128000;
      sender.setParameters(params).catch(() => {});
    }
  }

  function preferVideoCodecs(pc) {
    try {
      const caps = RTCRtpSender.getCapabilities("video");
      if (!caps) return;
      const ordem = ["av1", "vp9", "vp8"];
      const pontos = (c) => {
        const idx = ordem.findIndex((p) => c.mimeType.toLowerCase().includes(p));
        return idx === -1 ? ordem.length : idx;
      };
      const ordenados = [...caps.codecs].sort((a, b) => pontos(a) - pontos(b));
      pc.getTransceivers().forEach((t) => {
        if (t.sender?.track?.kind === "video" || t.receiver?.track?.kind === "video" || t.mid === null) {
          t.setCodecPreferences?.(ordenados);
        }
      });
    } catch {}
  }

  function monitorarQualidade(mine) {
    let ultimo = { bytes: 0, t: Date.now() };
    let bitrateAtual = Math.floor(bitrateAlvo * 0.8);
    let quedasSeguidas = 0;
    const histPerda = [];
    const histRTT = [];
    const minimo = 400000;

    const ajustar = (novo, nota) => {
      const sender = mine.pc.getSenders().find((s) => s.track?.kind === "video");
      if (!sender) return;
      const params = sender.getParameters();
      if (!params.encodings || !params.encodings.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = novo;
      params.encodings[0].maxFramerate = fpsAlvo;
      sender
        .setParameters(params)
        .then(() => {
          bitrateAtual = novo;
          mine.nota = nota;
        })
        .catch(() => {});
    };

    mine.monitor = setInterval(async () => {
      if (mine.pc.connectionState !== "connected") return;
      try {
        const stats = await mine.pc.getStats();
        let out = null;
        let cand = null;
        stats.forEach((r) => {
          if (r.type === "outbound-rtp" && r.kind === "video" && r.bytesSent !== undefined) out = r;
          if (r.type === "candidate-pair" && r.state === "succeeded" && r.currentRoundTripTime !== undefined) cand = r;
        });
        if (!out) return;
        const agora = Date.now();
        const dt = (agora - ultimo.t) / 1000;
        if (dt < 2) return;
        const kbps = ((out.bytesSent - ultimo.bytes) * 8) / dt / 1000;
        const totalPacotes = out.packetsSent ?? 0;
        const taxaPerda = totalPacotes > 0 ? (out.packetsLost ?? 0) / totalPacotes : 0;
        const rtt = cand ? cand.currentRoundTripTime : 0;
        const fpsReal = out.framesPerSecond ?? 0;
        ultimo = { bytes: out.bytesSent, t: agora };

        histPerda.push(taxaPerda);
        if (histPerda.length > 3) histPerda.shift();
        histRTT.push(rtt);
        if (histRTT.length > 3) histRTT.shift();
        const perdaMedia = histPerda.reduce((a, b) => a + b, 0) / histPerda.length;
        const rttMedio = histRTT.reduce((a, b) => a + b, 0) / histRTT.length;

        const jogo = els.modoSelect.value === "jogo";
        const limiarPerda = jogo ? 0.08 : 0.05;
        const limiarRTT = jogo ? 0.45 : 0.35;

        if (perdaMedia > limiarPerda) {
          quedasSeguidas++;
          const corte = quedasSeguidas >= 2 ? 0.6 : 0.75;
          ajustar(Math.max(Math.floor(bitrateAtual * corte), minimo), `🔴 perda ${(taxaPerda * 100).toFixed(1)}% · reduzindo`);
          return;
        }
        if (rttMedio > limiarRTT) {
          ajustar(Math.max(Math.floor(bitrateAtual * 0.85), minimo), `🟡 RTT ${Math.round(rtt * 1000)}ms · ajustando`);
          return;
        }
        if (fpsReal > 0 && fpsReal < fpsAlvo * 0.6) {
          ajustar(Math.max(Math.floor(bitrateAtual * 0.8), minimo), `🟡 ${fpsReal.toFixed(0)} fps · aliviando encoder`);
          return;
        }
        quedasSeguidas = 0;
        const sobe = jogo ? 1.08 : 1.15;
        if (kbps > 0 && bitrateAtual < bitrateAlvo && kbps > (bitrateAtual / 1000) * 0.9) {
          const novo = Math.min(Math.floor(bitrateAtual * sobe), bitrateAlvo);
          ajustar(novo, `🟢 subindo p/ ${(novo / 1e6).toFixed(1)} Mbps`);
        }
      } catch {}
    }, 3000);
  }

  function hasAnythingToShare() {
    return myKinds.size > 0 && (local.screen || local.cam || local.mic);
  }

  function collectMyStreams() {
    const entries = [];
    if (local.screen) entries.push([local.screen, "tela"]);
    if (local.cam) entries.push([local.cam, "câmera"]);
    if (local.mic) entries.push([local.mic, "voz"]);
    return entries;
  }

  function dropRecv(peerId) {
    const rec = pubs.get(peerId);
    if (rec) {
      try { rec.pc.close(); } catch {}
      pubs.delete(peerId);
      renderTiles();
    }
  }

  function dropSendTo(peerId) {
    const mine = subsOfMe.get(peerId);
    if (mine) {
      if (mine.monitor) clearInterval(mine.monitor);
      try { mine.pc.close(); } catch {}
      subsOfMe.delete(peerId);
    }
  }

  function dropPeerConnections(peerId) {
    dropRecv(peerId);
    dropSendTo(peerId);
    renderTiles();
  }

  function announcePublish() {
    for (const peerId of [...subsOfMe.keys()]) dropSendTo(peerId);
    wsSend({ type: "publish", kinds: [...myKinds] });
    refresh();
  }

  function refresh() {
    updatePeople();
    updateControls();
    renderTiles();
  }

  function updatePeople() {
    const count = peers.size + 1;
    els.roomCount.textContent = `${count} ${count === 1 ? "pessoa" : "pessoas"}`;
    els.peopleList.innerHTML = "";
    const all = [{ id: myId, name: myName, kinds: [...myKinds], me: true }];
    for (const [id, p] of peers) all.push({ id, name: p.name, kinds: p.kinds || [], me: false });
    for (const person of all) {
      const li = document.createElement("li");
      li.className = "person";
      const hue = [...person.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
      const avatar = document.createElement("span");
      avatar.className = "avatar";
      avatar.style.background = `hsl(${hue} 55% 42%)`;
      avatar.textContent = (person.name[0] || "?").toUpperCase();
      const name = document.createElement("span");
      name.className = "p-name";
      name.textContent = person.name;
      li.append(avatar, name);
      if (person.me) {
        const you = document.createElement("span");
        you.className = "p-you";
        you.textContent = "você";
        li.append(you);
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "p-rename";
        edit.title = "Renomear";
        edit.textContent = "✏️";
        edit.addEventListener("click", startRename);
        li.append(edit);
      }
      const kinds = document.createElement("span");
      kinds.className = "p-kinds";
      const icos = [];
      if (person.kinds.includes("screen")) icos.push("🖥️");
      if (person.kinds.includes("cam")) icos.push("🎥");
      if (person.kinds.includes("mic")) icos.push("🎙️");
      kinds.textContent = icos.join(" ");
      li.append(kinds);
      els.peopleList.append(li);
    }
  }

  function startRename(e) {
    const li = e.target.closest(".person");
    const nameEl = li.querySelector(".p-name");
    if (!nameEl || li.querySelector(".rename-input")) return;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "rename-input";
    input.maxLength = 24;
    input.value = myName;
    nameEl.replaceChildren(input);
    input.focus();
    input.select();
    const commit = () => {
      const name = input.value.trim().slice(0, 24);
      if (name && name !== myName) {
        myName = name;
        localStorage.setItem("sc:name", myName);
        wsSend({ type: "rename", name });
      }
      refresh();
      renderTiles();
    };
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") input.blur();
      if (ev.key === "Escape") {
        input.value = myName;
        input.blur();
      }
      ev.stopPropagation();
    });
    input.addEventListener("blur", commit, { once: true });
  }

  function updateControls() {
    els.screenBtn.classList.toggle("on", myKinds.has("screen"));
    els.camBtn.classList.toggle("on", myKinds.has("cam"));
    els.micBtn.classList.toggle("on", micActive());
  }

  function micActive() {
    if (local.cam) {
      const t = local.cam.getAudioTracks()[0];
      return !!(t && t.enabled);
    }
    return !!local.mic;
  }

  function renderTiles() {
    const seen = new Set();
    const insert = els.empty;

    for (const [stream, label] of collectMyStreams()) {
      const key = `me:${stream.id}`;
      seen.add(key);
      upsertTile(key, stream, `${myName} (você)`, label, true, insert);
    }

    for (const [pid, rec] of pubs) {
      const peer = peers.get(pid);
      for (const [sid, stream] of rec.streams) {
        const key = `${pid}:${sid}`;
        seen.add(key);
        upsertTile(key, stream, peer ? peer.name : "???", rec.streamKinds[sid] || "", false, insert);
      }
    }

    for (const [key, el] of tiles) {
      if (!seen.has(key)) {
        el.remove();
        tiles.delete(key);
      }
    }
    els.empty.classList.toggle("hidden", tiles.size > 0);
  }

  function upsertTile(key, stream, name, label, muted, before) {
    let el = tiles.get(key);
    if (!el) {
      el = document.createElement("div");
      const hasVideo = stream.getVideoTracks().length > 0;
      el.className = hasVideo ? "tile" : "tile tile-audio";
      if (hasVideo) {
        const video = document.createElement("video");
        video.autoplay = true;
        video.playsInline = true;
        video.muted = muted;
        el.append(video);
      } else {
        const audio = document.createElement("audio");
        audio.autoplay = true;
        el.append(audio);
        const mic = document.createElement("div");
        mic.className = "tile-mic";
        mic.textContent = "🎙️";
        el.append(mic);
      }
      const tag = document.createElement("span");
      tag.className = "tile-tag";
      const tagLabel = document.createElement("span");
      tagLabel.textContent = name;
      tag.append(tagLabel);
      if (label) {
        const kind = document.createElement("span");
        kind.className = "kind";
        kind.textContent = label;
        tag.append(kind);
      }
      const chip = document.createElement("span");
      chip.className = "tile-stats hidden";
      el.append(tag, chip);
      if (!muted) buildTileControls(el, media);
      attachAudioMeter(key, el, stream);
      tiles.set(key, el);
      els.tiles.insertBefore(el, before);
    }
    const media = el.querySelector("video, audio");
    if (media.srcObject !== stream) media.srcObject = stream;
    const tagLabel = el.querySelector(".tile-tag span");
    if (tagLabel.textContent !== name) tagLabel.textContent = name;
  }

  function forcarKeyframe(pc) {
    try {
      pc.getReceivers?.().forEach((r) => r.generateKeyframe?.());
      setTimeout(() => {
        if (pc.connectionState === "connected") pc.getReceivers?.().forEach((r) => r.generateKeyframe?.());
      }, 800);
    } catch {}
  }

  function buildTileControls(el, media) {
    const bar = document.createElement("div");
    bar.className = "tile-controls";

    const btnMudo = document.createElement("button");
    btnMudo.type = "button";
    btnMudo.title = "Som";
    btnMudo.textContent = "🔊";
    let mudo = false;
    btnMudo.addEventListener("click", (e) => {
      e.stopPropagation();
      mudo = !mudo;
      media.muted = mudo;
      btnMudo.textContent = mudo ? "🔇" : "🔊";
    });
    bar.append(btnMudo);

    const volume = document.createElement("input");
    volume.type = "range";
    volume.min = 0;
    volume.max = 100;
    volume.value = 100;
    volume.title = "Volume";
    volume.addEventListener("input", () => {
      media.volume = volume.value / 100;
    });
    volume.addEventListener("click", (e) => e.stopPropagation());
    bar.append(volume);

    if (media.tagName === "VIDEO") {
      const btnPip = document.createElement("button");
      btnPip.type = "button";
      btnPip.title = "Janelinha flutuante (PiP)";
      btnPip.textContent = "🗔";
      btnPip.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          if (document.pictureInPictureElement) await document.exitPictureInPicture();
          else await media.requestPictureInPicture();
        } catch {}
      });
      bar.append(btnPip);
    }

    const btnFull = document.createElement("button");
    btnFull.type = "button";
    btnFull.title = "Tela cheia";
    btnFull.textContent = "⛶";
    btnFull.addEventListener("click", (e) => {
      e.stopPropagation();
      if (document.fullscreenElement) document.exitFullscreen();
      else el.requestFullscreen?.().catch(() => {});
    });
    bar.append(btnFull);

    el.append(bar);

    el.addEventListener("dblclick", (e) => {
      if (e.target.closest(".tile-controls")) return;
      if (document.fullscreenElement) document.exitFullscreen();
      else el.requestFullscreen?.().catch(() => {});
    });
  }

  function attachAudioMeter(key, el, stream) {
    if (meters.has(key) || !stream.getAudioTracks().length || meters.size >= 8) return;
    try {
      audioCtx ??= new AudioContext();
      audioCtx.resume?.();
      const src = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const dados = new Uint8Array(analyser.frequencyBinCount);
      const barra = document.createElement("div");
      barra.className = "audio-meter";
      const barras = [];
      for (let i = 0; i < 5; i++) {
        const b = document.createElement("i");
        b.style.height = "3px";
        barra.append(b);
        barras.push(b);
      }
      el.append(barra);
      meters.set(key, { barra, src });
      const tick = () => {
        if (!meters.has(key) || !tiles.has(key)) {
          src.disconnect();
          barra.remove();
          meters.delete(key);
          return;
        }
        analyser.getByteFrequencyData(dados);
        const media = dados.reduce((a, b) => a + b, 0) / dados.length / 255;
        barras.forEach((b, i) => {
          const nivel = Math.max(0.12, Math.min(1, media * (1.5 + i * 0.35)));
          b.style.height = `${3 + nivel * 15}px`;
          b.style.opacity = media < 0.02 ? "0.25" : "0.85";
        });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {}
  }

  function getMedia(kind, on) {
    if (kind === "screen") {
      if (on) startScreen();
      else stopScreen();
    } else if (kind === "cam") {
      if (on) startCam();
      else stopCam();
    } else if (kind === "mic") {
      if (on) startMic();
      else stopMic();
    }
  }

  async function startScreen() {
    try {
      const cfg = await construirConstraints();
      const stream = await navigator.mediaDevices.getDisplayMedia(cfg.constraints);
      local.screen = stream;
      stream.getVideoTracks()[0].addEventListener("ended", stopScreen);
      recalibrarCaptura(stream.getVideoTracks()[0]);
      myKinds.add("screen");
      setPresetsDisabled(true);
      announcePublish();
      vigiarMinimizacao();
      toast("Tela sendo compartilhada");
    } catch {
      toast("Não foi possível capturar a tela", true);
    }
  }

  function stopScreen() {
    if (!local.screen) return;
    clearInterval(minimizadoTimer);
    minimizadoTimer = null;
    for (const t of local.screen.getTracks()) t.stop();
    local.screen = null;
    myKinds.delete("screen");
    setPresetsDisabled(false);
    announcePublish();
  }

  async function construirConstraints() {
    const jogo = els.modoSelect.value === "jogo";
    const auto = els.qualitySelect.value === "auto" || els.fpsSelect.value === "auto";
    const espectadores = subsOfMe.size;
    const audio = {
      channelCount: 2,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      sampleRate: 48000,
    };
    let height;
    let fps;

    if (jogo) {
      fps = 60;
      height = parseInt(els.qualitySelect.value) > 0
        ? parseInt(els.qualitySelect.value)
        : window.screen.height >= 1080 ? 1080 : 720;
      bitrateAlvo = height <= 720 ? 4500000 : height <= 1080 ? 6500000 : 8500000;
    } else if (auto) {
      height = window.screen.height;
      fps = 30;
      bitrateAlvo = await detectarBitrate();
    } else {
      fps = parseInt(els.fpsSelect.value);
      height = parseInt(els.qualitySelect.value);
      bitrateAlvo = height <= 360 ? 1000000
        : height <= 480 ? 1600000
        : height <= 720 ? 3200000
        : height <= 1080 ? 5200000
        : height <= 1440 ? 7800000
        : 11000000;
    }
    if (espectadores > 2) bitrateAlvo = Math.floor(bitrateAlvo / espectadores);
    fpsAlvo = fps;

    const width = Math.round((height * 16) / 9);
    const travado = !jogo && !auto;
    return {
      constraints: {
        video: {
          width: travado ? { ideal: width, max: width } : { ideal: width },
          height: travado ? { ideal: height, max: height } : { ideal: height },
          frameRate: travado || jogo ? { ideal: fps, max: fps } : { ideal: fps },
        },
        audio,
      },
    };
  }

  async function detectarBitrate() {
    try {
      const inicio = performance.now();
      await fetch("/icon.svg", { cache: "no-store" });
      const pingMs = performance.now() - inicio;
      const downlink = navigator.connection?.downlink || 10;
      let estimado = downlink * 0.45;
      if (pingMs > 150) estimado *= 0.5;
      return Math.min(Math.max(estimado * 1000000, 1000000), 8000000);
    } catch {
      return 2500000;
    }
  }

  function recalibrarCaptura(track) {
    try {
      const s = track.getSettings ? track.getSettings() : {};
      if (s.height && s.frameRate) {
        if (s.height <= 720) bitrateAlvo = Math.min(bitrateAlvo, 3200000);
        else if (s.height <= 1080) bitrateAlvo = Math.min(bitrateAlvo, 5200000);
        if (Math.round(s.frameRate) < fpsAlvo) fpsAlvo = Math.round(s.frameRate);
      }
    } catch {}
  }

  function setPresetsDisabled(on) {
    els.modoSelect.disabled = on;
    els.qualitySelect.disabled = on;
    els.fpsSelect.disabled = on;
  }

  function vigiarMinimizacao() {
    clearInterval(minimizadoTimer);
    minimizadoTimer = setInterval(() => {
      const track = local.screen ? local.screen.getVideoTracks()[0] : null;
      const el = local.screen ? tiles.get(`me:${local.screen.id}`) : null;
      const pausado = track && track.muted === true;
      let aviso = el ? el.querySelector(".tile-aviso") : null;
      if (pausado && el && !aviso) {
        aviso = document.createElement("div");
        aviso.className = "tile-aviso";
        const strong = document.createElement("strong");
        strong.textContent = "Transmissão pausada";
        const span = document.createElement("span");
        span.textContent = "A janela compartilhada foi minimizada";
        aviso.append(strong, span);
        el.append(aviso);
      } else if (!pausado && aviso) {
        aviso.remove();
      }
    }, 1500);
  }

  async function startCam() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stopMic();
      local.cam = stream;
      myKinds.add("cam");
      announcePublish();
      toast("Câmera ligada");
    } catch {
      toast("Não foi possível acessar a câmera", true);
    }
  }

  function stopCam() {
    if (!local.cam) return;
    for (const t of local.cam.getTracks()) t.stop();
    local.cam = null;
    myKinds.delete("cam");
    announcePublish();
  }

  async function startMic() {
    if (local.cam) {
      const t = local.cam.getAudioTracks()[0];
      if (t) t.enabled = true;
      updateControls();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      local.mic = stream;
      myKinds.add("mic");
      announcePublish();
      toast("Microfone ligado");
    } catch {
      toast("Não foi possível acessar o microfone", true);
    }
  }

  function stopMic() {
    if (local.cam) {
      const t = local.cam.getAudioTracks()[0];
      if (t) t.enabled = false;
      updateControls();
      return;
    }
    if (!local.mic) return;
    for (const t of local.mic.getTracks()) t.stop();
    local.mic = null;
    myKinds.delete("mic");
    announcePublish();
  }

  els.screenBtn.addEventListener("click", () => getMedia("screen", !myKinds.has("screen")));
  els.camBtn.addEventListener("click", () => getMedia("cam", !myKinds.has("cam")));
  els.micBtn.addEventListener("click", () => getMedia("mic", !micActive()));

  els.statsBtn.addEventListener("click", () => {
    statsOn = !statsOn;
    els.statsBtn.classList.toggle("on", statsOn);
    if (statsOn) {
      if (pubs.size === 0 && subsOfMe.size === 0) {
        toast("Os medidores aparecem quando houver transmissão na sala");
      }
      updateStats();
      statsTimer = setInterval(updateStats, 2000);
    } else {
      clearInterval(statsTimer);
      statsTimer = null;
      document.querySelectorAll(".tile-stats").forEach((chip) => chip.classList.add("hidden"));
    }
  });

  async function updateStats() {
    const now = performance.now();

    for (const [pid, rec] of pubs) {
      let text = "medindo…";
      try {
        const stats = await rec.pc.getStats();
        let bytes = 0;
        let lost = 0;
        let recv = 0;
        let rtt = null;
        let w = null;
        let h = null;
        stats.forEach((s) => {
          if (s.type === "inbound-rtp" && (s.kind === "video" || s.kind === "audio")) {
            bytes += s.bytesReceived || 0;
            lost += s.packetsLost || 0;
            recv += s.packetsReceived || 0;
            if (s.kind === "video" && s.frameWidth) {
              w = s.frameWidth;
              h = s.frameHeight;
            }
          }
          if (
            s.type === "candidate-pair" &&
            (s.nominated || s.state === "succeeded") &&
            s.currentRoundTripTime != null
          ) {
            rtt = s.currentRoundTripTime;
          }
        });
        const last = rec.lastStats || { bytes: 0, at: now };
        let mbps = null;
        if (last.bytes > 0 && bytes > last.bytes) {
          mbps = ((bytes - last.bytes) * 8) / ((now - last.at) / 1000) / 1e6;
        }
        rec.lastStats = { bytes, at: now };
        const parts = [];
        if (mbps != null) parts.push(`↓ ${mbps.toFixed(1)} Mbps`);
        if (recv + lost > 0) parts.push(`${((lost / (recv + lost)) * 100).toFixed(1)}% perdidos`);
        if (rtt != null) parts.push(`${Math.round(rtt * 1000)} ms`);
        if (w) parts.push(`${w}×${h}`);
        if (parts.length) text = parts.join(" · ");
      } catch {}
      const cor = rtt != null ? (rtt < 0.08 ? "ok" : rtt < 0.2 ? "warn" : "bad") : "";
      for (const [key, el] of tiles) {
        if (key.startsWith(`${pid}:`)) {
          const chip = el.querySelector(".tile-stats");
          if (chip) {
            chip.textContent = text;
            chip.className = `tile-stats${statsOn ? "" : " hidden"}${cor ? " " + cor : ""}`;
          }
        }
      }
    }

    if (subsOfMe.size > 0) {
      let totalBps = 0;
      let rttSum = 0;
      let rttN = 0;
      let w = null;
      let h = null;
      let active = 0;
      for (const mine of subsOfMe.values()) {
        if (mine.pc.connectionState === "closed") continue;
        active++;
        try {
          const stats = await mine.pc.getStats();
          let sent = 0;
          let r = null;
          stats.forEach((s) => {
            if (s.type === "outbound-rtp" && (s.kind === "video" || s.kind === "audio")) {
              sent += s.bytesSent || 0;
              if (s.kind === "video" && s.frameWidth) {
                w = s.frameWidth;
                h = s.frameHeight;
              }
            }
            if (
              s.type === "candidate-pair" &&
              (s.nominated || s.state === "succeeded") &&
              s.currentRoundTripTime != null
            ) {
              r = s.currentRoundTripTime;
            }
          });
          const last = mine.lastStats || { bytes: 0, at: now };
          if (last.bytes > 0 && sent > last.bytes) {
            totalBps += ((sent - last.bytes) * 8) / ((now - last.at) / 1000);
          }
          mine.lastStats = { bytes: sent, at: now };
          if (r != null) {
            rttSum += r;
            rttN++;
          }
        } catch {}
      }
      const parts = [];
      if (active > 0) {
        parts.push(`↑ ${(totalBps / 1e6).toFixed(1)} Mbps · ${active} ${active === 1 ? "espectador" : "espectadores"}`);
      }
      if (rttN > 0) parts.push(`${Math.round((rttSum / rttN) * 1000)} ms`);
      if (w) parts.push(`${w}×${h}`);
      for (const mine of subsOfMe.values()) {
        if (mine.nota) {
          parts.push(mine.nota);
          break;
        }
      }
      const text = active > 0 ? parts.join(" · ") : "medindo…";
      for (const [key, el] of tiles) {
        if (key.startsWith("me:")) {
          const chip = el.querySelector(".tile-stats");
          if (chip) {
            chip.textContent = text;
            chip.classList.toggle("hidden", !statsOn);
          }
        }
      }
    }
  }

  els.copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      toast("Link copiado!");
    } catch {
      toast("Não deu pra copiar o link", true);
    }
  });

  els.leaveBtn.addEventListener("click", () => {
    manualLeave = true;
    try { ws.close(); } catch {}
    location.href = "/";
  });

  window.addEventListener("beforeunload", () => {
    manualLeave = true;
    try { ws.close(); } catch {}
  });

  els.tabPeople.addEventListener("click", () => switchTab(true));
  els.tabChat.addEventListener("click", () => switchTab(false));

  function switchTab(people) {
    els.tabPeople.classList.toggle("active", people);
    els.tabChat.classList.toggle("active", !people);
    els.peoplePanel.classList.toggle("hidden", !people);
    els.chatPanel.classList.toggle("hidden", people);
    if (!people) els.chatInput.focus();
  }

  els.chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = els.chatInput.value.trim();
    if (!text) return;
    wsSend({ type: "chat", text });
    els.chatInput.value = "";
  });

  function appendChat(mine, name, text) {
    const wrap = document.createElement("div");
    wrap.className = `msg${mine ? " mine" : ""}`;
    const head = document.createElement("div");
    head.className = "m-head";
    head.textContent = name;
    const body = document.createElement("div");
    body.className = "m-body";
    body.textContent = text;
    wrap.append(head, body);
    pushMsg(wrap);
  }

  function sysChat(text) {
    const wrap = document.createElement("div");
    wrap.className = "msg sys";
    wrap.textContent = text;
    pushMsg(wrap);
  }

  function pushMsg(el) {
    els.chatMessages.append(el);
    const nearBottom =
      els.chatMessages.scrollHeight - els.chatMessages.scrollTop - els.chatMessages.clientHeight < 120;
    if (nearBottom) els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  }

  function toast(text, err) {
    const el = document.createElement("div");
    el.className = `toast${err ? " err" : ""}`;
    el.textContent = text;
    els.toasts.append(el);
    setTimeout(() => el.remove(), 3200);
  }

  function beep(f1 = 880, f2 = 1320) {
    try {
      audioCtx ??= new AudioContext();
      audioCtx.resume?.();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.setValueAtTime(f1, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(f2, audioCtx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.25);
    } catch {}
  }

  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, select") || e.target.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "s") {
      e.preventDefault();
      getMedia("screen", !myKinds.has("screen"));
    } else if (k === "c") {
      e.preventDefault();
      getMedia("cam", !myKinds.has("cam"));
    } else if (k === "m") {
      e.preventDefault();
      getMedia("mic", !micActive());
    } else if (e.key === "Escape") {
      document.querySelectorAll(".tile.foco").forEach((t) => t.classList.remove("foco"));
    }
  });

  els.tiles.addEventListener("click", (e) => {
    const tile = e.target.closest(".tile");
    if (!tile) return;
    if (e.target.closest(".tile-controls")) return;
    if (e.target.closest("button, input, select")) return;
    tile.classList.toggle("foco");
    if (tile.classList.contains("foco")) {
      tile.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });
})();
