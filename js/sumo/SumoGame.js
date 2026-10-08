/**
 * SUMO DE PELUCHES - Sumo Game Mode (host screen)
 * A shrinking round dohyo, charged shoves, ring-outs. Last one standing wins.
 * The server (server/sumoState.js) is authoritative: this page only renders 'sumo-state'.
 */

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { SERVER_URL } from '../config.js';
import { AnimationController } from '../animation/AnimationController.js';
import SumoPlayerController from './SumoPlayerController.js';
import TournamentManager from '../tournament/TournamentManager.js';
import { loadClips, loadModel } from '../assets/AssetLoader.js';
import { KOBurstManager, koScreenPunch } from '../effects/KOBurst.js';

// =================================
// Configuration
// =================================

const SUMO_CONFIG = {
    RING_RADIUS: 8,            // Server start radius (ring resets to this on every round)
    RING_LERP: 8,              // Ring radius smoothing (1/s)
    CAMERA_ANGLE: Math.PI * 0.26, // ~47° elevation: lower than tag so the characters read as figures, not dots
    CAMERA_BASE: 7.5,          // Camera height = BASE + PER_RADIUS * ringRadius
    CAMERA_PER_RADIUS: 1.55,
    CAMERA_LERP: 2.5,          // Camera zoom smoothing (1/s)
    HIDE_BELOW_Y: -6,          // Falling players disappear below this
    FALL_GRAVITY: 22,          // Local fall when the server loop already stopped
    MATCH_DURATION: 60,        // Seconds shown on the timer before the first state
    URGENT_SECONDS: 10,        // Timer turns red below this
    PLAYER_COLORS: ['#ff3366', '#00ffcc', '#ffcc00', '#9966ff', '#ff6600', '#00ccff', '#ccff00', '#ff00ff']
};

// Character models
const CHARACTER_MODELS = {
    edgar: { name: 'Edgar', file: 'Edgar_Model.fbx' },
    isabella: { name: 'Isabella', file: 'Isabella_Model.fbx' },
    jesus: { name: 'Jesus', file: 'Jesus_Model.fbx' },
    lia: { name: 'Lia', file: 'Lia_Model.fbx' },
    hector: { name: 'Hector', file: 'Hector.fbx' },
    katy: { name: 'Katy', file: 'Katy.fbx' },
    mariana: { name: 'Mariana', file: 'Mariana.fbx' },
    sol: { name: 'Sol', file: 'Sol.fbx' },
    yadira: { name: 'Yadira', file: 'Yadira.fbx' },
    angel: { name: 'Angel', file: 'Angel.fbx' },
    lidia: { name: 'Lidia', file: 'Lidia.fbx' },
    fabian: { name: 'Fabian', file: 'Fabian.fbx' },
    marile: { name: 'Marile', file: 'Marile.fbx' },
    gabriel: { name: 'Gabriel', file: 'Gabriel.fbx' },
    baby: { name: 'Bebé', file: 'bebe.fbx' } // Baby shower only (see characterIdFor)
};

// Loaded as small animation-only JSON clips by AssetLoader
const ANIMATION_FILES = {
    walk: 'Meshy_AI_Animation_Walking_withSkin.fbx',
    run: 'Meshy_AI_Animation_Running_withSkin.fbx',
    idle: 'Meshy_AI_Animation_Boxing_Guard_Prep_Straight_Punch_withSkin.fbx',
    punch: 'Meshy_AI_Animation_Left_Uppercut_from_Guard_withSkin.fbx',
    hit: 'Meshy_AI_Animation_Hit_Reaction_1_withSkin.fbx',
    fall: 'Meshy_AI_Animation_Shot_and_Slow_Fall_Backward_withSkin.fbx',
    win: 'Meshy_AI_Animation_Hip_Hop_Dance_withSkin.fbx'
};

// Baby shower only: AnimationController maps walk/run to crawling in that theme
const BABY_ANIMATION_FILES = {
    crawling: 'Crawling.fbx'
};

const BASE_EMISSIVE_INTENSITY = 0.2;
const HIT_FLASH_DURATION = 0.4;     // seconds of emissive flash after being shoved
const BURST_DURATION = 0.6;         // seconds the impact rings last
const FLOAT_TEXT_DURATION = 1300;   // ms the "¡FUERA!" shout stays over the player
const NAME_HOT_DURATION = 1200;     // ms the attacker's name stays highlighted
const SHRINK_PULSE_DURATION = 0.9;  // seconds of extra rim pulse after 'ring-shrink'
const SUMO_FLASH_DURATION = 900;    // ms "¡SUMO!" stays on screen

const RIM_COLOR = 0xffcc00;
const RIM_COLOR_DANGER = 0xff3366;
const CHARGE_COLOR = 0xffcc00;

// Ordinal suffix for placements (1 -> "1°")
function ordinal(n) {
    return `${n}°`;
}

// =================================
// Player entity (model + effects)
// =================================

class SumoPlayerEntity {
    constructor(id, number, color, baseModel, baseAnimations) {
        this.id = id;
        this.number = number;
        this.color = color;
        this.name = `Player ${number}`;

        // Root group in world units: carries position/rotation and the effects,
        // while the FBX model inside it is scaled to 0.01
        this.root = new THREE.Group();

        this.model = SkeletonUtils.clone(baseModel);
        this.model.scale.set(0.01, 0.01, 0.01);
        this.root.add(this.model);

        this.tintMaterials = [];
        this.applyColorTint(color);
        this.baseEmissive = new THREE.Color(color);
        this.flashColor = new THREE.Color(0xffffff);

        // Labels stay on the model (positions are in model units: 250 * 0.01 = 2.5 m)
        this.nameLabel = this.createNameLabel(color);
        this.model.add(this.nameLabel);

        // Charge glow on the floor (world units, on the root group)
        this.chargeRing = this.createChargeRing();
        this.chargeRing.visible = false;
        this.root.add(this.chargeRing);

        // Short-lived effects
        this.bursts = [];        // { mesh, t, growth }
        this.floatLabels = [];   // CSS2D shouts over the player ("¡FUERA!")
        this.flashTime = 0;
        this.hotTimer = null;

        // Animation / state tracking
        this.forcedAnim = null;      // Final pose (idle / win)
        this.fallPlayed = false;
        this.wasShoving = false;
        this.wasStunned = false;
        this.lastSquash = -1;
        this.hidden = false;
        this.localFall = false;      // Server loop stopped: keep dropping locally
        this.localVelocityY = 0;

        this.animController = new AnimationController(this.model, baseAnimations);
        this.controller = new SumoPlayerController(id, number, color);
    }

    createNameLabel(color) {
        const div = document.createElement('div');
        div.className = 'arena-player-name-label sumo-name-label';
        div.textContent = this.name;
        div.style.color = color;
        const label = new CSS2DObject(div);
        label.position.set(0, 250, 0);
        return label;
    }

    /**
     * Glow ring under the player while charging a shove (scaled by chargeRatio in tick)
     */
    createChargeRing() {
        const geometry = new THREE.RingGeometry(0.55, 0.8, 40);
        const material = new THREE.MeshBasicMaterial({
            color: CHARGE_COLOR,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0.08;
        return mesh;
    }

    applyColorTint(color) {
        const tintColor = new THREE.Color(color);
        this.model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                // Materials can be arrays on some FBX meshes
                const cloneMat = (m) => {
                    const mat = m.clone();
                    if (mat.emissive) {
                        mat.emissive = tintColor.clone();
                        mat.emissiveIntensity = BASE_EMISSIVE_INTENSITY;
                    }
                    this.tintMaterials.push(mat);
                    return mat;
                };
                child.material = Array.isArray(child.material)
                    ? child.material.map(cloneMat)
                    : cloneMat(child.material);
            }
        });
    }

    setName(name) {
        this.name = name;
        if (this.nameLabel && this.nameLabel.element) {
            this.nameLabel.element.textContent = name;
        }
    }

    /**
     * Short shout over the player ("¡FUERA!"), removed after FLOAT_TEXT_DURATION
     */
    showFloatText(text, cssColor, extraClass) {
        const div = document.createElement('div');
        div.className = `sumo-float-text${extraClass ? ` ${extraClass}` : ''}`;
        div.textContent = text;
        div.style.color = cssColor;
        const label = new CSS2DObject(div);
        label.position.set(0, 400, 0);
        this.model.add(label);
        this.floatLabels.push(label);
        setTimeout(() => this.removeFloatLabel(label), FLOAT_TEXT_DURATION);
    }

    removeFloatLabel(label) {
        const index = this.floatLabels.indexOf(label);
        if (index !== -1) this.floatLabels.splice(index, 1);
        this.model.remove(label);
        label.element?.parentNode?.removeChild(label.element);
    }

    /**
     * Highlight the name label briefly (the attacker of a ring-out)
     */
    highlightName() {
        const el = this.nameLabel?.element;
        if (!el) return;
        el.classList.add('sumo-name-hot');
        if (this.hotTimer) clearTimeout(this.hotTimer);
        this.hotTimer = setTimeout(() => {
            el.classList.remove('sumo-name-hot');
            this.hotTimer = null;
        }, NAME_HOT_DURATION);
    }

    /**
     * Expanding/fading rings at the player's feet (shove impact)
     */
    playBurst(color) {
        const makeRing = (inner, outer, ringColor, y) => {
            const geometry = new THREE.RingGeometry(inner, outer, 40);
            const material = new THREE.MeshBasicMaterial({
                color: ringColor,
                transparent: true,
                opacity: 1,
                side: THREE.DoubleSide,
                depthWrite: false
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.rotation.x = -Math.PI / 2;
            mesh.position.y = y;
            return mesh;
        };
        const ground = makeRing(0.4, 0.7, color, 0.09);
        const halo = makeRing(0.5, 0.62, 0xffffff, 1.1);
        this.root.add(ground);
        this.root.add(halo);
        this.bursts.push({ mesh: ground, t: 0, growth: 3.5 });
        this.bursts.push({ mesh: halo, t: 0, growth: 2 });
    }

    /** The attacker lunges: punch clip + whoosh ring */
    playShove() {
        if (this.controller.falling || this.forcedAnim) return;
        this.animController.play('punch');
    }

    /** The target gets launched: hit clip + impact rings + flash */
    playHit() {
        this.playBurst(this.baseEmissive.getHex());
        this.flashTime = HIT_FLASH_DURATION;
        if (this.controller.falling || this.forcedAnim) return;
        this.animController.play('hit');
    }

    /**
     * Freeze at the end of the match (optionally with a celebration animation).
     * Players still dropping into the void keep falling locally.
     */
    setFinalPose(animName) {
        if (this.controller.falling) {
            this.localFall = true;
            this.localVelocityY = this.controller.velocity.y || 0;
            return;
        }
        this.controller.velocity.set(0, 0, 0);
        this.controller.isCharging = false;
        this.controller.isShoving = false;
        this.forcedAnim = animName || 'idle';
        this.chargeRing.visible = false;
    }

    setHidden(hidden) {
        if (hidden === this.hidden) return;
        this.hidden = hidden;
        this.root.visible = !hidden;
        this.nameLabel.visible = !hidden;
        if (this.nameLabel.element) this.nameLabel.element.style.display = hidden ? 'none' : '';
    }

    /**
     * Apply a server snapshot (called from the socket handler, no animation work here)
     */
    applyState(state) {
        if (!state) return;
        const c = this.controller;
        const wasFalling = c.falling;
        c.applyServerState(state);
        this.localFall = false;

        // Stunned: short tint flash when it starts
        if (c.stunned && !this.wasStunned) this.flashTime = Math.max(this.flashTime, HIT_FLASH_DURATION);
        this.wasStunned = c.stunned;

        // Dash start: punch clip even if the dash does not land
        if (c.isShoving && !this.wasShoving) this.playShove();
        this.wasShoving = c.isShoving;

        // Eliminated: play the fall once, then keep dropping with position.y
        if (c.falling && !wasFalling && !this.fallPlayed) {
            this.fallPlayed = true;
            this.chargeRing.visible = false;
            this.animController.play('fall');
        }

        this.chargeRing.visible = c.isCharging && c.alive;
    }

    updateEffects(delta) {
        for (let i = this.bursts.length - 1; i >= 0; i--) {
            const burst = this.bursts[i];
            burst.t += delta;
            const k = Math.min(1, burst.t / BURST_DURATION);
            const s = 1 + k * burst.growth;
            burst.mesh.scale.set(s, s, s);
            burst.mesh.material.opacity = 1 - k;
            if (k >= 1) {
                this.root.remove(burst.mesh);
                burst.mesh.geometry.dispose();
                burst.mesh.material.dispose();
                this.bursts.splice(i, 1);
            }
        }

        // Emissive flash (hit / stunned)
        if (this.flashTime > 0) {
            this.flashTime = Math.max(0, this.flashTime - delta);
            const k = this.flashTime / HIT_FLASH_DURATION;
            const intensity = BASE_EMISSIVE_INTENSITY + k * 2.2;
            for (let i = 0; i < this.tintMaterials.length; i++) {
                const mat = this.tintMaterials[i];
                if (!mat.emissive) continue;
                mat.emissive.copy(this.baseEmissive).lerp(this.flashColor, k * 0.6);
                mat.emissiveIntensity = intensity;
            }
            if (this.flashTime === 0) {
                for (let i = 0; i < this.tintMaterials.length; i++) {
                    const mat = this.tintMaterials[i];
                    if (!mat.emissive) continue;
                    mat.emissive.copy(this.baseEmissive);
                    mat.emissiveIntensity = BASE_EMISSIVE_INTENSITY;
                }
            }
        }
    }

    /**
     * Per-frame update (called from the render loop with the shared frame delta)
     */
    tick(delta, time) {
        const c = this.controller;

        // Server loop already stopped (match finished) while this player was mid-air
        if (this.localFall && c.falling) {
            this.localVelocityY -= SUMO_CONFIG.FALL_GRAVITY * delta;
            c.position.y += this.localVelocityY * delta;
            c.position.x += c.velocity.x * delta;
            c.position.z += c.velocity.z * delta;
        }

        this.root.position.copy(c.position);
        this.root.rotation.y = c.facingAngle;
        this.setHidden(c.position.y < SUMO_CONFIG.HIDE_BELOW_Y);
        if (this.hidden) return;

        // Charge glow: grows with the charge and shifts from yellow to red
        if (this.chargeRing.visible) {
            const ratio = c.chargeRatio;
            const s = 0.7 + ratio * 1.3 + Math.sin(time * 14) * 0.05 * ratio;
            this.chargeRing.scale.set(s, s, 1);
            this.chargeRing.rotation.z += delta * (2 + ratio * 6);
            this.chargeRing.material.opacity = 0.45 + ratio * 0.5;
            this.chargeRing.material.color.setHSL(0.14 - 0.14 * ratio, 1, 0.55);
        }

        // Squash while charging (model units are 0.01)
        const squash = c.isCharging && c.alive ? c.chargeRatio : 0;
        if (squash !== this.lastSquash) {
            this.lastSquash = squash;
            this.model.scale.set(0.01 * (1 + 0.1 * squash), 0.01 * (1 - 0.18 * squash), 0.01 * (1 + 0.1 * squash));
        }

        // Animations: one-shots (punch / hit / fall) finish on their own
        if (!c.falling && !this.animController.isAttacking) {
            const animState = this.forcedAnim || c.getMovementState();
            this.animController.play(animState); // play() is a no-op if already running
        }
        this.animController.update(delta);

        this.updateEffects(delta);
    }

    dispose() {
        this.animController?.dispose?.();
        if (this.hotTimer) clearTimeout(this.hotTimer);

        // CSS2D label elements are not removed from the DOM automatically
        // when their parent group is removed from the scene
        [this.nameLabel, ...this.floatLabels].forEach(label => {
            label?.element?.parentNode?.removeChild(label.element);
        });
        this.floatLabels = [];

        this.bursts.forEach(b => {
            b.mesh.geometry.dispose();
            b.mesh.material.dispose();
        });
        this.bursts = [];

        this.chargeRing.geometry.dispose();
        this.chargeRing.material.dispose();
        this.tintMaterials.forEach(mat => mat.dispose());
        this.tintMaterials = [];
    }
}

// =================================
// Game
// =================================

class SumoGame {
    constructor() {
        this.players = new Map();
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.labelRenderer = null;
        this.clock = new THREE.Clock();
        this.elapsed = 0;
        this.socket = null;
        this.tournament = null;
        this.roomCode = null;
        this.isHost = true;
        this.gameStarted = false;

        this.isBabyShower = window.location.search.includes('mode=baby_shower');
        this.defaultCharacterId = this.isBabyShower ? 'baby' : 'edgar';
        this.baseModels = {};      // characterId -> loaded base model (only the ones requested)
        this.baseAnimations = {};

        // Players whose character model is still downloading when the match starts.
        // setupGeneration invalidates loads from a previous setup (rematch, lost session).
        this.pendingPlayers = new Map();     // id -> player data
        this.pendingStates = new Map();      // id -> latest server snapshot while pending
        this.setupGeneration = 0;
        this.matchOver = false;              // Late entities take the final pose too
        this.matchWinnerId = null;

        // Ring (dohyo) driven by 'sumo-state'.ringRadius with a smooth lerp
        this.ring = null;
        this.ringTarget = SUMO_CONFIG.RING_RADIUS;
        this.ringDisplay = SUMO_CONFIG.RING_RADIUS;
        this.shrinkPulse = 0;
        this.suddenDeath = false;
        this.gameState = 'countdown';

        // Camera zooms in as the ring shrinks
        this.cameraHeight = this.cameraHeightFor(SUMO_CONFIG.RING_RADIUS);
        this.cameraLookAt = new THREE.Vector3(0, 0.9, 0); // Slightly above the floor: the ring sits a bit lower on screen, clear of the HUD

        // HUD caches (DOM writes only on change)
        this.hud = {};
        this.lastTimerText = '';
        this.lastTimerUrgent = null;
        this.lastAliveText = '';
        this.lastCountdown = null;
        this.playerListKey = null;
        this.sumoFlashTimer = null;
        this.bannerTimer = null;
        this.rematchPending = false;
        this.sfx = null;

        this.init();
    }

    /**
     * Optional SFX (guarded: the game works without it)
     */
    loadSFX() {
        try {
            if (window.SFXManager) {
                this.sfx = new window.SFXManager();
                return;
            }
        } catch (e) { /* ignore */ }
        import('../audio/SFXManager.js')
            .then(mod => {
                const SFX = mod.SFXManager || mod.default;
                if (SFX) this.sfx = new SFX();
            })
            .catch(e => console.warn('[Sumo] SFXManager not available:', e));
    }

    playSfx(name) {
        try {
            this.sfx?.play?.(name);
        } catch (e) { /* ignore audio errors */ }
    }

    async init() {
        // Apply baby theme if needed
        if (this.isBabyShower) {
            document.documentElement.classList.add('baby-theme');
            const gameTitle = document.querySelector('.game-title');
            if (gameTitle) gameTitle.textContent = 'SUMO DE BEBÉS';
            document.title = 'Sumo de Bebés - Baby Shower';
        }

        this.cacheHud();
        this.setupScene();
        this.setupLights();
        this.createDohyo();

        await this.loadAssets();
        this.loadSFX();
        this.setupRematchButton();
        this.connectToServer();
        this.animate();

        window.addEventListener('resize', () => this.onWindowResize());
    }

    cacheHud() {
        const $ = id => document.getElementById(id);
        this.hud = {
            timer: $('sumo-timer'),
            alive: $('sumo-alive'),
            countdown: $('sumo-countdown'),
            banner: $('sumo-banner'),
            playerList: $('sumo-player-list'),
            roundEnd: $('round-end-overlay'),
            roundTitle: $('round-title'),
            roundWinner: $('round-winner'),
            roundScores: $('round-scores'),
            nextRound: $('next-round-countdown'),
            roundActions: document.querySelector('.round-end-actions'),
            rematchBtn: $('rematch-btn'),
            rematchError: $('rematch-error')
        };
    }

    // =================================
    // Scene
    // =================================

    setupScene() {
        const isBabyShower = document.documentElement.classList.contains('baby-theme');
        const bgColor = isBabyShower ? 0xFFEFFA : 0x07070f;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(bgColor);
        this.scene.fog = new THREE.Fog(bgColor, 28, 70);

        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.placeCamera(this.cameraHeight);

        this.renderer = new THREE.WebGLRenderer({
            canvas: document.getElementById('game-canvas'),
            antialias: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;

        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.domElement.style.position = 'absolute';
        this.labelRenderer.domElement.style.top = '0px';
        this.labelRenderer.domElement.style.pointerEvents = 'none';
        document.getElementById('game-container').appendChild(this.labelRenderer.domElement);

        this.addPlayerNameStyles();
    }

    addPlayerNameStyles() {
        if (document.getElementById('arena-name-styles')) return;
        const style = document.createElement('style');
        style.id = 'arena-name-styles';
        const isBabyShower = document.documentElement.classList.contains('baby-theme');

        style.textContent = `
            .arena-player-name-label {
                color: ${isBabyShower ? '#666' : 'white'};
                font-family: 'Orbitron', sans-serif;
                font-size: 12px;
                font-weight: bold;
                text-shadow: ${isBabyShower ? 'none' : '0 0 10px rgba(0,0,0,0.8)'};
                padding: 4px 12px;
                background: ${isBabyShower ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.6)'};
                border-radius: 10px;
                border: 2px solid currentColor;
                white-space: nowrap;
                pointer-events: none;
                text-transform: uppercase;
                transition: box-shadow 0.2s ease, background 0.2s ease;
            }
        `;
        document.head.appendChild(style);
    }

    setupLights() {
        const isBabyShower = document.documentElement.classList.contains('baby-theme');

        const ambientLight = new THREE.AmbientLight(0xffffff, isBabyShower ? 0.8 : 0.55);
        this.scene.add(ambientLight);

        const hemi = new THREE.HemisphereLight(0x8899ff, 0x221133, 0.35);
        this.scene.add(hemi);

        const sunLight = new THREE.DirectionalLight(0xffffff, 1);
        sunLight.position.set(10, 20, 10);
        sunLight.castShadow = true;
        sunLight.shadow.mapSize.width = 2048;
        sunLight.shadow.mapSize.height = 2048;
        sunLight.shadow.camera.left = -12;
        sunLight.shadow.camera.right = 12;
        sunLight.shadow.camera.top = 12;
        sunLight.shadow.camera.bottom = -12;
        this.scene.add(sunLight);
    }

    /**
     * The dohyo: a flat cylinder whose radius follows ringRadius (unit geometry scaled
     * every frame), a glowing rim that pulses, an edge-danger band, a center mark,
     * a pedestal and a dark void floor far below for the eliminated to fall into.
     */
    createDohyo() {
        const isBabyShower = document.documentElement.classList.contains('baby-theme');
        const group = new THREE.Group();

        // Top slab (top surface at y = 0)
        const slabHeight = 0.5;
        const slab = new THREE.Mesh(
            new THREE.CylinderGeometry(1, 1, slabHeight, 72, 1),
            new THREE.MeshPhongMaterial({
                color: isBabyShower ? 0xfff4fb : 0x2a2342,
                emissive: isBabyShower ? 0xffd6ec : 0x15102a,
                shininess: 25
            })
        );
        slab.position.y = -slabHeight / 2;
        slab.receiveShadow = true;
        group.add(slab);

        // Soft glow disc over the slab
        const glow = new THREE.Mesh(
            new THREE.CircleGeometry(1, 72),
            new THREE.MeshBasicMaterial({
                color: RIM_COLOR,
                transparent: true,
                opacity: isBabyShower ? 0.06 : 0.07,
                depthWrite: false
            })
        );
        glow.rotation.x = -Math.PI / 2;
        glow.position.y = 0.004;
        group.add(glow);

        // Danger band at the edge
        const edge = new THREE.Mesh(
            new THREE.RingGeometry(0.86, 0.985, 72),
            new THREE.MeshBasicMaterial({
                color: 0xff6600,
                transparent: true,
                opacity: 0.28,
                side: THREE.DoubleSide,
                depthWrite: false
            })
        );
        edge.rotation.x = -Math.PI / 2;
        edge.position.y = 0.012;
        group.add(edge);

        // Bright rim (unit torus: the tube gets thinner as the ring shrinks, the pulse compensates)
        const rim = new THREE.Mesh(
            new THREE.TorusGeometry(1, 0.035, 10, 96),
            new THREE.MeshBasicMaterial({ color: RIM_COLOR, transparent: true, opacity: 0.95 })
        );
        rim.rotation.x = -Math.PI / 2;
        rim.position.y = 0.03;
        group.add(rim);

        // Outer halo of the rim
        const halo = new THREE.Mesh(
            new THREE.RingGeometry(0.985, 1.08, 96),
            new THREE.MeshBasicMaterial({
                color: RIM_COLOR,
                transparent: true,
                opacity: 0.35,
                side: THREE.DoubleSide,
                depthWrite: false
            })
        );
        halo.rotation.x = -Math.PI / 2;
        halo.position.y = 0.02;
        group.add(halo);

        // Center mark (fixed size)
        const center = new THREE.Group();
        const centerRing = new THREE.Mesh(
            new THREE.RingGeometry(0.22, 0.32, 32),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
        );
        centerRing.rotation.x = -Math.PI / 2;
        center.add(centerRing);
        const barMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
        const barA = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.06), barMat);
        barA.rotation.x = -Math.PI / 2;
        const barB = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 1.4), barMat);
        barB.rotation.x = -Math.PI / 2;
        center.add(barA);
        center.add(barB);
        center.position.y = 0.015;
        group.add(center);

        // Pedestal under the slab
        const pedestal = new THREE.Mesh(
            new THREE.CylinderGeometry(0.93, 0.7, 8, 48, 1),
            new THREE.MeshPhongMaterial({ color: isBabyShower ? 0xf2d9ea : 0x14112a, emissive: 0x05040c })
        );
        pedestal.position.y = -slabHeight - 4;
        group.add(pedestal);

        this.scene.add(group);

        // Void floor far below (eliminated players fall into it)
        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(90, 90),
            new THREE.MeshPhongMaterial({ color: isBabyShower ? 0xf6e6f0 : 0x05050c, side: THREE.DoubleSide })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -9.5;
        floor.receiveShadow = true;
        this.scene.add(floor);

        const grid = new THREE.GridHelper(90, 45, isBabyShower ? 0xffc8dd : 0x2a1f4a, isBabyShower ? 0xe8f4ff : 0x12101f);
        grid.position.y = -9.49;
        this.scene.add(grid);

        this.ring = { group, slab, glow, edge, rim, halo, center, pedestal };
        this.applyRingScale(this.ringDisplay);
    }

    applyRingScale(r) {
        const ring = this.ring;
        if (!ring) return;
        ring.slab.scale.set(r, 1, r);
        ring.glow.scale.set(r, r, 1);
        ring.edge.scale.set(r, r, 1);
        ring.halo.scale.set(r, r, 1);
        ring.pedestal.scale.set(r, 1, r);
        // Rim: slight breathing, stronger right after a shrink notice and in sudden death
        const beat = this.gameState === 'active' || this.gameState === 'suddenDeath'
            ? Math.sin(this.elapsed * (this.suddenDeath ? 9 : 4)) * (0.012 + this.shrinkPulse * 0.05)
            : 0;
        const s = r * (1 + beat) + this.shrinkPulse * 0.15;
        ring.rim.scale.set(s, s, 1 + this.shrinkPulse * 2);
        ring.rim.material.opacity = 0.75 + 0.25 * Math.max(0, Math.sin(this.elapsed * 6)) + this.shrinkPulse * 0.25;
        ring.halo.material.opacity = 0.25 + this.shrinkPulse * 0.45;
    }

    setRimDanger(danger) {
        const color = danger ? RIM_COLOR_DANGER : RIM_COLOR;
        this.ring.rim.material.color.setHex(color);
        this.ring.halo.material.color.setHex(color);
        this.ring.glow.material.color.setHex(color);
    }

    cameraHeightFor(radius) {
        return SUMO_CONFIG.CAMERA_BASE + SUMO_CONFIG.CAMERA_PER_RADIUS * radius;
    }

    placeCamera(height) {
        this.camera.position.set(0, height, height / Math.tan(SUMO_CONFIG.CAMERA_ANGLE));
        this.camera.lookAt(this.cameraLookAt);
    }

    updateRing(delta) {
        // Smooth follow of the server radius
        const k = 1 - Math.exp(-SUMO_CONFIG.RING_LERP * delta);
        this.ringDisplay += (this.ringTarget - this.ringDisplay) * k;
        if (this.shrinkPulse > 0) this.shrinkPulse = Math.max(0, this.shrinkPulse - delta / SHRINK_PULSE_DURATION);
        this.applyRingScale(this.ringDisplay);

        // Camera zooms in with the ring
        const targetHeight = this.cameraHeightFor(this.ringDisplay);
        const kc = 1 - Math.exp(-SUMO_CONFIG.CAMERA_LERP * delta);
        const next = this.cameraHeight + (targetHeight - this.cameraHeight) * kc;
        if (Math.abs(next - this.cameraHeight) > 1e-4) {
            this.cameraHeight = next;
            this.placeCamera(next);
        }
    }

    resetRing() {
        this.ringTarget = SUMO_CONFIG.RING_RADIUS;
        this.shrinkPulse = 0;
        this.suddenDeath = false;
        this.gameState = 'countdown';
        this.setRimDanger(false);
    }

    // =================================
    // Assets
    // =================================

    /**
     * Startup assets: only the animation clips (small JSON, in parallel) block the loading
     * screen. The default character starts downloading in the background; every other
     * character is fetched when a player joins/selects it (see prefetchCharacters).
     */
    async loadAssets() {
        const fill = document.getElementById('progress-fill');
        const files = this.isBabyShower
            ? { ...ANIMATION_FILES, ...BABY_ANIMATION_FILES }
            : ANIMATION_FILES;

        // Fallback model + most common pick; never blocks room creation
        this.prefetchCharacters([this.defaultCharacterId]);

        this.baseAnimations = await loadClips(files, (loaded, total) => {
            if (fill) fill.style.width = `${(loaded / total) * 100}%`;
        });

        document.getElementById('loading-screen').classList.add('hidden');
    }

    /** Known character id for this page (unknown ids and baby outside baby shower -> default) */
    characterIdFor(characterId) {
        if (characterId === 'baby' && !this.isBabyShower) return this.defaultCharacterId;
        return CHARACTER_MODELS[characterId] ? characterId : this.defaultCharacterId;
    }

    /** Download (or reuse) a character model; resolves with the shared base model */
    loadCharacter(characterId) {
        const id = this.characterIdFor(characterId);
        return loadModel(CHARACTER_MODELS[id].file).then(model => {
            this.baseModels[id] = model;
            return model;
        });
    }

    /** Fire-and-forget download of the given characters (lobby: joins and selections) */
    prefetchCharacters(characterIds) {
        new Set(characterIds.filter(Boolean).map(id => this.characterIdFor(id))).forEach(id => {
            if (this.baseModels[id]) return;
            this.loadCharacter(id).catch(err => console.warn(`[Sumo] Could not preload ${id}:`, err));
        });
    }

    /** Model for a character, falling back to the default (or any loaded) model. Never rejects. */
    async resolveCharacterModel(characterId) {
        const id = this.characterIdFor(characterId);
        if (this.baseModels[id]) return this.baseModels[id];
        try {
            return await this.loadCharacter(id);
        } catch (err) {
            console.warn(`[Sumo] Model ${id} failed, using default:`, err);
        }
        if (id !== this.defaultCharacterId) {
            try {
                return await this.loadCharacter(this.defaultCharacterId);
            } catch (err) {
                console.warn('[Sumo] Default model failed too:', err);
            }
        }
        return Object.values(this.baseModels)[0] || null;
    }

    // =================================
    // Socket
    // =================================

    connectToServer() {
        // Load socket.io script first
        const script = document.createElement('script');
        script.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
        script.onload = () => this.initializeSocket();
        document.head.appendChild(script);
    }

    initializeSocket() {
        console.log('[Sumo] Connecting to server:', SERVER_URL);
        this.socket = io(SERVER_URL);

        // Tournament rounds HUD + round/tournament overlays (shared with the other modes)
        this.tournament = new TournamentManager(this.socket, 'sumo');

        this.socket.on('connect', () => {
            // Recovered connection (Socket.IO connectionStateRecovery): same id, same room,
            // missed events are replayed. Creating a room here would orphan all phones.
            if (this.socket.recovered) {
                console.log(`[Sumo] Connection recovered, keeping room ${this.roomCode}`);
                return;
            }

            console.log('[Sumo] Connected to server');

            // Reconnected but the session could not be recovered: the old room is gone
            if (this.roomCode) {
                console.warn('[Sumo] Session lost, creating a new room');
                this.clearPlayers();
                this.resetMatchUI();
                this.resetRing();
                this.gameStarted = false;
            }

            const isBabyShower = document.documentElement.classList.contains('baby-theme');
            this.socket.emit('create-room', {
                gameMode: 'sumo',
                isBabyShower: isBabyShower
            }, (response) => {
                if (response && response.success) {
                    this.roomCode = response.roomCode;
                    this.showRoomCode(this.roomCode);
                    console.log(`[Sumo] Room created: ${this.roomCode}`);
                } else {
                    console.error('[Sumo] Could not create the room:', response);
                }
            });
        });

        this.socket.on('player-joined', (data) => {
            console.log('[Sumo] Player joined:', data.player);
            this.updateRoomOverlay(data.room?.playerCount ?? 0);
            // Download characters already known during the lobby (baby shower auto-assigns)
            const roomPlayers = data.room?.players || [data.player];
            this.prefetchCharacters(roomPlayers.map(p => p?.character));
        });

        this.socket.on('character-selected', (data) => {
            this.prefetchCharacters([data?.character]);
        });

        this.socket.on('player-left', (data) => {
            console.log('[Sumo] Player left:', data.playerId);
            this.pendingPlayers.delete(data.playerId);
            this.pendingStates.delete(data.playerId);
            const entity = this.players.get(data.playerId);
            if (entity) {
                this.scene.remove(entity.root);
                entity.dispose();
                this.players.delete(data.playerId);
            }
            if (data.room) {
                this.updateRoomOverlay(data.room.playerCount);
            }
        });

        // Rematch (and tournament rounds): announced ~1 s before 'game-started'
        this.socket.on('round-starting', (data) => {
            console.log('[Sumo] Round starting', data);
            this.resetMatchUI();
            this.resetRing();
            if (data?.rematch) this.showBanner('¡REVANCHA!', 'rematch', 1500);
        });

        this.socket.on('game-started', (data) => {
            console.log('[Sumo] Game started!', data);
            this.gameStarted = true;
            document.getElementById('room-code-overlay')?.classList.add('hidden');
            this.resetMatchUI();
            this.resetRing();
            this.setupPlayers(data.players || []);
        });

        this.socket.on('sumo-state', (state) => {
            this.updateGameState(state);
        });

        this.socket.on('sumo-event', (event) => {
            this.handleEvent(event);
        });

        this.socket.on('sumo-game-over', (data) => {
            this.showGameOver(data);
        });

        // Tournament rounds: the shared overlay shows scores and the next-round countdown
        this.socket.on('round-ended', () => {
            if (this.hud.roundActions) this.hud.roundActions.classList.add('hidden');
            this.hud.nextRound?.classList.remove('hidden');
            if (this.hud.roundTitle) this.hud.roundTitle.textContent = 'RONDA TERMINADA';
        });
    }

    // =================================
    // Lobby overlay
    // =================================

    showRoomCode(code) {
        let overlay = document.getElementById('room-code-overlay');
        const mobileUrl = `${window.location.origin}/mobile/index.html?room=${code}`;
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(mobileUrl)}`;

        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'room-code-overlay';
            overlay.innerHTML = `
                <div class="room-code-content">
                    <h2>🥋 SUMO - SALA</h2>
                    <div class="room-code"></div>
                    <div class="qr-container">
                        <img src="" alt="QR Code" class="qr-code" />
                    </div>
                    <p>Escanea para unirte al juego</p>
                    <div class="url-display"></div>

                    <div class="rounds-selector">
                        <span class="rounds-label">RONDAS:</span>
                        <button class="round-btn selected" type="button" data-rounds="1">1</button>
                        <button class="round-btn" type="button" data-rounds="3">3</button>
                        <button class="round-btn" type="button" data-rounds="5">5</button>
                    </div>

                    <button id="start-game-btn" type="button" disabled>ESPERANDO JUGADORES...</button>
                    <div id="player-count-lobby">Jugadores: 0 / 8</div>
                </div>
            `;
            overlay.querySelector('.room-code').textContent = code;
            overlay.querySelector('.qr-code').src = qrCodeUrl;
            overlay.querySelector('.url-display').textContent = mobileUrl;
            document.body.appendChild(overlay);

            document.getElementById('start-game-btn').addEventListener('click', () => {
                this.socket.emit('start-game');
            });
            this.setupRoundsSelector(overlay);
        } else {
            // Overlay already exists (new room after a lost session): refresh it
            const codeEl = overlay.querySelector('.room-code');
            if (codeEl) codeEl.textContent = code;
            const qrEl = overlay.querySelector('.qr-code');
            if (qrEl) qrEl.src = qrCodeUrl;
            const urlEl = overlay.querySelector('.url-display');
            if (urlEl) urlEl.textContent = mobileUrl;
            overlay.classList.remove('hidden');
            this.updateRoomOverlay(0);
        }
    }

    setupRoundsSelector(overlay) {
        const buttons = overlay.querySelectorAll('.round-btn');
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                const rounds = parseInt(btn.dataset.rounds, 10) || 1;
                buttons.forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                if (this.tournament) this.tournament.setRounds(rounds);
                else this.socket?.emit('set-tournament-rounds', rounds);
            });
        });
    }

    updateRoomOverlay(count) {
        const btn = document.getElementById('start-game-btn');
        const countEl = document.getElementById('player-count-lobby');
        if (btn && countEl) {
            countEl.textContent = `Jugadores: ${count} / 8`;
            if (count >= 2) {
                btn.disabled = false;
                btn.textContent = '¡INICIAR SUMO!';
            } else {
                btn.disabled = true;
                btn.textContent = 'ESPERANDO JUGADORES...';
            }
        }
    }

    // =================================
    // Players
    // =================================

    clearPlayers() {
        this.players.forEach(entity => {
            this.scene.remove(entity.root);
            entity.dispose();
        });
        this.players.clear();
        this.playerListKey = null;

        // Drop entities still waiting for their model (they belong to the old setup)
        this.setupGeneration++;
        this.pendingPlayers.clear();
        this.pendingStates.clear();
    }

    setupPlayers(playersData) {
        // Always start from a clean slate (rematch / next round / changed player list)
        this.clearPlayers();
        const generation = this.setupGeneration;

        playersData.forEach((p, index) => {
            const color = p.color || SUMO_CONFIG.PLAYER_COLORS[index % SUMO_CONFIG.PLAYER_COLORS.length];

            const readyModel = this.baseModels[this.characterIdFor(p.character)];
            if (readyModel) {
                this.createPlayerEntity(p, color, readyModel);
                return;
            }

            // Model still downloading: create the entity as soon as it arrives
            this.pendingPlayers.set(p.id, p);
            this.resolveCharacterModel(p.character).then(model => {
                // Stale (rematch, lost session) or the player left meanwhile
                if (generation !== this.setupGeneration || this.pendingPlayers.get(p.id) !== p) return;
                this.pendingPlayers.delete(p.id);
                const lastState = this.pendingStates.get(p.id);
                this.pendingStates.delete(p.id);
                if (!model) {
                    console.error(`[Sumo] No model available for player ${p.name}`);
                    return;
                }
                const entity = this.createPlayerEntity(p, color, model);
                if (lastState) entity.applyState(lastState);
                if (this.matchOver) {
                    entity.setFinalPose(this.matchWinnerId && p.id === this.matchWinnerId ? 'win' : 'idle');
                }
                this.playerListKey = null; // Refresh HUD colors
            });
        });
    }

    createPlayerEntity(p, color, baseModel) {
        const entity = new SumoPlayerEntity(p.id, p.number, color, baseModel, this.baseAnimations);
        entity.setName(p.name);
        this.players.set(p.id, entity);
        this.scene.add(entity.root);
        return entity;
    }

    getPlayerColor(id, fallback = '#fff') {
        return this.players.get(id)?.color || fallback;
    }

    // =================================
    // HUD
    // =================================

    /**
     * Reset HUD and overlays for a fresh match (idempotent)
     */
    resetMatchUI() {
        this.matchOver = false;
        this.matchWinnerId = null;
        this.hud.roundEnd?.classList.add('hidden');
        document.getElementById('tournament-end-overlay')?.classList.add('hidden');

        this.setTimer(SUMO_CONFIG.MATCH_DURATION, false);
        this.setAliveText('');
        this.setCountdownText('');
        this.hideBanner();

        if (this.hud.playerList) this.hud.playerList.replaceChildren();
        this.playerListKey = null;

        this.setRematchButtonState(false);
    }

    setTimer(seconds, urgent) {
        const el = this.hud.timer;
        if (!el) return;
        const total = Math.max(0, Math.ceil(seconds));
        const m = Math.floor(total / 60);
        const s = (total % 60).toString().padStart(2, '0');
        const text = `${m}:${s}`;
        if (text !== this.lastTimerText) {
            this.lastTimerText = text;
            el.textContent = text;
        }
        if (urgent !== this.lastTimerUrgent) {
            this.lastTimerUrgent = urgent;
            el.classList.toggle('urgent', urgent);
        }
    }

    setAliveText(text) {
        const el = this.hud.alive;
        if (!el || text === this.lastAliveText) return;
        this.lastAliveText = text;
        el.textContent = text;
        el.classList.toggle('hidden', !text);
    }

    setCountdownText(text) {
        const el = this.hud.countdown;
        if (!el || text === this.lastCountdown) return;
        this.lastCountdown = text;
        el.textContent = text;
        el.classList.toggle('hidden', !text);
        if (text) {
            // Restart the pop animation
            el.classList.remove('pop');
            void el.offsetWidth;
            el.classList.add('pop');
        }
    }

    /**
     * Big "¡SUMO!" flash when the countdown ends
     */
    flashGo() {
        this.setCountdownText('¡SUMO!');
        if (this.sumoFlashTimer) clearTimeout(this.sumoFlashTimer);
        this.sumoFlashTimer = setTimeout(() => {
            this.sumoFlashTimer = null;
            if (this.lastCountdown === '¡SUMO!') this.setCountdownText('');
        }, SUMO_FLASH_DURATION);
    }

    showBanner(text, kind, autoHideMs) {
        const el = this.hud.banner;
        if (!el) return;
        el.textContent = text;
        el.className = `sumo-banner${kind ? ` ${kind}` : ''}`;
        if (this.bannerTimer) clearTimeout(this.bannerTimer);
        this.bannerTimer = null;
        if (autoHideMs) {
            this.bannerTimer = setTimeout(() => {
                this.bannerTimer = null;
                this.hideBanner();
            }, autoHideMs);
        }
    }

    hideBanner() {
        const el = this.hud.banner;
        if (!el) return;
        if (this.bannerTimer) clearTimeout(this.bannerTimer);
        this.bannerTimer = null;
        el.className = 'sumo-banner hidden';
        el.textContent = '';
    }

    /**
     * Side list: alive players first (by number), then the eliminated by placement.
     * Rebuilt only when ids, names or statuses change.
     */
    updatePlayerList(players) {
        const list = this.hud.playerList;
        if (!list) return;

        const sorted = [...players].sort((a, b) => {
            if (a.alive !== b.alive) return a.alive ? -1 : 1;
            if (!a.alive && !b.alive) return (a.placement || 99) - (b.placement || 99);
            return (a.number || 0) - (b.number || 0);
        });

        const key = sorted.map(p => `${p.id}|${p.name}|${p.alive ? 1 : 0}|${p.placement ?? ''}`).join(';');
        if (key === this.playerListKey) return;
        this.playerListKey = key;
        list.replaceChildren();

        sorted.forEach(p => {
            const item = document.createElement('div');
            item.className = `sumo-player-item ${p.alive ? 'alive' : 'out'}`;
            item.style.setProperty('--player-color', p.color || this.getPlayerColor(p.id));
            item.dataset.playerId = p.id;

            const nameEl = document.createElement('span');
            nameEl.className = 'sumo-player-name';
            nameEl.textContent = p.name || '';

            const statusEl = document.createElement('span');
            statusEl.className = 'sumo-player-status';
            if (p.alive) {
                statusEl.textContent = 'VIVO';
            } else if (p.placement === 1) {
                statusEl.textContent = '👑 1°';
            } else {
                statusEl.textContent = p.placement ? `FUERA · ${ordinal(p.placement)}` : 'FUERA';
            }

            item.appendChild(nameEl);
            item.appendChild(statusEl);
            list.appendChild(item);
        });
    }

    /** Brief highlight of a player's row in the side list */
    highlightListItem(playerId) {
        const list = this.hud.playerList;
        if (!list) return;
        const items = list.children;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.dataset.playerId !== playerId) continue;
            item.classList.remove('hot');
            void item.offsetWidth;
            item.classList.add('hot');
            break;
        }
    }

    // =================================
    // State & events
    // =================================

    updateGameState(state) {
        if (!state) return;

        const prevGameState = this.gameState;
        this.gameState = state.gameState || prevGameState;

        if (typeof state.ringRadius === 'number') this.ringTarget = state.ringRadius;

        // Countdown / go
        if (this.gameState === 'countdown') {
            const n = Math.max(0, Math.ceil(state.countdown || 0));
            this.setCountdownText(n > 0 ? String(n) : '');
        } else if (prevGameState === 'countdown' && (this.gameState === 'active' || this.gameState === 'suddenDeath')) {
            this.flashGo();
        }

        // Timer (red under 10 s; sudden death shows its banner instead of a clock)
        if (this.gameState === 'suddenDeath') {
            this.setTimer(0, true);
        } else {
            const timeLeft = typeof state.timeLeft === 'number' ? state.timeLeft : SUMO_CONFIG.MATCH_DURATION;
            this.setTimer(timeLeft, this.gameState !== 'countdown' && timeLeft < SUMO_CONFIG.URGENT_SECONDS);
        }

        const players = Array.isArray(state.players) ? state.players : null;
        if (players) {
            const alive = typeof state.aliveCount === 'number' ? state.aliveCount : players.filter(p => p.alive).length;
            this.setAliveText(`QUEDAN ${alive}`);
            this.updatePlayerList(players);

            // Only apply state here; animations are advanced in the render loop
            for (let i = 0; i < players.length; i++) {
                const pState = players[i];
                const entity = this.players.get(pState.id);
                if (entity) {
                    if (pState.name && entity.name !== pState.name) entity.setName(pState.name);
                    entity.applyState(pState);
                } else if (this.pendingPlayers.has(pState.id)) {
                    this.pendingStates.set(pState.id, pState); // Applied when its model arrives
                }
            }
        }

        // The last snapshot: freeze everyone (the overlay comes from 'sumo-game-over' or the tournament)
        if (this.gameState === 'finished' && !this.matchOver) {
            this.finishMatch(state.winner || null);
        }
    }

    /**
     * 'sumo-event': shove-hit | ring-out | sudden-death | ring-shrink
     */
    handleEvent(event) {
        if (!event) return;
        switch (event.type) {
            case 'shove-hit': {
                const attacker = this.players.get(event.attackerId);
                const target = this.players.get(event.targetId);
                attacker?.playShove();
                target?.playHit();
                this.playSfx(event.power > 0.7 ? 'hitLarge' : 'punchHit');
                break;
            }
            case 'ring-out': {
                const victim = this.players.get(event.playerId);
                victim?.showFloatText('¡FUERA!', '#ff3366', 'out');
                this.spawnRingOutBurst(victim);
                if (event.by) {
                    const attacker = this.players.get(event.by);
                    attacker?.highlightName();
                    this.highlightListItem(event.by);
                }
                this.playSfx('ko');
                break;
            }
            case 'sudden-death': {
                this.suddenDeath = true;
                this.setRimDanger(true);
                this.shrinkPulse = 1;
                this.showBanner('¡MUERTE SÚBITA!', 'sudden-death');
                this.playSfx('heavyHit');
                break;
            }
            case 'ring-shrink': {
                this.shrinkPulse = 1;
                if (typeof event.ringRadius === 'number') this.ringTarget = event.ringRadius;
                this.playSfx('land');
                break;
            }
            default:
                break;
        }
    }

    /**
     * Smash-style KO burst on the rim where the player left, in their color, plus flash and shake
     */
    spawnRingOutBurst(victim) {
        if (!this.koBursts) this.koBursts = new KOBurstManager(this.scene, this.camera, THREE);
        const color = victim?.color || '#ff3366';
        const pos = new THREE.Vector3(0, 0.6, 0);
        if (victim) {
            const p = victim.controller.position;
            const dist = Math.hypot(p.x, p.z) || 1;
            const r = Math.max(this.ringDisplay + 0.3, Math.min(dist, this.ringDisplay + 1.5));
            pos.set((p.x / dist) * r, 0.6, (p.z / dist) * r);
        }
        this.koBursts.spawn(pos, color, { scale: 1.1, sparks: 120 });
        koScreenPunch(document.getElementById('game-container'), color, { shake: 16, duration: 450 });
    }

    /**
     * Freeze players at the end (winner celebrates); late entities do the same on arrival
     */
    finishMatch(winner) {
        this.matchOver = true;
        this.matchWinnerId = winner?.id || null;
        this.players.forEach((entity, id) => {
            entity.setFinalPose(winner && id === winner.id ? 'win' : 'idle');
        });
        if (winner) {
            this.showBanner(`¡${String(winner.name || '').toUpperCase()} GANA!`, 'winner');
            const winnerEntity = this.players.get(winner.id);
            if (winnerEntity) winnerEntity.highlightName();
        } else {
            this.showBanner('¡FIN!', 'winner');
        }
    }

    /**
     * 'sumo-game-over' (single match): winner headline + ranking + rematch panel
     */
    showGameOver(data) {
        const overlay = this.hud.roundEnd;
        if (!overlay) return;
        overlay.classList.remove('hidden');

        const winner = data?.winner || null;
        if (!this.matchOver) this.finishMatch(winner);

        if (this.hud.roundTitle) this.hud.roundTitle.textContent = '¡FIN DEL COMBATE!';
        const winnerEl = this.hud.roundWinner;
        if (winnerEl) {
            winnerEl.textContent = winner ? `👑 ¡${winner.name} GANA!` : '¡FIN!';
            // Server sends no color: fall back to the player's known color
            winnerEl.style.color = (winner && (winner.color || this.getPlayerColor(winner.id, ''))) || '';
        }

        const scores = this.hud.roundScores;
        if (scores) {
            scores.replaceChildren();
            const heading = document.createElement('h3');
            heading.textContent = 'CLASIFICACIÓN';
            scores.appendChild(heading);

            const ranking = Array.isArray(data?.ranking) ? data.ranking : [];
            ranking.forEach(p => {
                const row = document.createElement('div');
                row.className = `sumo-rank-row${p.placement === 1 ? ' first' : ''}`;
                row.style.setProperty('--player-color', this.getPlayerColor(p.id, '#fff'));

                const place = document.createElement('span');
                place.className = 'sumo-rank-place';
                place.textContent = p.placement === 1 ? '🥇' : p.placement === 2 ? '🥈' : p.placement === 3 ? '🥉' : ordinal(p.placement || ranking.indexOf(p) + 1);

                const name = document.createElement('span');
                name.className = 'sumo-rank-name';
                name.textContent = p.name || '';

                row.appendChild(place);
                row.appendChild(name);
                scores.appendChild(row);
            });
        }

        this.hud.nextRound?.classList.add('hidden');
        this.hud.roundActions?.classList.remove('hidden');
        this.setRematchButtonState(false);
    }

    // =================================
    // Rematch
    // =================================

    setupRematchButton() {
        const btn = this.hud.rematchBtn;
        if (!btn || btn.dataset.bound) return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', () => this.requestRematch());
    }

    setRematchButtonState(pending, errorText) {
        this.rematchPending = pending;
        const btn = this.hud.rematchBtn;
        if (btn) {
            btn.disabled = pending;
            btn.textContent = pending ? 'PREPARANDO...' : 'REVANCHA';
        }
        if (this.hud.rematchError) this.hud.rematchError.textContent = errorText || '';
    }

    requestRematch() {
        if (this.rematchPending || !this.socket) return;
        this.setRematchButtonState(true);

        // Timeout so the button never stays stuck if the ack is lost
        this.socket.timeout(5000).emit('request-rematch', (err, res) => {
            if (err || !res?.success) {
                const reason = err ? 'Sin respuesta del servidor' : (res?.error || 'No se pudo iniciar la revancha');
                console.warn('[Sumo] Rematch failed:', reason);
                this.setRematchButtonState(false, reason);
            }
            // On success the button stays disabled until 'round-starting' resets the UI
        });
    }

    // =================================
    // Render loop
    // =================================

    animate() {
        requestAnimationFrame(() => this.animate());
        // One shared delta per frame (clamped to avoid jumps after tab switches)
        const delta = Math.min(this.clock.getDelta(), 0.1);
        this.elapsed += delta;

        this.updateRing(delta);
        for (const entity of this.players.values()) entity.tick(delta, this.elapsed);
        if (this.koBursts) this.koBursts.update(delta);

        this.renderer.render(this.scene, this.camera);
        this.labelRenderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
    }
}

// Start the game
new SumoGame();
