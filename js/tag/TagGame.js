/**
 * TAG DE PELUCHES - Tag Game Mode
 * Three.js based tag game with top-down perspective
 */

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { SERVER_URL, CONFIG } from '../config.js';
import { AnimationController, ANIMATION_CONFIG } from '../animation/AnimationController.js';
import TagPlayerController from './TagPlayerController.js';
import TournamentManager from '../tournament/TournamentManager.js';
import { loadClips, loadModel } from '../assets/AssetLoader.js';

// =================================
// Configuration
// =================================

const TAG_CONFIG = {
    MAP_SIZE: 20,
    CAMERA_HEIGHT: 25,
    CAMERA_ANGLE: Math.PI / 3,
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
    win: 'Meshy_AI_Animation_Hip_Hop_Dance_withSkin.fbx'
};

// Baby shower only: AnimationController maps walk/run to crawling in that theme
const BABY_ANIMATION_FILES = {
    crawling: 'Crawling.fbx'
};

// Escape text before inserting it with innerHTML (defense in depth; names are sanitized server-side)
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const BASE_EMISSIVE_INTENSITY = 0.2;
const TAG_FLASH_DURATION = 0.6; // seconds
const TAG_BURST_DURATION = 0.7; // seconds

// Power-ups ('tag-state'.powerUp / 'tag-powerup' events): look, label and shout per kind
const POWERUP_STYLE = {
    rayo:   { color: 0xffcc00, css: '#ffcc00', emoji: '⚡', shout: '¡RAYO!' },
    escudo: { color: 0x00e5ff, css: '#00e5ff', emoji: '🛡', shout: '¡ESCUDO!' }
};
const BOOST_EMISSIVE_INTENSITY = 0.7;
const BOOST_TRAIL_INTERVAL = 0.07;  // seconds between trail puffs while boosted and moving
const BOOST_TRAIL_DURATION = 0.45;  // seconds each puff lasts
const FLOAT_TEXT_DURATION = 1100;   // ms the "¡RAYO!" / "¡ESCUDO!" shout stays over the player

class TagPlayerEntity {
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

        // Labels stay on the model (positions are in model units: 250 * 0.01 = 2.5 m)
        this.nameLabel = this.createNameLabel(color);
        this.model.add(this.nameLabel);

        this.itLabel = this.createItLabel();
        this.itLabel.visible = false;
        this.model.add(this.itLabel);

        // Aura for "It" player (world units, on the root group)
        this.aura = this.createAura();
        this.aura.visible = false;
        this.root.add(this.aura);

        // Light for the aura: always in the scene (intensity toggled) so the
        // light count stays constant and shaders don't recompile on every tag
        this.auraLight = new THREE.PointLight(0xff3366, 0, 5);
        this.auraLight.position.y = 1;
        this.root.add(this.auraLight);

        // Shield for immune player (world units, on the root group)
        this.shield = this.createShield();
        this.shield.visible = false;
        this.root.add(this.shield);

        // Power-up effects: 'escudo' bubble and 'rayo' ring + trail (same approach as the aura)
        this.bubble = this.createBubble();
        this.bubble.visible = false;
        this.root.add(this.bubble);

        this.boostRing = this.createBoostRing();
        this.boostRing.visible = false;
        this.root.add(this.boostRing);

        this.boosted = false;
        this.shielded = false;
        this.trail = [];          // { mesh, t } puffs left behind while boosted (added to the scene)
        this.trailTimer = 0;
        this.floatLabels = [];    // CSS2D shouts over the player ("¡RAYO!")
        this.baseEmissive = new THREE.Color(color);

        // Tag feedback effects
        this.bursts = [];
        this.flashTime = 0;
        this.graceVisual = false;
        this.forcedAnim = null;

        this.animController = new AnimationController(this.model, baseAnimations);
        this.controller = new TagPlayerController(id, number, color);
    }
    
    createNameLabel(color) {
        const div = document.createElement('div');
        div.className = 'arena-player-name-label';
        div.textContent = this.name;
        div.style.color = color;
        const label = new CSS2DObject(div);
        label.position.set(0, 250, 0);
        return label;
    }

    createItLabel() {
        const div = document.createElement('div');
        div.className = 'tag-label-it';
        div.textContent = 'LA TRAE';
        const label = new CSS2DObject(div);
        label.position.set(0, 320, 0);
        return label;
    }

    createAura() {
        const geometry = new THREE.TorusGeometry(1.2, 0.1, 16, 100);
        const material = new THREE.MeshBasicMaterial({ 
            color: 0xff3366, 
            transparent: true, 
            opacity: 0.8
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0.1; // Just above the floor (world units)
        return mesh;
    }

    createShield() {
        const geometry = new THREE.IcosahedronGeometry(1.5, 1);
        const material = new THREE.MeshBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.3,
            wireframe: true
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = 1; // Centered on character (world units)
        return mesh;
    }

    /**
     * 'escudo' power-up: translucent bubble around the character
     */
    createBubble() {
        const geometry = new THREE.SphereGeometry(1.35, 24, 16);
        const material = new THREE.MeshBasicMaterial({
            color: POWERUP_STYLE.escudo.color,
            transparent: true,
            opacity: 0.28,
            depthWrite: false
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = 1;
        return mesh;
    }

    /**
     * 'rayo' power-up: yellow ring on the floor (the trail puffs are spawned in tick)
     */
    createBoostRing() {
        const geometry = new THREE.TorusGeometry(0.9, 0.08, 12, 48);
        const material = new THREE.MeshBasicMaterial({
            color: POWERUP_STYLE.rayo.color,
            transparent: true,
            opacity: 0.9
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0.12;
        return mesh;
    }

    /**
     * Short shout over the player ("¡RAYO!" / "¡ESCUDO!"), removed after FLOAT_TEXT_DURATION
     */
    showFloatText(text, cssColor) {
        const div = document.createElement('div');
        div.className = 'tag-float-text';
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
     * Character glow: yellow while boosted, the player color otherwise
     */
    applyEmissive(color, intensity) {
        this.tintMaterials.forEach(mat => {
            if (!mat.emissive) return;
            mat.emissive.copy(color);
            mat.emissiveIntensity = intensity;
        });
    }

    /**
     * Fading puff left on the floor behind a boosted runner
     */
    spawnTrailPuff() {
        const scene = this.root.parent;
        if (!scene) return;
        const geometry = new THREE.CircleGeometry(0.32, 16);
        const material = new THREE.MeshBasicMaterial({
            color: POWERUP_STYLE.rayo.color,
            transparent: true,
            opacity: 0.7,
            depthWrite: false
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(this.root.position.x, 0.06, this.root.position.z);
        scene.add(mesh);
        this.trail.push({ mesh, t: 0 });
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

    /**
     * Visible feedback when this player gets tagged: expanding rings + emissive flash
     */
    playTagBurst() {
        const makeRing = (inner, outer, color, y, rotateFlat) => {
            const geometry = new THREE.RingGeometry(inner, outer, 48);
            const material = new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 1,
                side: THREE.DoubleSide,
                depthWrite: false
            });
            const mesh = new THREE.Mesh(geometry, material);
            if (rotateFlat) mesh.rotation.x = -Math.PI / 2;
            mesh.position.y = y;
            return mesh;
        };

        const ground = makeRing(0.4, 0.7, 0xff3366, 0.08, true);
        const halo = makeRing(0.5, 0.65, 0xffcc00, 1.2, true);
        this.root.add(ground);
        this.root.add(halo);
        this.bursts.push({ mesh: ground, t: 0, growth: 4 });
        this.bursts.push({ mesh: halo, t: 0, growth: 2.5 });

        this.flashTime = TAG_FLASH_DURATION;
    }

    updateEffects(delta) {
        // Expanding/fading rings
        for (let i = this.bursts.length - 1; i >= 0; i--) {
            const burst = this.bursts[i];
            burst.t += delta;
            const k = Math.min(1, burst.t / TAG_BURST_DURATION);
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

        // Emissive flash on the character
        if (this.flashTime > 0) {
            this.flashTime = Math.max(0, this.flashTime - delta);
            const k = this.flashTime / TAG_FLASH_DURATION;
            const rest = this.boosted ? BOOST_EMISSIVE_INTENSITY : BASE_EMISSIVE_INTENSITY;
            const intensity = rest + k * 2.0;
            this.tintMaterials.forEach(mat => {
                if (mat.emissive) mat.emissiveIntensity = intensity;
            });
        }

        // Boost trail: fading puffs behind a moving runner
        if (this.boosted) {
            this.trailTimer += delta;
            const speed = Math.hypot(this.controller.velocity.x, this.controller.velocity.z);
            if (speed > 1 && this.trailTimer >= BOOST_TRAIL_INTERVAL) {
                this.trailTimer = 0;
                this.spawnTrailPuff();
            }
        }
        for (let i = this.trail.length - 1; i >= 0; i--) {
            const puff = this.trail[i];
            puff.t += delta;
            const k = Math.min(1, puff.t / BOOST_TRAIL_DURATION);
            const s = 1 - k * 0.6;
            puff.mesh.scale.set(s, s, s);
            puff.mesh.material.opacity = 0.7 * (1 - k);
            if (k >= 1) this.removeTrailPuff(i);
        }
    }

    removeTrailPuff(index) {
        const puff = this.trail[index];
        puff.mesh.parent?.remove(puff.mesh);
        puff.mesh.geometry.dispose();
        puff.mesh.material.dispose();
        this.trail.splice(index, 1);
    }

    /**
     * Freeze at the end of the match (optionally with a celebration animation)
     */
    setFinalPose(animName) {
        this.controller.velocity.set(0, 0, 0);
        this.controller.input = { left: false, right: false, up: false, down: false };
        this.forcedAnim = animName || 'idle';
    }

    dispose() {
        this.animController?.dispose();

        // CSS2D label elements are not removed from the DOM automatically
        // when their parent group is removed from the scene
        [this.nameLabel, this.itLabel, ...this.floatLabels].forEach(label => {
            label?.element?.parentNode?.removeChild(label.element);
        });
        this.floatLabels = [];

        this.bursts.forEach(b => {
            b.mesh.geometry.dispose();
            b.mesh.material.dispose();
        });
        this.bursts = [];
        while (this.trail.length) this.removeTrailPuff(this.trail.length - 1);

        [this.aura, this.shield, this.bubble, this.boostRing].forEach(mesh => {
            mesh?.geometry?.dispose();
            mesh?.material?.dispose();
        });
        this.tintMaterials.forEach(mat => mat.dispose());
        this.tintMaterials = [];
    }

    setName(name) {
        this.name = name;
        if (this.nameLabel && this.nameLabel.element) {
            this.nameLabel.element.textContent = name;
        }
    }

    /**
     * Apply a server snapshot (called from the socket handler, no animation work here)
     */
    applyState(state) {
        if (!state) return;
        this.controller.applyServerState(state);
        const isIt = !!state.isIt;
        const hasGrace = !!state.hasGrace;
        this.itLabel.visible = isIt;
        this.aura.visible = isIt;
        this.auraLight.intensity = isIt ? 2 : 0;
        this.shield.visible = hasGrace;

        // Visual feedback for grace period (transparency) - only when it changes
        if (hasGrace !== this.graceVisual) {
            this.graceVisual = hasGrace;
            this.tintMaterials.forEach(mat => {
                mat.transparent = hasGrace;
                mat.opacity = hasGrace ? 0.6 : 1.0;
            });
        }

        // Power-up effects (bubble / yellow glow + ring) - only when they change
        const shielded = !!state.shielded;
        if (shielded !== this.shielded) {
            this.shielded = shielded;
            this.bubble.visible = shielded;
        }
        const boosted = !!state.boosted;
        if (boosted !== this.boosted) {
            this.boosted = boosted;
            this.boostRing.visible = boosted;
            this.trailTimer = 0;
            if (this.flashTime <= 0) {
                this.applyEmissive(
                    boosted ? new THREE.Color(POWERUP_STYLE.rayo.color) : this.baseEmissive,
                    boosted ? BOOST_EMISSIVE_INTENSITY : BASE_EMISSIVE_INTENSITY
                );
            } else {
                // Keep the flash running; only swap the glow color
                this.tintMaterials.forEach(mat => {
                    if (mat.emissive) mat.emissive.copy(boosted ? new THREE.Color(POWERUP_STYLE.rayo.color) : this.baseEmissive);
                });
            }
        }
    }

    /**
     * Per-frame update (called from the render loop with the shared frame delta)
     */
    tick(delta) {
        if (this.aura.visible) {
            this.aura.rotation.z += delta * 2;
            const scale = 1 + Math.sin(Date.now() * 0.01) * 0.1;
            this.aura.scale.set(scale, scale, 1);
        }

        if (this.shield.visible) {
            this.shield.rotation.y += delta * 3;
            this.shield.rotation.x += delta * 1.5;
        }

        if (this.bubble.visible) {
            const pulse = 1 + Math.sin(Date.now() * 0.006) * 0.06;
            this.bubble.scale.set(pulse, pulse, pulse);
        }

        if (this.boostRing.visible) {
            this.boostRing.rotation.z -= delta * 4;
            const pulse = 1 + Math.sin(Date.now() * 0.012) * 0.12;
            this.boostRing.scale.set(pulse, pulse, 1);
        }

        this.root.position.copy(this.controller.position);
        this.root.rotation.y = this.controller.facingAngle; // Removed + Math.PI to fix walking backward

        const animState = this.forcedAnim || this.controller.getMovementState();
        this.animController.play(animState); // play() is a no-op if already running
        this.animController.update(delta);

        this.updateEffects(delta);
    }
}

class TagGame {
    constructor() {
        this.players = new Map();
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.labelRenderer = null;
        this.clock = new THREE.Clock();
        this.socket = null;
        this.roomCode = null;
        this.isHost = true; // Assume host by default for tag.html
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

        // HUD caches (avoid rebuilding DOM every server tick)
        this.playerListKey = null;
        this.penaltyEls = new Map();
        this.rematchPending = false;
        this.sfx = null;

        // Power-up on the map (one at a time): visual built once in createPowerUpVisual
        this.powerUpVisual = null;
        this.powerUpId = null;
        this.powerUpKind = null;
        this.powerUpTime = 0;

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
            .catch(e => console.warn('[Tag] SFXManager not available:', e));
    }

    async init() {
        // Apply baby theme if needed
        if (this.isBabyShower) {
            document.documentElement.classList.add('baby-theme');
            const gameTitle = document.querySelector('.game-title');
            if (gameTitle) gameTitle.innerHTML = '¡ATRÁPALO BEBÉ!';
            document.title = '¡Atrápalo Bebé! - Baby Shower';
        }

        this.setupScene();
        this.setupLights();
        this.createFloor();
        this.createPowerUpVisual();

        await this.loadAssets();
        this.loadSFX();
        this.setupRematchButton();
        this.connectToServer();
        this.animate();
        
        window.addEventListener('resize', () => this.onWindowResize());
    }

    setupScene() {
        const isBabyShower = document.documentElement.classList.contains('baby-theme');
        const bgColor = isBabyShower ? 0xFFEFFA : 0x0a0a15;
        
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(bgColor);
        this.scene.fog = new THREE.Fog(bgColor, 20, 50);

        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, TAG_CONFIG.CAMERA_HEIGHT, TAG_CONFIG.CAMERA_HEIGHT / Math.tan(TAG_CONFIG.CAMERA_ANGLE));
        this.camera.lookAt(0, 0, 0);

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
        
        // Add name label styles
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
            }
        `;
        document.head.appendChild(style);
    }

    setupLights() {
        const isBabyShower = document.documentElement.classList.contains('baby-theme');
        const ambientIntensity = isBabyShower ? 0.8 : 0.6;
        
        const ambientLight = new THREE.AmbientLight(0xffffff, ambientIntensity);
        this.scene.add(ambientLight);

        const sunLight = new THREE.DirectionalLight(0xffffff, 1);
        sunLight.position.set(10, 20, 10);
        sunLight.castShadow = true;
        sunLight.shadow.mapSize.width = 2048;
        sunLight.shadow.mapSize.height = 2048;
        this.scene.add(sunLight);
    }

    createFloor() {
        const isBabyShower = document.documentElement.classList.contains('baby-theme');
        const floorColor = isBabyShower ? 0xFFFFFF : 0x1a1a2e;
        
        const geometry = new THREE.PlaneGeometry(TAG_CONFIG.MAP_SIZE, TAG_CONFIG.MAP_SIZE);
        const material = new THREE.MeshPhongMaterial({ 
            color: floorColor,
            side: THREE.DoubleSide
        });
        const floor = new THREE.Mesh(geometry, material);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.scene.add(floor);

        // Add grid helper
        const grid = new THREE.GridHelper(
            TAG_CONFIG.MAP_SIZE, 
            20, 
            isBabyShower ? 0xFFC8DD : 0xff3366, 
            isBabyShower ? 0xE8F4FF : 0x333333
        );
        grid.position.y = 0.01;
        this.scene.add(grid);
    }

    // =================================
    // Power-up on the map
    // =================================

    /**
     * Floating, rotating glowing object with an emoji label above it. Built once and
     * hidden; showPowerUp/hidePowerUp toggle it. The light is always in the scene
     * (intensity toggled) so the light count stays constant (no shader recompiles).
     */
    createPowerUpVisual() {
        const group = new THREE.Group();
        group.visible = false;

        const makeMesh = (geometry, color) => {
            const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.y = 1;
            mesh.visible = false;
            group.add(mesh);
            return mesh;
        };
        const meshes = {
            rayo: makeMesh(new THREE.OctahedronGeometry(0.55, 0), POWERUP_STYLE.rayo.color),
            escudo: makeMesh(new THREE.IcosahedronGeometry(0.55, 1), POWERUP_STYLE.escudo.color)
        };

        // Wireframe halo around the solid core for the glow look
        const halo = new THREE.Mesh(
            new THREE.IcosahedronGeometry(0.8, 1),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, wireframe: true })
        );
        halo.position.y = 1;
        group.add(halo);

        // Ring on the floor marking the pickup spot
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.75, 0.95, 48),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.05;
        group.add(ring);

        const light = new THREE.PointLight(POWERUP_STYLE.rayo.color, 0, 7);
        light.position.y = 1.5;
        group.add(light);

        const div = document.createElement('div');
        div.className = 'tag-powerup-label';
        const label = new CSS2DObject(div);
        label.position.set(0, 2.2, 0);
        group.add(label);

        this.scene.add(group);
        this.powerUpVisual = { group, meshes, halo, ring, light, label };
    }

    showPowerUp(powerUp) {
        const visual = this.powerUpVisual;
        if (!visual || !powerUp) return;
        const style = POWERUP_STYLE[powerUp.kind] || POWERUP_STYLE.rayo;

        this.powerUpId = powerUp.id;
        this.powerUpKind = powerUp.kind;
        this.powerUpTime = 0;

        Object.entries(visual.meshes).forEach(([kind, mesh]) => { mesh.visible = kind === powerUp.kind; });
        visual.halo.material.color.setHex(style.color);
        visual.ring.material.color.setHex(style.color);
        visual.light.color.setHex(style.color);
        visual.light.intensity = 2.5;
        visual.label.element.textContent = style.emoji;
        visual.label.element.style.color = style.css;
        visual.label.element.style.display = '';
        visual.group.position.set(powerUp.position.x, 0, powerUp.position.z);
        visual.group.visible = true;
    }

    hidePowerUp() {
        const visual = this.powerUpVisual;
        this.powerUpId = null;
        this.powerUpKind = null;
        if (!visual) return;
        visual.group.visible = false;
        visual.light.intensity = 0;
        // CSS2D elements of hidden objects are hidden by the renderer, but keep the DOM clean
        visual.label.element.style.display = 'none';
    }

    /**
     * Keep the map object in sync with the server snapshot (spawn/expire/collect)
     */
    syncPowerUp(powerUp) {
        if (powerUp) {
            if (powerUp.id !== this.powerUpId) this.showPowerUp(powerUp);
        } else if (this.powerUpId) {
            this.hidePowerUp();
        }
    }

    updatePowerUpVisual(delta) {
        const visual = this.powerUpVisual;
        if (!visual || !visual.group.visible) return;
        this.powerUpTime += delta;
        const t = this.powerUpTime;
        const mesh = visual.meshes[this.powerUpKind];
        const y = 1 + Math.sin(t * 3) * 0.2;
        if (mesh) {
            mesh.position.y = y;
            mesh.rotation.y += delta * 1.5;
            mesh.rotation.x = Math.sin(t * 1.2) * 0.3;
        }
        visual.halo.position.y = y;
        visual.halo.rotation.y -= delta * 0.8;
        const pulse = 1 + Math.sin(t * 4) * 0.08;
        visual.ring.scale.set(pulse, pulse, 1);
        visual.light.intensity = 2.2 + Math.sin(t * 6) * 0.6;
    }

    /**
     * 'tag-powerup' { type: 'spawn' | 'collect' | 'expire', id, kind, playerId?, playerName? }
     */
    handlePowerUpEvent(event) {
        if (!event) return;
        const style = POWERUP_STYLE[event.kind] || POWERUP_STYLE.rayo;

        if (event.type === 'collect') {
            const entity = this.players.get(event.playerId);
            if (entity) entity.showFloatText(style.shout, style.css);
            this.hidePowerUp();
            try {
                this.sfx?.play?.(event.kind === 'rayo' ? 'jump' : 'block');
            } catch (e) { /* ignore audio errors */ }
        } else if (event.type === 'expire') {
            if (event.id === this.powerUpId) this.hidePowerUp();
        }
        // 'spawn' is shown from the next 'tag-state' snapshot (which carries the position)
    }

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

    // =================================
    // Character models (loaded on demand, cached by AssetLoader)
    // =================================

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
            this.loadCharacter(id).catch(err => console.warn(`[Tag] Could not preload ${id}:`, err));
        });
    }

    /** Model for a character, falling back to the default (or any loaded) model. Never rejects. */
    async resolveCharacterModel(characterId) {
        const id = this.characterIdFor(characterId);
        if (this.baseModels[id]) return this.baseModels[id];
        try {
            return await this.loadCharacter(id);
        } catch (err) {
            console.warn(`[Tag] Model ${id} failed, using default:`, err);
        }
        if (id !== this.defaultCharacterId) {
            try {
                return await this.loadCharacter(this.defaultCharacterId);
            } catch (err) {
                console.warn('[Tag] Default model failed too:', err);
            }
        }
        return Object.values(this.baseModels)[0] || null;
    }

    connectToServer() {
        // Load socket.io script first
        const script = document.createElement('script');
        script.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
        script.onload = () => this.initializeSocket();
        document.head.appendChild(script);
    }

    initializeSocket() {
        console.log('[Tag] Connecting to server:', SERVER_URL);
        this.socket = io(SERVER_URL);

        this.socket.on('connect', () => {
            // Recovered connection (Socket.IO connectionStateRecovery): same id, same room,
            // missed events are replayed. Creating a room here would orphan all phones.
            if (this.socket.recovered) {
                console.log(`[Tag] Connection recovered, keeping room ${this.roomCode}`);
                return;
            }

            console.log('[Tag] Connected to server');

            // Reconnected but the session could not be recovered: the old room is gone
            if (this.roomCode) {
                console.warn('[Tag] Session lost, creating a new room');
                this.clearPlayers();
                this.resetMatchUI();
                this.gameStarted = false;
            }

            // Create a new room for tag mode
            const isBabyShower = document.documentElement.classList.contains('baby-theme');
            this.socket.emit('create-room', { 
                gameMode: 'tag',
                isBabyShower: isBabyShower
            }, (response) => {
                if (response.success) {
                    this.roomCode = response.roomCode;
                    this.showRoomCode(this.roomCode);
                    console.log(`[Tag] Room created: ${this.roomCode}`);
                }
            });
        });

        this.socket.on('player-joined', (data) => {
            console.log('[Tag] Player joined:', data.player);
            this.updateRoomOverlay(data.room.playerCount);
            // Download characters already known during the lobby (baby shower auto-assigns)
            const roomPlayers = data.room?.players || [data.player];
            this.prefetchCharacters(roomPlayers.map(p => p?.character));
        });

        this.socket.on('character-selected', (data) => {
            this.prefetchCharacters([data?.character]);
        });

        this.socket.on('player-left', (data) => {
            console.log('[Tag] Player left:', data.playerId);
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
            console.log('[Tag] Round starting', data);
            this.resetMatchUI();
            if (data?.rematch) {
                const itAnnouncement = document.getElementById('it-announcement');
                if (itAnnouncement) {
                    itAnnouncement.textContent = '¡REVANCHA!';
                    itAnnouncement.style.color = '';
                }
            }
        });

        this.socket.on('game-started', (data) => {
            console.log('[Tag] Game started!', data);
            this.gameStarted = true;
            document.getElementById('room-code-overlay')?.classList.add('hidden');
            this.resetMatchUI();
            this.setupPlayers(data.players || []);
        });

        this.socket.on('tag-state', (state) => {
            this.updateGameState(state);
        });

        this.socket.on('tag-transfer', (data) => {
            this.handleTagTransfer(data);
        });

        this.socket.on('tag-powerup', (event) => {
            this.handlePowerUpEvent(event);
        });

        this.socket.on('tag-game-over', (data) => {
            this.showGameOver(data);
        });
    }

    showRoomCode(code) {
        let overlay = document.getElementById('room-code-overlay');
        const mobileUrl = `${window.location.origin}/mobile/index.html?room=${code}`;
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(mobileUrl)}`;
        
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'room-code-overlay';
            overlay.innerHTML = `
                <div class="room-code-content">
                    <h2>🏃 LA TRAE - SALA</h2>
                    <div class="room-code">${code}</div>
                    <div class="qr-container">
                        <img src="${qrCodeUrl}" alt="QR Code" class="qr-code" />
                    </div>
                    <p>Escanea para unirte al juego</p>
                    <div class="url-display">${mobileUrl}</div>
                    
                    <button id="start-game-btn" disabled>ESPERANDO JUGADORES...</button>
                    <div id="player-count-lobby">Jugadores: 0 / 8</div>
                </div>
            `;
            
            const style = document.createElement('style');
            style.textContent = `
                #room-code-overlay {
                    position: fixed; top: 50%; left: 50%;
                    transform: translate(-50%, -50%);
                    background: rgba(10, 10, 21, 0.95);
                    border: 3px solid #ffcc00; border-radius: 24px;
                    padding: 40px; z-index: 1000; text-align: center;
                    font-family: 'Orbitron', sans-serif;
                    box-shadow: 0 0 50px rgba(255, 204, 0, 0.3);
                    min-width: 320px;
                }
                .room-code-content h2 { color: #ffcc00; margin-bottom: 20px; font-size: 1.5rem; }
                .room-code { 
                    font-size: 4rem; font-weight: 900; color: #fff; 
                    letter-spacing: 15px; margin-bottom: 20px;
                    text-shadow: 0 0 20px rgba(255, 255, 255, 0.5);
                }
                .qr-container { 
                    background: white; padding: 15px; border-radius: 16px; 
                    display: inline-block; margin-bottom: 20px;
                }
                .qr-code { display: block; width: 150px; height: 150px; }
                .url-display { color: #ff3366; font-size: 0.8rem; margin-bottom: 25px; opacity: 0.8; }
                #start-game-btn {
                    width: 100%; padding: 18px; font-family: 'Orbitron';
                    font-size: 1.2rem; font-weight: 900;
                    background: linear-gradient(135deg, #ffcc00, #ff6600);
                    border: none; border-radius: 12px; color: #000;
                    cursor: pointer; transition: all 0.3s;
                }
                #start-game-btn:disabled { opacity: 0.5; cursor: not-allowed; filter: grayscale(1); }
                #start-game-btn:not(:disabled):hover { transform: scale(1.05); box-shadow: 0 0 30px #ffcc00; }
                #player-count-lobby { margin-top: 15px; color: rgba(255,255,255,0.6); font-size: 0.9rem; }
                .hidden { display: none !important; }
            `;
            document.head.appendChild(style);
            document.body.appendChild(overlay);
            
            document.getElementById('start-game-btn').addEventListener('click', () => {
                this.socket.emit('start-game');
            });
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

    updateRoomOverlay(count) {
        const btn = document.getElementById('start-game-btn');
        const countEl = document.getElementById('player-count-lobby');
        if (btn && countEl) {
            countEl.textContent = `Jugadores: ${count} / 8`;
            if (count >= 2) {
                btn.disabled = false;
                btn.textContent = '¡INICIAR JUEGO!';
            } else {
                btn.disabled = true;
                btn.textContent = 'ESPERANDO JUGADORES...';
            }
        }
    }

    clearPlayers() {
        this.players.forEach(entity => {
            this.scene.remove(entity.root);
            entity.dispose();
        });
        this.players.clear();
        this.playerListKey = null;
        this.penaltyEls.clear();

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
            const color = p.color || TAG_CONFIG.PLAYER_COLORS[index % TAG_CONFIG.PLAYER_COLORS.length];

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
                    console.error(`[Tag] No model available for player ${p.name}`);
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
        const entity = new TagPlayerEntity(
            p.id,
            p.number,
            color,
            baseModel,
            this.baseAnimations
        );
        entity.setName(p.name);
        this.players.set(p.id, entity);
        this.scene.add(entity.root);
        return entity;
    }

    getPlayerColor(id, fallback = '#fff') {
        return this.players.get(id)?.color || fallback;
    }

    /**
     * Reset HUD and overlays for a fresh match (idempotent)
     */
    resetMatchUI() {
        this.matchOver = false;
        this.matchWinnerId = null;
        document.getElementById('round-end-overlay')?.classList.add('hidden');
        document.getElementById('tournament-end-overlay')?.classList.add('hidden');

        const timerElement = document.getElementById('match-timer');
        if (timerElement) timerElement.textContent = '02:00';

        const itAnnouncement = document.getElementById('it-announcement');
        if (itAnnouncement) {
            itAnnouncement.textContent = '¡BUSCA A ALGUIEN!';
            itAnnouncement.style.color = '';
        }

        const playerList = document.getElementById('tag-player-list');
        if (playerList) playerList.replaceChildren();
        this.playerListKey = null;
        this.penaltyEls.clear();

        this.hidePowerUp();
        this.setRematchButtonState(false);
    }

    updatePlayerList(players) {
        const playerList = document.getElementById('tag-player-list');
        if (!playerList) return;

        // Sort players by penalty time (ascending - lower is better)
        const sortedPlayers = [...players].sort((a, b) => a.penaltyTime - b.penaltyTime);

        // Rebuild the DOM only when order, names or "it" status change
        const key = sortedPlayers.map(p => `${p.id}|${p.name}|${p.isIt ? 1 : 0}`).join(';');
        if (key !== this.playerListKey) {
            this.playerListKey = key;
            this.penaltyEls.clear();
            playerList.replaceChildren();

            sortedPlayers.forEach(p => {
                const item = document.createElement('div');
                item.className = `tag-player-item ${p.isIt ? 'is-it' : ''}`;
                item.style.setProperty('--player-color', p.color || this.getPlayerColor(p.id));

                const nameEl = document.createElement('span');
                nameEl.className = 'tag-player-name';
                nameEl.textContent = `${p.name} `;
                if (p.isIt) {
                    const badge = document.createElement('span');
                    badge.className = 'tag-badge';
                    badge.textContent = 'IT';
                    nameEl.appendChild(badge);
                }

                const penaltyEl = document.createElement('span');
                penaltyEl.className = 'tag-penalty-time';

                item.appendChild(nameEl);
                item.appendChild(penaltyEl);
                playerList.appendChild(item);
                this.penaltyEls.set(p.id, penaltyEl);
            });
        }

        // Cheap text-only updates for the penalty timers
        sortedPlayers.forEach(p => {
            const el = this.penaltyEls.get(p.id);
            if (!el) return;
            const text = `${(p.penaltyTime / 1000).toFixed(1)}s`;
            if (el.textContent !== text) el.textContent = text;
        });
    }

    updateGameState(state) {
        if (!state) return;

        const timerElement = document.getElementById('match-timer');
        if (timerElement) {
            const remainingTime = state.remainingTime || 0;
            const seconds = Math.floor(remainingTime / 1000);
            const m = Math.floor(seconds / 60).toString().padStart(2, '0');
            const s = (seconds % 60).toString().padStart(2, '0');
            const text = `${m}:${s}`;
            if (timerElement.textContent !== text) timerElement.textContent = text;
        }

        // The final 'finished' snapshot carries winner/ranking instead of players
        const players = Array.isArray(state.players) ? state.players : null;

        if (state.gameState === 'finished') this.hidePowerUp();
        else if ('powerUp' in state) this.syncPowerUp(state.powerUp);

        if (players) {
            this.updatePlayerList(players);

            // Only apply state here; animations are advanced in the render loop
            players.forEach(pState => {
                const entity = this.players.get(pState.id);
                if (entity) {
                    if (pState.name && entity.name !== pState.name) entity.setName(pState.name);
                    entity.applyState(pState);
                } else if (this.pendingPlayers.has(pState.id)) {
                    this.pendingStates.set(pState.id, pState); // Applied when its model arrives
                }
            });
        }

        const itAnnouncement = document.getElementById('it-announcement');
        if (itAnnouncement) {
            if (state.gameState === 'finished') {
                itAnnouncement.textContent = '¡TIEMPO AGOTADO!';
                itAnnouncement.style.color = '#fff';
            } else if (players) {
                const itPlayer = players.find(p => p.isIt);
                if (itPlayer) {
                    const text = `¡${String(itPlayer.name || '').toUpperCase()} LA TRAE!`;
                    if (itAnnouncement.textContent !== text) {
                        itAnnouncement.textContent = text;
                        itAnnouncement.style.color = itPlayer.color || this.getPlayerColor(itPlayer.id);
                    }
                }
            }
        }
    }

    handleTagTransfer(data) {
        console.log(`Tag transfer: ${data.oldItId} -> ${data.newItId}`);
        const entity = this.players.get(data.newItId);
        if (!entity) return;

        // Burst + flash on the newly tagged player
        entity.playTagBurst();

        // Pop the announcement
        const itAnnouncement = document.getElementById('it-announcement');
        if (itAnnouncement) {
            itAnnouncement.classList.remove('tag-flash');
            void itAnnouncement.offsetWidth; // restart CSS animation
            itAnnouncement.classList.add('tag-flash');
        }

        // SFX (optional)
        try {
            this.sfx?.play?.('punchHit');
        } catch (e) { /* ignore audio errors */ }
    }

    showGameOver(data) {
        const overlay = document.getElementById('round-end-overlay');
        if (!overlay) return;
        overlay.classList.remove('hidden');

        const winner = data?.winner || null;
        const winnerEl = document.getElementById('round-winner');
        document.getElementById('round-title').textContent = '¡FIN DE LA PARTIDA!';
        winnerEl.textContent = winner ? `👑 ¡${winner.name} GANA!` : '¡FIN!';
        // Server sends no color: fall back to the player's known color
        winnerEl.style.color = (winner && (winner.color || this.getPlayerColor(winner.id, ''))) || '';

        const scoresContainer = document.getElementById('round-scores');
        scoresContainer.replaceChildren();
        const heading = document.createElement('h3');
        heading.textContent = 'TIEMPOS DE PENALIZACIÓN:';
        scoresContainer.appendChild(heading);

        (data?.ranking || []).forEach((p, i) => {
            const pSec = (p.penaltyTime / 1000).toFixed(1);
            const row = document.createElement('div');
            row.style.margin = '10px 0';
            row.innerHTML = `${i + 1}. ${escapeHtml(p.name)}: <strong>${pSec}s</strong>`;
            scoresContainer.appendChild(row);
        });

        document.getElementById('next-round-countdown')?.classList.add('hidden');

        // Freeze players; winner celebrates (entities still loading do it on arrival)
        this.matchOver = true;
        this.matchWinnerId = winner?.id || null;
        this.players.forEach((entity, id) => {
            entity.setFinalPose(winner && id === winner.id ? 'win' : 'idle');
        });

        this.setRematchButtonState(false);
    }

    // =================================
    // Rematch
    // =================================

    setupRematchButton() {
        const btn = document.getElementById('rematch-btn');
        if (!btn || btn.dataset.bound) return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', () => this.requestRematch());
    }

    setRematchButtonState(pending, errorText) {
        this.rematchPending = pending;
        const btn = document.getElementById('rematch-btn');
        if (btn) {
            btn.disabled = pending;
            btn.textContent = pending ? 'PREPARANDO...' : 'REVANCHA';
        }
        const errorEl = document.getElementById('rematch-error');
        if (errorEl) errorEl.textContent = errorText || '';
    }

    requestRematch() {
        if (this.rematchPending || !this.socket) return;
        this.setRematchButtonState(true);

        // Timeout so the button never stays stuck if the ack is lost
        this.socket.timeout(5000).emit('request-rematch', (err, res) => {
            if (err || !res?.success) {
                const reason = err ? 'Sin respuesta del servidor' : (res?.error || 'No se pudo iniciar la revancha');
                console.warn('[Tag] Rematch failed:', reason);
                this.setRematchButtonState(false, reason);
            }
            // On success the button stays disabled until 'round-starting' resets the UI
        });
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        // One shared delta per frame (clamped to avoid jumps after tab switches)
        const delta = Math.min(this.clock.getDelta(), 0.1);

        this.players.forEach(entity => entity.tick(delta));
        this.updatePowerUpVisual(delta);

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
new TagGame();
