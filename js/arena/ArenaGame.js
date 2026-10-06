/**
 * ARENA DE PELUCHES - Wrestling Ring Game Mode
 * Three.js based arena fighting game with top-down perspective
 * Features: Health system, Stamina, Grabs, Ring-out mechanics
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { SERVER_URL, CONFIG } from '../config.js';
import { AnimationController, ANIMATION_CONFIG } from '../animation/AnimationController.js';
import ArenaPlayerController from './ArenaPlayerController.js';
import ArenaHUD from './ArenaHUD.js';
import TournamentManager from '../tournament/TournamentManager.js';
import { retargetMixamoClip } from '../animation/MixamoRetarget.js';

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

// Animation files
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
    throw: 'Meshy_AI_Animation_Throw_withSkin.fbx',
    crawling: 'Crawling.fbx',
    // Additional animations for escape sequence
    uppercut: 'Meshy_AI_Animation_Left_Uppercut_from_Guard_withSkin.fbx',
    knockdown: 'Meshy_AI_Animation_Shot_and_Slow_Fall_Backward_withSkin.fbx'
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
    getup: 'getting_up_c.fbx'         // Gets up from lying on the back
};

// Meshy clip copied in when a Mixamo clip can't be loaded/retargeted (no fallback = skipped)
const MIXAMO_FALLBACKS = {
    tieup: 'grab', headbutt: 'punch', knee: 'kick', suplex: 'fall',
    stomp: 'kick', kneel: 'block', down: 'fall'
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
        this.animController.playState(name, options);
        return true;
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
    }

    /**
     * Short one-shot that locomotion can't override until it ends (or the player moves)
     */
    playTimed(name, ms, { yaw = null, cancelOnMove = true, timeScale } = {}) {
        const ac = this.animController;
        if (this.lockAnim || !ac.actions[name]) return false;
        const duration = this.clipDuration(name);
        ac.playState(name, {
            loop: false,
            timeScale: timeScale ?? Math.max(0.1, duration / (ms / 1000)),
            fade: 0.1,
            restart: true
        });
        const now = performance.now();
        this.timedAnim = { name, start: now, until: now + ms, yaw, cancelOnMove };
        return true;
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
     * Start the procedural flight of a slammed/suplexed defender. The body plays the lying
     * clip the whole time and is rotated/moved as a rigid block, landing on its back on
     * `landing` exactly impactMs after the start.
     * - slam: lifted horizontal above the attacker's head, then slammed in front
     * - suplex: arcs backwards over the attacker's head (270 deg flip) and lands behind
     */
    startFlight({ type, start, attacker, landing, angle, impactMs }) {
        const lie = this.getLieInfo();
        // World direction the head points once landed: across the attacker for a slam,
        // back towards the attacker for a suplex
        const beta = type === 'slam' ? angle + Math.PI / 2 : angle;
        const yaw = beta - lie.alpha;
        const qFinal = new THREE.Quaternion().setFromAxisAngle(UP_AXIS, yaw).multiply(lie.local);

        this.flight = {
            type,
            yaw,
            qFinal,
            axis: new THREE.Vector3(Math.cos(beta), 0, -Math.sin(beta)), // up x head direction
            points: lie.points,
            minYFinal: minPointY(qFinal, lie.points),
            start: new THREE.Vector3(start.x, 0, start.z),
            attacker: new THREE.Vector3(attacker.x, 0, attacker.z),
            landing: new THREE.Vector3(landing.x, 0, landing.z),
            ground: Number.isFinite(landing.y) ? landing.y : ARENA_CONFIG.RING_HEIGHT,
            impactMs: Math.max(1, impactMs || 1),
            startTime: performance.now()
        };
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
        if (t >= impact) {
            this.finishFlight();
            return false;
        }

        // rot: around the horizontal axis perpendicular to the head direction (0 = lying flat,
        // -PI/2 = upright, +PI/2 = upside down). spin: extra yaw around the vertical axis.
        let rot = 0;
        let spin = 0;
        let height = 0;

        if (fl.type === 'slam') {
            const liftEnd = 0.45 * impact;
            const holdEnd = 0.75 * impact;
            if (t < liftEnd) {
                // Upright and facing the attacker -> horizontal above their head
                const s = easeInOut(t / liftEnd);
                rot = -Math.PI / 2 * (1 - s);
                spin = -Math.PI / 2 * (1 - s);
                _flightPos.lerpVectors(fl.start, fl.attacker, s);
                height = WRESTLE_CONFIG.LIFT_HEIGHT * s;
            } else if (t < holdEnd) {
                _flightPos.copy(fl.attacker);
                height = WRESTLE_CONFIG.LIFT_HEIGHT + 0.1 * Math.sin(((t - liftEnd) / (holdEnd - liftEnd)) * Math.PI);
            } else {
                // Slammed down (accelerating) onto the landing spot
                const s = (t - holdEnd) / (impact - holdEnd);
                _flightPos.lerpVectors(fl.attacker, fl.landing, s);
                height = WRESTLE_CONFIG.LIFT_HEIGHT * (1 - s * s);
            }
        } else {
            // Suplex: upright (3PI/2) -> head first over the attacker -> upside down -> flat on the back
            const s = t / impact;
            rot = 1.5 * Math.PI * (1 - s) * (1 - s);
            _flightPos.lerpVectors(fl.start, fl.landing, s);
            height = WRESTLE_CONFIG.SUPLEX_PEAK * Math.sin(Math.PI * s);
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
            this.model.position.set(hold.x, ctrlPos.y, hold.z);
        } else {
            this.model.position.copy(ctrlPos);
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
        const isRunning = isMoving && this.controller.input.run;

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

        // Procedural flight (slam/suplex) owns the transform; otherwise follow the controller
        if (!this.updateFlight(now)) {
            this.updateModelTransform(now);
        }

        // Animation priority: grapple lock > timed one-shot > locomotion
        const ac = this.animController;
        if (this.lockAnim) {
            // Something else took over (a one-shot's auto-return to idle...): put the lock clip back
            const action = ac.actions[this.lockAnim];
            if (action && ac.currentAction !== action) {
                ac.playState(this.lockAnim, { ...this.lockOpts, restart: true });
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
        this.characterModelCache = {};
        this.characterAnimCache = {};      // characterId -> Promise<{animations, meta}> (Meshy + retargeted Mixamo clips)
        this.mixamoSourcesPromise = null;  // Mixamo grapple FBX files, loaded once
        this.sharedGrappleClips = null;
        this.selectedCharacter = 'edgar'; // Default character

        // Grapple overlays
        this.tieUpIndicators = new Map();  // attackerId -> floating "AMARRE" tag
        this.transientLabels = new Set();  // Move-name popups
        this.pinVerdictTimer = null;

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
        
        // Load managers
        await this.loadManagers();
        
        // Load character and animations
        await this.loadCharacterWithAnimations();
        
        // Setup controls
        this.setupKeyboardControls();
        
        // Connect to server
        this.connectToServer();
        
        // Initialize HUD
        this.hud = new ArenaHUD();
        
        // Handle resize
        window.addEventListener('resize', () => this.onWindowResize());
        
        // Start game loop
        this.animate();
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
                
                const ropeGeometry = new THREE.CylinderGeometry(0.04, 0.04, length, 8);
                ropeGeometry.rotateZ(Math.PI / 2);
                if (side.axis === 'z') ropeGeometry.rotateY(Math.PI / 2);
                
                const rope = new THREE.Mesh(ropeGeometry, ropeMaterial);
                rope.position.set(
                    (side.start[0] + side.end[0]) / 2,
                    y,
                    (side.start[1] + side.end[1]) / 2
                );
                this.scene.add(rope);
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
    
    async loadCharacterWithAnimations(characterId = null) {
        const loader = new FBXLoader();
        const totalFiles = Object.keys(ANIMATION_FILES).length + 1;
        let loadedCount = 0;
        
        const charId = characterId || this.selectedCharacter;
        const characterConfig = CHARACTER_MODELS[charId];

        // Grapple clips (Mixamo) load in parallel with everything else
        const mixamoPromise = this.loadMixamoSources();

        try {
this.updateLoadingProgress(0, `Cargando modelo: ${characterConfig.name}...`);
            
            // Load character model
            this.baseModel = await this.loadFBX(loader, `assets/${characterConfig.file}`);
            this.characterModelCache[charId] = this.baseModel;
            loadedCount++;
            
            // Load animations
            for (const [actionName, fileName] of Object.entries(ANIMATION_FILES)) {
                this.updateLoadingProgress(
                    (loadedCount / totalFiles) * 100,
                    `Cargando animación: ${actionName}...`
                );
                
                try {
                    const animModel = await this.loadFBX(loader, `assets/${fileName}`);
                    if (animModel.animations && animModel.animations.length > 0) {
                        this.baseAnimations[actionName] = animModel.animations[0];
                    }
                    this.disposeModel(animModel);
                } catch (e) {
                    console.error(`Error loading animation ${actionName}:`, e);
                }
                
                loadedCount++;
            }
            
            // Retarget the grapple clips onto this character
            this.updateLoadingProgress(97, 'Preparando llaves de lucha...');
            await mixamoPromise;
            const grapple = await this.getCharacterAnimations(charId);

            // Create local player
            this.createLocalPlayer(grapple);

            this.updateLoadingProgress(100, '¡Arena lista!');
            
            setTimeout(() => {
                this.loadingScreen.classList.add('hidden');
                // The socket may have created the room while models were loading: don't overwrite its status
                if (!this.roomCode) {
                    this.updateAnimationDisplay('Conectando al servidor...');
                }
                this.gameState = 'lobby';
            }, 500);
            
        } catch (error) {
            console.error('Error loading character:', error);
            this.loadingText.textContent = 'Error al cargar el modelo';
        }
    }
    
    /**
     * Load every Mixamo grapple clip in parallel, once (failed files resolve to null)
     * @returns {Promise<Object<string, THREE.Object3D|null>>} file name -> loaded FBX
     */
    loadMixamoSources() {
        if (!this.mixamoSourcesPromise) {
            const loader = new FBXLoader();
            const files = [...new Set(Object.values(MIXAMO_FILES))];
            this.mixamoSourcesPromise = Promise.all(files.map((file) =>
                this.loadFBX(loader, `assets/mixamo/${file}`)
                    .then((fbx) => [file, fbx])
                    .catch((err) => {
                        console.warn(`[Arena] Mixamo clip ${file} not loaded:`, err);
                        return [file, null];
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
                .catch((err) => {
                    console.error(`[Arena] Grapple clips failed for ${characterId}:`, err);
                    return { animations: { ...this.baseAnimations, ...this.getSharedGrappleClips() }, meta: null };
                });
        }
        return this.characterAnimCache[characterId];
    }

    async buildCharacterAnimations(characterId) {
        const model = this.characterModelCache[characterId];
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
            suplexEndHeadYawDeg: deg(meta.suplexEndAlpha)
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
            restPoints: null
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
                points: Object.values(points)
            };
        };

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
        } catch (err) {
            console.warn('[Arena] Wrestle pose analysis failed:', err);
        } finally {
            mixer.stopAllAction();
            mixer.uncacheRoot(probe);
        }
        return meta;
    }

    loadFBX(loader, path) {
        return new Promise((resolve, reject) => {
            loader.load(path, resolve, undefined, reject);
        });
    }
    
    disposeModel(model) {
        model.traverse((child) => {
            if (child.isSkinnedMesh) child.skeleton?.dispose();
            if (child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(mat => {
                    if (mat.map) mat.map.dispose();
                    mat.dispose();
                });
            }
            if (child.geometry) child.geometry.dispose();
        });
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
        const characterName = CHARACTER_MODELS[this.selectedCharacter]?.name || 'Player 1';
        this.localPlayer.setName(characterName);
        
        // Start at center of ring
        this.localPlayer.controller.position.set(0, ARENA_CONFIG.RING_HEIGHT, 0);
        this.scene.add(this.localPlayer.model);
        this.players.set('local', this.localPlayer);
        
        // Add to HUD
        if (this.hud) {
            this.hud.addPlayer(this.localPlayer);
        }
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
                
                if (target && !target.controller.isEliminated) {
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

            // Already on the mat (pinned, stomped, or mid slam/suplex): stay lying down.
            // Otherwise fall and stay down (the plain 'fall' one-shot used to pop back to idle).
            const onTheMat = player.flight || player.lockAnim === 'down' || data.reason === 'pinfall';
            if (onTheMat) {
                if (!player.flight) player.enterDown();
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

        // Play victory animation
        if (winner?.player && winner.player.playAnimation) {
            winner.player.playAnimation('taunt');
        }

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
            player.playAnimation('taunt');
            
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
        if (c.isEliminated || player.flight) return;
        if (!c.move) player.moveVisual = null;

        if (c.pin) {
            if (c.pin.role === 'pinner') {
                player.setLock('kneel', { loop: false, timeScale: WRESTLE_CONFIG.KNEEL_SPEED, fade: 0.2 });
            } else {
                player.enterDown();
            }
        } else if (c.isDown) {
            player.enterDown();
        } else if (c.isGettingUp) {
            player.enterGetUp();
        } else if (c.move) {
            if (!player.moveVisual) {
                // Missed 'arena-grapple-move': best-effort pose until the move ends
                player.moveVisual = { type: c.move.type, role: c.move.role };
                if (c.move.role === 'attacker') {
                    player.setLock(MOVE_ATTACKER_CLIPS[c.move.type] || 'tieup', { loop: false, fade: 0.1 });
                } else {
                    player.setLock('tieup', { loop: true });
                }
            }
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
        if (!player || player.controller.isEliminated || player.flight) return;
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
     */
    showMovePopup(text, worldPos) {
        const el = document.createElement('div');
        el.className = 'arena-move-popup';
        const inner = document.createElement('span');
        inner.textContent = text;
        el.appendChild(inner);

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
    }

    async addPlayer(playerData, index = 0, total= Math.max(this.players.size + 1, 4)) {
        if (this.players.has(playerData.id)) return;
        
        // Several events (player-joined, game-started) can add the same player while its
        // model is still loading: only the latest call for an id may create the entity
        if (!this.pendingPlayerLoads) this.pendingPlayerLoads = new Map();
        const loadToken = {};
        this.pendingPlayerLoads.set(playerData.id, loadToken);
        
        const characterId = CHARACTER_MODELS[playerData.character] ? playerData.character : 'edgar';
        let playerModel = this.characterModelCache[characterId];
        
        if (!playerModel) {
            const loader = new FBXLoader();
            const config = CHARACTER_MODELS[characterId];
            playerModel = await this.loadFBX(loader, `assets/${config.file}`);
            this.characterModelCache[characterId] = playerModel;
        }

        // Grapple clips retargeted to this character (cached)
        const grapple = await this.getCharacterAnimations(characterId);

        // Supersededby a newer addPlayer, removed meanwhile, or already created
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
    
    removePlayer(playerId) {
        this.pendingPlayerLoads?.delete(playerId); // cancel an in-flight addPlayer
        const player = this.players.get(playerId);
        if (player) {
            this.tieUpIndicators.forEach((ind, attackerId) => {
                if (ind.attackerId === playerId || ind.defenderId === playerId) this.removeTieUpIndicator(attackerId);
            });
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
                if (bounced && !player.ropeSoundPlayed && this.sfxManager) {
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
                const isRunning = isMoving && player.controller.input?.run;
                
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
        
        this.camera.lookAt(this.camera.userData.lookAtTarget);
    }
}

// Initialize game when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.arenaGame = new ArenaGame();
});

