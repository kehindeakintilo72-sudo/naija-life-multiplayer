/* Naija Life 3D city client. Loaded by public/index.html after the main app script. */
(() => {
  const keys = new Set();
  const touches = new Set();
  const remotes = new Map();
  let renderer, scene, camera, avatar, yaw = 0, lastSend = 0, started = false;

  function makeAvatar(color) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.38, 0.72, 4, 8),
      new THREE.MeshStandardMaterial({ color })
    );
    body.position.y = 0.82;
    group.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.23, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xf0c49c })
    );
    head.position.y = 1.48;
    group.add(head);
    return group;
  }

  function building(x, z, w, d, h, color) {
    const b = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.9 })
    );
    b.position.set(x, h / 2, z);
    b.castShadow = true;
    scene.add(b);
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.2, 0.18, d + 0.2),
      new THREE.MeshStandardMaterial({ color: 0x4b4b4b })
    );
    roof.position.set(x, h + 0.05, z);
    scene.add(roof);
    for (let y = 1.5; y < h - 0.5; y += 1.5) {
      for (let xx = -w / 2 + 0.8; xx < w / 2 - 0.4; xx += 1.5) {
        const win = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.55, 0.04),
          new THREE.MeshStandardMaterial({ color: 0x91d9e8 })
        );
        win.position.set(x + xx, y, z - d / 2 - 0.03);
        scene.add(win);
      }
    }
  }

  function tree(x, z) {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.2, 1.5, 7),
      new THREE.MeshStandardMaterial({ color: 0x795333 })
    );
    trunk.position.set(x, 0.75, z);
    scene.add(trunk);
    const leaves = new THREE.Mesh(
      new THREE.SphereGeometry(0.85, 8, 7),
      new THREE.MeshStandardMaterial({ color: 0x25834a })
    );
    leaves.position.set(x, 1.9, z);
    scene.add(leaves);
  }

  function buildCity() {
    scene.background = new THREE.Color(0x9dd5e6);
    scene.fog = new THREE.Fog(0x9dd5e6, 60, 145);
    scene.add(new THREE.HemisphereLight(0xeaf8ff, 0x63714e, 2));
    const sun = new THREE.DirectionalLight(0xfff0d0, 2);
    sun.position.set(-25, 40, 25);
    scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(220, 220),
      new THREE.MeshStandardMaterial({ color: 0x7dbb71 })
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x343b40 });
    [[220, 13], [13, 220]].forEach(([w, d]) => {
      const road = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), roadMaterial);
      road.position.y = 0.04;
      scene.add(road);
    });

    const yellow = new THREE.MeshStandardMaterial({ color: 0xf5d85c });
    for (let p = -100; p < 105; p += 8) {
      const line1 = new THREE.Mesh(new THREE.BoxGeometry(3, 0.025, 0.16), yellow);
      line1.position.set(p, 0.09, 0);
      scene.add(line1);
      const line2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, 3), yellow);
      line2.position.set(0, 0.09, p);
      scene.add(line2);
    }

    const colors = [0xf0b56d, 0xe8d8b8, 0xd86f51, 0xd8e2e5, 0xc4a0dc, 0xf0d56d, 0x8dc9b3];
    for (let x = -44; x <= 44; x += 22) {
      for (let z = -44; z <= 44; z += 22) {
        if (Math.abs(x) < 12 || Math.abs(z) < 12) continue;
        building(x + (x < 0 ? -3 : 3), z + (z < 0 ? -3 : 3), 9, 8,
          7 + Math.abs(x * 3 + z * 2) % 18,
          colors[Math.abs(x + z) % colors.length]);
        tree(x + (x < 0 ? 8 : -8), z + 9);
      }
    }

    // Bright market stalls give the central crossroads a Nigerian market feel.
    for (let i = 0; i < 6; i++) {
      const stall = new THREE.Mesh(
        new THREE.BoxGeometry(2.7, 1.6, 2.2),
        new THREE.MeshStandardMaterial({ color: [0xd94b3d, 0xe8b938, 0x27885b][i % 3] })
      );
      stall.position.set(9 + (i % 3) * 3, 0.8, 10 + Math.floor(i / 3) * 3);
      scene.add(stall);
      const canopy = new THREE.Mesh(
        new THREE.BoxGeometry(3, 0.18, 2.5),
        new THREE.MeshStandardMaterial({ color: [0xf2cf48, 0x2c9a62, 0xd94b3d][i % 3] })
      );
      canopy.position.set(stall.position.x, 1.7, stall.position.z);
      scene.add(canopy);
    }
  }

  function sendPosition() {
    if (avatar && typeof socket !== "undefined" && socket && socket.connected) {
      socket.emit("world:position", { x: avatar.position.x, z: avatar.position.z, yaw });
    }
  }

  function addRemote(p) {
    if (!p || !Number.isFinite(Number(p.id)) ||
        (typeof currentUser !== "undefined" && Number(p.id) === Number(currentUser && currentUser.id))) return;
    const id = Number(p.id);
    let group = remotes.get(id);
    if (!group) {
      group = makeAvatar(0x2b72c7);
      scene.add(group);
      remotes.set(id, group);
    }
    group.position.set(Number(p.x) || 0, 0, Number(p.z) || 0);
    group.rotation.y = Number(p.yaw) || 0;
    const count = document.getElementById("cityPlayerCount");
    if (count) count.textContent = String(remotes.size + 1);
  }

  function animate() {
    requestAnimationFrame(animate);
    if (!renderer || !scene || !camera) return;

    const game = document.getElementById("game");
    if (avatar && game && !game.classList.contains("hidden")) {
      const forward = keys.has("w") || keys.has("arrowup") || touches.has("forward");
      const back = keys.has("s") || keys.has("arrowdown") || touches.has("back");
      const left = keys.has("a") || keys.has("arrowleft") || touches.has("left");
      const right = keys.has("d") || keys.has("arrowright") || touches.has("right");
      let dx = (right ? 1 : 0) - (left ? 1 : 0);
      let dz = (back ? 1 : 0) - (forward ? 1 : 0);
      if (dx || dz) {
        const length = Math.hypot(dx, dz);
        dx /= length; dz /= length;
        avatar.position.x = Math.max(-98, Math.min(98, avatar.position.x + dx * 0.17));
        avatar.position.z = Math.max(-98, Math.min(98, avatar.position.z + dz * 0.17));
        yaw = Math.atan2(dx, dz);
        avatar.rotation.y = yaw;
        if (performance.now() - lastSend > 100) {
          lastSend = performance.now();
          sendPosition();
        }
      }
      const follow = new THREE.Vector3(
        avatar.position.x + Math.sin(yaw) * 8,
        5.2,
        avatar.position.z + Math.cos(yaw) * 8
      );
      camera.position.lerp(follow, 0.12);
      camera.lookAt(avatar.position.x, 1.1, avatar.position.z);
    }
    renderer.render(scene, camera);
  }

  window.startCity = function () {
    if (!window.THREE) {
      const status = document.getElementById("cityStatus");
      if (status) status.textContent = "3D library unavailable";
      return;
    }
    if (started) return;
    const canvas = document.getElementById("cityCanvas");
    if (!canvas) return;
    started = true;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(62, 1, 0.1, 250);
    buildCity();
    avatar = makeAvatar(0x087443);
    scene.add(avatar);
    avatar.position.set(0, 0, 8);

    const resize = () => {
      const shell = document.getElementById("cityShell");
      if (!shell) return;
      const w = shell.clientWidth, h = shell.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", resize);
    resize();

    window.addEventListener("keydown", e => {
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
        keys.add(k);
        if (k.startsWith("arrow")) e.preventDefault();
      }
    });
    window.addEventListener("keyup", e => keys.delete(e.key.toLowerCase()));

    document.querySelectorAll("#touchPad [data-move]").forEach(button => {
      const key = button.dataset.move;
      button.addEventListener("pointerdown", e => { e.preventDefault(); touches.add(key); });
      ["pointerup", "pointercancel", "pointerleave"].forEach(type =>
        button.addEventListener(type, e => { e.preventDefault(); touches.delete(key); }));
    });

    const reset = document.getElementById("resetCity");
    if (reset) reset.addEventListener("click", () => {
      avatar.position.set(0, 0, 8); yaw = 0; sendPosition();
    });

    if (typeof socket !== "undefined" && socket) {
      socket.on("connect", () => {
        const status = document.getElementById("cityStatus");
        if (status) status.textContent = "Multiplayer connected";
        sendPosition();
      });
      socket.on("disconnect", () => {
        const status = document.getElementById("cityStatus");
        if (status) status.textContent = "Reconnecting…";
      });
      socket.on("world:players", players => (players || []).forEach(addRemote));
      socket.on("world:player-position", addRemote);
      socket.on("world:player-left", id => {
        const group = remotes.get(Number(id));
        if (group) scene.remove(group);
        remotes.delete(Number(id));
        const count = document.getElementById("cityPlayerCount");
        if (count) count.textContent = String(remotes.size + 1);
      });
    }
    animate();
  };
})();
