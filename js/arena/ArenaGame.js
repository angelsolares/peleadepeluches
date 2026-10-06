/**
 * ARENA DE PELUCHES - Wrestling Ring Game Mode
 * Three.js based arena fighting game with top-down perspective
 * Features: Health system, Stamina, Grabs, Ring-out mechanics
 */

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { SERVER_URL, CONFIG } from '../config.js';
import { AnimationController, ANIMATION_CONFIG } from '../animation/AnimationController.js';
import ArenaPlayerController from './ArenaPlayerController.js';
import ArenaHUD from './ArenaHUD.js';
import TournamentManager from '../tournament/TournamentManager.js';
import { retargetMixamoClip } from '../animation/MixamoRetarget.js';
import { loadClips, loadModel } from '../assets/AssetLoader.js';

// =================================
// Configuration
// =================================

const ARENA_CONFIG = {
    // Ring dimensions - BIGGER RING
    RING_SIZE: 18,          // Width/depth of the ring (was 12)
    RING_HEIGHT: 0.5,       // Height of the ring platform
    ROPE_HEIGHT: 1.5,       // Height of the ropes
    RING_OUT_ZONE: 3,       // Distance outside ring before considered "out"
    
    // Physics
    GRAVITY: -30,
    MOVE_SPEED: 6,
    RUN_SPEED: 10,
    
    // Combat
    MAX_HEALTH: 100,
    MAX_STAMINA: 100,
    STAMINA_REGEN: 10,      // Per second
    
    // Stamina costs
    PUNCH_STAMINA: 15,
    KICK_STAMINA: 20,
    GRAB_STAMINA: 25,
    THROW_STAMINA: 30,
    BLOCK_STAMINA_PER_SEC: 5,
    
    // Damage
    PUNCH_DAMAGE: 10,
    KICK_DAMAGE: 15,
    THROW_DAMAGE: 25,
    RING_OUT_DAMAGE: 50,
    
    // Camera - adjusted for bigger ring
    CAMERA_HEIGHT: 24,
    CAMERA_ANGLE: Math.PI / 3.5, // Slightly less steep for better view
};

// Character models (same as main game)
const CHARACTER_MODELS = {
    baby: { name: 'Bebé', file: 'bebe.fbx', thumbnail: '👶' },
    edgar: { name: 'Edgar', file: 'Edgar_Model.fbx', thumbnail: '👦' },
    isabella: { name: 'Isabella', file: 'Isabella_Model.fbx', thumbnail: '👧' },
    jesus: { name: 'Jesus', file: 'Jesus_Model.fbx', thumbnail: '🧔' },
    lia: { name: 'Lia', file: 'Lia_Model.fbx', thumbnail: '👩' },
    hector: { name: 'Hector', file: 'Hector.fbx', thumbnail: '🧑' },
    katy: { name: 'Katy', file: 'Katy.fbx', thumbnail: '👱‍♀️' },
    mariana: { name: 'Mariana', file: 'Mariana.fbx', thumbnail: '👩‍🦱' },
    sol: { name: 'Sol', file: 'Sol.fbx', thumbnail: '🌞' },
    yadira: { name: 'Yadira', file: 'Yadira.fbx', thumbnail: '💃' },
    angel: { name: 'Angel', file: 'Angel.fbx', thumbnail: '😇' },
    lidia: { name: 'Lidia', file: 'Lidia.fbx', thumbnail: '👩‍🦰' },
    fabian: { name: 'Fabian', file: 'Fabian.fbx', thumbnail: '🧑‍🦲' },
    marile: { name: 'Marile', file: 'Marile.fbx', thumbnail: '👩‍🦳' },
    gabriel: { name: 'Gabriel', file: 'Gabriel.fbx', thumbnail: '👼' }
};

// Animation files (loaded in parallel through AssetLoader: animation-only JSON clips)
const ANIMATION_FILES = {
    walk: 'Meshy_AI_Animation_Walking_withSkin.fbx',
    run: 'Meshy_AI_Animation_Running_withSkin.fbx',
    punch: 'Meshy_AI_Animation_Left_Uppercut_from_Guard_withSkin.fbx',
    kick: 'Meshy_AI_Animation_Boxing_Guard_Right_Straight_Kick_withSkin.fbx',
    hit: 'Meshy_AI_Animation_Hit_Reaction_1_withSkin.fbx',
    fall: 'Meshy_AI_Animation_Shot_and_Slow_Fall_Backward_withSkin.fbx',
    block: 'Meshy_AI_Animation_Block3_withSkin.fbx',
    taunt: 'Meshy_AI_Animation_Hip_Hop_Dance_withSkin.fbx',
    grab: 'Meshy_AI_Animation_Grab_Held_withSkin.fbx',
    throw: 'Meshy_AI_Animation_Throw_withSkin.fbx'
};

// Baby shower only: walk/run are mapped to crawling (see AnimationController.play)
const BABY_ANIMATION_FILES = {
    crawling: 'Crawling.fbx'
};

// Extra keys that reuse an already loaded clip (escape sequence). Each one gets its own
// copy so it keeps its own mixer action, exactly like when the file was loaded twice.
const ANIMATION_ALIASES = {
    uppercut: 'punch',
    knockdown: 'fall'
};

// One color per player slot (rooms support up to 8 players)
const PLAYER_COLORS = ['#ff3366', '#00ffcc', '#ffcc00', '#9966ff', '#ff8800', '#33ccff', '#66ff33', '#ff66cc'];

/**
 * Escape player-provided text before inserting it with innerHTML
 */
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
}

/**
 * Spawn position for slot `index` out of `total` players, evenly spread around the ring
 */
function getSpawnPosition(index, total) {
    const slots = Math.max(total || 0, 2);
    const angle = (index / slots) * Math.PI * 2;
    const radius = ARENA_CONFIG.RING_SIZE / 3;
    return new THREE.Vector3(
        Math.cos(angle) * radius,
        ARENA_CONFIG.RING_HEIGHT,
        Math.sin(angle) * radius
    );
}

// =================================
// Wrestling (grapples) configuration
// =================================

// Mixamo clips (skinless FBX in assets/mixamo) retargeted onto each character's Meshy skeleton
const MIXAMO_FILES = {
    idle: 'fighting_idle.fbx',        // Guard stance (replaces the paused-walk idle)
    tieup: 'hold_off_assailant.fbx',  // Collar-and-elbow struggle
    headbutt: 'headbutt.fbx',
    knee: 'illegal_knee.fbx',
    suplex: 'falling_back.fbx',       // Suplex attacker: falls on the back
    stomp: 'stomping.fbx',
    kneel: 'kneel.fbx',               // Pin cover (kneels down then stays kneeling: played once, clamped)
    down: 'laying_breathless.fbx',    // On the mat, lying on the back (the clip itself lies the body down)
    getup: 'getting_up_c.fbx',        // Gets up from lying on the back

    // Phase 2: taunts, victory and signature finishers
    tauntChest: 'taunt_chest_thump.fbx',
    tauntCry: 'taunt_battlecry.fbx',
    tauntFlex: 'taunt_flex.fbx',
    tauntGesture: 'taunt_gesture.fbx',
    victory: 'victory.fbx',
    kickMma: 'mma_kick.fbx',          // Superkick variants
    kickFlying: 'flying_kick.fbx',
    kickHurricane: 'hurricane_kick.fbx',
    jumpAttack: 'jump_attack.fbx',    // Splash variants (the leap itself is procedural)
    dive: 'dive_forward.fbx',
    sit: 'sitting.fbx'                // Piledriver attacker: only the sit-down part is used
};

// Meshy clip copied in when a Mixamo clip can't be loaded/retargeted (no fallback = skipped)
const MIXAMO_FALLBACKS = {
    tieup: 'grab', headbutt: 'punch', knee: 'kick', suplex: 'fall',
    stomp: 'kick', kneel: 'block', down: 'fall',
    kickMma: 'kick', kickFlying: 'kick', kickHurricane: 'kick'
};

// =================================
// Spirit meter, taunts & finishers (phase 2)
// =================================

// Each plush has its own taunt ('tauntDance' = private copy of the Meshy hip-hop dance)
const TAUNT_CLIPS = ['tauntChest', 'tauntCry', 'tauntFlex', 'tauntGesture', 'tauntDance'];
const CHARACTER_TAUNTS = {
    edgar: 'tauntChest', hector: 'tauntChest', baby: 'tauntChest',
    marile: 'tauntCry', gabriel: 'tauntCry', fabian: 'tauntCry',
    sol: 'tauntFlex', lidia: 'tauntFlex', angel: 'tauntFlex',
    jesus: 'tauntGesture', isabella: 'tauntGesture', katy: 'tauntGesture',
    lia: 'tauntDance', yadira: 'tauntDance', mariana: 'tauntDance'
};

const SUPERKICK_CLIPS = { mma: 'kickMma', flying: 'kickFlying', hurricane: 'kickHurricane' };
const FINISHER_COLORS = { powerbomb: 0xff3366, piledriver: 0x9966ff, ddt: 0x00ffcc, superkick: 0xffcc00, splash: 0x33ccff };

// Head direction of a finisher victim once on the mat, relative to the attacker -> defender angle
// (0 = head away from the attacker, PI = head towards the attacker)
const FLIGHT_BETA = { slam: Math.PI / 2, suplex: 0, powerbomb: 0, piledriver: Math.PI, ddt: Math.PI };
// Where the victim is held, in front of the attacker (world units along attacker -> defender)
const FLIGHT_HOLD_OFFSET = { powerbomb: 0.35, piledriver: 0.38, ddt: 0.45 };

const FINISHER_CONFIG = {
    TAUNT_MS: 2500,            // Server taunt duration
    SPECIAL_MS: 12000,         // Server SPECIAL_DURATION (fallback when the event has none)
    CAMERA_HEIGHT: 4.5,        // Punch-in camera height during a finisher (normal: 7-20)
    CAMERA_LERP: 0.12,
    CAMERA_HOLD_MS: 600,       // Camera stays punched in after the move ends
    BANNER_AFTER_IMPACT_MS: 1100,
    POWERBOMB_LIFT: 1.4,       // Lowest body point (the head) at the top: hips end up ~2.2 above the mat
    POWERBOMB_TOP_ROT: 0.55 * Math.PI, // Upside down, slightly tilted, back against the attacker
    PILEDRIVER_HEAD: 0.9,      // Head height while held upside down (attacker's chest)
    PILEDRIVER_DROP: 0.62,     // Fraction of the impact delay where the attacker starts sitting
    DDT_SPIKE_ROT: -1.6 * Math.PI, // Head-first into the mat, legs up
    DDT_ARC: 0.35,
    FALL_MS: 380,              // Piledriver / DDT: victim topples flat after the head hits the mat
    KICK_AIR_MS: 420,          // Superkick: time to tip from upright to flat while flying
    KICK_MAX_TIMESCALE: 2.2,
    SPLASH_JUMP_ARC: 1.3,      // Extra procedural arc of the leap (minus the clip's own hip rise)
    SPLASH_DIVE_ARC: 0.6,
    SIT_RISE_MS: 600,          // Piledriver attacker stands back up (sit clip played backwards)
    BOUNCE_MS: 280             // Splash victim jolts on the mat
};

// Attacker clip per grapple move ('slamThrow' is a private copy of the Meshy 'throw' clip)
const MOVE_ATTACKER_CLIPS = { headbutt: 'headbutt', knee: 'knee', slam: 'slamThrow', suplex: 'suplex' };

const MOVE_NAMES = { headbutt: '¡CABEZAZO!', knee: '¡RODILLAZO!', slam: '¡AZOTÓN!', suplex: '¡SUPLEX!' };
const MOVE_COLORS = { headbutt: 0xffcc00, knee: 0xff6600, slam: 0xff3366, suplex: 0x9966ff };

const WRESTLE_CONFIG = {
    LIFT_HEIGHT: 1.7,            // Slam: lowest point of the lifted body above the mat (world units)
    SUPLEX_PEAK: 1.5,            // Suplex: arc height of the lowest point of the body
    SUPLEX_FALL_FRACTION: 0.45,  // Point of falling_back where the back hits the mat (synced to the impact)
    GETUP_MS: 1500,              // Server GETUP_DURATION
    POST_SUPLEX_GETUP_MS: 700,   // The suplexing attacker scrambles back up after the move
    STOMP_MS: 800,
    KNEEL_SPEED: 1.5,
    HIT_REACT_SPEED: 1.5,
    LANDING_HOLD_MS: 600         // Keep the landing spot until the server position catches up
};

// =================================
// Ropes, running strikes & battle royal (phase 3)
// =================================

const ROPE_CONFIG = {
    POST_INSET: 0.3,             // Ropes run between the corner posts (RING_SIZE / 2 - inset)
    SEGMENTS: 40,                // Segments along each rope, so a contact can bend it
    LEVEL_PUSH: [0.75, 1, 0.85], // Push per rope level (bottom, middle, top)
    PUSH_MS: 90,                 // Rope stretched out by the body
    SPRING_MS: 260,              // Period of the spring-back wobble
    DAMP_MS: 210,                // Decay of the wobble
    LIFE_MS: 1000,
    WIDTH: 1.6,                  // Width (world units) of the pushed part of the rope
    REBOUND_PUSH: 0.55,          // Whipped player hitting the ropes
    BOUNCE_PUSH: 0.45,           // Player running into the ropes
    LEAN_MS: 300,                // Player sinks into the ropes and is flung back
    LEAN_ANGLE: 0.38,
    LEAN_SINK: 0.35,
    RUN_TIMESCALE: 1.35,         // Run clip speed while whipped
    WHIP_FLING_MS: 520,          // Attacker's fling (throw clip)
    SOUND_GUARD_MS: 400          // No generic rope "bonk" right after a rebound/bounce sound
};

const STRIKE_CONFIG = {
    ACTIVE_FRAME_MS: 150,        // Server ACTIVE_FRAME_DELAY: when a running strike connects
    LARIAT_SWING_MS: 560,
    DROPKICK_MS: 700,            // Flying kick one-shot (the server lays the kicker down at ~300 ms)
    DROPKICK_HOP: 0.45,
    DROPKICK_HOP_MS: 320,
    KNOCK_LARIAT_MS: 540,        // Victim turned inside out: legs fly up past flat, back on the mat
    KNOCK_LARIAT_OVER: 0.6,
    KNOCK_LARIAT_HEIGHT: 0.55,
    KNOCK_DROPKICK_MS: 420,      // Victim knocked straight back
    KNOCK_DROPKICK_HEIGHT: 0.3,
    KNOCK_SELF_MS: 260,          // Dropkicker drops onto their back
    SELF_FALL_WINDOW_MS: 1500
};

const STRIKE_NAMES = { lariat: '¡TENDEDERO!', dropkick: '¡DROPKICK!' };
const STRIKE_COLORS = { lariat: 0xff8800, dropkick: 0x33ccff };

// Battle royal elimination feed
const ELIMINATION_REASONS = { ringout: 'RING-OUT', knockout: 'KO', pinfall: 'CUENTA DE 3', disconnect: 'ABANDONO' };

const UP_AXIS = new THREE.Vector3(0, 1, 0);
const IDENTITY_QUAT = new THREE.Quaternion();
// Tips an upright model onto its back (head towards local -Z): only used if the lying clip doesn't lie down
const LIE_BACK_QUAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
// Rough body points (world units, model origin at the feet) if the pose analysis can't run
const DEFAULT_BODY_POINTS = [
    new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(0, 0.9, 0),
    new THREE.Vector3(0.12, 0.08, 0), new THREE.Vector3(-0.12, 0.08, 0)
];

// Scratch objects for the per-frame procedural motion
const _flightPos = new THREE.Vector3();
const _pointTmp = new THREE.Vector3();
const _qAxis = new THREE.Quaternion();
const _qSpin = new THREE.Quaternion();
const _qPose = new THREE.Quaternion();

/**
 * Lowest Y of a set of body points (model space) once rotated by q
 */
function minPointY(q, points) {
    let min = Infinity;
    for (const p of points) {
        const y = _pointTmp.copy(p).applyQuaternion(q).y;
        if (y < min) min = y;
    }
    return min === Infinity ? 0 : min;
}

function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function easeOut(t) {
    return 1 - (1 - t) * (1 - t);
}

/**
 * Rope displacement over time for one contact (1 = fully pushed out): stretched out by the
 * body, then springs back with a damped wobble
 */
function ropeImpulseAmp(t) {
    if (t < 0) return 0;
    const push = ROPE_CONFIG.PUSH_MS;
    if (t < push) return easeOut(t / push);
    const k = t - push;
    return Math.exp(-k / ROPE_CONFIG.DAMP_MS) * Math.cos((2 * Math.PI * k) / ROPE_CONFIG.SPRING_MS);
}

// =================================
// Arena Player Entity
// =================================

class ArenaPlayerEntity {
    /**
     * @param {object} animations - Clips for this character (Meshy clips + retargeted grapple clips)
     * @param {object|null} wrestleMeta - Pose info of the grapple clips (see ArenaGame.analyzeWrestlePoses)
     */
    constructor(id, number, color, baseModel, animations, wrestleMeta = null) {
        this.id = id;
        this.number = number;
        this.color = color;
        this.name = `Player ${number}`;

        // Clone the model
        this.model = SkeletonUtils.clone(baseModel);
        this.model.scale.set(0.01, 0.01, 0.01);

        // Apply color tint
        this.applyColorTint(color);

        // Create floating name label
        this.nameLabel = this.createNameLabel(color);
        this.model.add(this.nameLabel);

        // Animation controller
        this.animController = new AnimationController(this.model, animations);
        this.wrestleMeta = wrestleMeta;

        // Grapple visuals (host side). While lockAnim is set, a grapple state owns the
        // animation: locomotion and the legacy hit/idle/attack calls can't override it.
        this.lockAnim = null;
        this.lockOpts = null;
        this.timedAnim = null;    // { name, start, until, yaw, cancelOnMove } short one-shot (stomp, scramble up)
        this.poseYaw = null;      // Fixed yaw while on the mat / getting up
        this.flight = null;       // Procedural slam/suplex motion of a defender
        this.positionHold = null; // { x, z, until } landing spot kept until the server position catches up
        this.moveVisual = null;   // { type, role } grapple move being shown
        this.leap = null;         // Splash attacker: procedural leap onto the landing spot
        this.launch = null;       // Superkick victim: tips back flat while the server flies them
        this.bounce = null;       // Splash victim: short jolt on the mat
        this.celebrating = false; // Match winner: victory clip, grapple sync ignored

        // Ropes & running strikes (phase 3)
        this.knock = null;        // Lariat/dropkick: procedural tip from upright onto the back
        this.hop = null;          // Dropkick: small vertical hop
        this.ropeLean = null;     // Sinking into the ropes on a rebound
        this.leanApplied = false; // The lean tilted the model this frame (undone next frame)
        this.leanBaseYaw = 0;
        this.selfFallUntil = 0;   // Dropkicker: the next isDown is them landing on their back

        // Arena-specific controller (360 movement)
        this.controller = new ArenaPlayerController(id, number, color);
    }

    /**
     * Create floating name label above player
     */
    createNameLabel(color) {
        const div = document.createElement('div');
        div.className = 'arena-player-name-label';
        div.textContent = this.name;
        div.style.color = color;

        const label = new CSS2DObject(div);
        // Position above player's head (in model's local space, scaled by 0.01)
        // 280 in local = 2.8 in world (well above head, not covering face)
        label.position.set(0, 280, 0);
        label.center.set(0.5, 0);

        return label;
    }

    /**
     * Update the name label text
     */
    setName(name) {
        this.name = name;
        if (this.nameLabel && this.nameLabel.element) {
            this.nameLabel.element.textContent = name;
        }
    }

    applyColorTint(color) {
        const tintColor = new THREE.Color(color);

        this.model.traverse((child) => {
            if (child.isMesh && child.material) {
                if (Array.isArray(child.material)) {
                    child.material = child.material.map(m => m.clone());
                } else {
                    child.material = child.material.clone();
                }

                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(mat => {
                    mat.transparent = false;
                    mat.opacity = 1.0;
                    mat.depthWrite = true;
                    mat.depthTest = true;
                    mat.side = THREE.FrontSide;

                    if (mat.emissive) {
                        mat.emissive = tintColor;
                        mat.emissiveIntensity = 0.15;
                    }
                    mat.needsUpdate = true;
                });
            }

            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
    }

    playAnimation(actionName) {
        // A grapple state owns the animation (tie-up, move, on the mat, pin...)
        if (this.lockAnim) return;
        this.timedAnim = null;

        switch (actionName) {
            case 'idle': this.playFightIdle(); break;
            case 'walk': this.animController.playWalk(); break;
            case 'run': this.animController.playRun(); break;
            case 'punch': this.animController.playPunch(); break;
            case 'kick': this.animController.playKick(); break;
            case 'hit': this.animController.playHit(); break;
            case 'fall': this.animController.playFall(); break;
            case 'block': this.animController.playBlock(); break;
            case 'taunt': this.animController.playTaunt(); break;
            case 'grab': this.animController.play('grab'); break;
            case 'throw': this.animController.play('throw'); break;
            default: this.animController.play(actionName);
        }

        // Apply speed multipliers for Arena mode (faster action)
        if (this.animController && this.animController.mixer) {
            const ARENA_SPEEDS = {
                'walk': 2.0,
                'run': 1.5,
                'throw': 2.0,
                'grab': 1.5,
                'punch': 2.0,
                'kick': 2.0
            };

            if (ARENA_SPEEDS[actionName]) {
                const action = this.animController.mixer.clipAction(
                    this.animController.animations[actionName]
                );
                if (action) {
                    action.timeScale = ARENA_SPEEDS[actionName];
                }
            }
        }
    }

    /**
     * Guard-stance idle (Mixamo fighting_idle). Falls back to the old paused-walk idle.
     */
    playFightIdle(fade = ANIMATION_CONFIG.fadeDuration.toIdle) {
        const ac = this.animController;
        const idle = ac.actions.idle;
        if (!idle) return ac.playIdle();
        if (ac.isAttacking) return false;
        if (ac.currentAction === idle && idle.isRunning()) return true;
        return ac.play('idle', fade);
    }

    clipDuration(name) {
        const action = this.animController.actions[name];
        return action ? action.getClip().duration : 1;
    }

    isFallbackClip(name) {
        return !!this.wrestleMeta?.fallback?.has(name);
    }

    /**
     * Force a clip while a grapple state is active (see playState for the options)
     */
    setLock(name, opts = {}) {
        if (!this.animController.actions[name]) return false;
        // Meshy stand-ins for missing Mixamo clips are one-shots: play them once and hold
        const options = this.isFallbackClip(name) ? { ...opts, loop: false } : opts;

        if (name !== 'down' && name !== 'getup') this.poseYaw = null;
        this.timedAnim = null;
        if (this.lockAnim === name && !opts.restart) return true;

        this.lockAnim = name;
        this.lockOpts = options;
        this.playLockClip(name, options);
        return true;
    }

    /**
     * playState + optional start time (options.startAt, seconds into the clip)
     */
    playLockClip(name, options) {
        const ac = this.animController;
        ac.playState(name, options);
        const action = ac.actions[name];
        if (action && options.startAt > 0) {
            action.time = Math.min(options.startAt, action.getClip().duration);
        }
    }

    /**
     * Lock a one-shot clip so that clip time `keySec` (the kick connecting, the landing...)
     * is shown exactly `keyMs` from now. Too slow a clip is started part-way in.
     */
    playSynced(name, keySec, keyMs, { maxTimeScale = FINISHER_CONFIG.KICK_MAX_TIMESCALE, fade = 0.1 } = {}) {
        if (!this.animController.actions[name]) return false;
        const duration = this.clipDuration(name);
        const key = Math.max(0, Math.min(Number.isFinite(keySec) ? keySec : duration * 0.5, duration));
        const keyS = Math.max(0.05, keyMs / 1000);
        let timeScale = key > 0.01 ? key / keyS : 1;
        let startAt = 0;
        if (timeScale > maxTimeScale) {
            timeScale = maxTimeScale;
            startAt = key - timeScale * keyS;
        }
        return this.setLock(name, { loop: false, timeScale, fade, restart: true, startAt });
    }

    /**
     * Lock a one-shot clip so that its segment [segStart, segEnd] (seconds) plays between
     * msStart and msEnd from now (the piledriver sit-down lands exactly on the impact)
     */
    playSegment(name, segStart, segEnd, msStart, msEnd, fade = 0.15) {
        if (!this.animController.actions[name]) return false;
        const s0 = msStart / 1000;
        const s1 = Math.max(s0 + 0.05, msEnd / 1000);
        let timeScale = (segEnd - segStart) / (s1 - s0);
        let startAt = segStart - timeScale * s0;
        if (!(timeScale > 0) || startAt < 0) {
            startAt = 0;
            timeScale = Math.max(0.1, segEnd / s1);
        }
        timeScale = Math.min(timeScale, 4);
        return this.setLock(name, { loop: false, timeScale, fade, restart: true, startAt });
    }

    /**
     * Leave the grapple state: locomotion (fight idle / walk / run) takes over next frame
     */
    clearLock() {
        const prev = this.lockAnim;
        if (!prev) return;
        this.lockAnim = null;
        this.lockOpts = null;
        if (this.poseYaw !== null) {
            this.poseYaw = null;
            this.model.rotation.set(0, this.model.rotation.y, 0);
        }

        // The suplexing attacker ends on their back: scramble up (cancelled as soon as they move)
        if (prev === 'suplex' && !this.controller.isEliminated) {
            const m = this.wrestleMeta;
            const yaw = m ? this.model.rotation.y + (m.suplexEndAlpha - m.getupAlpha) : null;
            this.playTimed('getup', WRESTLE_CONFIG.POST_SUPLEX_GETUP_MS, { yaw });
        }

        // The piledriver attacker sat down: stand back up (the sit-down played backwards)
        const sit = prev === 'sit' ? this.getSitSegment() : null;
        if (sit && !this.controller.isEliminated) {
            const ms = FINISHER_CONFIG.SIT_RISE_MS;
            this.playTimed('sit', ms, { from: sit.end, timeScale: -(sit.end - sit.start) / (ms / 1000) });
        }
    }

    /**
     * Sit-down part of the sitting clip ({ start, end } seconds), from the pose analysis or a guess
     */
    getSitSegment() {
        if (!this.animController.actions.sit || this.isFallbackClip('sit')) return null;
        if (this.wrestleMeta?.sit) return this.wrestleMeta.sit;
        const duration = this.clipDuration('sit');
        return { start: duration * 0.15, end: duration * 0.5 };
    }

    /**
     * Short one-shot that locomotion can't override until it ends (or the player moves).
     * `from` starts part-way into the clip (with a negative timeScale it plays backwards).
     */
    playTimed(name, ms, { yaw = null, cancelOnMove = true, timeScale, from = 0 } = {}) {
        const ac = this.animController;
        if (this.lockAnim || !ac.actions[name]) return false;
        const duration = this.clipDuration(name);
        this.playLockClip(name, {
            loop: false,
            timeScale: timeScale ?? Math.max(0.1, duration / (ms / 1000)),
            fade: 0.1,
            restart: true,
            startAt: from
        });
        const now = performance.now();
        this.timedAnim = { name, start: now, until: now + ms, yaw, cancelOnMove };
        return true;
    }

    /**
     * Timed one-shot (see playTimed) where clip time `keySec` (a kick connecting) is shown
     * `keyMs` from now. Unlike playSynced it isn't a grapple lock, so the arena-state sync
     * doesn't cancel it while the player keeps running.
     */
    playTimedSynced(name, keySec, keyMs, ms, maxTimeScale = FINISHER_CONFIG.KICK_MAX_TIMESCALE) {
        if (!this.animController.actions[name]) return false;
        const duration = this.clipDuration(name);
        const key = Math.max(0, Math.min(Number.isFinite(keySec) ? keySec : duration * 0.5, duration));
        const keyS = Math.max(0.05, keyMs / 1000);
        let timeScale = key > 0.01 ? key / keyS : 1;
        let from = 0;
        if (timeScale > maxTimeScale) {
            timeScale = maxTimeScale;
            from = key - timeScale * keyS;
        }
        return this.playTimed(name, ms, { cancelOnMove: false, timeScale, from });
    }

    /**
     * @returns {boolean} True while a timed one-shot is playing
     */
    updateTimed(now, isMoving) {
        const timed = this.timedAnim;
        if (!timed) return false;
        const ac = this.animController;
        const replaced = ac.currentAction !== ac.actions[timed.name];
        const moved = timed.cancelOnMove && isMoving && now - timed.start > 250;
        if (now >= timed.until || replaced || moved) {
            this.timedAnim = null;
            if (timed.yaw !== null) this.model.rotation.set(0, this.model.rotation.y, 0);
            return false;
        }
        return true;
    }

    /**
     * Lying on the mat (keeps the yaw it landed with)
     */
    enterDown() {
        if (this.lockAnim === 'down') return;
        if (this.poseYaw === null) this.poseYaw = this.model.rotation.y;
        this.setLock('down', { loop: true, fade: 0.25 });
    }

    /**
     * Get up from the mat in WRESTLE_CONFIG.GETUP_MS
     */
    enterGetUp() {
        if (this.lockAnim === 'getup') return;
        if (!this.animController.actions.getup) {
            this.clearLock();
            return;
        }
        // Turn the model so the get-up clip starts with the head where the lying clip had it
        const m = this.wrestleMeta;
        if (this.lockAnim === 'down' && m) {
            const baseYaw = this.poseYaw ?? this.model.rotation.y;
            this.poseYaw = baseYaw + (m.downAlpha - m.getupAlpha);
        } else {
            this.poseYaw = null;
        }
        this.setLock('getup', {
            loop: false,
            timeScale: this.clipDuration('getup') / (WRESTLE_CONFIG.GETUP_MS / 1000),
            fade: 0.2
        });
    }

    /**
     * How the lying clip lies: head direction (yaw in model space) and body points
     */
    getLieInfo() {
        const m = this.wrestleMeta;
        if (!m || m.downIsLying) {
            return { alpha: m ? m.downAlpha : Math.PI, local: IDENTITY_QUAT, points: m?.downPoints || DEFAULT_BODY_POINTS };
        }
        // The clip doesn't lie the model down: tip it over procedurally (head towards local -Z)
        return { alpha: Math.PI, local: LIE_BACK_QUAT, points: m.restPoints || DEFAULT_BODY_POINTS };
    }

    /**
     * Start the procedural flight of a slammed/suplexed/finished defender. The body plays the
     * lying clip the whole time and is rotated/moved as a rigid block, landing on its back on
     * `landing` exactly impactMs after the start (endMs > impactMs: it keeps moving after the
     * impact, e.g. toppling flat after a head-first spike).
     * - slam: lifted horizontal above the attacker's head, then slammed in front
     * - suplex: arcs backwards over the attacker's head (270 deg flip) and lands behind
     * - powerbomb: bent over the attacker, lifted upside down over the shoulders, driven down flat
     * - piledriver: flipped upside down (facing the attacker), dropped on the head as the
     *   attacker sits, then topples flat away from the attacker
     * - ddt: twisted head-first into the mat, legs up, then topples flat
     */
    startFlight({ type, start, attacker, landing, angle, impactMs, endMs, dropStartMs }) {
        const lie = this.getLieInfo();
        // World direction the head points once landed (see FLIGHT_BETA)
        const beta = angle + (FLIGHT_BETA[type] ?? 0);
        const yaw = beta - lie.alpha;
        const qFinal = new THREE.Quaternion().setFromAxisAngle(UP_AXIS, yaw).multiply(lie.local);
        const impact = Math.max(1, impactMs || 1);
        const dir = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)); // attacker -> defender
        const attackerPos = new THREE.Vector3(attacker.x, 0, attacker.z);

        this.flight = {
            type,
            yaw,
            qFinal,
            axis: new THREE.Vector3(Math.cos(beta), 0, -Math.sin(beta)), // up x head direction
            points: lie.points,
            minYFinal: minPointY(qFinal, lie.points),
            start: new THREE.Vector3(start.x, 0, start.z),
            attacker: attackerPos,
            hold: attackerPos.clone().addScaledVector(dir, FLIGHT_HOLD_OFFSET[type] || 0),
            landing: new THREE.Vector3(landing.x, 0, landing.z),
            ground: Number.isFinite(landing.y) ? landing.y : ARENA_CONFIG.RING_HEIGHT,
            impactMs: impact,
            endMs: Math.max(impact, endMs || impact),
            dropStartMs: dropStartMs || impact * FINISHER_CONFIG.PILEDRIVER_DROP,
            startTime: performance.now()
        };
        this.launch = null;
        this.positionHold = null;
        this.poseYaw = yaw;
        this.setLock('down', { loop: true, fade: 0.2 });
    }

    /**
     * @returns {boolean} True while the flight drives the model transform
     */
    updateFlight(now) {
        const fl = this.flight;
        if (!fl) return false;

        const t = now - fl.startTime;
        const impact = fl.impactMs;
        if (t >= fl.endMs) {
            this.finishFlight();
            return false;
        }

        // rot: around the horizontal axis perpendicular to the head direction (0 = lying flat,
        // -PI/2 = upright, +PI/2 = upside down). spin: extra yaw around the vertical axis.
        let rot = 0;
        let spin = 0;
        let height = 0;
        const PI = Math.PI;

        switch (fl.type) {
            case 'slam': {
                const liftEnd = 0.45 * impact;
                const holdEnd = 0.75 * impact;
                if (t < liftEnd) {
                    // Upright and facing the attacker -> horizontal above their head
                    const s = easeInOut(t / liftEnd);
                    rot = -PI / 2 * (1 - s);
                    spin = -PI / 2 * (1 - s);
                    _flightPos.lerpVectors(fl.start, fl.attacker, s);
                    height = WRESTLE_CONFIG.LIFT_HEIGHT * s;
                } else if (t < holdEnd) {
                    _flightPos.copy(fl.attacker);
                    height = WRESTLE_CONFIG.LIFT_HEIGHT + 0.1 * Math.sin(((t - liftEnd) / (holdEnd - liftEnd)) * PI);
                } else {
                    // Slammed down (accelerating) onto the landing spot
                    const s = (t - holdEnd) / (impact - holdEnd);
                    _flightPos.lerpVectors(fl.attacker, fl.landing, s);
                    height = WRESTLE_CONFIG.LIFT_HEIGHT * (1 - s * s);
                }
                break;
            }
            case 'powerbomb': {
                const liftEnd = 0.42 * impact;
                const holdEnd = 0.72 * impact;
                const lift = FINISHER_CONFIG.POWERBOMB_LIFT;
                const topRot = FINISHER_CONFIG.POWERBOMB_TOP_ROT;
                if (t < liftEnd) {
                    // Upright facing the attacker -> bent over their shoulder -> upside down
                    const s = easeInOut(t / liftEnd);
                    rot = 1.5 * PI + (topRot - 1.5 * PI) * s;
                    _flightPos.lerpVectors(fl.start, fl.hold, s);
                    height = lift * s;
                } else if (t < holdEnd) {
                    // Held high over the shoulders
                    const u = Math.sin(((t - liftEnd) / (holdEnd - liftEnd)) * PI);
                    rot = topRot + 0.06 * u;
                    _flightPos.copy(fl.hold);
                    height = lift + 0.15 * u;
                } else {
                    // Driven down (accelerating), flat on the back onto the landing spot
                    const s = (t - holdEnd) / (impact - holdEnd);
                    const e = s * s;
                    rot = topRot * (1 - e);
                    _flightPos.lerpVectors(fl.hold, fl.landing, e);
                    height = lift * (1 - e);
                }
                break;
            }
            case 'piledriver': {
                const flipEnd = 0.45 * impact;
                const dropStart = Math.min(Math.max(fl.dropStartMs, flipEnd), impact - 1);
                const head = FINISHER_CONFIG.PILEDRIVER_HEAD;
                if (t < flipEnd) {
                    // Flipped upside down with a half twist: ends facing the attacker (tombstone)
                    const s = easeInOut(t / flipEnd);
                    rot = -PI / 2 - PI * s;
                    spin = PI * (1 - s);
                    _flightPos.lerpVectors(fl.start, fl.hold, s);
                    height = head * s;
                } else if (t < dropStart) {
                    rot = -1.5 * PI;
                    _flightPos.copy(fl.hold);
                    height = head + 0.05 * Math.sin(((t - flipEnd) / (dropStart - flipEnd)) * PI);
                } else if (t < impact) {
                    // The attacker sits down: head into the mat exactly at the impact
                    const s = (t - dropStart) / (impact - dropStart);
                    rot = -1.5 * PI;
                    _flightPos.copy(fl.hold);
                    height = head * (1 - s * s);
                } else {
                    // Topples flat on the back, away from the attacker
                    const s = easeOut((t - impact) / (fl.endMs - impact));
                    rot = -1.5 * PI - 0.5 * PI * s;
                    _flightPos.lerpVectors(fl.hold, fl.landing, s);
                }
                break;
            }
            case 'ddt': {
                const spike = FINISHER_CONFIG.DDT_SPIKE_ROT;
                if (t < impact) {
                    // Pulled forward and twisted head-first into the mat (accelerating)
                    const s = t / impact;
                    rot = -PI / 2 + (spike + PI / 2) * Math.pow(s, 1.6);
                    spin = PI * (1 - easeInOut(s));
                    _flightPos.lerpVectors(fl.start, fl.hold, easeInOut(s));
                    height = FINISHER_CONFIG.DDT_ARC * Math.sin(PI * s);
                } else {
                    // Legs flop over: flat on the back
                    const s = easeOut((t - impact) / (fl.endMs - impact));
                    rot = spike + (-2 * PI - spike) * s;
                    _flightPos.lerpVectors(fl.hold, fl.landing, s);
                }
                break;
            }
            default: {
                // Suplex: upright (3PI/2) -> head first over the attacker -> upside down -> flat on the back
                const s = t / impact;
                rot = 1.5 * PI * (1 - s) * (1 - s);
                _flightPos.lerpVectors(fl.start, fl.landing, s);
                height = WRESTLE_CONFIG.SUPLEX_PEAK * Math.sin(PI * s);
            }
        }

        _qAxis.setFromAxisAngle(fl.axis, rot);
        _qSpin.setFromAxisAngle(UP_AXIS, spin);
        _qPose.copy(_qSpin).multiply(_qAxis).multiply(fl.qFinal);

        // Keep the body's lowest point `height` above the mat (the root is the hips' floor point)
        const y = fl.ground + height + (fl.minYFinal - minPointY(_qPose, fl.points));
        this.model.position.set(_flightPos.x, y, _flightPos.z);
        this.model.quaternion.copy(_qPose);
        return true;
    }

    finishFlight() {
        const fl = this.flight;
        if (!fl) return;
        this.flight = null;
        this.poseYaw = fl.yaw;
        this.model.position.set(fl.landing.x, fl.ground, fl.landing.z);
        this.model.rotation.set(0, fl.yaw, 0);
        this.positionHold = {
            x: fl.landing.x,
            z: fl.landing.z,
            until: performance.now() + WRESTLE_CONFIG.LANDING_HOLD_MS
        };
    }

    /**
     * Superkick victim: the server flies them (position), the host tips the body from upright
     * to flat on the back (head away from the kicker) and keeps the lying clip. When the server
     * position can't be used (eliminated players aren't simulated), the arc is simulated here.
     */
    startLaunch({ angle, simulate = false }) {
        const lie = this.getLieInfo();
        const yaw = angle - lie.alpha;
        const qFinal = new THREE.Quaternion().setFromAxisAngle(UP_AXIS, yaw).multiply(lie.local);
        const dir = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
        this.flight = null;
        this.launch = {
            yaw,
            qFinal,
            axis: new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle)),
            points: lie.points,
            minYFinal: minPointY(qFinal, lie.points),
            sim: null,
            airborne: false,
            startTime: performance.now()
        };
        if (simulate) {
            const p0 = this.model.position.clone();
            p0.y = Math.max(p0.y, ARENA_CONFIG.RING_HEIGHT);
            this.simulateLaunch(p0, dir.multiplyScalar(8), 6);
        }
        this.positionHold = null;
        this.poseYaw = yaw;
        this.setLock('down', { loop: true, fade: 0.12 });
    }

    /**
     * Continue the launch as a host-side ballistic arc (the server stops simulating
     * eliminated players)
     */
    simulateLaunch(p0, velH, velY) {
        if (!this.launch) return;
        this.launch.sim = {
            p0: p0.clone(),
            vx: velH.x,
            vz: velH.z,
            vy: velY,
            t0: performance.now()
        };
    }

    /**
     * @returns {boolean} True while the launch drives the model transform
     */
    updateLaunch(now) {
        const la = this.launch;
        if (!la) return false;

        const t = now - la.startTime;
        const c = this.controller;
        const ground = ARENA_CONFIG.RING_HEIGHT;
        const air = FINISHER_CONFIG.KICK_AIR_MS;
        let landed;

        if (la.sim) {
            const ts = (now - la.sim.t0) / 1000;
            _flightPos.set(la.sim.p0.x + la.sim.vx * ts, 0, la.sim.p0.z + la.sim.vz * ts);
            const half = ARENA_CONFIG.RING_SIZE / 2;
            const floor = Math.abs(_flightPos.x) <= half && Math.abs(_flightPos.z) <= half ? ground : -0.1;
            _flightPos.y = la.sim.p0.y + la.sim.vy * ts + 0.5 * ARENA_CONFIG.GRAVITY * ts * ts;
            landed = (_flightPos.y <= floor && ts > 0.05) || ts > 2.5;
            if (landed) _flightPos.y = floor;
        } else {
            _flightPos.copy(c.position);
            if (c.position.y > ground + 0.25) la.airborne = true;
            landed = c.isDown || (la.airborne && c.position.y <= ground + 0.05) || t > 3000;
        }

        if (landed && t > 150) {
            this.launch = null;
            this.poseYaw = la.yaw;
            this.model.position.copy(_flightPos);
            this.model.rotation.set(0, la.yaw, 0);
            if (la.sim) this.positionHold = { x: _flightPos.x, y: _flightPos.y, z: _flightPos.z, until: now + 60000 };
            this.onLaunchLanded?.(this);
            return false;
        }

        // Upright -> flat on the back while flying
        const rot = -Math.PI / 2 * (1 - easeOut(Math.min(1, t / air)));
        _qAxis.setFromAxisAngle(la.axis, rot);
        _qPose.copy(_qAxis).multiply(la.qFinal);
        const y = _flightPos.y + (la.minYFinal - minPointY(_qPose, la.points));
        this.model.position.set(_flightPos.x, y, _flightPos.z);
        this.model.quaternion.copy(_qPose);
        return true;
    }

    /**
     * Splash attacker: procedural leap (linear in X/Z + arc) from `from` onto `to`, touching
     * down exactly impactMs after the start. The clip's own vertical motion adds on top.
     */
    startLeap({ from, to, impactMs, delayMs = 0, arc = 1, yaw }) {
        const now = performance.now();
        const delay = Math.max(0, Math.min(delayMs, impactMs - 250));
        this.leap = {
            from: new THREE.Vector3(from.x, 0, from.z),
            to: new THREE.Vector3(to.x, 0, to.z),
            ground: Number.isFinite(to.y) ? to.y : ARENA_CONFIG.RING_HEIGHT,
            arc,
            yaw,
            takeoff: now + delay,
            land: now + Math.max(delay + 1, impactMs)
        };
        this.positionHold = null;
    }

    /**
     * @returns {boolean} True while the leap drives the model transform
     */
    updateLeap(now) {
        const lp = this.leap;
        if (!lp) return false;

        if (now >= lp.land) {
            this.leap = null;
            this.model.position.set(lp.to.x, lp.ground, lp.to.z);
            this.positionHold = { x: lp.to.x, z: lp.to.z, until: now + WRESTLE_CONFIG.LANDING_HOLD_MS };
            return false;
        }

        const s = Math.max(0, (now - lp.takeoff) / (lp.land - lp.takeoff));
        _flightPos.lerpVectors(lp.from, lp.to, s);
        this.model.position.set(_flightPos.x, lp.ground + lp.arc * 4 * s * (1 - s), _flightPos.z);
        this.model.rotation.set(0, lp.yaw, 0);
        return true;
    }

    /**
     * Splash victim: quick jolt of the lying body
     */
    startBounce() {
        this.bounce = { start: performance.now() };
    }

    applyBounce(now) {
        if (!this.bounce) return;
        const s = (now - this.bounce.start) / FINISHER_CONFIG.BOUNCE_MS;
        if (s >= 1) {
            this.bounce = null;
            return;
        }
        this.model.position.y += 0.25 * Math.sin(Math.PI * s) * (1 - s);
    }

    /**
     * Running strike knockdown (lariat / dropkick victim, or the dropkicker landing): the body
     * plays the lying clip and is tipped from upright onto its back at the server position,
     * head towards `angle`. Ends lying ('down' lock), like a superkick landing.
     * @param {object} opts
     * @param {number} opts.angle - World direction of the head once on the mat
     * @param {'lariat'|'dropkick'|'self'} opts.style
     * @param {Function} [opts.onLand] - Called when the back hits the mat
     */
    startKnockdown({ angle, style = 'dropkick', onLand = null }) {
        const lie = this.getLieInfo();
        const yaw = angle - lie.alpha;
        const qFinal = new THREE.Quaternion().setFromAxisAngle(UP_AXIS, yaw).multiply(lie.local);
        const ms = style === 'lariat' ? STRIKE_CONFIG.KNOCK_LARIAT_MS
            : style === 'self' ? STRIKE_CONFIG.KNOCK_SELF_MS
            : STRIKE_CONFIG.KNOCK_DROPKICK_MS;
        this.flight = null;
        this.launch = null;
        this.hop = null;
        this.ropeLean = null;
        this.selfFallUntil = 0;
        this.knock = {
            style,
            yaw,
            qFinal,
            axis: new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle)), // up x head direction
            points: lie.points,
            minYFinal: minPointY(qFinal, lie.points),
            start: performance.now(),
            ms,
            onLand
        };
        this.poseYaw = yaw;
        this.setLock('down', { loop: true, fade: 0.1 });
    }

    /**
     * @returns {boolean} True while the knockdown drives the model transform
     */
    updateKnock(now) {
        const k = this.knock;
        if (!k) return false;

        const t = now - k.start;
        if (t >= k.ms) {
            this.knock = null;
            this.poseYaw = k.yaw;
            k.onLand?.(this);
            return false;
        }

        // Position from the server (or a landing hold); the rotation is replaced below
        this.updateModelTransform(now);

        // rot: 0 = flat on the back, -PI/2 = upright, > 0 = past flat (legs up)
        const PI = Math.PI;
        const s = t / k.ms;
        let rot;
        let height;
        if (k.style === 'lariat') {
            const over = STRIKE_CONFIG.KNOCK_LARIAT_OVER;
            const turn = 0.62;
            rot = s < turn
                ? -PI / 2 + (PI / 2 + over) * easeOut(s / turn)
                : over * (1 - easeInOut((s - turn) / (1 - turn)));
            height = STRIKE_CONFIG.KNOCK_LARIAT_HEIGHT * Math.sin(PI * Math.min(1, s / 0.8));
        } else if (k.style === 'self') {
            rot = -PI / 2 * (1 - easeOut(s));
            height = STRIKE_CONFIG.DROPKICK_HOP * 0.8 * (1 - s * s);
        } else {
            rot = -PI / 2 * (1 - s * s);
            height = STRIKE_CONFIG.KNOCK_DROPKICK_HEIGHT * Math.sin(PI * s);
        }

        _qAxis.setFromAxisAngle(k.axis, rot);
        _qPose.copy(_qAxis).multiply(k.qFinal);
        this.model.position.y += height + (k.minYFinal - minPointY(_qPose, k.points));
        this.model.quaternion.copy(_qPose);
        return true;
    }

    /**
     * Small vertical hop on top of the server position (dropkick takeoff)
     */
    startHop(height, ms) {
        this.hop = { start: performance.now(), height, ms };
    }

    applyHop(now) {
        const hop = this.hop;
        if (!hop) return;
        const s = (now - hop.start) / hop.ms;
        if (s >= 1) {
            this.hop = null;
            return;
        }
        this.model.position.y += hop.height * Math.sin(Math.PI * s);
    }

    /**
     * Sink into the ropes and get flung back: the body tilts (top towards `normal`, out of
     * the ring) and moves a little into the ropes
     * @param {THREE.Vector3} normal - Horizontal unit vector pointing out of the ring
     */
    startRopeLean(normal) {
        this.ropeLean = {
            start: performance.now(),
            normal: normal.clone(),
            axis: new THREE.Vector3().crossVectors(UP_AXIS, normal).normalize()
        };
    }

    applyRopeLean(now) {
        const lean = this.ropeLean;
        if (!lean) return;
        const s = (now - lean.start) / ROPE_CONFIG.LEAN_MS;
        if (s >= 1 || this.lockAnim === 'down' || this.poseYaw !== null) {
            this.ropeLean = null;
            return;
        }
        // Fast in, slower out
        const k = Math.sin(Math.PI * Math.pow(s, 0.6));
        this.leanBaseYaw = this.model.rotation.y;
        _qAxis.setFromAxisAngle(lean.axis, ROPE_CONFIG.LEAN_ANGLE * k);
        this.model.quaternion.premultiply(_qAxis);
        this.model.position.addScaledVector(lean.normal, ROPE_CONFIG.LEAN_SINK * k);
        this.leanApplied = true;
    }

    /**
     * Drop every grapple visual (new round / rematch)
     */
    resetWrestleVisuals() {
        this.lockAnim = null;
        this.lockOpts = null;
        this.timedAnim = null;
        this.poseYaw = null;
        this.flight = null;
        this.positionHold = null;
        this.moveVisual = null;
        this.leap = null;
        this.launch = null;
        this.bounce = null;
        this.celebrating = false;
        this.knock = null;
        this.hop = null;
        this.ropeLean = null;
        this.leanApplied = false;
        this.selfFallUntil = 0;
    }

    /**
     * Lerp the model's Y rotation toward an angle along the shortest arc
     */
    rotateTowards(targetAngle, t) {
        const current = this.model.rotation.y;
        const diff = Math.atan2(Math.sin(targetAngle - current), Math.cos(targetAngle - current));
        this.model.rotation.y = current + diff * t;
    }

    /**
     * Model position/rotation from the controller (outside procedural flights)
     */
    updateModelTransform(now) {
        const ctrlPos = this.controller.position;

        // Right after a landing, keep the landing spot until the server position catches up
        const hold = this.positionHold;
        if (hold) {
            const dx = ctrlPos.x - hold.x;
            const dz = ctrlPos.z - hold.z;
            if (now > hold.until || dx * dx + dz * dz < 0.04) this.positionHold = null;
        }
        if (this.positionHold) {
            this.model.position.set(hold.x, hold.y ?? ctrlPos.y, hold.z);
        } else {
            this.model.position.copy(ctrlPos);
        }

        // Match winner: turn towards the winner camera (+Z)
        if (this.celebrating) {
            this.rotateTowards(0, 0.08);
            return;
        }

        // Fixed yaw on the mat / getting up / scrambling up
        const timedYaw = this.timedAnim ? this.timedAnim.yaw : null;
        const yaw = timedYaw ?? this.poseYaw;
        if (yaw !== null && yaw !== undefined) {
            if (this.lockAnim === 'down' && this.getLieInfo().local !== IDENTITY_QUAT) {
                this.model.quaternion.setFromAxisAngle(UP_AXIS, yaw).multiply(LIE_BACK_QUAT);
            } else {
                this.model.rotation.set(0, yaw, 0);
            }
            return;
        }

        // Update model rotation based on facing angle (always, not just when moving)
        // This ensures rotation updates even when grabbing/grabbed
        if (this.controller.facingAngle !== undefined) {
            this.rotateTowards(this.controller.facingAngle, 0.15);
        } else if (this.controller.movementDirection.length() > 0.1) {
            // Fallback to movement direction
            const targetAngle = Math.atan2(
                this.controller.movementDirection.x,
                this.controller.movementDirection.z
            );
            this.rotateTowards(targetAngle, 0.15);
        }
    }

    /**
     * Fight idle / walk / run from the movement state
     */
    updateLocomotion(isMoving) {
        const ac = this.animController;
        const c = this.controller;
        // Players bouncing off the ropes or whipped run even without the run button
        const isRunning = isMoving && (c.input.run || c.isRopeRunning || !!c.whip);

        // No guard-stance clip: keep the original behaviour
        if (!ac.actions.idle) {
            ac.updateFromMovementState({ isMoving, isRunning, isGrounded: true, isJumping: false });
            return;
        }

        // Eliminated players stay down; attacks/blocks/taunts finish on their own
        if (this.controller.isEliminated) return;
        if (ac.isAttacking || ac.isBlocking || ac.isTaunting) return;

        if (isRunning) {
            ac.playRun();
        } else if (isMoving) {
            ac.playWalk();
        } else {
            this.playFightIdle();
        }
    }

    update(delta) {
        const now = performance.now();

        // Update controller physics
        this.controller.update(delta);
        const isMoving = this.controller.velocity.length() > 0.5;

        // Undo last frame's rope lean before anything reads the yaw
        if (this.leanApplied) {
            this.model.rotation.set(0, this.leanBaseYaw, 0);
            this.leanApplied = false;
        }

        // Procedural motion (slam/suplex/finisher flight, superkick launch, splash leap,
        // lariat/dropkick knockdown) owns the transform; otherwise follow the controller
        if (!this.updateFlight(now) && !this.updateLaunch(now) && !this.updateLeap(now) && !this.updateKnock(now)) {
            this.updateModelTransform(now);
            this.applyBounce(now);
            this.applyHop(now);
            this.applyRopeLean(now);
        }

        // Animation priority: grapple lock > timed one-shot > locomotion
        const ac = this.animController;
        if (this.lockAnim) {
            // Something else took over (a one-shot's auto-return to idle...): put the lock clip back
            const action = ac.actions[this.lockAnim];
            if (action && ac.currentAction !== action) {
                this.playLockClip(this.lockAnim, { ...this.lockOpts, restart: true });
            }
        } else if (!this.updateTimed(now, isMoving)) {
            this.updateLocomotion(isMoving);
        }

        ac.update(delta);
    }

    dispose() {
        this.animController.dispose();

        // Remove name label
        if (this.nameLabel) {
            this.model.remove(this.nameLabel);
            if (this.nameLabel.element && this.nameLabel.element.parentNode) {
                this.nameLabel.element.parentNode.removeChild(this.nameLabel.element);
            }
        }

        this.model.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(m => m.dispose());
            }
        });
    }
}

// =================================
// Arena Game Class
// =================================

class ArenaGame {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.labelRenderer = null; // CSS2DRenderer for floating name labels
        this.clock = new THREE.Clock();
        
        // Players
        this.players = new Map();
        this.localPlayer = null;
        
        // Base assets
        this.baseModel = null;
        this.baseAnimations = {};
        this.baseClipsPromise = null;      // Meshy clips (shared by every character), loaded once
        this.characterModelCache = {};     // characterId -> loaded model (shared, cloned per entity)
        this.characterAnimCache = {};      // characterId -> Promise<{animations, meta}> (Meshy + retargeted Mixamo clips)
        this.characterAssetCache = {};     // characterId -> Promise<{characterId, model, grapple}> (model + clips, on demand)
        this.mixamoSourcesPromise = null;  // Mixamo grapple FBX files, loaded once
        this.sharedGrappleClips = null;
        this.selectedCharacter = 'edgar'; // Default character

        // Grapple overlays
        this.tieUpIndicators = new Map();  // attackerId -> floating "AMARRE" tag
        this.transientLabels = new Set();  // Move-name popups
        this.pinVerdictTimer = null;

        // Spirit meter & finishers
        this.specialAuras = new Map();     // playerId -> glowing aura while SPECIAL
        this.finisherCam = null;           // Camera punch-in during a finisher
        this.finisherTimers = new Set();   // Cinematic/impact timers (cleared on reset)

        // Ropes & battle royal (phase 3)
        this.ropes = [];                   // Bendable rope meshes (see pushRopesAt / updateRopes)
        this.matchStartCount = 0;          // Players at the start of the match
        this.feedEliminated = new Set();   // Eliminations already in the feed (no duplicates)
        this.lastTwoShown = false;

        // Networking
        this.socket = null;
        this.roomCode = null;
        this.isHost = false;
        this.gameState = 'loading';
        this.matchId = 0;            // Bumped on every new round/rematch to cancel stale timers
        this.rematchPending = false; // A 'request-rematch' is in flight

        // HUD
        this.hud = null;
        
        // VFX/SFX managers (loaded dynamically)
        this.vfxManager = null;
        this.sfxManager = null;
        this.bgmManager = null;
        
        // UI elements
        this.loadingScreen = document.getElementById('loading-screen');
        this.loadingText = document.getElementById('loading-text');
        this.progressFill = document.getElementById('progress-fill');
        this.animationNameDisplay = document.getElementById('animation-name');
        
        // Initialize
        this.init();
    }
    
    async init() {
        // Apply baby theme if needed
        const isBabyShower = document.documentElement.classList.contains('baby-theme');
        if (isBabyShower) {
            this.selectedCharacter = 'baby';
            const gameTitle = document.querySelector('.game-title');
            if (gameTitle) gameTitle.innerHTML = 'BUMPER BABIES';
            document.title = 'Bumper Babies - Baby Shower';
        } else {
            this.selectedCharacter = 'edgar';
        }

        // Start downloading right away (all in parallel): the preview model, the Meshy clips and
        // the Mixamo grapple clips. Other characters are loaded on demand when a player picks them.
        const startupAssets = this.loadCharacterWithAnimations();

        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0a15);
        this.scene.fog = new THREE.Fog(0x0a0a15, 20, 50);
        
        // Setup camera - isometric/top-down view
        this.camera = new THREE.PerspectiveCamera(
            50,
            window.innerWidth / window.innerHeight,
            0.1,
            100
        );
        this.setupCamera();
        
        // Setup renderer
        const canvas = document.getElementById('game-canvas');
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        
        // Setup CSS2D renderer for floating name labels
        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.domElement.style.position = 'absolute';
        this.labelRenderer.domElement.style.top = '0px';
        this.labelRenderer.domElement.style.pointerEvents = 'none';
        document.getElementById('game-container').appendChild(this.labelRenderer.domElement);
        
        // Add styles for floating player names
        this.addPlayerNameStyles();
        
        // Setup lighting
        this.setupLights();
        
        // Create the ring
        this.createRing();
        
        // Initialize HUD (before connecting: players can join while assets are still loading)
        this.hud = new ArenaHUD();

        // Setup controls
        this.setupKeyboardControls();

        // Handle resize
        window.addEventListener('resize', () => this.onWindowResize());

        // Load managers (small scripts, downloaded while the models/clips keep loading)
        await this.loadManagers();

        // Connect to server: the room is created without waiting for the character assets.
        // Players that join early get their entity as soon as their model is ready (addPlayer).
        this.connectToServer();

        // Start game loop
        this.animate();

        // Preview model + clips (hides the loading screen when done)
        await startupAssets;
    }
    
    setupCamera() {
        // Isometric-style camera position
        const distance = ARENA_CONFIG.CAMERA_HEIGHT;
        const angle = ARENA_CONFIG.CAMERA_ANGLE;
        
        this.camera.position.set(
            0,
            distance * Math.cos(angle) + 5,
            distance * Math.sin(angle)
        );
        this.camera.lookAt(0, 0, 0);
    }
    
    /**
     * Add CSS styles for floating player names in Arena mode
     */
    addPlayerNameStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .arena-player-name-label {
                color: white;
                font-family: 'Orbitron', 'Segoe UI', sans-serif;
                font-size: 12px;
                font-weight: bold;
                text-shadow: 
                    2px 2px 4px rgba(0, 0, 0, 0.9),
                    -1px -1px 2px rgba(0, 0, 0, 0.6),
                    0 0 8px currentColor;
                padding: 3px 10px;
                background: linear-gradient(180deg, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.5) 100%);
                border-radius: 10px;
                border: 2px solid currentColor;
                white-space: nowrap;
                transform: translateX(-50%);
                pointer-events: none;
                user-select: none;
                text-transform: uppercase;
                letter-spacing: 1px;
            }
            
            @keyframes grabPulse {
                0% {
                    transform: translate(-50%, -50%) scale(0.5);
                    opacity: 0;
                }
                30% {
                    transform: translate(-50%, -50%) scale(1.2);
                    opacity: 1;
                }
                100% {
                    transform: translate(-50%, -50%) scale(1);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    setupLights() {
        // Stronger ambient light for better visibility
        const ambient = new THREE.AmbientLight(0x6060a0, 1.2);
        this.scene.add(ambient);
        
        // Main spotlight (arena style) - BRIGHTER
        const mainLight = new THREE.SpotLight(0xffffff, 3, 60, Math.PI / 3, 0.3);
        mainLight.position.set(0, 25, 0);
        mainLight.castShadow = true;
        mainLight.shadow.mapSize.width = 2048;
        mainLight.shadow.mapSize.height = 2048;
        this.scene.add(mainLight);
        
        // Second overhead light for more coverage
        const overheadLight = new THREE.DirectionalLight(0xffffff, 1.5);
        overheadLight.position.set(0, 20, 5);
        overheadLight.castShadow = true;
        this.scene.add(overheadLight);
        
        // Corner spotlights (colored) - BRIGHTER
        const cornerColors = [0xff3366, 0x00ffcc, 0xffcc00, 0x9966ff];
        const corners = [
            [-ARENA_CONFIG.RING_SIZE/2, -ARENA_CONFIG.RING_SIZE/2],
            [ARENA_CONFIG.RING_SIZE/2, -ARENA_CONFIG.RING_SIZE/2],
            [-ARENA_CONFIG.RING_SIZE/2, ARENA_CONFIG.RING_SIZE/2],
            [ARENA_CONFIG.RING_SIZE/2, ARENA_CONFIG.RING_SIZE/2]
        ];
        
        corners.forEach((corner, i) => {
            const light = new THREE.PointLight(cornerColors[i], 1.5, 25);
            light.position.set(corner[0], 10, corner[1]);
            this.scene.add(light);
        });
        
        // Rim lights for drama - STRONGER
        const rimLight1 = new THREE.DirectionalLight(0xff3366, 1.0);
        rimLight1.position.set(-15, 8, -15);
        this.scene.add(rimLight1);
        
        const rimLight2 = new THREE.DirectionalLight(0x00ffcc, 1.0);
        rimLight2.position.set(15, 8, 15);
        this.scene.add(rimLight2);
        
        // Additional fill light from front
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.8);
        fillLight.position.set(0, 10, 20);
        this.scene.add(fillLight);
    }
    
    createRing() {
        const ringSize = ARENA_CONFIG.RING_SIZE;
        const ringHeight = ARENA_CONFIG.RING_HEIGHT;
        const ropeHeight = ARENA_CONFIG.ROPE_HEIGHT;
        
        // === RING FLOOR ===
        const floorGeometry = new THREE.BoxGeometry(ringSize, ringHeight, ringSize);
        const floorMaterial = new THREE.MeshStandardMaterial({
            color: 0x2a2a4a,
            metalness: 0.3,
            roughness: 0.7
        });
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.position.y = ringHeight / 2;
        floor.receiveShadow = true;
        this.scene.add(floor);
        
        // Ring surface (canvas mat)
        const matGeometry = new THREE.PlaneGeometry(ringSize - 0.5, ringSize - 0.5);
        const matMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a1a2e,
            roughness: 0.9
        });
        const mat = new THREE.Mesh(matGeometry, matMaterial);
        mat.rotation.x = -Math.PI / 2;
        mat.position.y = ringHeight + 0.01;
        mat.receiveShadow = true;
        this.scene.add(mat);
        
        // Center ring design
        const centerGeometry = new THREE.RingGeometry(1.5, 2, 32);
        const centerMaterial = new THREE.MeshBasicMaterial({
            color: 0xffcc00,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide
        });
        const centerRing = new THREE.Mesh(centerGeometry, centerMaterial);
        centerRing.rotation.x = -Math.PI / 2;
        centerRing.position.y = ringHeight + 0.02;
        this.scene.add(centerRing);
        
        // === CORNER POSTS ===
        const postHeight = ropeHeight + 0.5;
        const postGeometry = new THREE.CylinderGeometry(0.15, 0.15, postHeight, 8);
        const postMaterial = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            metalness: 0.8,
            roughness: 0.2
        });
        
        const postPositions = [
            [-ringSize/2 + 0.3, -ringSize/2 + 0.3],
            [ringSize/2 - 0.3, -ringSize/2 + 0.3],
            [-ringSize/2 + 0.3, ringSize/2 - 0.3],
            [ringSize/2 - 0.3, ringSize/2 - 0.3]
        ];
        
        const turnbuckleColors = [0xff3366, 0x00ffcc, 0xffcc00, 0x9966ff];
        
        postPositions.forEach((pos, i) => {
            // Post
            const post = new THREE.Mesh(postGeometry, postMaterial);
            post.position.set(pos[0], ringHeight + postHeight/2, pos[1]);
            post.castShadow = true;
            this.scene.add(post);
            
            // Turnbuckle pad (colored)
            const padGeometry = new THREE.BoxGeometry(0.4, 0.6, 0.4);
            const padMaterial = new THREE.MeshStandardMaterial({
                color: turnbuckleColors[i],
                emissive: turnbuckleColors[i],
                emissiveIntensity: 0.3
            });
            const pad = new THREE.Mesh(padGeometry, padMaterial);
            pad.position.set(pos[0], ringHeight + ropeHeight * 0.7, pos[1]);
            this.scene.add(pad);
        });
        
        // === ROPES ===
        // Segmented along their length so rebounds can bend them (pushRopesAt / updateRopes)
        this.ropes = [];
        const ropeLevels = [0.4, 0.7, 1.0].map(h => h * ropeHeight + ringHeight);
        const ropeColors = [0xffffff, 0xff3366, 0xffcc00];
        
        ropeLevels.forEach((y, levelIndex) => {
            const ropeColor = ropeColors[levelIndex];
            const ropeMaterial = new THREE.MeshBasicMaterial({ color: ropeColor });
            
            // Four sides of ropes
            const sides = [
                { start: postPositions[0], end: postPositions[1], axis: 'x' },
                { start: postPositions[2], end: postPositions[3], axis: 'x' },
                { start: postPositions[0], end: postPositions[2], axis: 'z' },
                { start: postPositions[1], end: postPositions[3], axis: 'z' }
            ];
            
            sides.forEach(side => {
                const length = Math.abs(
                    side.axis === 'x' 
                        ? side.end[0] - side.start[0]
                        : side.end[1] - side.start[1]
                );
                
                const ropeGeometry = new THREE.CylinderGeometry(0.04, 0.04, length, 8, ROPE_CONFIG.SEGMENTS);
                ropeGeometry.rotateZ(Math.PI / 2);
                if (side.axis === 'z') ropeGeometry.rotateY(Math.PI / 2);

                const rope = new THREE.Mesh(ropeGeometry, ropeMaterial);
                rope.position.set(
                    (side.start[0] + side.end[0]) / 2,
                    y,
                    (side.start[1] + side.end[1]) / 2
                );
                rope.frustumCulled = false; // The bent rope leaves its original bounds
                this.scene.add(rope);

                // Ropes along X sit at z = +-edge, ropes along Z at x = +-edge. The mesh isn't
                // rotated, so local vertex coordinates line up with the world axes.
                this.ropes.push({
                    mesh: rope,
                    axis: side.axis,
                    fixed: side.axis === 'x' ? rope.position.z : rope.position.x,
                    level: levelIndex,
                    length,
                    base: Float32Array.from(ropeGeometry.attributes.position.array),
                    impulses: [],
                    dirty: false
                });
            });
        });
        
        // === FLOOR AROUND RING (fall zone) ===
        const outerFloorSize = ringSize + ARENA_CONFIG.RING_OUT_ZONE * 2 + 4;
        const outerFloorGeometry = new THREE.PlaneGeometry(outerFloorSize, outerFloorSize);
        const outerFloorMaterial = new THREE.MeshStandardMaterial({
            color: 0x0a0a15,
            roughness: 0.9
        });
        const outerFloor = new THREE.Mesh(outerFloorGeometry, outerFloorMaterial);
        outerFloor.rotation.x = -Math.PI / 2;
        outerFloor.position.y = -0.1;
        outerFloor.receiveShadow = true;
        this.scene.add(outerFloor);
        
        // Warning zone (red border around ring)
        const warningGeometry = new THREE.RingGeometry(
            ringSize / 2 - 0.5,
            ringSize / 2,
            4
        );
        warningGeometry.rotateZ(Math.PI / 4);
        const warningMaterial = new THREE.MeshBasicMaterial({
            color: 0xff3366,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide
        });
        const warningZone = new THREE.Mesh(warningGeometry, warningMaterial);
        warningZone.rotation.x = -Math.PI / 2;
        warningZone.position.y = ringHeight + 0.03;
        this.scene.add(warningZone);
    }
    
    async loadManagers() {
        // Load VFX Manager
        try {
            const vfxScript = document.createElement('script');
            vfxScript.src = 'js/effects/VFXManager.js';
            document.head.appendChild(vfxScript);
            await new Promise((resolve, reject) => {
                vfxScript.onload = resolve;
                vfxScript.onerror = reject;
            });
            if (window.VFXManager) {
                this.vfxManager = new window.VFXManager(this.scene, this.camera, THREE);
            }
        } catch (e) {
            console.warn('[Arena] VFXManager not loaded:', e);
        }
        
        // Load SFX Manager
        try {
            const sfxScript = document.createElement('script');
            sfxScript.src = 'js/audio/SFXManager.js';
            document.head.appendChild(sfxScript);
            await new Promise((resolve, reject) => {
                sfxScript.onload = resolve;
                sfxScript.onerror = reject;
            });
            if (window.SFXManager) {
                this.sfxManager = new window.SFXManager();
            }
        } catch (e) {
            console.warn('[Arena] SFXManager not loaded:', e);
        }
        
        // Load BGM Manager
        try {
            const bgmScript = document.createElement('script');
            bgmScript.src = 'js/audio/BGMManager.js';
            document.head.appendChild(bgmScript);
            await new Promise((resolve, reject) => {
                bgmScript.onload = resolve;
                bgmScript.onerror = reject;
            });
            if (window.BGMManager) {
                this.bgmManager = new window.BGMManager();
                this.bgmManager.playCharacterSelect();
            }
        } catch (e) {
            console.warn('[Arena] BGMManager not loaded:', e);
        }
        
        // Create mute button
        this.createMuteButton();
    }
    
    /**
     * Create mute button for sound control
     */
    createMuteButton() {
        // Check if button already exists
        if (document.getElementById('mute-btn')) return;
        
        const muteBtn = document.createElement('button');
        muteBtn.id = 'mute-btn';
        muteBtn.innerHTML = '🔊';
        muteBtn.title = 'Mutear/Desmutear sonido';
        muteBtn.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 20px;
            width: 50px;
            height: 50px;
            border-radius: 50%;
            border: 2px solid #00ffcc;
            background: rgba(10, 10, 21, 0.9);
            color: #00ffcc;
            font-size: 24px;
            cursor: pointer;
            z-index: 1000;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        
        let isMuted = false;
        const self = this;
        
        muteBtn.addEventListener('click', () => {
            isMuted = !isMuted;
            
            // Toggle SFX
            if (self.sfxManager) {
                self.sfxManager.setEnabled(!isMuted);
            }
            
            // Toggle BGM
            if (self.bgmManager) {
                if (isMuted) {
                    self.bgmManager.setVolume(0);
                } else {
                    self.bgmManager.setVolume(1);
                }
            }
            
            // Update button appearance
            muteBtn.innerHTML = isMuted ? '🔇' : '🔊';
            muteBtn.style.borderColor = isMuted ? '#ff3366' : '#00ffcc';
            muteBtn.style.color = isMuted ? '#ff3366' : '#00ffcc';
        });
        
        // Hover effect
        muteBtn.addEventListener('mouseenter', () => {
            muteBtn.style.transform = 'scale(1.1)';
            muteBtn.style.boxShadow = '0 0 15px rgba(0, 255, 204, 0.5)';
        });
        
        muteBtn.addEventListener('mouseleave', () => {
            muteBtn.style.transform = 'scale(1)';
            muteBtn.style.boxShadow = 'none';
        });
        
        document.body.appendChild(muteBtn);
    }
    
    /**
     * Startup assets, all downloaded in parallel: the preview character's model, the shared
     * Meshy clips (animation-only JSON) and the Mixamo grapple clips. Every other character is
     * loaded on demand when a player picks it (loadCharacterAssets), so the loading screen
     * only waits for what the lobby preview needs.
     */
    async loadCharacterWithAnimations(characterId = null) {
        const requested = characterId || this.selectedCharacter;
        const charId = CHARACTER_MODELS[requested] ? requested : 'edgar';
        const characterConfig = CHARACTER_MODELS[charId];

        // Progress: model bytes + clip files done (weights add up to 95, the rest is retargeting)
        const progress = { model: 0, clips: 0, mixamo: 0 };
        const stageText = () => {
            if (progress.model < 1) return `Cargando luchador: ${characterConfig.name}...`;
            if (progress.clips < 1 || progress.mixamo < 1) return 'Cargando animaciones...';
            return 'Preparando llaves de lucha...';
        };
        const render = () => {
            const percent = progress.model * 50 + progress.clips * 15 + progress.mixamo * 30;
            this.updateLoadingProgress(Math.min(97, percent), stageText());
        };
        render();

        this.loadBaseClips((done, total) => {
            progress.clips = done / total;
            render();
        });
        this.loadMixamoSources((done, total) => {
            progress.mixamo = done / total;
            render();
        });

        try {
            const { characterId: loadedId, model, grapple } = await this.loadCharacterAssets(charId, {
                onProgress: (event) => {
                    if (event?.lengthComputable && event.total > 0) {
                        progress.model = Math.min(0.99, event.loaded / event.total);
                        render();
                    }
                },
                onModel: () => {
                    progress.model = 1;
                    render();
                }
            });
            this.baseModel = model;
            this.previewCharacter = loadedId;

            // Lobby preview player (not if the host already started the match meanwhile)
            if (this.gameState === 'loading' && !this.players.has('local')) {
                this.createLocalPlayer(grapple);
            }

            this.updateLoadingProgress(100, '¡Arena lista!');

            setTimeout(() => {
                this.loadingScreen.classList.add('hidden');
                // The socket may have created the room while models were loading: don't overwrite its status
                if (!this.roomCode) {
                    this.updateAnimationDisplay('Conectando al servidor...');
                }
                if (this.gameState === 'loading') this.gameState = 'lobby';
            }, 300);

        } catch (error) {
            console.error('Error loading character:', error);
            this.loadingText.textContent = 'Error al cargar el modelo';
        }
    }

    /**
     * Shared Meshy clips, loaded once in parallel (AssetLoader uses the small JSON clips).
     * Crawling is only needed in baby shower mode.
     * @param {(done:number,total:number)=>void} [onEach]
     * @returns {Promise<Object<string, THREE.AnimationClip>>}
     */
    loadBaseClips(onEach) {
        if (!this.baseClipsPromise) {
            const isBabyShower = document.documentElement.classList.contains('baby-theme');
            const files = isBabyShower ? { ...ANIMATION_FILES, ...BABY_ANIMATION_FILES } : ANIMATION_FILES;
            this.baseClipsPromise = loadClips(files, onEach).then((clips) => {
                Object.entries(ANIMATION_ALIASES).forEach(([alias, key]) => {
                    if (!clips[key]) return;
                    clips[alias] = clips[key].clone();
                    clips[alias].name = alias;
                });
                this.baseAnimations = clips;
                return clips;
            });
        }
        return this.baseClipsPromise;
    }

    /**
     * Model + clips of a character (shared Meshy clips and Mixamo clips retargeted onto its
     * skeleton), loaded on demand and cached: the first call starts the download, later calls
     * (player-joined, character-selected, game-started, rematch) share it.
     * If the model can't be loaded, the preview/default character is used instead.
     * @param {string} characterId
     * @param {{onProgress?: Function, onModel?: Function, noFallback?: boolean}} [options]
     * @returns {Promise<{characterId: string, model: THREE.Object3D, grapple: {animations: object, meta: object|null}}>}
     */
    loadCharacterAssets(characterId, options = {}) {
        const id = CHARACTER_MODELS[characterId] ? characterId : 'edgar';
        if (!this.characterAssetCache[id]) {
            const promise = (async () => {
                let model;
                try {
                    model = await loadModel(CHARACTER_MODELS[id].file, options.onProgress);
                } catch (err) {
                    const fallbackId = options.noFallback
                        ? null
                        : [this.previewCharacter, this.selectedCharacter, 'edgar'].find((c) => c && c !== id && CHARACTER_MODELS[c]);
                    if (!fallbackId) throw err;
                    console.warn(`[Arena] Model for ${id} failed, using ${fallbackId} instead:`, err);
                    // Not cached under this id: a later request retries the download
                    delete this.characterAssetCache[id];
                    return this.loadCharacterAssets(fallbackId, { noFallback: true });
                }
                this.characterModelCache[id] = model;
                options.onModel?.(id);

                // Grapple clips retargeted to this character (once per character, cached)
                const grapple = await this.getCharacterAnimations(id);
                return { characterId: id, model, grapple };
            })();
            this.characterAssetCache[id] = promise;
            promise.catch(() => {
                if (this.characterAssetCache[id] === promise) delete this.characterAssetCache[id];
            });
        }
        return this.characterAssetCache[id];
    }

    /**
     * Load every Mixamo grapple clip in parallel, once (failed files resolve to null).
     * Goes through the shared AssetLoader cache (small skinless FBX files).
     * @param {(done:number,total:number)=>void} [onEach]
     * @returns {Promise<Object<string, THREE.Object3D|null>>} file name -> loaded FBX
     */
    loadMixamoSources(onEach) {
        if (!this.mixamoSourcesPromise) {
            const files = [...new Set(Object.values(MIXAMO_FILES))];
            let done = 0;
            this.mixamoSourcesPromise = Promise.all(files.map((file) =>
                loadModel(`mixamo/${file}`)
                    .then((fbx) => [file, fbx])
                    .catch((err) => {
                        console.warn(`[Arena] Mixamo clip ${file} not loaded:`, err);
                        return [file, null];
                    })
                    .finally(() => {
                        done++;
                        onEach?.(done, files.length);
                    })
            )).then((entries) => Object.fromEntries(entries));
        }
        return this.mixamoSourcesPromise;
    }

    /**
     * Private copies of Meshy clips used by grapple states. Separate clip objects get their
     * own mixer actions, so the AnimationController's one-shot auto-return to idle (keyed on
     * 'throw'/'hit'/'fall') never fires for them.
     */
    getSharedGrappleClips() {
        if (!this.sharedGrappleClips) {
            const base = this.baseAnimations;
            this.sharedGrappleClips = {};
            if (base.throw) this.sharedGrappleClips.slamThrow = base.throw.clone(); // Slam attacker
            if (base.hit) this.sharedGrappleClips.hitReact = base.hit.clone();     // Headbutt/knee victim
            if (base.fall) this.sharedGrappleClips.ko = base.fall.clone();         // Eliminated: fall and stay down
            if (base.taunt) this.sharedGrappleClips.tauntDance = base.taunt.clone(); // Hip-hop taunt (timed)
            if (base.run) this.sharedGrappleClips.ropeRun = base.run.clone();       // Whipped into the ropes
            if (base.punch) this.sharedGrappleClips.lariatSwing = base.punch.clone(); // Lariat (timed)
        }
        return this.sharedGrappleClips;
    }

    /**
     * Clips for a character: shared Meshy clips + Mixamo clips retargeted to its skeleton
     * (cached per character). Needs characterModelCache[characterId] to be loaded.
     * @returns {Promise<{animations: object, meta: object|null}>}
     */
    getCharacterAnimations(characterId) {
        if (!this.characterAnimCache[characterId]) {
            this.characterAnimCache[characterId] = this.buildCharacterAnimations(characterId)
                .catch(async (err) => {
                    console.error(`[Arena] Grapple clips failed for ${characterId}:`, err);
                    await this.loadBaseClips();
                    return { animations: { ...this.baseAnimations, ...this.getSharedGrappleClips() }, meta: null };
                });
        }
        return this.characterAnimCache[characterId];
    }

    async buildCharacterAnimations(characterId) {
        const model = this.characterModelCache[characterId];
        // Shared Meshy clips first (getSharedGrappleClips copies them), then the Mixamo sources
        await this.loadBaseClips();
        const sources = await this.loadMixamoSources();
        const animations = { ...this.baseAnimations, ...this.getSharedGrappleClips() };
        const fallback = new Set();
        const startTime = performance.now();

        for (const [name, file] of Object.entries(MIXAMO_FILES)) {
            const source = sources[file];
            const clip = source?.animations?.[0];
            if (model && clip) {
                try {
                    animations[name] = retargetMixamoClip(model, source, clip, { name: `${characterId}_${name}` });
                } catch (err) {
                    console.warn(`[Arena] Retarget ${name} failed for ${characterId}:`, err);
                }
            }
            const stand = MIXAMO_FALLBACKS[name];
            if (!animations[name] && stand && this.baseAnimations[stand]) {
                animations[name] = this.baseAnimations[stand].clone();
                fallback.add(name);
            }
            // Retargeting is synchronous: yield between clips so the page stays responsive
            await new Promise((resolve) => setTimeout(resolve, 0));
        }

        const meta = this.analyzeWrestlePoses(model, animations, fallback);
        const deg = (rad) => Math.round(THREE.MathUtils.radToDeg(rad));
        console.log(`[Arena] Grapple clips for ${characterId} ready in ${Math.round(performance.now() - startTime)} ms`, {
            fallback: [...fallback],
            downIsLying: meta.downIsLying,
            downHeadYawDeg: deg(meta.downAlpha),
            getupStartHeadYawDeg: deg(meta.getupAlpha),
            suplexEndHeadYawDeg: deg(meta.suplexEndAlpha),
            kickHitSec: meta.kickHit,
            leap: meta.leap,
            sit: meta.sit
        });
        return { animations, meta };
    }

    /**
     * Sample the lying / get-up / suplex clips on a throwaway copy of the character to learn
     * where the head points (yaw in model space, 0 = +Z = facing direction) and whether the
     * lying clip really lies the body down. The host uses this to line up the procedural
     * slam/suplex landing and the down -> get-up transition.
     */
    analyzeWrestlePoses(model, animations, fallback) {
        const meta = {
            fallback,
            downIsLying: true,
            downAlpha: Math.PI,
            getupAlpha: Math.PI,
            suplexEndAlpha: Math.PI,
            downPoints: null,
            restPoints: null,
            kickHit: {},   // superkick clip -> seconds where the kick connects
            leap: {},      // splash clip -> { start, land, rise } (seconds / world units)
            sit: null      // { start, end } seconds of the sit-down part of the sitting clip
        };
        if (!model) return meta;

        const probe = SkeletonUtils.clone(model);
        probe.position.set(0, 0, 0);
        probe.rotation.set(0, 0, 0);
        probe.scale.setScalar(0.01);
        const bones = new Map();
        probe.traverse((o) => { if (o.isBone && !bones.has(o.name)) bones.set(o.name, o); });
        const names = ['Head', 'Hips', 'LeftFoot', 'RightFoot', 'LeftHand', 'RightHand'];
        const mixer = new THREE.AnimationMixer(probe);

        const sample = (clip, time) => {
            mixer.stopAllAction();
            if (clip) {
                const action = mixer.clipAction(clip);
                action.reset();
                action.play();
                mixer.setTime(Math.max(0, Math.min(time, clip.duration * 0.999)));
            }
            probe.updateMatrixWorld(true);
            const points = {};
            names.forEach((n) => {
                const bone = bones.get(n);
                if (bone) points[n] = bone.getWorldPosition(new THREE.Vector3());
            });
            if (!points.Head || !points.Hips) return null;
            const d = points.Head.clone().sub(points.Hips);
            return {
                alpha: Math.atan2(d.x, d.z),
                lying: Math.hypot(d.x, d.z) > Math.abs(d.y),
                points: Object.values(points),
                named: points
            };
        };

        // Evenly spaced samples of a clip: [{ t, named }]
        const series = (clip, count = 48) => {
            const out = [];
            for (let i = 0; i <= count; i++) {
                const t = (clip.duration * i) / count;
                const info = sample(clip, t);
                if (info) out.push({ t, named: info.named });
            }
            return out;
        };
        const usable = (name) => animations[name] && !fallback.has(name);

        try {
            const rest = sample(null, 0);
            if (rest) meta.restPoints = rest.points;

            const down = animations.down;
            if (down) {
                const t = fallback.has('down') ? down.duration : Math.min(0.4, down.duration * 0.5);
                const info = sample(down, t);
                if (info) {
                    meta.downIsLying = info.lying;
                    meta.downAlpha = info.lying ? info.alpha : Math.PI; // Procedural lie: head to -Z
                    meta.downPoints = info.points;
                }
            }

            const up = animations.getup ? sample(animations.getup, 0) : null;
            meta.getupAlpha = up && up.lying ? up.alpha : meta.downAlpha;

            const sup = animations.suplex ? sample(animations.suplex, animations.suplex.duration) : null;
            meta.suplexEndAlpha = sup && sup.lying ? sup.alpha : meta.getupAlpha;

            this.analyzeFinisherClips(meta, animations, series, usable);
        } catch (err) {
            console.warn('[Arena] Wrestle pose analysis failed:', err);
        } finally {
            mixer.stopAllAction();
            mixer.uncacheRoot(probe);
        }
        return meta;
    }

    /**
     * Key moments of the finisher clips, so the host can sync them to the server impact:
     * - kicks: the frame where a foot is furthest in front (model +Z) and high
     * - jump/dive: takeoff and touchdown from the hips height after its highest point
     * - sitting: start and end of the sit-down (hips going from standing to their lowest)
     */
    analyzeFinisherClips(meta, animations, series, usable) {
        ['kickMma', 'kickFlying', 'kickHurricane'].forEach((name) => {
            if (!usable(name)) return;
            let best = -Infinity;
            let bestT = animations[name].duration * 0.5;
            series(animations[name]).forEach(({ t, named }) => {
                [named.LeftFoot, named.RightFoot].forEach((foot) => {
                    if (!foot) return;
                    const score = foot.z + 0.35 * foot.y;
                    if (score > best) {
                        best = score;
                        bestT = t;
                    }
                });
            });
            meta.kickHit[name] = bestT;
        });

        ['jumpAttack', 'dive'].forEach((name) => {
            if (!usable(name)) return;
            const s = series(animations[name]).filter((p) => p.named.Hips);
            if (s.length < 3) return;
            const ys = s.map((p) => p.named.Hips.y);
            const y0 = ys[0];
            let peak = 0;
            ys.forEach((y, i) => { if (y > ys[peak]) peak = i; });
            const minAfter = Math.min(...ys.slice(peak));
            const range = Math.max(1e-3, ys[peak] - minAfter);
            let land = ys.length - 1;
            for (let i = peak; i < ys.length; i++) {
                if (ys[i] <= minAfter + 0.2 * range) { land = i; break; }
            }
            // Takeoff: the jump leaves the ground on the way to the peak; the dive starts moving
            const motion = Math.max(1e-3, Math.max(...ys) - Math.min(...ys));
            let start = 0;
            if (name === 'jumpAttack' && ys[peak] - y0 > 0.1) {
                for (let i = 0; i <= peak; i++) {
                    if (ys[i] >= y0 + 0.15 * (ys[peak] - y0)) { start = i; break; }
                }
            } else {
                for (let i = 0; i <= land; i++) {
                    if (Math.abs(ys[i] - y0) > 0.1 * motion) { start = i; break; }
                }
            }
            meta.leap[name] = {
                start: s[Math.min(start, land)].t,
                land: s[land].t,
                rise: Math.max(0, ys[peak] - y0)
            };
        });

        if (usable('sit')) {
            const s = series(animations.sit, 60).filter((p) => p.named.Hips);
            if (s.length >= 3) {
                const ys = s.map((p) => p.named.Hips.y);
                const y0 = ys[0];
                const min = Math.min(...ys);
                const range = y0 - min;
                if (range > 0.05) {
                    let end = ys.findIndex((y) => y <= min + 0.08 * range);
                    let start = 0;
                    for (let i = end; i >= 0; i--) {
                        if (ys[i] >= y0 - 0.08 * range) { start = i; break; }
                    }
                    if (end <= start) end = Math.min(ys.length - 1, start + 1);
                    meta.sit = { start: s[start].t, end: s[end].t };
                }
            }
        }
    }

    createLocalPlayer(grapple = null) {
        this.localPlayer = new ArenaPlayerEntity(
            'local',
            1,
            PLAYER_COLORS[0],
            this.baseModel,
            grapple?.animations || this.baseAnimations,
            grapple?.meta || null
        );
        
        // Set name based on selected character
        const characterName = CHARACTER_MODELS[this.previewCharacter || this.selectedCharacter]?.name || 'Player 1';
        this.localPlayer.setName(characterName);
        
        // Start at center of ring
        this.localPlayer.controller.position.set(0, ARENA_CONFIG.RING_HEIGHT, 0);
        this.scene.add(this.localPlayer.model);
        this.players.set('local', this.localPlayer);
        // No HUD bar for the lobby preview (it is removed when the match starts)
    }
    
    setupKeyboardControls() {
        window.addEventListener('keydown', (event) => {
            if (!this.localPlayer) return;
            
            const input = this.localPlayer.controller.input;
            
            switch (event.key.toLowerCase()) {
                case 'arrowleft':
                case 'a':
                    input.left = true;
                    break;
                case 'arrowright':
                case 'd':
                    input.right = true;
                    break;
                case 'arrowup':
                case 'w':
                    input.up = true;
                    break;
                case 'arrowdown':
                case 's':
                    input.down = true;
                    break;
                case 'shift':
                    input.run = true;
                    break;
                case 'j':
                    if (!this.localPlayer.controller.isAttacking) {
                        this.localPlayer.controller.punch();
                        this.localPlayer.playAnimation('punch');
                    }
                    break;
                case 'k':
                    if (!this.localPlayer.controller.isAttacking) {
                        this.localPlayer.controller.kick();
                        this.localPlayer.playAnimation('kick');
                    }
                    break;
                case 'g':
                    if (!this.localPlayer.controller.isAttacking) {
                        this.localPlayer.controller.grab();
                    }
                    break;
                case 'l':
                    input.block = true;
                    this.localPlayer.controller.isBlocking = true;
                    this.localPlayer.playAnimation('block');
                    break;
                case 't':
                    if (!this.localPlayer.controller.isAttacking && !this.localPlayer.controller.isBlocking) {
                        this.localPlayer.playAnimation('taunt');
                    }
                    break;
            }
        });
        
        window.addEventListener('keyup', (event) => {
            if (!this.localPlayer) return;
            
            const input = this.localPlayer.controller.input;
            
            switch (event.key.toLowerCase()) {
                case 'arrowleft':
                case 'a':
                    input.left = false;
                    break;
                case 'arrowright':
                case 'd':
                    input.right = false;
                    break;
                case 'arrowup':
                case 'w':
                    input.up = false;
                    break;
                case 'arrowdown':
                case 's':
                    input.down = false;
                    break;
                case 'shift':
                    input.run = false;
                    break;
                case 'l':
                    input.block = false;
                    this.localPlayer.controller.isBlocking = false;
                    this.localPlayer.animController.releaseBlock();
                    break;
            }
        });
    }
    
    connectToServer() {
        const script = document.createElement('script');
        script.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
        script.onload = () => this.initializeSocket();
        script.onerror = () => {
            console.error('[Socket] Failed to load Socket.IO');
            this.updateAnimationDisplay('Error: No se pudo cargar Socket.IO');
        };
        document.head.appendChild(script);
    }
    
    initializeSocket() {
        console.log('[Socket] Connecting to server:', SERVER_URL);
        
        this.socket = io(SERVER_URL, {
            transports: ['websocket'],
            reconnection: true,
            reconnectionAttempts: 5
        });
        
        this.socket.on('connect', () => {
            // Recovered reconnect (connectionStateRecovery): same socket id and room,
            // missed events are replayed. Creating a room here would orphan every phone.
            if (this.socket.recovered) {
                console.log(`[Socket] Connection recovered, keeping room ${this.roomCode}`);
                return;
            }

            console.log('[Socket] Connected to server');
            this.isHost = true;
            
            // Create room with arena mode
            console.log('[Socket] Emitting create-room with arena mode...');
            const isBabyShower = document.documentElement.classList.contains('baby-theme');
            this.socket.emit('create-room', { 
                gameMode: 'arena',
                isBabyShower: isBabyShower
            }, (response) => {
                console.log('[Socket] create-room response:', response);
                if (response && response.success) {
                    this.roomCode = response.roomCode;
                    console.log(`[Socket] Arena room created: ${this.roomCode}`);
                    this.updateAnimationDisplay(`Sala: ${this.roomCode} - Esperando jugadores...`);
                    this.showRoomCode(this.roomCode);
                } else {
                    console.error('[Socket] Failed to create room:', response);
                    this.updateAnimationDisplay('Error al crear sala');
                }
            });
        });
        
        this.socket.on('disconnect', () => {
            this.updateAnimationDisplay('Desconectado del servidor');
        });
        
        // Game events (similar to main game)
        this.socket.on('player-joined', (data) => this.handlePlayerJoined(data));
        this.socket.on('player-left', (data) => this.handlePlayerLeft(data));
        this.socket.on('character-selected', (data) => this.handleCharacterSelected(data));
        this.socket.on('game-started', (data) => this.handleGameStarted(data));
        this.socket.on('player-input-update', (data) => this.handlePlayerInput(data));
        this.socket.on('game-state', (data) => this.handleGameState(data));
        
        // Arena-specific events
        this.socket.on('arena-state', (data) => this.handleArenaState(data));
        this.socket.on('arena-attack-started', (data) => this.handleArenaAttackStarted(data));
        this.socket.on('arena-attack-hit', (data) => this.handleArenaAttackHit(data));
        this.socket.on('arena-grab', (data) => this.handleArenaGrab(data));
        this.socket.on('arena-throw', (data) => this.handleArenaThrow(data));
        this.socket.on('arena-block-state', (data) => this.handleArenaBlockState(data));
        this.socket.on('player-taunting', (data) => this.handleArenaTaunt(data));
        this.socket.on('arena-game-over', (data) => this.handleArenaGameOver(data));
        this.socket.on('arena-grab-escape', (data) => this.handleArenaGrabEscape(data));
        this.socket.on('arena-elimination', (data) => this.handleArenaElimination(data));

        // Grappling (tie-ups, grapple moves, downs, pins)
        this.socket.on('arena-tieup', (data) => this.handleArenaTieUp(data));
        this.socket.on('arena-tieup-end', (data) => this.handleArenaTieUpEnd(data));
        this.socket.on('arena-grapple-move', (data) => this.handleArenaGrappleMove(data));
        this.socket.on('arena-grapple-impact', (data) => this.handleArenaGrappleImpact(data));
        this.socket.on('arena-getup', (data) => this.handleArenaGetUp(data));
        this.socket.on('arena-pin-start', (data) => this.handleArenaPinStart(data));
        this.socket.on('arena-pin-count', (data) => this.handleArenaPinCount(data));
        this.socket.on('arena-pin-end', (data) => this.handleArenaPinEnd(data));

        // Spirit meter & signature finishers
        this.socket.on('arena-special', (data) => this.handleArenaSpecial(data));
        this.socket.on('arena-special-end', (data) => this.handleArenaSpecialEnd(data));
        this.socket.on('arena-finisher', (data) => this.handleArenaFinisher(data));

        // Ropes: Irish whip, rebounds, rope running
        this.socket.on('arena-whip', (data) => this.handleArenaWhip(data));
        this.socket.on('arena-rebound', (data) => this.handleArenaRebound(data));
        this.socket.on('arena-whip-end', (data) => this.handleArenaWhipEnd(data));
        this.socket.on('arena-rope-bounce', (data) => this.handleArenaRopeBounce(data));

        // Tournament events - listen for round transitions
        this.socket.on('round-starting', (data) => {
            console.log('[Arena] Round starting:', data);
            this.resetForNextRound(data);
        });
        
        this.socket.on('round-ended', (data) => {
            console.log('[Arena] Round ended:', data);
            // The tournament overlay shows the round result: drop any single-match victory overlay
            this.gameState = 'finished';
            this.removeVictoryOverlay();
        });

        this.socket.on('tournament-ended', (data) => {
            console.log('[Arena] Tournament ended:', data);
            // The tournament end overlay (with its REVANCHA button) takes over
            this.gameState = 'finished';
            this.removeVictoryOverlay();
            this.setRematchButtonsPending(false);
        });
        
        // Initialize tournament manager
        this.tournamentManager = new TournamentManager(this.socket, 'arena');

        // REVANCHA button on the static tournament end overlay
        this.setupRematchButtons();
    }

    /**
     * Wire the static REVANCHA button(s) once
     */
    setupRematchButtons() {
        if (this.rematchButtonsWired) return;
        this.rematchButtonsWired = true;
        const btn = document.getElementById('arena-tournament-rematch-btn');
        btn?.addEventListener('click', () => this.requestRematch());
    }

    /**
     * Ask the server to restart the match from round 1 with the same players.
     * The actual reset happens on 'round-starting' (rematch: true) + 'game-started'.
     */
    requestRematch() {
        if (!this.socket || this.rematchPending) return;
        this.setRematchButtonsPending(true);

        this.socket.timeout(5000).emit('request-rematch', (err, res) => {
            if (err || !res || !res.success) {
                console.warn('[Arena] Rematch failed:', err || res?.error);
                this.setRematchButtonsPending(false, res?.error ? 'NO SE PUDO: REINTENTAR' : 'REINTENTAR');
                return;
            }
            console.log('[Arena] Rematch accepted, waiting for round-starting');
            // Safety net: if the restart never arrives, let the host try again
            clearTimeout(this.rematchFallbackTimer);
            this.rematchFallbackTimer = setTimeout(() => {
                if (this.rematchPending) this.setRematchButtonsPending(false, 'REINTENTAR');
            }, 5000);
        });
    }

    /**
     * Disable/enable every REVANCHA button while a request is in flight
     */
    setRematchButtonsPending(pending, idleLabel = 'REVANCHA') {
        this.rematchPending = pending;
        if (!pending) clearTimeout(this.rematchFallbackTimer);
        document.querySelectorAll('.arena-rematch-btn').forEach((btn) => {
            btn.disabled = pending;
            btn.textContent = pending ? 'PREPARANDO...' : idleLabel;
        });
    }

    /**
     * Remove the single-match victory overlay (if any)
     */
    removeVictoryOverlay() {
        document.getElementById('victory-overlay')?.remove();
    }
    
    showRoomCode(code) {
        // Similar to main game, create room code overlay
        let overlay = document.getElementById('room-code-overlay');
        const mobileUrl = `${window.location.origin}/mobile/?room=${code}`;
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(mobileUrl)}`;
        
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'room-code-overlay';
            overlay.innerHTML = `
                <div class="room-code-content">
                    <h2>🏟️ ARENA DE PELUCHES</h2>
                    <div class="room-code">${escapeHtml(code)}</div>
                    <div class="qr-container">
                        <img src="${qrCodeUrl}" alt="QR Code" class="qr-code" />
                    </div>
                    <p>Escanea o ingresa este código en tu celular</p>
                    <a href="${escapeHtml(mobileUrl)}" target="_blank" class="url">${escapeHtml(mobileUrl)}</a>
                    
                    <div class="rounds-selector">
                        <span class="rounds-label">RONDAS:</span>
                        <button class="round-btn selected" data-rounds="1">1</button>
                        <button class="round-btn" data-rounds="3">3</button>
                        <button class="round-btn" data-rounds="5">5</button>
                    </div>
                    
                    <button id="start-game-btn" disabled>INICIAR LUCHA</button>
                    <p class="waiting-text">Esperando luchadores...</p>
                </div>
            `;
            
            // Add styles (similar to main game)
            const style = document.createElement('style');
            style.textContent = `
                #room-code-overlay {
                    position: fixed; top: 20px; right: 20px;
                    background: rgba(10, 10, 21, 0.95);
                    border: 2px solid #00ffcc; border-radius: 16px;
                    padding: 24px; z-index: 100; text-align: center;
                    font-family: 'Orbitron', sans-serif;
                    box-shadow: 0 0 30px rgba(0, 255, 204, 0.3);
                    min-width: 280px;
                }
                #room-code-overlay h2 { color: #00ffcc; font-size: 1rem; margin-bottom: 12px; }
                #room-code-overlay .room-code {
                    font-size: 3rem; font-weight: 900; color: #ffcc00;
                    letter-spacing: 12px; text-shadow: 0 0 20px rgba(255, 204, 0, 0.5);
                    margin-bottom: 12px;
                }
                #room-code-overlay .qr-container {
                    margin: 16px auto; padding: 10px; background: #0a0a15;
                    border-radius: 12px; border: 2px solid #00ffcc; display: inline-block;
                }
                #room-code-overlay .qr-code { display: block; width: 120px; height: 120px; }
                #room-code-overlay p { color: rgba(255,255,255,0.7); font-size: 0.85rem; }
                #room-code-overlay .url { color: #ff3366; font-size: 0.75rem; text-decoration: none; }
                #room-code-overlay button {
                    margin-top: 16px; padding: 14px 28px;
                    font-family: 'Orbitron', sans-serif; font-size: 1rem;
                    background: linear-gradient(135deg, #00ffcc, #9966ff);
                    border: none; border-radius: 8px; color: #0a0a15; cursor: pointer;
                }
                #room-code-overlay button:disabled { opacity: 0.5; cursor: not-allowed; }
                #room-code-overlay.hidden { display: none; }
            `;
            document.head.appendChild(style);
            document.body.appendChild(overlay);
            
            document.getElementById('start-game-btn').addEventListener('click', () => this.startGame());
            
            // Add rounds selector listeners
            this.setupRoundsSelector();
        }
    }
    
    setupRoundsSelector() {
        const roundBtns = document.querySelectorAll('.round-btn');
        roundBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const rounds = parseInt(e.target.dataset.rounds);
                
                // Update UI
                roundBtns.forEach(b => b.classList.remove('selected'));
                e.target.classList.add('selected');
                
                // Send to server
                this.tournamentRounds = rounds;
                this.socket?.emit('set-tournament-rounds', rounds);
            });
        });
    }
    
    startGame() {
        if (!this.socket || !this.isHost) return;
        
        this.socket.emit('start-game', (response) => {
            if (response.success) {
                this.gameState = 'playing';
                document.getElementById('room-code-overlay')?.classList.add('hidden');
                
                // Remove local test player
                if (this.players.has('local')) {
                    this.removePlayer('local');
                    this.localPlayer = null;
                }
                
                if (this.bgmManager) {
                    this.bgmManager.playBattle();
                }
                
                this.showRoundAnnouncement('¡LUCHA!');
            }
        });
    }
    
    handlePlayerJoined(data) {
        console.log('[Arena] Player joined:', data.player);
        const index = this.players.size;
        this.addPlayer(data.player, index, Math.max(index + 1, data.room?.playerCount || 0));
        this.updateRoomOverlay(data.room.playerCount);
    }
    
    /**
     * A phone picked a character: start downloading its model (and retargeting its grapple
     * clips) while the lobby is still open, so the entity is ready when the match starts.
     * The entity itself is (re)created with the new character on 'game-started'.
     */
    handleCharacterSelected(data) {
        const characterId = data?.character;
        if (!CHARACTER_MODELS[characterId]) return;
        this.loadCharacterAssets(characterId).catch((err) => {
            console.warn(`[Arena] Preload of ${characterId} failed:`, err);
        });
    }
    
    handlePlayerLeft(data) {
        console.log('[Arena] Player left:', data.playerId);
        this.removePlayer(data.playerId);
    }
    
    handleGameStarted(data) {
        console.log('[Arena] Game started!', data);
        this.gameState = 'playing';
        this.updateAnimationDisplay('¡A LUCHAR!');

        const list = Array.isArray(data.players) ? data.players : [];
        const total = list.length;
        const incoming = new Map(list.map(p => [p.id, p]));

        // Drop players that are no longer in the match (or whose character changed)
        Array.from(this.players.keys()).forEach((id) => {
            const next = incoming.get(id);
            const player = this.players.get(id);
            if (id !== 'local' && (!next || (next.character || 'edgar') !== player.characterId)) {
                this.removePlayer(id);
            }
        });

        // Reuse existing entities (fully reset) and create the missing ones
        list.forEach((playerData, index) => {
            const player = this.players.get(playerData.id);
            if (player) {
                if (playerData.name) player.setName(playerData.name);
                this.resetPlayerVisuals(player, getSpawnPosition(index, total));
                this.hud?.addPlayer(player);
                this.hud?.resetPlayer?.(player.id);
            } else {
                this.addPlayer(playerData, index, total);
            }
        });

        // Battle royal: fresh feed, "QUEDAN N" from 3 players up
        this.startBattleRoyal(total);
    }
    
    handlePlayerInput(data) {
        const player = this.players.get(data.playerId);
        if (player) {
            player.controller.input = { ...player.controller.input, ...data.input };
        }
    }
    
    handleGameState(data) {
        data.players?.forEach(state => {
            const player = this.players.get(state.id);
            if (player) {
                player.controller.applyServerState(state);
                if (this.hud) {
                    this.hud.updatePlayer(player);
                }
            }
        });
    }
    
    // Arena-specific event handlers
    handleArenaState(data) {
        // Update all players from server state
        data.players?.forEach(state => {
            const player = this.players.get(state.id);
            if (player) {
                // Check if player was grabbed and now isn't (grab released)
                const wasGrabbed = player.controller.isGrabbed;
                const wasBeingCarried = player.isBeingCarried;
                
                // Apply position and state from server
                player.controller.applyServerState(state);
                
                // Detect grab release (was grabbed, now isn't, and not being thrown)
                if ((wasGrabbed || wasBeingCarried) && 
                    !state.isGrabbed && 
                    !player.isBeingThrown && 
                    !player.isFlying) {
                    console.log('[Arena] Grab released for player:', state.id);
                    player.isBeingCarried = false;
                    this.endCarryAnimation(player);
                    
                    // Reset rotation to upright
                    player.model.rotation.x = 0;
                    player.model.rotation.z = 0;
                    
                    // Return to idle animation
                    player.playAnimation('idle');
                }

                // Grapple animations follow the server flags (tie-up, move, down, get-up, pin)
                this.syncGrappleVisuals(player);

                // Spirit: aura while SPECIAL (self-heals a missed event), taunt cut short by the server
                this.syncSpiritVisuals(player);

                // Update HUD
                if (this.hud) {
                    this.hud.updatePlayer(player);
                }
            }
        });
    }
    
    handleArenaAttackStarted(data) {
        console.log('[Arena] Attack started:', data);
        const player = this.players.get(data.attackerId);
        if (player && (data.attackType === 'lariat' || data.attackType === 'dropkick')) {
            this.playRunningStrike(player, data.attackType);
            return;
        }
        if (player && data.attackType === 'stomp') {
            // Strike on a downed opponent
            player.playTimed('stomp', WRESTLE_CONFIG.STOMP_MS);
            this.sfxManager?.playKickWhoosh?.();
            return;
        }
        if (player) {
            // Play attack animation
            player.playAnimation(data.attackType);

            // Create attack trail VFX
            if (this.vfxManager && player.model) {
                const pos = player.model.position.clone();
                pos.y += 1;
                const direction = player.controller?.facingAngle ? 
                    Math.sign(Math.sin(player.controller.facingAngle)) || 1 : 1;
                const color = data.attackType === 'punch' ? 0xff6600 : 0x00ff88;
                this.vfxManager.createAttackTrail?.(pos, data.attackType, direction, color);
                this.vfxManager.createChargeGlow?.(player.model, color);
            }
            
            // Play sound effect
            if (this.sfxManager) {
                if (data.attackType === 'punch') {
                    this.sfxManager.playPunchWhoosh?.();
                } else if (data.attackType === 'kick') {
                    this.sfxManager.playKickWhoosh?.();
                }
            }
        }
    }
    
    handleArenaAttackHit(data) {
        console.log('[Arena] Attack hit:', data);
        const attacker = this.players.get(data.attackerId);
        
        // Process all hits in the attack result
        if (data.hits && Array.isArray(data.hits)) {
            for (const hit of data.hits) {
                const target = this.players.get(hit.targetId);
                
                if (target && !target.controller.isEliminated && hit.knockdown && !hit.blocked) {
                    // Lariat / dropkick (or a plain strike countering a rebound): flat on the mat
                    this.playStrikeKnockdown(attacker, target, hit, data);
                } else if (target && !target.controller.isEliminated) {
                    // A clean hit breaks a tie-up or knocks a pinner off the cover
                    if (!hit.blocked && (target.lockAnim === 'tieup' || target.lockAnim === 'kneel')) {
                        target.clearLock();
                    }

                    // Play hit/hurt animation (speed x2 for arena)
                    if (target.animController) {
                        target.playAnimation('hit');
                        const hitAction = target.animController.mixer?.clipAction(
                            target.animController.animations['hit']
                        );
                        if (hitAction) {
                            hitAction.timeScale = 2.0; // Speed up hurt animation
                        }
                    }
                    
                    // Apply damage to controller
                    target.controller.health = hit.newHealth;
                    
                    // Show VFX
                    if (this.vfxManager && target.model) {
                        const hitPosition = target.model.position.clone();
                        hitPosition.y += 1;
                        
                        if (hit.blocked) {
                            // Block VFX - blue shield sparks
                            this.vfxManager.createBlockShield?.(hitPosition, 0x00bfff);
                            this.vfxManager.createBlockSparks?.(hitPosition);
                            this.vfxManager.createDamageNumber?.(hitPosition, hit.damage, 0x00bfff);
                        } else {
                            // Normal hit VFX - red sparks
                            this.vfxManager.createHitSparks?.(hitPosition, 0xff3366, hit.damage / 10);
                            this.vfxManager.createImpactRing?.(hitPosition, 0xff3366);
                            this.vfxManager.createDamageNumber?.(hitPosition, hit.damage, 0xff3366);
                            this.vfxManager.createCharacterFlash?.(target.model, 100);
                        }
                    }
                    
                    // Play hit sound
                    if (this.sfxManager) {
                        if (hit.blocked) {
                            this.sfxManager.playBlock?.();
                        } else {
                            this.sfxManager.playHit?.(hit.damage, false);
                        }
                    }
                    
                    // Update HUD
                    if (this.hud) {
                        this.hud.updatePlayer(target);
                        this.hud.showDamage(hit.targetId, hit.damage, hit.blocked);
                    }
                    
                    // Return to idle after hit animation completes
                    setTimeout(() => {
                        if (target && !target.controller.isEliminated && 
                            !target.controller.isGrabbed && !target.isBeingThrown) {
                            target.playAnimation('idle');
                        }
                    }, 400); // Short delay for hit animation at 2x speed
                }
            }
        }
    }
    
    handleArenaGrab(data) {
        console.log('[Arena] Grab:', data);
        const grabber = this.players.get(data.grabberId);
        const victim = this.players.get(data.targetId);
        
        if (grabber && victim) {
            // Lifted out of a tie-up: the carry visuals take over
            this.removeTieUpIndicator(data.grabberId);
            grabber.clearLock();
            victim.clearLock();

            grabber.controller.isGrabbing = true;
            grabber.controller.grabbedPlayer = victim.controller;
            grabber.grabbedEntity = victim; // Store the entity reference for position updates
            victim.controller.isGrabbed = true;
            victim.controller.grabbedBy = grabber.controller;
            
            // Create grab VFX - purple energy effect
            if (this.vfxManager && grabber.model && victim.model) {
                const grabPos = grabber.model.position.clone();
                grabPos.y += 1;
                
                // Purple grab sparks
                this.vfxManager.createHitSparks?.(grabPos, 0x9966ff, 1.5);
                
                // Impact ring at grab point
                this.vfxManager.createImpactRing?.(grabPos, 0x9966ff);
                
                // Flash both characters
                this.vfxManager.createCharacterFlash?.(grabber.model, 150);
                this.vfxManager.createCharacterFlash?.(victim.model, 150);
            }
            
            // Play grab animation on grabber (held pose)
            grabber.playAnimation('grab');
            
            // Play hit animation on victim in LOOP (being carried)
            victim.playAnimation('hit');
            // Make the victim's hit animation loop
            if (victim.animController && victim.animController.mixer) {
                const hitAction = victim.animController.mixer.clipAction(
                    victim.animController.animations['hit']
                );
                if (hitAction) {
                    hitAction.setLoop(THREE.LoopRepeat);
                    hitAction.timeScale = 0.5; // Slow struggle animation
                }
            }
            
            // Mark victim for special "carried" positioning
            victim.isBeingCarried = true;
            
            // Show status indicators for both players
            if (this.hud) {
                // Show who the grabber is holding
                this.hud.showStatus(data.grabberId, `¡AGARRANDO: ${victim.name}!`);
                // Show that victim is grabbed
                this.hud.showStatus(data.targetId, '¡AGARRADO!');
            }
            
            // Show floating grab indicator
            this.showGrabIndicator(grabber, victim);
            
            // Play grab sound
            if (this.sfxManager) {
                this.sfxManager.playHit?.(5, false);
            }
        }
    }
    
    /**
     * Undo the carried-victim animation setup from handleArenaGrab: the 'hit' action was
     * switched to LoopRepeat (never fires 'finished'), which left animController.isAttacking
     * stuck and blocked every later idle/walk/punch animation.
     */
    endCarryAnimation(player) {
        const anim = player?.animController;
        if (!anim) return;
        const hitAction = anim.actions?.hit;
        if (hitAction) {
            hitAction.setLoop(THREE.LoopOnce);
            hitAction.clampWhenFinished = true;
            hitAction.timeScale = ANIMATION_CONFIG.defaultSpeeds?.hit || 1;
        }
        anim.isAttacking = false;
    }

    /**
     * Show visual indicator when someone is grabbed
     */
    showGrabIndicator(grabber, victim) {
        // Create a floating text indicator
        const indicator = document.createElement('div');
        indicator.className = 'grab-indicator';
        indicator.textContent = `🤼 ${grabber.name} → ${victim.name}`;
        indicator.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: linear-gradient(45deg, rgba(153, 102, 255, 0.9), rgba(255, 102, 0, 0.9));
            color: white;
            font-family: 'Orbitron', sans-serif;
            font-size: 1.5rem;
            font-weight: bold;
            padding: 15px 30px;
            border-radius: 10px;
            z-index: 1000;
            animation: grabPulse 0.5s ease-out forwards;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
            pointer-events: none;
        `;
        
        document.body.appendChild(indicator);
        
        // Remove after animation
        setTimeout(() => {
            indicator.remove();
        }, 1500);
    }
    
    /**
     * Update grabbed player position to follow the grabber (wrestling carry position)
     */
    updateGrabbedPlayerPositions() {
        this.players.forEach((player) => {
            if (player.controller.isGrabbing && player.grabbedEntity) {
                const victim = player.grabbedEntity;
                const grabber = player;
                
                // Position the victim above and behind the grabber (wrestling carry)
                const horizontalOffset = 0.3; // How far in front/back
                const heightOffset = 1.2; // How high (above shoulders)
                const angle = grabber.controller.facingAngle || 0;
                
                // Position: slightly behind grabber, raised up
                victim.controller.position.x = grabber.controller.position.x - Math.sin(angle) * horizontalOffset;
                victim.controller.position.z = grabber.controller.position.z - Math.cos(angle) * horizontalOffset;
                victim.controller.position.y = grabber.controller.position.y + heightOffset;
                
                victim.model.position.copy(victim.controller.position);
                
                // Rotate victim to be horizontal (on their back, face up)
                // Rotate 90 degrees on X axis to lay them flat
                victim.model.rotation.x = -Math.PI / 2; // Lay flat on back
                victim.model.rotation.y = angle; // Face same direction as grabber
                victim.model.rotation.z = 0;
            }
        });
    }
    
    handleArenaThrow(data) {
        console.log('[Arena] Throw:', data);
        const grabber = this.players.get(data.grabberId);
        const victim = this.players.get(data.targetId);
        
        if (grabber && victim) {
            // IMPORTANT: Keep victim at current visual position (where they were being carried)
            // This prevents the "teleport behind" issue
            const currentVisualPos = victim.model.position.clone();
            
            // Release grab state
            grabber.controller.isGrabbing = false;
            grabber.controller.grabbedPlayer = null;
            grabber.grabbedEntity = null;
            victim.controller.isGrabbed = false;
            victim.controller.grabbedBy = null;
            victim.isBeingCarried = false;
            this.endCarryAnimation(victim);

            // Set victim position to where they were visually (carried position)
            victim.controller.position.x = currentVisualPos.x;
            victim.controller.position.y = currentVisualPos.y;
            victim.controller.position.z = currentVisualPos.z;
            
            // Mark victim as being thrown for visual effects
            victim.isBeingThrown = true;
            victim.throwStartTime = Date.now();
            
            // Reset victim's rotation from carried position (but keep position!)
            victim.model.rotation.x = 0;
            victim.model.rotation.z = 0;
            
            // Play throw animation on grabber (speed x2)
            grabber.playAnimation('throw');
            if (grabber.animController) {
                const throwAction = grabber.animController.mixer?.clipAction(
                    grabber.animController.animations['throw']
                );
                if (throwAction) {
                    throwAction.timeScale = 2.0;
                }
            }
            
            // Freeze victim in T-pose/ragdoll while flying (no animation)
            // Stop all animations on victim
            if (victim.animController && victim.animController.mixer) {
                victim.animController.mixer.stopAllAction();
            }
            
            // Mark as flying (no spin rotation - just fly straight)
            victim.isFlying = true;
            victim.throwSpin = {
                active: false, // No spinning - just fly and land
                speed: 0,
                axis: 'x'
            };
            
            // Create dramatic VFX
            if (this.vfxManager && victim.model) {
                const pos = victim.model.position.clone();
                this.vfxManager.createHitSparks?.(pos, 0xff6600, 2);
                this.vfxManager.createImpactRing?.(pos);
                this.vfxManager.createDamageNumber?.(pos, data.damage || 25, 0xff6600);
            }
            
            // Play throw sound
            if (this.sfxManager) {
                this.sfxManager.playHit?.(25, true);
            }
            
            // Show status
            if (this.hud) {
                this.hud.showStatus(data.targetId, '¡LANZADO!');
                this.hud.updatePlayer(victim);
            }
            
            // Screen shake for dramatic effect
            this.shakeScreen(0.5, 300);
            
            // Grabber returns to idle after throw animation
            setTimeout(() => {
                if (grabber && !grabber.controller.isEliminated) {
                    grabber.playAnimation('idle');
                }
            }, 500);
        }
    }
    
    /**
     * Handle player elimination
     */
    handleArenaElimination(data) {
        console.log('[Arena] Elimination event received:', data);
        const player = this.players.get(data.playerId);

        // Battle royal feed + "QUEDAN N" counter
        this.recordElimination(data, player);

        if (player) {
            console.log(`[Arena] Marking ${data.playerName} as eliminated`);
            
            // Mark as eliminated
            player.controller.isEliminated = true;
            
            // Show elimination announcement
            const reason = data.reason === 'ringout' ? '¡RING OUT!'
                : data.reason === 'disconnect' ? '¡DESCONECTADO!'
                : data.reason === 'pinfall' ? '¡PINFALL!'
                : '¡K.O.!';
            this.showEliminationAnnouncement(data.playerName, reason);

            // No more SPECIAL for them
            this.removeSpecialAura(data.playerId);
            player.leap = null;
            player.hop = null;
            player.ropeLean = null;
            player.selfFallUntil = 0;

            // Already on the mat (pinned, stomped, mid slam/suplex/finisher, superkicked,
            // lariat/dropkick): stay lying down. Otherwise fall and stay down (the plain 'fall'
            // one-shot used to pop back to idle).
            const midAir = player.flight || player.launch || player.knock;
            const onTheMat = midAir || player.lockAnim === 'down' || data.reason === 'pinfall';
            if (onTheMat) {
                if (!midAir) player.enterDown();
                // Eliminated players aren't simulated by the server: finish the superkick arc here
                if (player.launch && !player.launch.sim) {
                    const c = player.controller;
                    player.simulateLaunch(c.position, c.velocity, c.velocity.y);
                }
            } else {
                player.clearLock();
                const fallSpeed = ANIMATION_CONFIG.defaultSpeeds.fall || 1;
                if (!player.setLock('ko', { loop: false, timeScale: fallSpeed, fade: 0.1, restart: true })) {
                    player.playAnimation('fall');
                }
            }

            // Create dramatic elimination VFX
            if (this.vfxManager && player.model) {
                const pos = player.model.position.clone();
                pos.y += 1;
                
                // Multiple bursts of red particles
                for (let i = 0; i < 5; i++) {
                    setTimeout(() => {
                        if (this.vfxManager) {
                            const burstPos = pos.clone();
                            burstPos.x += (Math.random() - 0.5) * 2;
                            burstPos.y += (Math.random() - 0.5) * 2;
                            this.vfxManager.createHitSparks?.(burstPos, 0xff0000, 2);
                        }
                    }, i * 80);
                }
                
                // Large impact ring
                this.vfxManager.createImpactRing?.(pos, 0xff3366);
                
                // Character flash
                this.vfxManager.createCharacterFlash?.(player.model, 300);
                
                // Ground shockwave
                setTimeout(() => {
                    if (this.vfxManager) {
                        const groundPos = player.model.position.clone();
                        groundPos.y = 0.5;
                        this.vfxManager.createLandingImpact?.(groundPos, 2.5);
                    }
                }, 200);
            }
            
            // Start fade out effect
            this.fadeOutPlayer(player);
            
            // Hide HUD for this player after delay (unless a rematch/new round started meanwhile)
            const matchId = this.matchId;
            setTimeout(() => {
                if (this.hud && matchId === this.matchId) {
                    this.hud.hidePlayer(data.playerId);
                }
            }, 2000);
            
            // Play KO sound
            if (this.sfxManager) {
                this.sfxManager.playKO?.();
            }
            
            // Screen shake
            this.shakeScreen(0.8, 500);
            
            // Create dramatic particles
            if (this.vfxManager && player.model) {
                const pos = player.model.position.clone();
                for (let i = 0; i < 3; i++) {
                    setTimeout(() => {
                        this.vfxManager.createHitSparks?.(pos, 0xff0000, 2);
                        this.vfxManager.createImpactRing?.(pos);
                    }, i * 100);
                }
            }
            
            // Check for winner after a short delay
            console.log('[Arena] Will check for winner in 2.5 seconds...');
            setTimeout(() => {
                if (matchId === this.matchId) this.checkForWinner();
            }, 2500);
        } else {
            console.log(`[Arena] Player ${data.playerId} not found in local players map!`);
            // Still check for winner - the player might have been removed
            const matchId = this.matchId;
            setTimeout(() => {
                if (matchId === this.matchId) this.checkForWinner();
            }, 2500);
        }
    }
    
    /**
     * Check if there's only one player left alive
     */
    checkForWinner() {
        // Don't check if game is already finished
        if (this.gameState === 'finished') {
            console.log('[Arena] Game already finished, skipping winner check');
            return;
        }
        
        let alivePlayers = [];
        let totalPlayers = 0;
        
        this.players.forEach((player, playerId) => {
            totalPlayers++;
            const isEliminated = player.controller?.isEliminated || false;
            console.log(`[Arena] Player ${player.name}: eliminated=${isEliminated}`);
            
            if (!isEliminated) {
                alivePlayers.push({
                    id: playerId,
                    name: player.name,
                    player: player
                });
            }
        });
        
        console.log(`[Arena] Winner check: ${alivePlayers.length} alive out of ${totalPlayers} total`);
        
        // If only one player remains, they win!
        if (alivePlayers.length === 1 && totalPlayers > 1) {
            const winner = alivePlayers[0];
            console.log(`[Arena] WINNER DETECTED: ${winner.name}`);
            this.showVictoryScreen(winner);
        } else if (alivePlayers.length === 0 && totalPlayers > 0) {
            console.log('[Arena] No alive players - draw?');
        }
    }
    
    /**
     * Show victory screen for the winner
     */
    showVictoryScreen(winner) {
        // Game is over
        this.gameState = 'finished';

        // The "QUEDAN N" counter has done its job
        this.hud?.setRemaining?.(null);

        // Play victory animation (Mixamo celebration, looped)
        if (winner?.player) this.playVictory(winner.player);

        // Zoom camera on winner
        if (winner?.player) this.focusCameraOnWinner(winner.player);

        // In a tournament the round/tournament overlays show the result (and the REVANCHA button)
        if (this.tournamentManager?.isActive) {
            console.log('[Arena] Tournament round won by:', winner?.name);
            return;
        }

        // Victory music
        this.bgmManager?.playVictory?.();

        // Never stack two overlays
        this.removeVictoryOverlay();
        this.ensureVictoryStyles();

        const isDraw = !winner || !winner.name;

        // Create victory overlay
        const victoryOverlay = document.createElement('div');
        victoryOverlay.id = 'victory-overlay';
        victoryOverlay.innerHTML = `
            <div class="confetti-container">
                ${isDraw ? '' : Array(20).fill().map(() => `<div class="confetti"></div>`).join('')}
            </div>
            <div class="victory-content">
                <div class="victory-crown">${isDraw ? '🤝' : '👑'}</div>
                <div class="victory-title">${isDraw ? '¡EMPATE!' : '¡VICTORIA!'}</div>
                ${isDraw ? '' : `<div class="winner-name">${escapeHtml(winner.name)}</div>`}
                <div class="winner-label">${isDraw ? 'NADIE QUEDÓ EN PIE' : 'CAMPEÓN DE LA ARENA'}</div>
                <div class="victory-actions">
                    <button type="button" class="arena-rematch-btn">REVANCHA</button>
                    <button type="button" class="arena-menu-btn">VOLVER AL MENÚ</button>
                </div>
            </div>
        `;

        victoryOverlay.querySelector('.arena-rematch-btn')
            .addEventListener('click', () => this.requestRematch());
        victoryOverlay.querySelector('.arena-menu-btn')
            .addEventListener('click', () => { window.location.href = 'index.html'; });

        document.body.appendChild(victoryOverlay);

        // Reflect a request that may already be in flight
        this.setRematchButtonsPending(!!this.rematchPending);

        console.log('[Arena] Victory screen shown for:', isDraw ? '(draw)' : winner.name);
    }

    /**
     * Inject the victory overlay styles once
     */
    ensureVictoryStyles() {
        if (document.getElementById('arena-victory-styles')) return;

        const style = document.createElement('style');
        style.id = 'arena-victory-styles';
        style.textContent = `
            #victory-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                background: rgba(0, 0, 0, 0.85);
                z-index: 10000;
                animation: victoryFadeIn 0.5s ease-out;
            }

            @keyframes victoryFadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }

            @keyframes victoryCrown {
                0%, 100% { transform: translateY(0) rotate(0deg); }
                25% { transform: translateY(-20px) rotate(-10deg); }
                50% { transform: translateY(-30px) rotate(0deg); }
                75% { transform: translateY(-20px) rotate(10deg); }
            }

            @keyframes victoryPulse {
                0%, 100% { transform: scale(1); text-shadow: 0 0 30px rgba(255, 215, 0, 0.5); }
                50% { transform: scale(1.1); text-shadow: 0 0 60px rgba(255, 215, 0, 0.8); }
            }

            @keyframes confettiFall {
                0% { transform: translateY(-100vh) rotate(0deg); opacity: 1; }
                100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
            }

            .victory-content {
                position: relative;
                z-index: 1;
                text-align: center;
                font-family: 'Orbitron', sans-serif;
            }

            .victory-crown {
                font-size: 100px;
                animation: victoryCrown 2s ease-in-out infinite;
                margin-bottom: 20px;
            }

            .victory-title {
                font-size: 4rem;
                font-weight: 900;
                background: linear-gradient(135deg, #ffd700, #ff8c00, #ffd700);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                animation: victoryPulse 1.5s ease-in-out infinite;
                margin-bottom: 20px;
            }

            .winner-name {
                font-size: 3rem;
                font-weight: 700;
                color: #00ffcc;
                text-shadow: 0 0 30px rgba(0, 255, 204, 0.7);
                margin-bottom: 10px;
            }

            .winner-label {
                font-size: 1.2rem;
                color: #ff3366;
                letter-spacing: 5px;
                text-transform: uppercase;
            }

            .confetti-container {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
                overflow: hidden;
            }

            .confetti {
                position: absolute;
                width: 15px;
                height: 15px;
                top: -20px;
                animation: confettiFall 3s linear infinite;
            }

            .confetti:nth-child(odd) { background: #ffd700; }
            .confetti:nth-child(even) { background: #00ffcc; }
            .confetti:nth-child(3n) { background: #ff3366; }
            .confetti:nth-child(4n) { background: #9966ff; }

            ${Array(20).fill().map((_, i) => `
                .confetti:nth-child(${i + 1}) {
                    left: ${Math.random() * 100}%;
                    animation-delay: ${Math.random() * 3}s;
                    animation-duration: ${2 + Math.random() * 2}s;
                    transform: rotate(${Math.random() * 360}deg);
                }
            `).join('')}
        `;

        document.head.appendChild(style);
    }

    /**
     * Focus camera on the winner
     */
    focusCameraOnWinner(winner) {
        if (!winner || !winner.controller) return;
        
        const pos = winner.controller.position;
        const targetX = pos.x;
        const targetZ = pos.z + 3;
        const targetY = 5;
        
        // Smooth camera transition to winner
        const animateCamera = () => {
            if (this.gameState !== 'finished') return;
            
            this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, targetX, 0.03);
            this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, targetY, 0.03);
            this.camera.position.z = THREE.MathUtils.lerp(this.camera.position.z, targetZ, 0.03);
            this.camera.lookAt(pos.x, pos.y + 1, pos.z);
            
            requestAnimationFrame(animateCamera);
        };
        
        animateCamera();
    }
    
    /**
     * Show elimination announcement
     */
    showEliminationAnnouncement(playerName, reason) {
        const announcement = document.createElement('div');
        announcement.className = 'elimination-announcement';
        announcement.innerHTML = `
            <div class="elimination-text">${escapeHtml(reason)}</div>
            <div class="eliminated-name">${escapeHtml(playerName)}</div>
            <div class="eliminated-label">ELIMINADO</div>
        `;
        announcement.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            text-align: center;
            z-index: 1000;
            pointer-events: none;
            animation: eliminationPulse 2s ease-out forwards;
        `;
        
        // Add styles if not exists
        if (!document.getElementById('elimination-styles')) {
            const style = document.createElement('style');
            style.id = 'elimination-styles';
            style.textContent = `
                @keyframes eliminationPulse {
                    0% { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }
                    20% { opacity: 1; transform: translate(-50%, -50%) scale(1.2); }
                    40% { transform: translate(-50%, -50%) scale(1); }
                    80% { opacity: 1; }
                    100% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
                }
                .elimination-announcement .elimination-text {
                    font-family: 'Orbitron', sans-serif;
                    font-size: 3rem;
                    font-weight: bold;
                    color: #ff3366;
                    text-shadow: 0 0 20px #ff3366, 0 0 40px #ff0000;
                }
                .elimination-announcement .eliminated-name {
                    font-family: 'Orbitron', sans-serif;
                    font-size: 2rem;
                    color: white;
                    margin: 10px 0;
                    text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
                }
                .elimination-announcement .eliminated-label {
                    font-family: 'Orbitron', sans-serif;
                    font-size: 1.5rem;
                    color: #ff6666;
                    text-shadow: 0 0 10px #ff3366;
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(announcement);
        
        // Remove after animation
        setTimeout(() => announcement.remove(), 2000);
    }
    
    /**
     * Fade out eliminated player
     */
    fadeOutPlayer(player) {
        if (!player.model) return;

        const duration = 3500; // ms - longer fade out for dramatic effect
        const startTime = Date.now();
        // A reset (new round / rematch) bumps this token and cancels the fade
        const fadeToken = player.fadeToken = (player.fadeToken || 0) + 1;

        const fadeOut = () => {
            if (player.fadeToken !== fadeToken) return;

            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const opacity = 1 - progress;

            // Apply opacity to all materials
            player.model.traverse((child) => {
                if (child.isMesh && child.material) {
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    materials.forEach(mat => {
                        mat.transparent = true;
                        mat.opacity = opacity;
                    });
                }
            });

            // Continue fading or hide completely
            if (progress < 1) {
                requestAnimationFrame(fadeOut);
            } else {
                // Remove from scene
                if (player.model.parent) {
                    player.model.parent.remove(player.model);
                }
                // Remove name label
                if (player.nameLabel && player.nameLabel.parent) {
                    player.nameLabel.parent.remove(player.nameLabel);
                }
            }
        };

        fadeOut();
    }

    handleArenaGameOver(data) {
        console.log('[Arena] Game Over from server:', data);

        // Don't show twice
        if (this.gameState === 'finished') {
            console.log('[Arena] Game already finished, ignoring duplicate');
            return;
        }

        // Show full victory screen with confetti (or the draw screen), both with REVANCHA
        if (data.winner) {
            // Find the winner player entity (by id first, name as a fallback)
            let winnerPlayer = this.players.get(data.winner.id) || null;
            if (!winnerPlayer) {
                this.players.forEach((player) => {
                    if (player.name === data.winner.name) winnerPlayer = player;
                });
            }

            const winnerData = {
                id: data.winner.id,
                name: data.winner.name,
                player: winnerPlayer
            };

            console.log('[Arena] Showing victory screen for:', winnerData.name);
            this.showVictoryScreen(winnerData);
        } else {
            this.showVictoryScreen(null);
        }
    }

    /**
     * Reset game state for the next round in a tournament, or for a rematch
     * ('round-starting' with rematch: true). 'game-started' follows ~1 s later and
     * re-syncs the player list (handleGameStarted).
     */
    resetForNextRound(data = {}) {
        console.log('[Arena] Resetting for round:', data.round, data.rematch ? '(rematch)' : '');

        // Invalidate timers from the previous match (winner checks, HUD fades...)
        this.matchId = (this.matchId || 0) + 1;

        // Hide/remove every end-of-match overlay
        this.removeVictoryOverlay();
        document.getElementById('round-end-overlay')?.classList.add('hidden');
        document.getElementById('tournament-end-overlay')?.classList.add('hidden');
        document.getElementById('room-code-overlay')?.classList.add('hidden');
        document.querySelectorAll('.elimination-announcement, .grab-indicator').forEach(el => el.remove());
        this.clearGrappleOverlays();
        this.clearRopeWobble();
        this.setRematchButtonsPending(false);

        if (data.rematch) {
            // Fresh tournament: old scores must not linger in the tournament HUD
            const scores = document.getElementById('tournament-scores');
            if (scores) scores.innerHTML = '';
            const currentRound = document.getElementById('current-round');
            if (currentRound) currentRound.textContent = '1';
            this.bgmManager?.playBattle?.();
        }

        // Reset game state (also stops the winner camera zoom loop)
        this.gameState = 'playing';
        this.cameraShake = null;

        // Reset all players
        const total = this.players.size;
        Array.from(this.players.values()).forEach((player, index) => {
            this.resetPlayerVisuals(player, getSpawnPosition(index, total));
            this.hud?.resetPlayer?.(player.id);
        });

        // Battle royal: empty feed, counter back to full ('game-started' re-syncs it)
        this.startBattleRoyal(total);

        // Show round announcement
        this.showRoundAnnouncement(data.rematch ? '¡REVANCHA!' : `¡RONDA ${data.round}!`);

        console.log('[Arena] Reset complete');
    }

    /**
     * Bring a player entity back to a clean, alive, upright, idle state
     */
    resetPlayerVisuals(player, spawnPosition) {
        // Cancel a running elimination fade
        player.fadeToken = (player.fadeToken || 0) + 1;

        // Logic state
        player.controller?.reset?.();
        if (spawnPosition) {
            player.controller.position.copy(spawnPosition);
            player.controller.facingAngle = Math.atan2(-spawnPosition.x, -spawnPosition.z); // face the center
        }

        // Host-side visual flags
        player.resetWrestleVisuals?.();
        player.isBeingThrown = false;
        player.isFlying = false;
        player.isBeingCarried = false;
        player.isEscaping = false;
        player.isBeingHit = false;
        player.grabbedEntity = null;
        player.throwSpin = null;
        player.ropeSoundPlayed = false;

        // Model back in the scene, visible, opaque and upright
        if (player.model) {
            if (!player.model.parent) this.scene.add(player.model);
            player.model.visible = true;
            player.model.position.copy(player.controller.position);
            player.model.rotation.set(0, player.controller.facingAngle || 0, 0);
            player.model.traverse((child) => {
                if (child.isMesh && child.material) {
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    materials.forEach(mat => {
                        mat.transparent = false;
                        mat.opacity = 1.0;
                        mat.needsUpdate = true;
                    });
                }
            });
        }

        // Floating name label
        if (player.nameLabel) {
            if (player.nameLabel.parent !== player.model) player.model.add(player.nameLabel);
            player.nameLabel.visible = true;
            if (player.nameLabel.element) player.nameLabel.element.style.display = '';
        }

        // Animations: clear every lock (attack/block/taunt/carry) and go idle
        this.endCarryAnimation(player);
        player.animController?.stopAll?.();
        player.playAnimation('idle');
    }

    /**
     * Handle block state change
     */
    handleArenaBlockState(data) {
        console.log('[Arena] Block state:', data);
        const player = this.players.get(data.playerId);
        if (player) {
            player.controller.isBlocking = data.isBlocking;
            if (data.isBlocking) {
                player.playAnimation('block');
                
                // Create shield VFX when starting to block
                if (this.vfxManager && player.model) {
                    const pos = player.model.position.clone();
                    pos.y += 1;
                    this.vfxManager.createBlockShield?.(pos, 0x00bfff);
                }
            } else {
                // releaseBlock() clears animController.isBlocking (playIdle alone left it set,
                // so updateFromMovementState bailed out forever) and returns to idle
                player.animController.releaseBlock();
            }
        }
    }
    
    /**
     * Handle taunt animation
     */
    handleArenaTaunt(data) {
        console.log('[Arena] Taunt:', data);
        const player = this.players.get(data.playerId);
        if (player) {
            // The character's own taunt, sized to the server taunt (fills the spirit meter)
            this.playCharacterTaunt(player);
            if (!player.controller.isEliminated) {
                const head = player.model.position.clone();
                head.y += 2.1;
                this.showFloatingText('+ÁNIMO', head, 'arena-spirit-popup', 1400);
            }

            // Create taunt VFX - sparkles around player
            if (this.vfxManager && player.model) {
                const pos = player.model.position.clone();
                pos.y += 1.5;
                // Create colorful sparkles
                this.vfxManager.createHitSparks?.(pos, 0xffcc00, 1.5);
                
                // Create expanding rings at feet
                const footPos = player.model.position.clone();
                footPos.y += 0.1;
                this.vfxManager.createImpactRing?.(footPos, 0xffcc00);
                
                // Second wave of sparkles after delay
                setTimeout(() => {
                    if (this.vfxManager && player.model) {
                        const pos2 = player.model.position.clone();
                        pos2.y += 1.5;
                        this.vfxManager.createHitSparks?.(pos2, 0xff66cc, 1.2);
                    }
                }, 500);
            }
            
            // Play taunt sound
            if (this.sfxManager) {
                this.sfxManager.playTaunt?.();
            }
        }
    }
    
    /**
     * Handle grab escape event
     */
    handleArenaGrabEscape(data) {
        console.log('[Arena] Grab escape:', data);
        const grabber = this.players.get(data.grabberId);
        const victim = this.players.get(data.targetId);
        
        if (grabber && victim) {
            // Release grab state FIRST
            grabber.controller.isGrabbing = false;
            grabber.controller.grabbedPlayer = null;
            grabber.grabbedEntity = null;
            victim.controller.isGrabbed = false;
            victim.controller.grabbedBy = null;
            victim.isBeingCarried = false;
            this.endCarryAnimation(victim);

            // Mark as escaping to prevent other animations from interrupting
            victim.isEscaping = true;
            grabber.isBeingHit = true;
            
            // Reset victim's rotation to normal (was laying flat)
            victim.model.rotation.x = 0;
            victim.model.rotation.z = 0;
            victim.controller.position.y = grabber.controller.position.y; // Back to ground level
            victim.model.position.copy(victim.controller.position);
            
            // Victim (escaping player) plays uppercut animation
            console.log('[Arena] Victim playing punch animation');
            victim.playAnimation('punch');
            if (victim.animController) {
                const punchAction = victim.animController.mixer?.clipAction(
                    victim.animController.animations['punch']
                );
                if (punchAction) {
                    punchAction.timeScale = 2.0; // Fast uppercut
                }
            }
            
            // Grabber receives HURT - they got punched!
            console.log('[Arena] Grabber playing hit animation');
            grabber.playAnimation('hit');
            if (grabber.animController) {
                const hitAction = grabber.animController.mixer?.clipAction(
                    grabber.animController.animations['hit']
                );
                if (hitAction) {
                    hitAction.timeScale = 1.5; // Faster hurt
                }
            }
            
            // Show status
            if (this.hud) {
                this.hud.showStatus(data.targetId, '¡ESCAPÓ!');
                this.hud.showStatus(data.grabberId, '¡GOLPEADO!');
                this.hud.showDamage(data.grabberId, 10, false);
            }
            
            // Screen shake for dramatic effect
            this.shakeScreen(0.3, 200);
            
            // Create VFX on grabber (they got hit)
            if (this.vfxManager) {
                const pos = grabber.model.position.clone();
                pos.y += 1;
                this.vfxManager.createHitSparks?.(pos, 0xff3366, 1.5);
                this.vfxManager.createDamageNumber?.(pos, 10, 0xff3366);
            }
            
            // Play punch sound
            if (this.sfxManager) {
                this.sfxManager.playHit?.(10, false);
            }
            
            // Return VICTIM to idle after punch animation (short)
            setTimeout(() => {
                console.log('[Arena] Returning victim to idle');
                victim.isEscaping = false;
                if (victim && !victim.controller.isEliminated && !victim.controller.isStunned) {
                    victim.playAnimation('idle');
                }
            }, 400); // Punch animation is fast
            
            // Return GRABBER to idle after hit animation (slightly longer)
            setTimeout(() => {
                console.log('[Arena] Returning grabber to idle');
                grabber.isBeingHit = false;
                if (grabber && !grabber.controller.isEliminated && !grabber.controller.isStunned) {
                    grabber.playAnimation('idle');
                }
            }, 700); // Hit animation takes a bit longer
        }
    }
    
    // =================================
    // Grappling (tie-ups, moves, downs, pins)
    // =================================

    /**
     * Drive grapple animations from the arena-state flags, so a missed event self-heals.
     * Priority: pin > on the mat > getting up > move > tie-up > nothing (locomotion).
     */
    syncGrappleVisuals(player) {
        const c = player.controller;
        if (c.isEliminated || player.flight || player.launch || player.leap || player.knock || player.celebrating) return;
        if (!c.move) player.moveVisual = null;

        if (c.pin) {
            if (c.pin.role === 'pinner') {
                player.setLock('kneel', { loop: false, timeScale: WRESTLE_CONFIG.KNEEL_SPEED, fade: 0.2 });
            } else {
                player.enterDown();
            }
        } else if (c.isDown) {
            if (player.selfFallUntil > performance.now() && player.lockAnim !== 'down') {
                // Dropkick: the kicker drops onto their back (head away from the kick)
                player.startKnockdown({
                    angle: player.model.rotation.y + Math.PI,
                    style: 'self',
                    onLand: (p) => this.playKnockLanding(p, 0.6)
                });
            } else {
                player.enterDown();
            }
        } else if (c.isGettingUp) {
            player.enterGetUp();
        } else if (c.move) {
            if (!player.moveVisual) {
                // Missed 'arena-grapple-move' / 'arena-finisher': best-effort pose until the move ends
                player.moveVisual = { type: c.move.type, role: c.move.role };
                if (c.move.role === 'attacker' && c.move.type === 'finisher') {
                    player.setLock('slamThrow', { loop: false, fade: 0.1 }) || player.setLock('tieup', { loop: true });
                } else if (c.move.role === 'attacker') {
                    player.setLock(MOVE_ATTACKER_CLIPS[c.move.type] || 'tieup', { loop: false, fade: 0.1 });
                } else {
                    player.setLock('tieup', { loop: true });
                }
            }
        } else if (c.whip) {
            // Irish whip: forced run into the ropes and back (facing follows the server)
            player.setLock('ropeRun', { loop: true, fade: 0.12, timeScale: ROPE_CONFIG.RUN_TIMESCALE });
        } else if (c.tieUp) {
            player.setLock('tieup', { loop: true, fade: 0.15 });
        } else if (player.lockAnim && player.lockAnim !== 'ko') {
            player.clearLock();
        }
    }

    handleArenaTieUp(data) {
        const attacker = this.players.get(data.attackerId);
        const defender = this.players.get(data.defenderId);
        [attacker, defender].forEach((p) => {
            if (p && !p.controller.isEliminated) p.setLock('tieup', { loop: true, fade: 0.15 });
        });
        if (!attacker || !defender) return;

        this.showTieUpIndicator(attacker, defender, data.duration || 2500);

        if (this.vfxManager) {
            const mid = attacker.model.position.clone().add(defender.model.position).multiplyScalar(0.5);
            mid.y += 1.2;
            this.vfxManager.createHitSparks?.(mid, 0xffcc00, 0.8);
        }
        this.sfxManager?.playBlock?.();
    }

    handleArenaTieUpEnd(data) {
        this.removeTieUpIndicator(data.attackerId);
        const attacker = this.players.get(data.attackerId);
        const defender = this.players.get(data.defenderId);

        if (data.reason === 'escape') {
            this.hud?.showStatus(data.defenderId, '¡SE ZAFÓ!');
            this.hud?.showStatus(data.attackerId, 'stunned');
            this.sfxManager?.playBlock?.();
            if (this.vfxManager && defender) {
                const pos = defender.model.position.clone();
                pos.y += 1.2;
                this.vfxManager.createBlockSparks?.(pos);
            }
        }

        // No move/lift follows a tie-up end: release both (arena-state would do it too)
        [attacker, defender].forEach((p) => {
            if (p && p.lockAnim === 'tieup') p.clearLock();
        });
    }

    handleArenaGrappleMove(data) {
        const attacker = this.players.get(data.attackerId);
        const defender = this.players.get(data.defenderId);
        this.removeTieUpIndicator(data.attackerId);

        const duration = data.duration || 1000;
        const impactDelay = data.impactDelay || duration / 2;

        if (attacker && !attacker.controller.isEliminated) {
            attacker.moveVisual = { type: data.move, role: 'attacker' };
            if (typeof data.facingAngle === 'number') attacker.controller.facingAngle = data.facingAngle;

            const clipName = MOVE_ATTACKER_CLIPS[data.move] || 'tieup';
            const clipDuration = attacker.clipDuration(clipName);
            // Fit the clip to the move; the suplex fall is synced so the back hits the mat at the impact
            let timeScale = clipDuration / (duration / 1000);
            if (data.move === 'suplex' && !attacker.isFallbackClip('suplex')) {
                timeScale = (clipDuration * WRESTLE_CONFIG.SUPLEX_FALL_FRACTION) / (impactDelay / 1000);
            }
            attacker.setLock(clipName, { loop: false, timeScale, fade: 0.1, restart: true });
        }

        if (defender && !defender.controller.isEliminated) {
            defender.moveVisual = { type: data.move, role: 'defender' };
            if ((data.move === 'slam' || data.move === 'suplex') && data.landing) {
                const attackerPos = data.attackerPos || attacker?.controller.position || defender.model.position;
                defender.startFlight({
                    type: data.move,
                    start: defender.model.position,
                    attacker: attackerPos,
                    landing: data.landing,
                    angle: typeof data.facingAngle === 'number'
                        ? data.facingAngle
                        : Math.atan2(defender.model.position.x - attackerPos.x, defender.model.position.z - attackerPos.z),
                    impactMs: impactDelay
                });
            } else {
                // Headbutt/knee: keep struggling until the impact
                defender.setLock('tieup', { loop: true });
            }
        }

        if (this.sfxManager) {
            if (data.move === 'headbutt') this.sfxManager.playPunchWhoosh?.();
            else if (data.move === 'knee') this.sfxManager.playKickWhoosh?.();
            else this.sfxManager.playJump?.();
        }
    }

    handleArenaGrappleImpact(data) {
        if (data.move === 'finisher') {
            this.handleFinisherImpact(data);
            return;
        }
        const defender = this.players.get(data.defenderId);
        if (defender) {
            if (typeof data.newHealth === 'number') defender.controller.health = data.newHealth;

            if (!defender.controller.isEliminated) {
                if (!data.down) {
                    defender.setLock('hitReact', {
                        loop: false,
                        timeScale: WRESTLE_CONFIG.HIT_REACT_SPEED,
                        fade: 0.08,
                        restart: true
                    });
                } else if (!defender.flight) {
                    // The flight was missed (or already over): make sure they're on the mat
                    defender.enterDown();
                }
            }
        }

        this.playGrappleImpactEffects(data, defender);
    }

    playGrappleImpactEffects(data, defender) {
        const heavy = !!data.down;
        const color = MOVE_COLORS[data.move] || 0xff3366;
        const damage = data.damage || 0;

        let hitPos;
        if (heavy && data.landing) {
            hitPos = new THREE.Vector3(data.landing.x, (data.landing.y ?? ARENA_CONFIG.RING_HEIGHT) + 0.3, data.landing.z);
        } else if (defender) {
            hitPos = defender.model.position.clone();
            hitPos.y += data.move === 'headbutt' ? 1.5 : 1.0;
        } else {
            return;
        }

        if (this.vfxManager) {
            this.vfxManager.createHitSparks?.(hitPos, color, heavy ? 2.5 : 1.6);
            this.vfxManager.createImpactRing?.(hitPos, color);
            this.vfxManager.createDamageNumber?.(hitPos, damage, color);
            if (defender) this.vfxManager.createCharacterFlash?.(defender.model, 120);
            if (heavy) {
                const ground = hitPos.clone();
                ground.y = ARENA_CONFIG.RING_HEIGHT;
                this.vfxManager.createLandingImpact?.(ground, data.move === 'suplex' ? 2.5 : 2.0);
                this.vfxManager.createDustCloud?.(ground, 2);
            }
        }

        if (this.sfxManager) {
            if (heavy) {
                this.sfxManager.playHit?.(35, false); // Heavy hit
                this.sfxManager.playLand?.(1);
            } else if (data.move === 'knee') {
                this.sfxManager.playKickHit?.(damage);
            } else {
                this.sfxManager.playHit?.(20, false);
            }
        }

        if (heavy) {
            this.shakeScreen(data.move === 'suplex' ? 1.0 : 0.8, data.move === 'suplex' ? 550 : 450);
        } else {
            this.shakeScreen(0.35, 180);
        }

        if (this.hud && defender) {
            this.hud.updatePlayer(defender);
            this.hud.showDamage(data.defenderId, damage, false);
            if (heavy && !data.eliminated) this.hud.showStatus(data.defenderId, '¡A LA LONA!');
        }

        this.showMovePopup(MOVE_NAMES[data.move] || '¡ZAS!', hitPos);
    }

    handleArenaGetUp(data) {
        const player = this.players.get(data.playerId);
        // Mid knockdown: the arena-state sync starts the get-up once the back is on the mat
        if (!player || player.controller.isEliminated || player.flight || player.launch || player.knock) return;
        player.enterGetUp();
    }

    handleArenaPinStart(data) {
        const pinner = this.players.get(data.pinnerId);
        const victim = this.players.get(data.victimId);
        if (pinner && !pinner.controller.isEliminated) {
            pinner.setLock('kneel', { loop: false, timeScale: WRESTLE_CONFIG.KNEEL_SPEED, fade: 0.2 });
        }
        if (victim && !victim.controller.isEliminated && !victim.flight) victim.enterDown();

        this.hud?.showStatus(data.victimId, '¡CUBIERTO!');
        this.hud?.showRefCount('¡PIN!', 'start', 800);
    }

    handleArenaPinCount(data) {
        const count = data.count || 0;
        const final = count >= 3;
        this.hud?.showRefCount(final ? '3!' : String(count), final ? 'final' : 'count', final ? 900 : 850);

        // Referee slapping the mat
        this.sfxManager?.playBlock?.();
        if (final) this.sfxManager?.playKO?.();
        this.shakeScreen(final ? 0.3 : 0.12, final ? 250 : 120);

        const victim = this.players.get(data.victimId);
        if (this.vfxManager && victim) {
            const pos = victim.model.position.clone();
            pos.y = ARENA_CONFIG.RING_HEIGHT + 0.05;
            this.vfxManager.createImpactRing?.(pos, final ? 0xffcc00 : 0xffffff);
        }
    }

    handleArenaPinEnd(data) {
        const pinner = this.players.get(data.pinnerId);
        if (pinner && pinner.lockAnim === 'kneel') pinner.clearLock();

        if (data.result === 'kickout') {
            this.hud?.showRefCount('¡SE ZAFÓ!', 'kickout', 1600);
            this.hud?.showStatus(data.victimId, '¡SE ZAFÓ!');
            if (pinner && !pinner.controller.isEliminated) {
                pinner.playTimed('hitReact', 500, { cancelOnMove: false });
            }
            this.sfxManager?.playBlock?.();
            this.shakeScreen(0.3, 200);
        } else if (data.result === 'pinfall') {
            // "3!" is on screen: follow it with the verdict
            const matchId = this.matchId;
            clearTimeout(this.pinVerdictTimer);
            this.pinVerdictTimer = setTimeout(() => {
                if (matchId === this.matchId) this.hud?.showRefCount('¡CUENTA DE 3!', 'pinfall', 1800);
            }, 650);
        } else {
            this.hud?.hideRefCount();
        }
    }

    // =================================
    // Spirit meter, taunts, victory & finishers (phase 2)
    // =================================

    /**
     * Per arena-state: aura while SPECIAL (heals a missed 'arena-special'/'-end') and taunts
     * the server cut short (hit, grabbed...)
     */
    syncSpiritVisuals(player) {
        const c = player.controller;
        if (!c.hasSpiritState) return;

        if (c.isSpecial && !c.isEliminated) {
            if (!this.specialAuras.has(player.id)) this.addSpecialAura(player);
        } else if (this.specialAuras.has(player.id)) {
            this.removeSpecialAura(player.id);
        }

        const timed = player.timedAnim;
        if (timed?.taunt && !c.isTaunting && performance.now() - timed.start > 400) {
            timed.until = 0; // updateTimed ends it next frame, locomotion takes over
        }
    }

    /**
     * Taunt clip of a character (each plush has its own, see CHARACTER_TAUNTS)
     */
    getTauntClip(player) {
        const actions = player.animController.actions;
        const id = player.characterId || this.selectedCharacter || 'edgar';
        let clip = CHARACTER_TAUNTS[id];
        if (!clip) {
            let hash = 0;
            for (const ch of String(id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
            clip = TAUNT_CLIPS[hash % TAUNT_CLIPS.length];
        }
        if (actions[clip] && !player.isFallbackClip(clip)) return clip;
        if (actions.tauntDance) return 'tauntDance';
        return TAUNT_CLIPS.find((name) => actions[name] && !player.isFallbackClip(name)) || null;
    }

    /**
     * Play the character's taunt for the server taunt duration (2.5 s)
     */
    playCharacterTaunt(player) {
        if (player.controller.isEliminated || player.lockAnim) return;
        const ms = FINISHER_CONFIG.TAUNT_MS;
        const clip = this.getTauntClip(player);
        if (clip) {
            // Close to the clip's own speed; a long clip is cut, a short one holds its last frame
            const timeScale = THREE.MathUtils.clamp(player.clipDuration(clip) / (ms / 1000), 0.8, 1.6);
            if (player.playTimed(clip, ms, { cancelOnMove: false, timeScale })) {
                player.timedAnim.taunt = true;
                return;
            }
        }
        player.playAnimation('taunt');
    }

    /**
     * Match winner: Mixamo victory celebration (looped), turning towards the winner camera
     */
    playVictory(player) {
        if (!player || player.controller.isEliminated) return;
        if (player.flight) player.finishFlight();
        player.launch = null;
        player.leap = null;
        player.bounce = null;
        player.knock = null;
        player.hop = null;
        player.ropeLean = null;
        player.clearLock();
        player.timedAnim = null;
        player.poseYaw = null;

        const actions = player.animController.actions;
        const clip = actions.victory && !player.isFallbackClip('victory')
            ? 'victory'
            : (actions.tauntDance ? 'tauntDance' : null);
        if (clip && player.setLock(clip, { loop: true, fade: 0.3, restart: true })) {
            player.celebrating = true;
            return;
        }
        player.playAnimation('taunt');
    }

    handleArenaSpecial(data) {
        const player = this.players.get(data.playerId);
        if (!player) return;
        const c = player.controller;
        c.isSpecial = true;
        c.specialDuration = data.duration || FINISHER_CONFIG.SPECIAL_MS;
        c.specialMsLeft = c.specialDuration;
        c.spirit = 100;
        if (data.finisher) c.finisher = data.finisher;
        this.hud?.updatePlayer(player);
        if (c.isEliminated) return;

        this.addSpecialAura(player);
        this.showSpecialBanner(player, data.finisher || c.finisher);

        if (this.vfxManager) {
            const color = new THREE.Color(player.color).getHex();
            const pos = player.model.position.clone();
            pos.y += 1.2;
            this.vfxManager.createHitSparks?.(pos, color, 2.2);
            const feet = player.model.position.clone();
            feet.y = ARENA_CONFIG.RING_HEIGHT + 0.05;
            this.vfxManager.createImpactRing?.(feet, color);
            this.vfxManager.createCharacterFlash?.(player.model, 200);
        }
        this.sfxManager?.play?.('firePunch', 0.9);
        this.shakeScreen(0.2, 200);
    }

    handleArenaSpecialEnd(data) {
        this.removeSpecialAura(data.playerId);
        const player = this.players.get(data.playerId);
        if (!player) return;
        player.controller.isSpecial = false;
        player.controller.specialMsLeft = 0;
        this.hud?.updatePlayer(player);
        if (data.reason === 'timeout' && !player.controller.isEliminated) {
            this.hud?.showStatus(data.playerId, 'SE ENFRIÓ');
        }
    }

    /**
     * Glowing, pulsing aura in the player's color while SPECIAL
     */
    addSpecialAura(player) {
        if (this.specialAuras.has(player.id) || !player.model) return;

        if (!this.auraGeometries) {
            const column = new THREE.CylinderGeometry(0.6, 0.85, 2.5, 32, 1, true);
            column.translate(0, 1.25, 0);
            const ring = new THREE.RingGeometry(0.55, 1.0, 48);
            ring.rotateX(-Math.PI / 2);
            this.auraGeometries = { column, ring };
        }

        const color = new THREE.Color(player.color);
        const group = new THREE.Group();

        // Light column fading upwards, with flickering vertical streaks
        const colMat = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: color },
                uTime: { value: 0 },
                uOpacity: { value: 0.5 }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uColor;
                uniform float uTime;
                uniform float uOpacity;
                varying vec2 vUv;
                void main() {
                    float fade = pow(1.0 - vUv.y, 1.5);
                    float streaks = 0.65 + 0.35 * sin(vUv.x * 50.0 + uTime * 5.0 + vUv.y * 8.0);
                    gl_FragColor = vec4(uColor * 1.5, fade * streaks * uOpacity);
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
        });
        const column = new THREE.Mesh(this.auraGeometries.column, colMat);
        column.renderOrder = 5;
        group.add(column);

        // Ring on the mat
        const ringMat = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.7,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
        });
        const ring = new THREE.Mesh(this.auraGeometries.ring, ringMat);
        ring.position.y = 0.04;
        ring.renderOrder = 5;
        group.add(ring);

        // Rising sparks
        const count = 18;
        const sparkGeo = new THREE.BufferGeometry();
        sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        const sparkMat = new THREE.PointsMaterial({
            color,
            size: 0.1,
            transparent: true,
            opacity: 0.95,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
        const sparks = new THREE.Points(sparkGeo, sparkMat);
        sparks.frustumCulled = false;
        group.add(sparks);
        const seeds = Array.from({ length: count }, () => ({
            angle: Math.random() * Math.PI * 2,
            radius: 0.35 + Math.random() * 0.45,
            speed: 0.5 + Math.random() * 0.6,
            offset: Math.random()
        }));

        // The model itself glows (pulses the color tint set by applyColorTint)
        const materials = [];
        player.model.traverse((child) => {
            if (!child.isMesh || !child.material) return;
            (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => {
                if (m.emissive) materials.push(m);
            });
        });

        this.scene.add(group);
        this.specialAuras.set(player.id, {
            group, column, colMat, ring, ringMat, sparkGeo, sparkMat, seeds, materials,
            start: performance.now()
        });
        this.updateSpecialAuras(performance.now());
    }

    removeSpecialAura(playerId) {
        const aura = this.specialAuras.get(playerId);
        if (!aura) return;
        this.specialAuras.delete(playerId);
        aura.group.removeFromParent();
        aura.colMat.dispose();
        aura.ringMat.dispose();
        aura.sparkGeo.dispose();
        aura.sparkMat.dispose();
        aura.materials.forEach((m) => { m.emissiveIntensity = 0.15; });
    }

    updateSpecialAuras(now) {
        this.specialAuras.forEach((aura, id) => {
            const player = this.players.get(id);
            if (!player || !player.model.parent || player.controller.isEliminated) {
                this.removeSpecialAura(id);
                return;
            }
            const t = (now - aura.start) / 1000;
            const pulse = 0.5 + 0.5 * Math.sin(t * 6);
            const p = player.model.position;
            aura.group.position.set(p.x, p.y, p.z);

            aura.colMat.uniforms.uTime.value = t;
            aura.colMat.uniforms.uOpacity.value = 0.3 + 0.35 * pulse;
            const s = 1 + 0.08 * pulse;
            aura.column.scale.set(s, 1 + 0.05 * pulse, s);
            aura.ring.scale.setScalar(1 + 0.2 * pulse);
            aura.ringMat.opacity = 0.4 + 0.4 * pulse;

            const pos = aura.sparkGeo.attributes.position.array;
            aura.seeds.forEach((seed, i) => {
                const life = (t * seed.speed + seed.offset) % 1;
                const a = seed.angle + t * 1.3;
                const r = seed.radius * (1 - 0.4 * life);
                pos[i * 3] = Math.cos(a) * r;
                pos[i * 3 + 1] = 0.1 + life * 2.5;
                pos[i * 3 + 2] = Math.sin(a) * r;
            });
            aura.sparkGeo.attributes.position.needsUpdate = true;

            const glow = 0.3 + 0.55 * pulse;
            aura.materials.forEach((m) => { m.emissiveIntensity = glow; });
        });
    }

    /**
     * Absolutely positioned overlay inside the game container (created if arena.html lacks it)
     */
    getOverlayHost(id) {
        let el = document.getElementById(id);
        if (!el) {
            el = document.createElement('div');
            el.id = id;
            (document.getElementById('game-container') || document.body).appendChild(el);
        }
        return el;
    }

    /**
     * "¡ESPECIAL! <player>" banner
     */
    showSpecialBanner(player, finisher) {
        const host = this.getOverlayHost('arena-special-banners');
        const el = document.createElement('div');
        el.className = 'arena-special-banner';
        el.style.setProperty('--player-color', player.color);

        const title = document.createElement('span');
        title.className = 'arena-special-title';
        title.textContent = '¡ESPECIAL!';
        const name = document.createElement('span');
        name.className = 'arena-special-player';
        name.textContent = player.name;
        el.append(title, name);
        if (finisher?.name) {
            const move = document.createElement('span');
            move.className = 'arena-special-move';
            move.textContent = `${finisher.name} LISTO`;
            el.appendChild(move);
        }

        host.appendChild(el);
        setTimeout(() => el.remove(), 2600);
    }

    /**
     * Floating world-space text (CSS2D) that removes itself
     */
    showFloatingText(text, worldPos, className, ms = 1300) {
        const el = document.createElement('div');
        el.className = className;
        const inner = document.createElement('span');
        inner.textContent = text;
        el.appendChild(inner);

        const label = new CSS2DObject(el);
        label.position.copy(worldPos);
        label.center.set(0.5, 1);
        this.scene.add(label);
        this.transientLabels.add(label);

        setTimeout(() => {
            label.removeFromParent();
            this.transientLabels.delete(label);
        }, ms);
    }

    /**
     * Timer cancelled on a new round / rematch
     */
    addFinisherTimer(fn, ms) {
        const matchId = this.matchId;
        const timer = setTimeout(() => {
            this.finisherTimers.delete(timer);
            if (matchId === this.matchId) fn();
        }, ms);
        this.finisherTimers.add(timer);
        return timer;
    }

    handleArenaFinisher(data) {
        console.log('[Arena] Finisher:', data);
        const attacker = this.players.get(data.attackerId);
        const defender = this.players.get(data.defenderId);
        const type = data.finisher;
        const duration = data.duration || 1500;
        const impact = Math.min(data.impactDelay || duration * 0.6, duration);

        this.removeTieUpIndicator(data.attackerId);
        this.removeSpecialAura(data.attackerId);

        const angle = typeof data.facingAngle === 'number'
            ? data.facingAngle
            : (attacker && defender
                ? Math.atan2(defender.model.position.x - attacker.model.position.x,
                    defender.model.position.z - attacker.model.position.z)
                : 0);

        if (attacker) {
            const c = attacker.controller;
            c.isSpecial = false;
            c.specialMsLeft = 0;
            c.spirit = 0;
            this.hud?.updatePlayer(attacker);
        }

        this.showFinisherCinematic(attacker, data, impact, duration);
        this.finisherCam = {
            attackerId: data.attackerId,
            defenderId: data.defenderId,
            until: performance.now() + duration + FINISHER_CONFIG.CAMERA_HOLD_MS
        };

        if (attacker && !attacker.controller.isEliminated) {
            attacker.moveVisual = { type: 'finisher', role: 'attacker' };
            attacker.controller.facingAngle = angle;
            this.playFinisherAttacker(attacker, defender, data, type, angle, impact, duration);
        }
        if (defender && !defender.controller.isEliminated) {
            defender.moveVisual = { type: 'finisher', role: 'defender' };
            this.playFinisherDefender(defender, attacker, data, type, angle, impact, duration);
        }

        // Wind-up
        const color = FINISHER_COLORS[type] || 0xffcc00;
        this.sfxManager?.play?.('firePunch', 0.8);
        if (type === 'superkick') this.sfxManager?.playKickWhoosh?.();
        else this.sfxManager?.playJump?.();
        if (this.vfxManager && attacker) {
            const pos = attacker.model.position.clone();
            pos.y += 1.2;
            this.vfxManager.createChargeGlow?.(attacker.model, color);
            this.vfxManager.createHitSparks?.(pos, color, 1.6);
        }
    }

    /**
     * Attacker side of a finisher: clip timed to the server impact
     */
    playFinisherAttacker(attacker, defender, data, type, angle, impact, duration) {
        const meta = attacker.wrestleMeta || {};
        const actions = attacker.animController.actions;
        const fitWhole = (clip, ms) => attacker.setLock(clip, {
            loop: false,
            timeScale: attacker.clipDuration(clip) / (ms / 1000),
            fade: 0.1,
            restart: true
        });

        switch (type) {
            case 'powerbomb':
                // Meshy throw fitted to the move (like the slam)
                if (!fitWhole('slamThrow', duration)) attacker.setLock('tieup', { loop: true });
                break;

            case 'piledriver': {
                // Sit-down part of the sitting clip: seated exactly at the impact
                const sit = attacker.getSitSegment();
                const dropStart = impact * FINISHER_CONFIG.PILEDRIVER_DROP;
                if (sit && attacker.playSegment('sit', sit.start, sit.end, dropStart, impact)) break;
                if (!fitWhole('kneel', impact)) fitWhole('slamThrow', duration);
                break;
            }

            case 'ddt': {
                // falling_back: the back hits the mat at the impact (scrambles up after the move)
                const clip = 'suplex';
                if (!actions[clip]) {
                    fitWhole('slamThrow', duration);
                    break;
                }
                const timeScale = attacker.isFallbackClip(clip)
                    ? attacker.clipDuration(clip) / (duration / 1000)
                    : (attacker.clipDuration(clip) * WRESTLE_CONFIG.SUPLEX_FALL_FRACTION) / (impact / 1000);
                attacker.setLock(clip, { loop: false, timeScale, fade: 0.1, restart: true });
                break;
            }

            case 'splash': {
                const wanted = data.variant === 'jump' ? 'jumpAttack' : 'dive';
                const other = wanted === 'jumpAttack' ? 'dive' : 'jumpAttack';
                const clip = actions[wanted] ? wanted : (actions[other] ? other : null);
                const info = clip ? meta.leap?.[clip] : null;
                let delayMs = 0;
                if (clip) {
                    attacker.playSynced(clip, info ? info.land : attacker.clipDuration(clip) * 0.6, impact);
                    // Real time of the clip's takeoff through the synced playback
                    const { timeScale = 1, startAt = 0 } = attacker.lockOpts || {};
                    if (info) delayMs = Math.max(0, ((info.start - startAt) / timeScale) * 1000);
                }
                const baseArc = clip === 'jumpAttack' ? FINISHER_CONFIG.SPLASH_JUMP_ARC : FINISHER_CONFIG.SPLASH_DIVE_ARC;
                let to = data.landing;
                if (!to) {
                    const victim = data.defenderPos || defender?.model.position || attacker.model.position;
                    to = { x: victim.x - Math.sin(angle) * 0.6, z: victim.z - Math.cos(angle) * 0.6 };
                }
                attacker.startLeap({
                    from: attacker.model.position,
                    to,
                    impactMs: impact,
                    delayMs,
                    arc: Math.max(0.2, baseArc - (info?.rise || 0)),
                    yaw: angle
                });
                break;
            }

            default: {
                // Superkick (unknown finishers too): the kick connects at the impact
                let clip = SUPERKICK_CLIPS[data.variant] || 'kickMma';
                if (!actions[clip]) clip = 'kickMma';
                if (!actions[clip]) {
                    attacker.playAnimation('kick');
                    break;
                }
                const key = attacker.isFallbackClip(clip) ? attacker.clipDuration(clip) * 0.5 : meta.kickHit?.[clip];
                attacker.playSynced(clip, key, impact);
            }
        }
    }

    /**
     * Defender side of a finisher (the superkick launch starts on the impact)
     */
    playFinisherDefender(defender, attacker, data, type, angle, impact, duration) {
        if (type === 'powerbomb' || type === 'piledriver' || type === 'ddt') {
            if (!data.landing) return;
            const attackerPos = data.attackerPos || attacker?.model.position || defender.model.position;
            const fallMs = Math.min(FINISHER_CONFIG.FALL_MS, Math.max(0, duration - impact - 50));
            defender.timedAnim = null;
            defender.startFlight({
                type,
                start: defender.model.position,
                attacker: attackerPos,
                landing: data.landing,
                angle,
                impactMs: impact,
                endMs: type === 'powerbomb' ? impact : impact + fallMs,
                dropStartMs: impact * FINISHER_CONFIG.PILEDRIVER_DROP
            });
        } else if (type === 'splash') {
            defender.enterDown(); // Already on the mat: stays lying until the splash lands
        }
    }

    handleFinisherImpact(data) {
        const attacker = this.players.get(data.attackerId);
        const defender = this.players.get(data.defenderId);
        const type = data.finisher;
        const color = FINISHER_COLORS[type] || 0xffcc00;
        const damage = data.damage || 0;
        const ringY = ARENA_CONFIG.RING_HEIGHT;

        if (defender) {
            if (typeof data.newHealth === 'number') defender.controller.health = data.newHealth;

            if (type === 'superkick') {
                // Flies from the server physics; lies down when the state says isDown
                const from = attacker?.model.position;
                const to = defender.model.position;
                const angle = from
                    ? Math.atan2(to.x - from.x, to.z - from.z)
                    : (defender.controller.facingAngle || 0) + Math.PI;
                defender.timedAnim = null;
                defender.startLaunch({ angle, simulate: defender.controller.isEliminated });
                defender.onLaunchLanded = (p) => {
                    p.onLaunchLanded = null;
                    this.playLaunchLanding(p);
                };
            } else if (type === 'splash') {
                if (!defender.flight) defender.enterDown();
                defender.startBounce();
            } else if (!defender.flight && !defender.controller.isEliminated) {
                // The flight was missed (or already over): make sure they're on the mat
                defender.enterDown();
            }
        }

        // Impact point
        let hitPos;
        if (type === 'superkick' && defender) {
            hitPos = defender.model.position.clone();
            hitPos.y = Math.max(hitPos.y, ringY) + 1.3;
        } else if (data.landing && type !== 'splash') {
            hitPos = new THREE.Vector3(data.landing.x, ringY + 0.3, data.landing.z);
        } else if (defender) {
            hitPos = defender.model.position.clone();
            hitPos.y = ringY + 0.3;
        } else {
            return;
        }
        const ground = hitPos.clone();
        ground.y = ringY + 0.02;

        const vfx = this.vfxManager;
        if (vfx) {
            vfx.createHitSparks?.(hitPos, color, 3.5);
            vfx.createHitSparks?.(hitPos, 0xffffff, 2.0);
            vfx.createImpactRing?.(ground, color);
            vfx.createLandingImpact?.(ground, 3.5);
            vfx.createDustCloud?.(ground, 1);
            vfx.createDustCloud?.(ground, -1);
            vfx.createDamageNumber?.(hitPos, damage, 0xffcc00);
            if (defender) vfx.createCharacterFlash?.(defender.model, 220);
            this.addFinisherTimer(() => {
                vfx.createImpactRing?.(ground, 0xffffff);
                vfx.createHitSparks?.(hitPos, 0xffcc00, 2.5);
            }, 110);
            this.addFinisherTimer(() => vfx.createImpactRing?.(ground, color), 240);
        }

        if (this.sfxManager) {
            this.sfxManager.play?.('heavyHit', 1);
            this.sfxManager.playKO?.();
            this.sfxManager.playLand?.(1);
        }

        this.shakeScreen(1.5, 750);
        this.flashScreen();
        this.markFinisherImpact();

        if (this.hud && defender) {
            this.hud.updatePlayer(defender);
            this.hud.showDamage(data.defenderId, damage, false);
            if (!data.eliminated) this.hud.showStatus(data.defenderId, type === 'superkick' ? '¡NOQUEADO!' : '¡A LA LONA!');
        }
    }

    /**
     * Superkicked player hits the mat
     */
    playLaunchLanding(player) {
        if (this.vfxManager) {
            const pos = player.model.position.clone();
            pos.y = Math.max(pos.y, 0) + 0.05;
            this.vfxManager.createDustCloud?.(pos, 2);
            this.vfxManager.createImpactRing?.(pos, 0xffffff);
            this.vfxManager.createLandingImpact?.(pos, 1.5);
        }
        this.sfxManager?.playLand?.(1);
        this.shakeScreen(0.5, 250);
    }

    /**
     * Cinematic bars + big move-name banner ("¡EDGARBOMBA!")
     */
    showFinisherCinematic(attacker, data, impact, duration) {
        const root = this.getFinisherCinema();
        root.querySelector('.arena-finisher-move').textContent = `¡${data.name || 'FINISHER'}!`;
        root.querySelector('.arena-finisher-attacker').textContent = attacker?.name || '';
        root.style.setProperty('--player-color', attacker?.color || '#ffcc00');

        // Restart the animations
        root.className = '';
        void root.offsetWidth;
        root.className = 'active';

        // Hidden after the impact (rescheduled when the impact event arrives)
        this.scheduleCinemaHide(Math.max(duration, impact + FINISHER_CONFIG.BANNER_AFTER_IMPACT_MS) + 200);
    }

    getFinisherCinema() {
        const root = this.getOverlayHost('arena-finisher-cinema');
        if (!root.querySelector('.arena-finisher-move')) {
            root.innerHTML = `
                <div class="cine-bar cine-top"></div>
                <div class="cine-bar cine-bottom"></div>
                <div class="arena-finisher-banner">
                    <span class="arena-finisher-attacker"></span>
                    <span class="arena-finisher-move"></span>
                </div>
            `;
        }
        return root;
    }

    markFinisherImpact() {
        const root = document.getElementById('arena-finisher-cinema');
        if (!root || !root.classList.contains('active')) return;
        root.classList.remove('impact');
        void root.offsetWidth;
        root.classList.add('impact');
        this.scheduleCinemaHide(FINISHER_CONFIG.BANNER_AFTER_IMPACT_MS);
    }

    scheduleCinemaHide(ms) {
        if (this.cinemaHideTimer) {
            clearTimeout(this.cinemaHideTimer);
            this.finisherTimers.delete(this.cinemaHideTimer);
        }
        this.cinemaHideTimer = this.addFinisherTimer(() => this.hideFinisherCinematic(), ms);
    }

    hideFinisherCinematic() {
        const root = document.getElementById('arena-finisher-cinema');
        if (root && root.classList.contains('active')) root.className = 'leaving';
    }

    /**
     * White impact flash over the whole screen
     */
    flashScreen() {
        const el = this.getOverlayHost('arena-impact-flash');
        el.className = '';
        void el.offsetWidth;
        el.className = 'flash';
    }

    /**
     * Camera punched in on the finisher pair (restored by the normal follow camera afterwards)
     * @returns {boolean} True while it drives the camera
     */
    updateFinisherCamera() {
        const fc = this.finisherCam;
        if (!fc) return false;
        if (performance.now() > fc.until || this.gameState === 'finished') {
            this.finisherCam = null;
            return false;
        }

        let cx = 0;
        let cz = 0;
        let n = 0;
        [fc.attackerId, fc.defenderId].forEach((id) => {
            const p = this.players.get(id);
            if (!p || !p.model.parent) return;
            cx += p.model.position.x;
            cz += p.model.position.z;
            n++;
        });
        if (n === 0) {
            this.finisherCam = null;
            return false;
        }
        cx /= n;
        cz /= n;

        const height = FINISHER_CONFIG.CAMERA_HEIGHT;
        const offset = height * Math.tan(ARENA_CONFIG.CAMERA_ANGLE);
        const k = FINISHER_CONFIG.CAMERA_LERP;
        const lookY = 1.0;
        const cam = this.camera;
        cam.position.x = THREE.MathUtils.lerp(cam.position.x, cx, k);
        cam.position.y = THREE.MathUtils.lerp(cam.position.y, height + lookY, k);
        cam.position.z = THREE.MathUtils.lerp(cam.position.z, cz + offset, k);

        if (!cam.userData.lookAtTarget) cam.userData.lookAtTarget = new THREE.Vector3(cx, 0, cz);
        const look = cam.userData.lookAtTarget;
        look.x = THREE.MathUtils.lerp(look.x, cx, k);
        look.y = THREE.MathUtils.lerp(look.y, lookY, k);
        look.z = THREE.MathUtils.lerp(look.z, cz, k);
        cam.lookAt(look);
        return true;
    }

    /**
     * Remove every spirit/finisher visual (new round / rematch)
     */
    clearSpiritOverlays() {
        Array.from(this.specialAuras.keys()).forEach((id) => this.removeSpecialAura(id));
        this.finisherTimers.forEach((timer) => clearTimeout(timer));
        this.finisherTimers.clear();
        this.cinemaHideTimer = null;
        this.finisherCam = null;
        const cinema = document.getElementById('arena-finisher-cinema');
        if (cinema) cinema.className = 'hidden';
        const flash = document.getElementById('arena-impact-flash');
        if (flash) flash.className = '';
        document.querySelectorAll('.arena-special-banner').forEach((el) => el.remove());
    }

    /**
     * "AMARRE" tag floating over a tied-up pair, with the tie-up timer and escape progress
     */
    showTieUpIndicator(attacker, defender, duration) {
        this.removeTieUpIndicator(attacker.id);

        const el = document.createElement('div');
        el.className = 'arena-tieup-indicator';
        el.innerHTML = `
            <span class="arena-tieup-label">AMARRE</span>
            <div class="arena-tieup-bar"><div class="arena-tieup-fill"></div></div>
            <span class="arena-tieup-escape"></span>
        `;
        const label = new CSS2DObject(el);
        label.center.set(0.5, 1);
        this.scene.add(label);

        this.tieUpIndicators.set(attacker.id, {
            label,
            attackerId: attacker.id,
            defenderId: defender.id,
            fill: el.querySelector('.arena-tieup-fill'),
            escape: el.querySelector('.arena-tieup-escape'),
            duration,
            start: performance.now()
        });
        this.updateTieUpIndicators();
    }

    removeTieUpIndicator(attackerId) {
        const indicator = this.tieUpIndicators.get(attackerId);
        if (!indicator) return;
        indicator.label.removeFromParent(); // CSS2DObject removes its element on 'removed'
        this.tieUpIndicators.delete(attackerId);
    }

    updateTieUpIndicators() {
        const now = performance.now();
        this.tieUpIndicators.forEach((ind, attackerId) => {
            const attacker = this.players.get(ind.attackerId);
            const defender = this.players.get(ind.defenderId);
            const elapsed = now - ind.start;
            const gone = !attacker || !defender ||
                attacker.controller.isEliminated || defender.controller.isEliminated ||
                (!attacker.controller.tieUp && elapsed > 300) ||
                elapsed > ind.duration + 1000;
            if (gone) {
                this.removeTieUpIndicator(attackerId);
                return;
            }

            ind.label.position.copy(attacker.model.position).add(defender.model.position).multiplyScalar(0.5);
            ind.label.position.y += 2.4;

            const tie = attacker.controller.tieUp;
            const msLeft = tie && typeof tie.msLeft === 'number' ? tie.msLeft : Math.max(0, ind.duration - elapsed);
            ind.fill.style.width = `${Math.max(0, Math.min(1, msLeft / ind.duration)) * 100}%`;

            const defTie = defender.controller.tieUp;
            const taps = defTie?.escapeTaps || 0;
            ind.escape.textContent = taps > 0 ? `ZAFÁNDOSE ${taps}/${defTie.escapeNeeded || 5}` : '';
        });
    }

    /**
     * Big move name over the impact point ("¡SUPLEX!")
     * @param {string} text
     * @param {THREE.Vector3} worldPos
     * @param {object} [opts]
     * @param {string} [opts.sub] - Second, smaller line ("¡CONTRAATAQUE!" + "¡TENDEDERO!")
     * @param {string} [opts.variant] - Extra class for the colour ('lariat', 'dropkick', 'counter', 'whip')
     */
    showMovePopup(text, worldPos, { sub = null, variant = null } = {}) {
        const el = document.createElement('div');
        el.className = 'arena-move-popup';
        if (variant) el.classList.add(variant);
        const inner = document.createElement('span');
        inner.className = 'arena-move-main';
        inner.textContent = text;
        el.appendChild(inner);
        if (sub) {
            el.classList.add('with-sub');
            const subEl = document.createElement('span');
            subEl.className = 'arena-move-sub';
            subEl.textContent = sub;
            el.appendChild(subEl);
        }

        const label = new CSS2DObject(el);
        label.position.copy(worldPos);
        label.position.y += 1.4;
        label.center.set(0.5, 1);
        this.scene.add(label);
        this.transientLabels.add(label);

        setTimeout(() => {
            label.removeFromParent();
            this.transientLabels.delete(label);
        }, 1300);
    }

    /**
     * Remove every grapple overlay (new round / rematch)
     */
    clearGrappleOverlays() {
        Array.from(this.tieUpIndicators.keys()).forEach((id) => this.removeTieUpIndicator(id));
        this.transientLabels.forEach((label) => label.removeFromParent());
        this.transientLabels.clear();
        clearTimeout(this.pinVerdictTimer);
        this.hud?.hideRefCount?.();
        this.clearSpiritOverlays();
    }

    async addPlayer(playerData, index = 0, total= Math.max(this.players.size + 1, 4)) {
        if (this.players.has(playerData.id)) return;
        
        // Several events (player-joined, game-started) can add the same player while its
        // model is still loading: only the latest call for an id may create the entity
        if (!this.pendingPlayerLoads) this.pendingPlayerLoads = new Map();
        const loadToken = {};
        this.pendingPlayerLoads.set(playerData.id, loadToken);
        
        const characterId = CHARACTER_MODELS[playerData.character] ? playerData.character : 'edgar';

        // Model + grapple clips retargeted to this character (downloaded on demand, cached;
        // falls back to the default model if this one can't be loaded)
        let assets;
        try {
            assets = await this.loadCharacterAssets(characterId);
        } catch (err) {
            console.error(`[Arena] No model available for player ${playerData.id} (${characterId}):`, err);
            if (this.pendingPlayerLoads.get(playerData.id) === loadToken) this.pendingPlayerLoads.delete(playerData.id);
            return;
        }
        const { model: playerModel, grapple } = assets;

        // Superseded by a newer addPlayer, removed meanwhile, or already created
        if (this.pendingPlayerLoads.get(playerData.id) !== loadToken) return;
        this.pendingPlayerLoads.delete(playerData.id);
        if (this.players.has(playerData.id)) return;
        
        const number = playerData.number || (index + 1);
        const player = new ArenaPlayerEntity(
            playerData.id,
            number,
            playerData.color || PLAYER_COLORS[(number - 1) % PLAYER_COLORS.length],
            playerModel,
            grapple.animations,
            grapple.meta
        );
        player.characterId = playerData.character || 'edgar';
        
        player.setName(playerData.name || `Player ${number}`);
        
        // Position players evenly around the ring (supports up to 8+ players)
        player.controller.position.copy(getSpawnPosition(index, total));
        player.controller.facingAngle = Math.atan2(-player.controller.position.x, -player.controller.position.z);
        
        this.scene.add(player.model);
        this.players.set(playerData.id, player);
        
        if (this.hud) {
            this.hud.addPlayer(player);
        }
    }
    
    // =================================
    // Ropes, running strikes & battle royal (phase 3)
    // =================================

    /**
     * Irish whip: the attacker flings, the defender runs into the ropes
     * (the run itself follows the server whip state, see syncGrappleVisuals)
     */
    handleArenaWhip(data) {
        const attacker = this.players.get(data.attackerId);
        const defender = this.players.get(data.defenderId);
        this.removeTieUpIndicator(data.attackerId);

        const dir = data.dir || {};
        const hasDir = Number.isFinite(dir.x) && Number.isFinite(dir.z) && (dir.x !== 0 || dir.z !== 0);
        const angle = hasDir ? Math.atan2(dir.x, dir.z) : null;

        if (attacker && !attacker.controller.isEliminated) {
            attacker.controller.tieUp = null;
            if (angle !== null) attacker.controller.facingAngle = angle;
            if (attacker.lockAnim === 'tieup') attacker.clearLock();
            // Fast fling: the release part of the throw clip
            const from = attacker.clipDuration('slamThrow') * 0.25;
            const flung = attacker.playTimed('slamThrow', ROPE_CONFIG.WHIP_FLING_MS, {
                from,
                timeScale: Math.max(0.5, (attacker.clipDuration('slamThrow') - from) / (ROPE_CONFIG.WHIP_FLING_MS / 1000))
            });
            if (!flung) attacker.playAnimation('throw');
        }

        if (defender && !defender.controller.isEliminated) {
            const c = defender.controller;
            c.tieUp = null;
            c.whip = { phase: 'out', attackerId: data.attackerId };
            if (angle !== null) c.facingAngle = angle;
            defender.timedAnim = null;
            defender.setLock('ropeRun', { loop: true, fade: 0.12, timeScale: ROPE_CONFIG.RUN_TIMESCALE });

            const head = defender.model.position.clone();
            head.y += 1.2;
            this.showMovePopup('¡A LAS CUERDAS!', head, { variant: 'whip' });
            if (this.vfxManager) {
                const pos = defender.model.position.clone();
                pos.y += 1.1;
                this.vfxManager.createHitSparks?.(pos, 0x00ffcc, 1.0);
            }
        }

        this.sfxManager?.playKickWhoosh?.();
        this.sfxManager?.playBlock?.();
        this.shakeScreen(0.15, 120);
    }

    /**
     * The whipped player hit the ropes: ropes bend, they bounce back running
     */
    handleArenaRebound(data) {
        const player = this.players.get(data.playerId);
        if (!player || player.controller.isEliminated) return;
        if (player.controller.whip) player.controller.whip.phase = 'back';
        this.playRopeContact(player, ROPE_CONFIG.REBOUND_PUSH);
    }

    /**
     * A running player bounced off the ropes and comes back at speed
     */
    handleArenaRopeBounce(data) {
        const player = this.players.get(data.playerId);
        if (!player || player.controller.isEliminated) return;
        player.controller.isRopeRunning = true;
        this.playRopeContact(player, ROPE_CONFIG.BOUNCE_PUSH);
    }

    handleArenaWhipEnd(data) {
        const player = this.players.get(data.playerId);
        if (!player) return;
        player.controller.whip = null;
        if (player.lockAnim === 'ropeRun') player.clearLock();
        // Ran out of steam: short stagger (the server stuns them for a moment)
        if (data.reason === 'done' && !player.controller.isEliminated && !player.knock && !player.lockAnim) {
            player.playTimed('hitReact', 320);
        }
    }

    /**
     * Rope contact: bend the ropes there, lean the player into them, thud + dust
     */
    playRopeContact(player, push) {
        const pos = player.controller.position;
        const contact = this.pushRopesAt(pos, push);
        player.lastRopeFxAt = performance.now();
        if (!contact) return;

        if (!player.lockAnim || player.lockAnim === 'ropeRun') player.startRopeLean(contact.normal);

        if (this.vfxManager) {
            const feet = new THREE.Vector3(pos.x, ARENA_CONFIG.RING_HEIGHT + 0.05, pos.z);
            this.vfxManager.createDustCloud?.(feet, Math.sign(contact.normal.x) || 1); // Kicked back into the ring
            const rope = contact.point.clone().addScaledVector(contact.normal, push * 0.6);
            this.vfxManager.createHitSparks?.(rope, 0xffffff, 0.6);
        }
        this.sfxManager?.playLand?.(1);
        this.sfxManager?.play?.('block', 0.5);
        this.shakeScreen(0.18, 140);
    }

    /**
     * Bend the ropes on the side nearest to `pos` around the contact point
     * @returns {{normal: THREE.Vector3, point: THREE.Vector3}|null} Outward normal and contact point
     */
    pushRopesAt(pos, strength) {
        if (!this.ropes.length || !pos) return null;
        const edge = ARENA_CONFIG.RING_SIZE / 2 - ROPE_CONFIG.POST_INSET;
        // Ropes along Z (sides x = +-edge) or along X (sides z = +-edge): the closest side
        const alongZ = edge - Math.abs(pos.x) < edge - Math.abs(pos.z);
        const sign = (alongZ ? Math.sign(pos.x) : Math.sign(pos.z)) || 1;
        const axis = alongZ ? 'z' : 'x';
        const u0 = THREE.MathUtils.clamp(alongZ ? pos.z : pos.x, -edge, edge);
        const now = performance.now();

        this.ropes.forEach((rope) => {
            if (rope.axis !== axis || (Math.sign(rope.fixed) || 1) !== sign) return;
            rope.impulses.push({ u0, start: now, amp: strength * (ROPE_CONFIG.LEVEL_PUSH[rope.level] ?? 1) });
            if (rope.impulses.length > 4) rope.impulses.shift();
        });

        const y = ARENA_CONFIG.RING_HEIGHT + ARENA_CONFIG.ROPE_HEIGHT * 0.7;
        return {
            normal: alongZ ? new THREE.Vector3(sign, 0, 0) : new THREE.Vector3(0, 0, sign),
            point: alongZ ? new THREE.Vector3(sign * edge, y, u0) : new THREE.Vector3(u0, y, sign * edge)
        };
    }

    /**
     * Per frame: bend the ropes that have active contacts (pushed out, then springing back)
     */
    updateRopes(now) {
        const width = ROPE_CONFIG.WIDTH;
        this.ropes.forEach((rope) => {
            if (rope.impulses.length) {
                rope.impulses = rope.impulses.filter((imp) => now - imp.start < ROPE_CONFIG.LIFE_MS);
            }
            if (!rope.impulses.length) {
                if (rope.dirty) this.restoreRope(rope);
                return;
            }

            const active = rope.impulses.map((imp) => ({ u0: imp.u0, a: imp.amp * ropeImpulseAmp(now - imp.start) }));
            const attr = rope.mesh.geometry.attributes.position;
            const arr = attr.array;
            const base = rope.base;
            const along = rope.axis === 'x' ? 0 : 2; // Vertex component along the rope
            const out = rope.axis === 'x' ? 2 : 0;   // Component pointing out of the ring
            const sign = Math.sign(rope.fixed) || 1;
            const len = rope.length;
            const half = len / 2;

            for (let i = 0; i < arr.length; i += 3) {
                const u = base[i + along];
                // Ends stay tied to the posts
                const taper = Math.sin(Math.PI * THREE.MathUtils.clamp((u + half) / len, 0, 1));
                let d = 0;
                for (const imp of active) {
                    const x = (u - imp.u0) / width;
                    d += imp.a * Math.exp(-x * x);
                }
                arr[i] = base[i];
                arr[i + 1] = base[i + 1];
                arr[i + 2] = base[i + 2];
                arr[i + out] += sign * d * taper;
            }
            attr.needsUpdate = true;
            rope.dirty = true;
        });
    }

    restoreRope(rope) {
        const attr = rope.mesh.geometry.attributes.position;
        attr.array.set(rope.base);
        attr.needsUpdate = true;
        rope.dirty = false;
    }

    /**
     * Straighten every rope (new round / rematch)
     */
    clearRopeWobble() {
        this.ropes.forEach((rope) => {
            rope.impulses = [];
            this.restoreRope(rope);
        });
    }

    /**
     * Lariat / dropkick wind-up on the attacker (the hit comes ~150 ms later)
     */
    playRunningStrike(player, type) {
        if (player.controller.isEliminated) return;

        if (type === 'lariat') {
            // Arm swung through the opponent at full speed: the uppercut clip, peak on the hit
            const swing = player.playTimedSynced(
                'lariatSwing',
                player.clipDuration('lariatSwing') * 0.5,
                STRIKE_CONFIG.ACTIVE_FRAME_MS + 60,
                STRIKE_CONFIG.LARIAT_SWING_MS,
                3
            );
            if (!swing) player.playAnimation('punch');
            this.sfxManager?.playPunchWhoosh?.();
        } else {
            // Flying kick, feet connect on the hit; the server then lays the kicker down
            const meta = player.wrestleMeta || {};
            const actions = player.animController.actions;
            const clip = actions.kickFlying ? 'kickFlying' : (actions.kickMma ? 'kickMma' : null);
            const key = clip && !player.isFallbackClip(clip) ? meta.kickHit?.[clip] : null;
            const kicked = clip && player.playTimedSynced(
                clip,
                Number.isFinite(key) ? key : player.clipDuration(clip) * 0.5,
                STRIKE_CONFIG.ACTIVE_FRAME_MS,
                STRIKE_CONFIG.DROPKICK_MS
            );
            if (!kicked) player.playAnimation('kick');
            player.startHop(STRIKE_CONFIG.DROPKICK_HOP, STRIKE_CONFIG.DROPKICK_HOP_MS);
            player.selfFallUntil = performance.now() + STRIKE_CONFIG.SELF_FALL_WINDOW_MS;
            this.sfxManager?.playKickWhoosh?.();
            this.sfxManager?.playJump?.();
        }

        if (this.vfxManager && player.model) {
            const color = STRIKE_COLORS[type];
            const pos = player.model.position.clone();
            pos.y += 1;
            const direction = Math.sign(Math.sin(player.controller.facingAngle || 0)) || 1;
            this.vfxManager.createAttackTrail?.(pos, type === 'lariat' ? 'punch' : 'kick', direction, color);
            this.vfxManager.createChargeGlow?.(player.model, color);
        }
    }

    /**
     * Lariat / dropkick hit (or a plain strike upgraded because the target was coming back
     * from the ropes): the target is knocked flat, then the usual down / get-up flow
     */
    playStrikeKnockdown(attacker, target, hit, data) {
        const move = hit.move === 'lariat' ? 'lariat' : 'dropkick';
        const counter = data.attackType !== 'lariat' && data.attackType !== 'dropkick';
        const color = STRIKE_COLORS[move];
        if (typeof hit.newHealth === 'number') target.controller.health = hit.newHealth;

        // Head away from the attacker
        const to = target.model.position;
        const from = attacker?.model.position;
        const dx = from ? to.x - from.x : 0;
        const dz = from ? to.z - from.z : 0;
        const angle = dx * dx + dz * dz > 1e-4 ? Math.atan2(dx, dz) : target.model.rotation.y + Math.PI;

        if (!target.flight && !target.launch && !target.leap) {
            target.controller.whip = null;
            target.startKnockdown({
                angle,
                style: move,
                onLand: (p) => this.playKnockLanding(p, move === 'lariat' ? 0.9 : 0.7)
            });
        }

        const hitPos = target.model.position.clone();
        hitPos.y = Math.max(hitPos.y, ARENA_CONFIG.RING_HEIGHT) + (move === 'lariat' ? 1.5 : 1.1);

        if (this.vfxManager) {
            this.vfxManager.createHitSparks?.(hitPos, color, counter ? 2.8 : 2.2);
            this.vfxManager.createHitSparks?.(hitPos, 0xffffff, 1.0);
            this.vfxManager.createImpactRing?.(hitPos, color);
            this.vfxManager.createDamageNumber?.(hitPos, hit.damage, color);
            this.vfxManager.createCharacterFlash?.(target.model, 140);
        }

        if (this.sfxManager) {
            if (counter) this.sfxManager.play?.('heavyHit', 0.9);
            else if (move === 'lariat') this.sfxManager.playPunchHit?.(25);
            else this.sfxManager.playKickHit?.(30);
        }

        this.shakeScreen(counter ? 0.75 : 0.6, counter ? 380 : 320);

        if (this.hud) {
            this.hud.updatePlayer(target);
            this.hud.showDamage(hit.targetId, hit.damage, false);
            if (!hit.eliminated) this.hud.showStatus(hit.targetId, '¡A LA LONA!');
        }

        if (counter) {
            this.showMovePopup('¡CONTRAATAQUE!', hitPos, { sub: STRIKE_NAMES[move], variant: 'counter' });
        } else {
            this.showMovePopup(STRIKE_NAMES[move], hitPos, { variant: move });
        }
    }

    /**
     * Back hits the mat after a knockdown
     */
    playKnockLanding(player, intensity = 0.7) {
        if (!player.model.parent) return;
        if (this.vfxManager) {
            const pos = player.model.position.clone();
            pos.y = ARENA_CONFIG.RING_HEIGHT + 0.05;
            this.vfxManager.createDustCloud?.(pos, 1);
            this.vfxManager.createDustCloud?.(pos, -1);
            this.vfxManager.createImpactRing?.(pos, 0xffffff);
            this.vfxManager.createLandingImpact?.(pos, 1.2 * intensity);
        }
        this.sfxManager?.playLand?.(1);
        this.shakeScreen(0.35 * intensity, 200);
    }

    /**
     * New match / round: empty the elimination feed, "QUEDAN N" when 3+ players started
     */
    startBattleRoyal(total) {
        this.matchStartCount = total || 0;
        this.feedEliminated.clear();
        this.lastTwoShown = false;
        this.hud?.resetBattleRoyal?.();
        if (this.matchStartCount >= 3) this.hud?.setRemaining?.(this.matchStartCount);
    }

    /**
     * Elimination feed entry ("<attacker> eliminó a <victim> · RING-OUT"), remaining counter
     * and the "¡ÚLTIMOS DOS!" banner
     */
    recordElimination(data, player) {
        if (!data?.playerId || this.feedEliminated.has(data.playerId)) return;
        this.feedEliminated.add(data.playerId);

        const killerId = data.eliminatedBy && data.eliminatedBy !== data.playerId ? data.eliminatedBy : null;
        const killer = killerId ? this.players.get(killerId) : null;
        const killerName = killerId ? (data.eliminatedByName || killer?.name || null) : null;
        this.hud?.addEliminationFeed?.({
            attacker: killerName ? { name: killerName, color: killer?.color } : null,
            victim: { name: data.playerName || player?.name || 'Luchador', color: player?.color },
            reason: ELIMINATION_REASONS[data.reason] || 'KO'
        });

        let remaining = Number.isFinite(data.remaining) ? data.remaining : null;
        if (remaining === null) {
            remaining = 0;
            this.players.forEach((p, id) => {
                if (id !== data.playerId && id !== 'local' && !p.controller.isEliminated) remaining++;
            });
        }

        if (this.matchStartCount >= 3 && this.gameState !== 'finished') {
            this.hud?.setRemaining?.(remaining);
            if (remaining === 2 && !this.lastTwoShown) {
                this.lastTwoShown = true;
                // After the elimination announcement (center screen, 2 s)
                this.addFinisherTimer(() => {
                    if (this.gameState !== 'finished') this.hud?.showBattleBanner?.('¡ÚLTIMOS DOS!');
                }, 1700);
            }
        }
    }

    removePlayer(playerId) {
        this.pendingPlayerLoads?.delete(playerId); // cancel an in-flight addPlayer
        const player = this.players.get(playerId);
        if (player) {
            this.tieUpIndicators.forEach((ind, attackerId) => {
                if (ind.attackerId === playerId || ind.defenderId === playerId) this.removeTieUpIndicator(attackerId);
            });
            this.removeSpecialAura(playerId);
            this.scene.remove(player.model);
            player.dispose();
            this.players.delete(playerId);
            
            if (this.hud) {
                this.hud.removePlayer(playerId);
            }
        }
    }
    
    updateRoomOverlay(playerCount) {
        const btn = document.getElementById('start-game-btn');
        const text = document.querySelector('#room-code-overlay .waiting-text');
        
        if (btn && text) {
            btn.disabled = playerCount < 1;
            text.textContent = playerCount > 0 
                ? `${playerCount} luchador${playerCount > 1 ? 'es' : ''} listo${playerCount > 1 ? 's' : ''}`
                : 'Esperando luchadores...';
        }
    }
    
    showRoundAnnouncement(text) {
        const announcement = document.createElement('div');
        announcement.className = 'arena-round-display';
        announcement.textContent = text;
        document.body.appendChild(announcement);
        
        setTimeout(() => announcement.remove(), 2000);
    }
    
    updateLoadingProgress(percent, text) {
        if (this.progressFill) this.progressFill.style.width = `${percent}%`;
        if (text && this.loadingText) this.loadingText.textContent = text;
    }
    
    updateAnimationDisplay(name) {
        if (this.animationNameDisplay) this.animationNameDisplay.textContent = name;
    }
    
    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        if (this.labelRenderer) {
            this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
        }
    }
    
    checkPlayerCollisions() {
        const playerArray = Array.from(this.players.values());
        const COLLISION_RADIUS = 0.8;
        
        for (let i = 0; i < playerArray.length; i++) {
            for (let j = i + 1; j < playerArray.length; j++) {
                const p1 = playerArray[i].controller;
                const p2 = playerArray[j].controller;

                // The server resolves collisions during online matches
                if (p1.serverControlled || p2.serverControlled) continue;

                // Skip collision if one is grabbing the other
                if (p1.isGrabbing && p1.grabbedPlayer === p2) continue;
                if (p2.isGrabbing && p2.grabbedPlayer === p1) continue;
                if (p1.isGrabbed && p1.grabbedBy === p2) continue;
                if (p2.isGrabbed && p2.grabbedBy === p1) continue;
                
                // Skip collision if either is being carried
                if (playerArray[i].isBeingCarried || playerArray[j].isBeingCarried) continue;
                
                // Skip collision if either is being thrown (flying through the air)
                if (playerArray[i].isBeingThrown || playerArray[j].isBeingThrown) continue;
                if (playerArray[i].isFlying || playerArray[j].isFlying) continue;
                
                const dx = p2.position.x - p1.position.x;
                const dz = p2.position.z - p1.position.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                
                if (dist < COLLISION_RADIUS && dist > 0) {
                    const overlap = COLLISION_RADIUS - dist;
                    const pushX = (dx / dist) * overlap * 0.5;
                    const pushZ = (dz / dist) * overlap * 0.5;
                    
                    p1.position.x -= pushX;
                    p1.position.z -= pushZ;
                    p2.position.x += pushX;
                    p2.position.z += pushZ;
                }
            }
        }
    }
    
    /**
     * Shake the camera. Called on throws, landings, escapes and eliminations.
     * @param {number} intensity - Max offset in world units
     * @param {number} durationMs - Duration in milliseconds
     */
    shakeScreen(intensity = 0.3, durationMs = 200) {
        const now = performance.now();
        const active = this.cameraShake && now < this.cameraShake.end;
        // Keep the strongest active shake instead of letting a weak one cut a strong one short
        if (!active || intensity >= this.cameraShake.intensity) {
            this.cameraShake = { intensity, duration: durationMs, end: now + durationMs };
        }
    }

    /**
     * Current camera shake offset (decays linearly), or null when not shaking
     */
    getCameraShakeOffset() {
        if (!this.cameraShake) return null;
        const remaining = this.cameraShake.end - performance.now();
        if (remaining <= 0) {
            this.cameraShake = null;
            return null;
        }
        const amp = this.cameraShake.intensity * (remaining / this.cameraShake.duration);
        if (!this.shakeOffset) this.shakeOffset = new THREE.Vector3();
        return this.shakeOffset.set(
            (Math.random() * 2 - 1) * amp,
            (Math.random() * 2 - 1) * amp * 0.5,
            (Math.random() * 2 - 1) * amp
        );
    }

    checkRingBoundaries() {
        const ringHalf = ARENA_CONFIG.RING_SIZE / 2 - 0.8; // Rope boundary
        const ringBounce = 0.3; // Bounce back force when hitting ropes
        
        this.players.forEach(player => {
            const pos = player.controller.position;
            const vel = player.controller.velocity;

            if (player.controller.serverControlled) {
                // Server already bounced the player off the ropes: only show warnings and play the sound once
                const edgeDistance = 1.5;
                player.controller.isNearEdge =
                    Math.abs(pos.x) > ringHalf - edgeDistance ||
                    Math.abs(pos.z) > ringHalf - edgeDistance;

                const bouncedX = Math.abs(Math.abs(pos.x) - ringHalf) < 0.01 && vel.x * Math.sign(pos.x) < -2;
                const bouncedZ = Math.abs(Math.abs(pos.z) - ringHalf) < 0.01 && vel.z * Math.sign(pos.z) < -2;
                const bounced = bouncedX || bouncedZ;
                // Rebounds/rope runs already played their own rope sound
                const ropeFxRecent = performance.now() - (player.lastRopeFxAt || 0) < ROPE_CONFIG.SOUND_GUARD_MS;
                if (bounced && !player.ropeSoundPlayed && !ropeFxRecent && this.sfxManager) {
                    this.sfxManager.playBlock();
                }
                player.ropeSoundPlayed = bounced;
                return;
            }

            // Local (non-server) players: enforce rope boundaries (can't go through ropes)
            let hitRope = false;
            
            // Left rope
            if (pos.x < -ringHalf) {
                pos.x = -ringHalf;
                vel.x = Math.abs(vel.x) * ringBounce; // Bounce back
                hitRope = true;
            }
            // Right rope
            if (pos.x > ringHalf) {
                pos.x = ringHalf;
                vel.x = -Math.abs(vel.x) * ringBounce;
                hitRope = true;
            }
            // Front rope (near camera)
            if (pos.z > ringHalf) {
                pos.z = ringHalf;
                vel.z = -Math.abs(vel.z) * ringBounce;
                hitRope = true;
            }
            // Back rope (far from camera)
            if (pos.z < -ringHalf) {
                pos.z = -ringHalf;
                vel.z = Math.abs(vel.z) * ringBounce;
                hitRope = true;
            }
            
            // Set near edge status (for visual warnings)
            const edgeDistance = 1.5;
            player.controller.isNearEdge = 
                Math.abs(pos.x) > ringHalf - edgeDistance ||
                Math.abs(pos.z) > ringHalf - edgeDistance;
            
            // Play bounce sound effect if hit rope
            if (hitRope && this.sfxManager && Math.abs(vel.x) + Math.abs(vel.z) > 2) {
                this.sfxManager.playBlock();
            }
        });
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());
        
        const delta = this.clock.getDelta();
        
        // Track time for dust effects
        if (!this.lastDustTime) this.lastDustTime = 0;
        this.lastDustTime += delta;
        
        // Update all players
        this.players.forEach(player => {
            player.update(delta);
            
            // Update thrown player effects
            this.updateThrownPlayer(player, delta);
            
            // Create dust clouds when running (every 0.15 seconds)
            if (this.vfxManager && player.model && player.controller) {
                const isMoving = player.controller.velocity && 
                    (Math.abs(player.controller.velocity.x) > 0.5 || 
                     Math.abs(player.controller.velocity.z) > 0.5);
                const c = player.controller;
                const isRunning = isMoving && (c.input?.run || c.isRopeRunning || !!c.whip);
                
                if (isRunning && this.lastDustTime > 0.15) {
                    const footPos = player.model.position.clone();
                    footPos.y = 0.5;
                    const direction = Math.sign(player.controller.velocity.x) || 1;
                    this.vfxManager.createDustCloud?.(footPos, direction);
                }
            }
            
            if (this.hud) {
                this.hud.updatePlayer(player);
            }
        });
        
        // Reset dust timer
        if (this.lastDustTime > 0.15) this.lastDustTime = 0;
        
        // Update grabbed player positions (make them follow their grabber)
        this.updateGrabbedPlayerPositions();

        // Floating "AMARRE" tags follow their pair
        this.updateTieUpIndicators();

        // SPECIAL auras follow their player and pulse
        this.updateSpecialAuras(performance.now());

        // Ropes bent by rebounds spring back
        this.updateRopes(performance.now());

        // Check collisions
        this.checkPlayerCollisions();
        this.checkRingBoundaries();
        
        // Update VFX
        if (this.vfxManager) {
            this.vfxManager.update(delta);
        }
        
        // Update camera to follow action
        this.updateCamera();

        // Apply camera shake only for this frame's render, so it never accumulates into the follow camera
        const shakeOffset = this.getCameraShakeOffset();
        if (shakeOffset) this.camera.position.add(shakeOffset);

        this.renderer.render(this.scene, this.camera);

        // Render floating name labels
        if (this.labelRenderer) {
            this.labelRenderer.render(this.scene, this.camera);
        }

        if (shakeOffset) this.camera.position.sub(shakeOffset);
    }
    
    /**
     * Update thrown player - ragdoll spin while flying, fall animation on landing
     */
    updateThrownPlayer(player, delta) {
        // Handle flying state (no animation, just tumbling)
        if (player.isFlying || player.isBeingThrown) {
            const pos = player.controller.position;
            
            // Check if player landed (Y position back to ground level)
            const groundLevel = ARENA_CONFIG.RING_HEIGHT || 0.5;
            
            if (player.controller.position.y <= groundLevel + 0.2) {
                console.log(`[Throw Debug] Player ${player.name} LANDED!`);
                // Player landed!
                player.isBeingThrown = false;
                player.isFlying = false;
                
                if (player.throwSpin) {
                    player.throwSpin.active = false;
                }
                
                // Reset rotation to upright
                player.model.rotation.x = 0;
                player.model.rotation.z = 0;
                
                // NOW play fall/landing animation
                player.playAnimation('fall');
                
                // Play landing effect
                if (this.vfxManager && player.model) {
                    const vfxPos = player.model.position.clone();
                    this.vfxManager.createDustCloud?.(vfxPos, 2);
                    this.vfxManager.createImpactRing?.(vfxPos);
                }
                
                // Play landing sound
                if (this.sfxManager) {
                    this.sfxManager.playLand?.();
                }
                
                // Screen shake on impact
                this.shakeScreen(0.3, 200);
                
                // After fall animation, return to idle (if not eliminated)
                if (!player.controller.isEliminated) {
                    setTimeout(() => {
                        if (!player.controller.isEliminated && !player.controller.isStunned) {
                            player.playAnimation('idle');
                        }
                    }, 1000); // Wait for fall animation to complete
                }
            }
        }
    }
    
    /**
     * Dynamic elastic camera with automatic framing for Arena mode
     * - Follows all players from isometric view
     * - Adjusts height/zoom to keep everyone visible
     * - Smooth interpolation for elastic feel
     */
    updateCamera() {
        if (this.players.size === 0) return;

        // A finisher punches the camera in on the pair
        if (this.updateFinisherCamera()) return;
        
        // Camera configuration for Arena - DYNAMIC based on player count
        const ARENA_CAMERA = {
            MIN_HEIGHT: 6,     // Very close for 1-2 players
            MAX_HEIGHT: 20,    // Further for many players
            PADDING: 3,        // Padding around players
            POSITION_LERP: 0.08,
            ZOOM_LERP: 0.05,
            ANGLE: ARENA_CONFIG.CAMERA_ANGLE,
            FOV: 50
        };
        
        // Only consider ALIVE players for camera framing
        let minX = Infinity, maxX = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        let alivePlayers = 0;
        
        this.players.forEach(player => {
            // Skip eliminated players
            if (player.controller.isEliminated) return;
            
            alivePlayers++;
            const px = player.controller.position.x;
            const pz = player.controller.position.z;
            
            minX = Math.min(minX, px);
            maxX = Math.max(maxX, px);
            minZ = Math.min(minZ, pz);
            maxZ = Math.max(maxZ, pz);
        });
        
        // If no alive players, don't update camera
        if (alivePlayers === 0) return;
        
        // Dynamic padding based on alive player count
        const dynamicPadding = ARENA_CAMERA.PADDING + (alivePlayers * 0.5);
        
        // Add padding to bounds
        minX -= dynamicPadding;
        maxX += dynamicPadding;
        minZ -= dynamicPadding;
        maxZ += dynamicPadding;
        
        // Calculate center of bounding box
        const centerX = (minX + maxX) / 2;
        const centerZ = (minZ + maxZ) / 2;
        
        // Calculate required dimensions
        const spreadX = maxX - minX;
        const spreadZ = maxZ - minZ;
        const maxSpread = Math.max(spreadX, spreadZ);
        
        // Calculate required height based on spread and FOV
        const fovRad = THREE.MathUtils.degToRad(ARENA_CAMERA.FOV);
        
        // Distance needed to fit the spread (considering the camera angle)
        const viewDistance = (maxSpread / 2) / Math.tan(fovRad / 2);
        let targetHeight = viewDistance * Math.cos(ARENA_CAMERA.ANGLE);
        
        // Dynamic min height based on alive players (closer when fewer players)
        const dynamicMinHeight = Math.max(ARENA_CAMERA.MIN_HEIGHT, 4 + (alivePlayers * 1.5));
        
        // Clamp height to dynamic min/max
        targetHeight = THREE.MathUtils.clamp(targetHeight, dynamicMinHeight, ARENA_CAMERA.MAX_HEIGHT);
        
        // Calculate camera offset based on angle
        const horizontalOffset = targetHeight * Math.tan(ARENA_CAMERA.ANGLE);
        
        // Target camera position (isometric view from above and behind)
        const targetCamX = centerX;
        const targetCamY = targetHeight;
        const targetCamZ = centerZ + horizontalOffset;
        
        // Smoothly interpolate camera position (elastic effect)
        this.camera.position.x = THREE.MathUtils.lerp(
            this.camera.position.x, targetCamX, ARENA_CAMERA.POSITION_LERP
        );
        this.camera.position.y = THREE.MathUtils.lerp(
            this.camera.position.y, targetCamY, ARENA_CAMERA.ZOOM_LERP
        );
        this.camera.position.z = THREE.MathUtils.lerp(
            this.camera.position.z, targetCamZ, ARENA_CAMERA.POSITION_LERP
        );
        
        // Look at center of action with smooth interpolation
        if (!this.camera.userData.lookAtTarget) {
            this.camera.userData.lookAtTarget = new THREE.Vector3(centerX, 0, centerZ);
        }
        
        this.camera.userData.lookAtTarget.x = THREE.MathUtils.lerp(
            this.camera.userData.lookAtTarget.x, centerX, ARENA_CAMERA.POSITION_LERP
        );
        this.camera.userData.lookAtTarget.z = THREE.MathUtils.lerp(
            this.camera.userData.lookAtTarget.z, centerZ, ARENA_CAMERA.POSITION_LERP
        );
        // Back to the mat after a finisher punch-in (which looks a bit higher)
        this.camera.userData.lookAtTarget.y = THREE.MathUtils.lerp(
            this.camera.userData.lookAtTarget.y, 0, ARENA_CAMERA.POSITION_LERP
        );
        
        this.camera.lookAt(this.camera.userData.lookAtTarget);
    }
}

// Initialize game when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.arenaGame = new ArenaGame();
});

