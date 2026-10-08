/**
 * KOBurst - Smash-style knockout burst, shared by the modes that eliminate players.
 *
 * One call = a bright core flash, a colored shockwave ring, ~100 additive sparks with
 * gravity and fading tails, and a handful of star streaks shooting outward.
 * Positions are in world space; the burst faces the camera it is given.
 *
 *   const koBursts = new KOBurstManager(scene, camera, THREE);
 *   koBursts.spawn(position, 0xff3366);      // on a KO / ring-out
 *   koBursts.update(delta);                  // every frame
 */

export class KOBurstManager {
    constructor(scene, camera, THREE) {
        this.scene = scene;
        this.camera = camera;
        this.THREE = THREE;
        this.bursts = [];
        this._tmp = new THREE.Vector3();
        this.sparkTexture = this._makeSparkTexture();
    }

    /** Soft round dot so sparks glow instead of rendering as squares */
    _makeSparkTexture() {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.35, 'rgba(255,255,255,0.8)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
        const texture = new this.THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        return texture;
    }

    /**
     * @param {THREE.Vector3|{x,y,z}} position  World position of the KO
     * @param {number|string} color            Player color
     * @param {object} [options]
     * @param {number} [options.scale=1]       Overall size multiplier
     * @param {number} [options.sparks=110]
     */
    spawn(position, color, options = {}) {
        const THREE = this.THREE;
        const scale = options.scale ?? 1;
        const sparkCount = options.sparks ?? 110;
        const base = new THREE.Color(color);
        const white = new THREE.Color(0xffffff);
        const hot = base.clone().lerp(white, 0.55);
        const group = new THREE.Group();
        group.position.set(position.x, position.y, position.z);
        this.scene.add(group);

        // Core flash: a bright sprite that pops and fades fast
        const core = new THREE.Sprite(new THREE.SpriteMaterial({
            color: white, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false
        }));
        core.scale.setScalar(0.5 * scale);
        group.add(core);

        // Shockwave ring (faces the camera)
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.8, 1, 48),
            new THREE.MeshBasicMaterial({ color: hot, transparent: true, opacity: 0.95, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        ring.scale.setScalar(0.2 * scale);
        group.add(ring);

        // Second, slower ring in the player's color
        const ring2 = new THREE.Mesh(
            new THREE.RingGeometry(0.9, 1, 48),
            new THREE.MeshBasicMaterial({ color: base, transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        ring2.scale.setScalar(0.1 * scale);
        group.add(ring2);

        // Sparks: points with per-particle velocity, gravity and a short tail (trail copy)
        const positions = new Float32Array(sparkCount * 3);
        const colors = new Float32Array(sparkCount * 3);
        const velocities = new Float32Array(sparkCount * 3);
        for (let i = 0; i < sparkCount; i++) {
            const c = base.clone().lerp(white, Math.random() * 0.7);
            colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
            const angle = Math.random() * Math.PI * 2;
            const elev = (Math.random() - 0.3) * Math.PI;       // mostly sideways/up
            const speed = (6 + Math.random() * 16) * scale;
            velocities[i * 3] = Math.cos(angle) * Math.cos(elev) * speed;
            velocities[i * 3 + 1] = Math.sin(elev) * speed + 4 * scale;
            velocities[i * 3 + 2] = Math.sin(angle) * Math.cos(elev) * speed * 0.5;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const sparks = new THREE.Points(geometry, new THREE.PointsMaterial({
            size: 0.55 * scale, map: this.sparkTexture, vertexColors: true, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
        }));
        group.add(sparks);
        const tail = new THREE.Points(geometry.clone(), new THREE.PointsMaterial({
            size: 0.3 * scale, map: this.sparkTexture, vertexColors: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false
        }));
        group.add(tail);

        // Star streaks: thin planes radiating from the center
        const streaks = [];
        for (let i = 0; i < 10; i++) {
            const streak = new THREE.Mesh(
                new THREE.PlaneGeometry(1, 0.1),
                new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? white : hot, transparent: true, opacity: 1, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
            );
            streak.userData.angle = (i / 10) * Math.PI * 2 + Math.random() * 0.3;
            streak.userData.len = (1.2 + Math.random() * 1.8) * scale;
            group.add(streak);
            streaks.push(streak);
        }

        this.bursts.push({ group, core, ring, ring2, sparks, tail, velocities, streaks, t: 0, duration: 1.1, scale });
    }

    update(delta) {
        if (!this.bursts.length) return;
        const THREE = this.THREE;
        for (let b = this.bursts.length - 1; b >= 0; b--) {
            const burst = this.bursts[b];
            burst.t += delta;
            const k = Math.min(1, burst.t / burst.duration);
            const ease = 1 - Math.pow(1 - k, 3);

            // Face the camera
            if (this.camera) {
                burst.group.quaternion.copy(this.camera.quaternion);
            }

            // Core: pop to 4 units then vanish in the first 25 %
            const coreK = Math.min(1, k / 0.25);
            burst.core.scale.setScalar((0.5 + 3.5 * coreK) * burst.scale);
            burst.core.material.opacity = 1 - coreK;

            // Rings expand (to ~3.5 units) and fade
            burst.ring.scale.setScalar((0.2 + 3.3 * ease) * burst.scale);
            burst.ring.material.opacity = 0.95 * (1 - k);
            burst.ring2.scale.setScalar((0.1 + 2.2 * Math.min(1, k / 0.7)) * burst.scale);
            burst.ring2.material.opacity = 0.8 * (1 - Math.min(1, k / 0.7));

            // Sparks: integrate in the group's local space (tail = previous frame)
            const pos = burst.sparks.geometry.attributes.position;
            const tailPos = burst.tail.geometry.attributes.position;
            const vel = burst.velocities;
            for (let i = 0; i < pos.count; i++) {
                tailPos.array[i * 3] = pos.array[i * 3];
                tailPos.array[i * 3 + 1] = pos.array[i * 3 + 1];
                tailPos.array[i * 3 + 2] = pos.array[i * 3 + 2];
                vel[i * 3 + 1] -= 22 * delta;              // gravity
                vel[i * 3] *= 0.985; vel[i * 3 + 2] *= 0.985;
                pos.array[i * 3] += vel[i * 3] * delta;
                pos.array[i * 3 + 1] += vel[i * 3 + 1] * delta;
                pos.array[i * 3 + 2] += vel[i * 3 + 2] * delta;
            }
            pos.needsUpdate = true;
            tailPos.needsUpdate = true;
            burst.sparks.material.opacity = 1 - k * k;
            burst.tail.material.opacity = 0.5 * (1 - k);

            // Streaks: shoot out and thin away
            for (const streak of burst.streaks) {
                const len = streak.userData.len * (0.3 + ease);
                const dist = len * 0.5 + ease * 1.4 * burst.scale;
                streak.scale.set(len, 1 - k, 1);
                streak.rotation.z = streak.userData.angle;
                streak.position.set(Math.cos(streak.userData.angle) * dist, Math.sin(streak.userData.angle) * dist, 0);
                streak.material.opacity = 1 - k;
            }

            if (k >= 1) {
                this.scene.remove(burst.group);
                burst.group.traverse((obj) => {
                    if (obj.geometry) obj.geometry.dispose();
                    if (obj.material) obj.material.dispose();
                });
                this.bursts.splice(b, 1);
            }
        }
    }

    dispose() {
        for (const burst of this.bursts) {
            this.scene.remove(burst.group);
            burst.group.traverse((obj) => {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) obj.material.dispose();
            });
        }
        this.bursts = [];
    }
}

/**
 * Screen-level punch for a KO: a colored flash and a shake of the given container.
 * Pure DOM, so any mode can use it next to the 3D burst.
 */
export function koScreenPunch(container, color = '#ffffff', { shake = 14, duration = 450 } = {}) {
    const flash = document.createElement('div');
    const hex = typeof color === 'number' ? `#${color.toString(16).padStart(6, '0')}` : color;
    flash.style.cssText = `position:fixed;inset:0;background:${hex};opacity:0.4;pointer-events:none;z-index:9998;mix-blend-mode:screen;transition:opacity 0.3s ease-out;`;
    document.body.appendChild(flash);
    requestAnimationFrame(() => { flash.style.opacity = '0'; });
    setTimeout(() => flash.remove(), 400);

    if (!container) return;
    const start = performance.now();
    const original = container.style.transform;
    const step = () => {
        const p = (performance.now() - start) / duration;
        if (p >= 1) { container.style.transform = original || ''; return; }
        const a = shake * (1 - p);
        container.style.transform = `translate(${(Math.random() - 0.5) * a}px, ${(Math.random() - 0.5) * a}px)`;
        requestAnimationFrame(step);
    };
    step();
}
