/**
 * PELEA DE PELUCHES - 3D Fighter Prototype
 * Three.js based fighting game with FBX animations
 * Multiplayer support via WebSocket
 */

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { SERVER_URL, CONFIG } from './config.js';
import { AnimationController, ANIMATION_CONFIG, AnimationState } from './animation/AnimationController.js';
import ModeSelector, { GAME_MODES } from './modes/ModeSelector.js';
import TournamentManager from './tournament/TournamentManager.js';
import { loadClips, loadModel } from './assets/AssetLoader.js';

// VFX Manager will be loaded dynamically
let VFXManager = null;

// Game mode - set directly from menu.html selection
let selectedGameMode = GAME_MODES.SMASH;
let selectedCharacter = 'edgar';

// Apply baby theme if needed
const IS_BABY_SHOWER = window.location.search.includes('mode=baby_shower');
if (IS_BABY_SHOWER) {
    document.documentElement.classList.add('baby-theme');
    CONFIG.BABY_SHOWER_MODE = true;
    selectedCharacter = 'baby'; // Force baby model in Baby Shower mode
    
    // Update titles
    const gameTitle = document.querySelector('.game-title');
    if (gameTitle) gameTitle.innerHTML = 'FIESTA DE BEBÉS';
    document.title = 'Fiesta de Bebés - 3D Fighter';
}

// SFX Manager will be loaded dynamically
let SFXManager = null;

// BGM Manager will be loaded dynamically
let BGMManager = null;

// =================================
// Configuration
// =================================

const PHYSICS = {
    GRAVITY: -30,
    MOVE_SPEED: 4,
    RUN_SPEED: 7,
    JUMP_FORCE: 15, // Increased to reach floating platforms (max height ~3.75 units)
    GROUND_Y: 0,
    // 2D Stage boundaries (Smash Bros style)
    STAGE_LEFT: -8,  // Extended to match platform positions
    STAGE_RIGHT: 8
};

// Animation Speed Storage Key (shared with playground)
const SPEED_STORAGE_KEY = 'pelea-peluches-animation-speeds';

/**
 * Load saved animation speeds from localStorage
 * These are configured in the playground and affect gameplay
 */
function loadSavedAnimationSpeeds() {
    try {
        const saved = localStorage.getItem(SPEED_STORAGE_KEY);
        if (saved) {
            const speeds = JSON.parse(saved);
            console.log('[Game] Loaded animation speeds from playground:', speeds);
            return speeds;
        }
    } catch (e) {
        console.warn('[Game] Failed to load animation speeds:', e);
    }
    return null;
}

// =================================
// Player Controller Class
// =================================

class PlayerController {
    constructor(playerId, playerNumber, color) {
        this.id = playerId;
        this.playerNumber = playerNumber;
        this.color = color;
        
        // Physics properties
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.position = new THREE.Vector3(0, 0, 0);
        
        // State flags
        this.isGrounded = true;
        this.isJumping = false;
        this.isAttacking = false;
        this.isBlocking = false;
        this.isTaunting = false;
        this.facingRight = true;
        
        // Game state
        this.health = 0;
        this.stocks = 3;
        
        // Input state
        this.input = {
            left: false,
            right: false,
            jump: false,
            punch: false,
            kick: false,
            run: false,
            block: false
        };
        
        // Attack cooldown
        this.attackCooldown = 0;
    }
    
    /**
     * Update player physics and state
     * @param {number} delta - Time since last frame
     */
    update(delta) {
        // Decrease attack cooldown
        if (this.attackCooldown > 0) {
            this.attackCooldown -= delta;
            if (this.attackCooldown <= 0) {
                this.isAttacking = false;
            }
        }
        
        // Don't process movement during attack, block, or taunt - but still apply gravity
        if (this.isAttacking || this.isBlocking || this.isTaunting) {
            if (!this.isGrounded) {
                this.velocity.y += PHYSICS.GRAVITY * delta;
                const prevY = this.position.y;
                this.position.y += this.velocity.y * delta;
                
                // Check platform collisions during attack
                for (const platform of stagePlatforms) {
                    const halfWidth = platform.width / 2;
                    if (this.position.x >= platform.x - halfWidth && this.position.x <= platform.x + halfWidth) {
                        if (platform.isMainGround && this.position.y <= platform.y) {
                            this.position.y = platform.y;
                            this.velocity.y = 0;
                            this.isGrounded = true;
                            this.isJumping = false;
                            break;
                        }
                        if (!platform.isMainGround && this.velocity.y <= 0 && prevY >= platform.y && this.position.y <= platform.y) {
                            this.position.y = platform.y;
                            this.velocity.y = 0;
                            this.isGrounded = true;
                            this.isJumping = false;
                            break;
                        }
                    }
                }
                
                // Fallback ground
                if (this.position.y <= PHYSICS.GROUND_Y) {
                    this.position.y = PHYSICS.GROUND_Y;
                    this.velocity.y = 0;
                    this.isGrounded = true;
                    this.isJumping = false;
                }
            }
            return;
        }
        
        // Horizontal movement
        const currentSpeed = this.input.run ? PHYSICS.RUN_SPEED : PHYSICS.MOVE_SPEED;
        
        if (this.input.left) {
            this.velocity.x = -currentSpeed;
            this.facingRight = false;
        } else if (this.input.right) {
            this.velocity.x = currentSpeed;
            this.facingRight = true;
        } else {
            this.velocity.x *= 0.8;
            if (Math.abs(this.velocity.x) < 0.1) {
                this.velocity.x = 0;
            }
        }
        
        // Jumping
        if (this.input.jump && this.isGrounded) {
            this.velocity.y = PHYSICS.JUMP_FORCE;
            this.isGrounded = false;
            this.isJumping = true;
        }
        
        // Apply gravity
        if (!this.isGrounded) {
            this.velocity.y += PHYSICS.GRAVITY * delta;
        }
        
        // Store previous Y for platform detection
        const prevY = this.position.y;
        
        // Update position
        this.position.x += this.velocity.x * delta;
        this.position.y += this.velocity.y * delta;
        
        // Platform collision detection (including floating platforms)
        this.isGrounded = false;
        
        // Check collision with all platforms
        for (const platform of stagePlatforms) {
            const halfWidth = platform.width / 2;
            const platformLeft = platform.x - halfWidth;
            const platformRight = platform.x + halfWidth;
            
            // Check if player is within platform's horizontal bounds
            if (this.position.x >= platformLeft && this.position.x <= platformRight) {
                // For main ground (y=0), always land
                if (platform.isMainGround && this.position.y <= platform.y) {
                    this.position.y = platform.y;
                    this.velocity.y = 0;
                    this.isGrounded = true;
                    this.isJumping = false;
                    break;
                }
                
                // For floating platforms, only land when falling through from above
                if (!platform.isMainGround && this.velocity.y <= 0) {
                    // Was above platform last frame, now at or below
                    if (prevY >= platform.y && this.position.y <= platform.y) {
                        this.position.y = platform.y;
                        this.velocity.y = 0;
                        this.isGrounded = true;
                        this.isJumping = false;
                        break;
                    }
                }
            }
        }
        
        // Fallback: main ground collision (if no platforms found)
        if (!this.isGrounded && this.position.y <= PHYSICS.GROUND_Y) {
            this.position.y = PHYSICS.GROUND_Y;
            this.velocity.y = 0;
            this.isGrounded = true;
            this.isJumping = false;
        }
        
        // 2D Stage boundaries (left/right only, lock Z axis)
        this.position.x = Math.max(PHYSICS.STAGE_LEFT, Math.min(PHYSICS.STAGE_RIGHT, this.position.x));
        this.position.z = 0; // Lock Z axis for side-view
    }
    
    /**
     * Perform a punch attack (can be done in air)
     */
    punch() {
        if (!this.isAttacking && this.attackCooldown <= 0) {
            this.isAttacking = true;
            this.attackCooldown = 0.4; // Reduced from 1.0 for faster combat
            return true;
        }
        return false;
    }
    
    /**
     * Perform a kick attack (can be done in air)
     */
    kick() {
        if (!this.isAttacking && this.attackCooldown <= 0) {
            this.isAttacking = true;
            this.attackCooldown = 0.5; // Reduced from 0.8 for faster combat
            return true;
        }
        return false;
    }
    
    /**
     * Get current movement state for animation selection
     */
    getMovementState() {
        if (this.isAttacking) return 'attacking';
        if (this.isJumping || !this.isGrounded) return 'jumping';
        if (Math.abs(this.velocity.x) > 0.5) {
            return this.input.run ? 'running' : 'walking';
        }
        return 'idle';
    }
    
    /**
     * Apply state from server
     */
    applyServerState(state) {
        if (state.position) {
            this.position.set(state.position.x, state.position.y, state.position.z);
        }
        if (state.velocity) {
            this.velocity.set(state.velocity.x, state.velocity.y, state.velocity.z);
        }
        if (typeof state.health === 'number') this.health = state.health;
        if (typeof state.stocks === 'number') this.stocks = state.stocks;
        if (typeof state.isGrounded === 'boolean') this.isGrounded = state.isGrounded;
        if (typeof state.facingRight === 'boolean') this.facingRight = state.facingRight;
        if (state.input) this.input = { ...this.input, ...state.input };
    }
}

// =================================
// Player Entity (Model + Controller)
// =================================

class PlayerEntity {
    constructor(id, number, color, baseModel, baseAnimations) {
        this.id = id;
        this.number = number;
        this.color = color;
        this.name = `Player ${number}`;
        
        // Clone the model
        this.model = SkeletonUtils.clone(baseModel);
        // Scale (negative Z to face right by default)
        this.model.scale.set(0.01, 0.01, -0.01);
        
        // Rotate model 90° to show profile view
        this.model.rotation.y = -Math.PI / 2;
        
        // Apply color tint to materials
        this.applyColorTint(color);
        
        // Create floating name label
        this.nameLabel = this.createNameLabel(color);
        this.model.add(this.nameLabel);
        
        // Create shared AnimationController (handles mixer, actions, and transitions)
        this.animController = new AnimationController(this.model, baseAnimations);
        
        // Apply saved animation speeds from playground
        const savedSpeeds = loadSavedAnimationSpeeds();
        if (savedSpeeds) {
            this.animController.setAnimationSpeeds(savedSpeeds);
        }
        
        // Setup animation finished callback
        this.animController.onAnimationFinished = (name) => {
            // Sync attacking state with physics controller
            if (!this.animController.isAttacking) {
                this.controller.isAttacking = false;
            }
        };
        
        // Controller for physics/input
        this.controller = new PlayerController(id, number, color);
    }
    
    /**
     * Create floating name label above player
     */
    createNameLabel(color) {
        const div = document.createElement('div');
        div.className = 'player-name-label';
        div.textContent = this.name;
        div.style.color = color;
        
        const label = new CSS2DObject(div);
        // Position above player's head (in model's local space, scaled by 0.01)
        // Model is scaled to 0.01, so 280 in local = 2.8 in world (well above head)
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
                // Clone material to avoid affecting other players
                if (Array.isArray(child.material)) {
                    child.material = child.material.map(m => m.clone());
                } else {
                    child.material = child.material.clone();
                }
                
                // Apply emissive color for subtle tint and FIX TRANSPARENCY
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(mat => {
                    // Disable transparency to fix see-through issue
                    mat.transparent = false;
                    mat.opacity = 1.0;
                    mat.alphaTest = 0;
                    mat.depthWrite = true;
                    mat.depthTest = true;
                    mat.side = THREE.FrontSide;
                    
                    // Apply emissive color for subtle tint
                    if (mat.emissive) {
                        mat.emissive = tintColor;
                        mat.emissiveIntensity = 0.1;
                    }
                    
                    // Force material update
                    mat.needsUpdate = true;
                });
            }
            
            // Enable shadows
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
    }
    
    /**
     * Play animation by name using shared AnimationController
     */
    playAnimation(actionName) {
        // Get player color for VFX
        const colorIndex = this.controller.playerNumber - 1;
        const colors = [0xff3366, 0x00ffcc, 0xffcc00, 0x9966ff];
        const playerColor = colors[colorIndex] || 0xFF6600;
        
        switch (actionName) {
            case 'idle':
                this.animController.playIdle();
                break;
            case 'walk':
                this.animController.playWalk();
                break;
            case 'run':
                this.animController.playRun();
                break;
            case 'punch':
                this.animController.playPunch();
                // VFX: Attack trail
                if (vfxManager) {
                    const attackPos = this.controller.position.clone();
                    attackPos.y += 1.2;
                    const direction = this.controller.facingRight ? 1 : -1;
                    vfxManager.createAttackTrail(attackPos, 'punch', direction, playerColor);
                }
                // SFX: Punch whoosh
                if (sfxManager) {
                    sfxManager.playPunchWhoosh();
                }
                break;
            case 'kick':
                this.animController.playKick();
                // VFX: Attack trail
                if (vfxManager) {
                    const attackPos = this.controller.position.clone();
                    attackPos.y += 0.8;
                    const direction = this.controller.facingRight ? 1 : -1;
                    vfxManager.createAttackTrail(attackPos, 'kick', direction, playerColor);
                }
                // SFX: Kick whoosh
                if (sfxManager) {
                    sfxManager.playKickWhoosh();
                }
                break;
            case 'hit':
                this.animController.playHit();
                break;
            case 'fall':
                this.animController.playFall();
                break;
            case 'block':
                this.animController.playBlock();
                break;
            case 'taunt':
                this.animController.playTaunt();
                break;
            default:
                this.animController.play(actionName);
        }
    }
    
    update(delta, skipPhysics = false) {
        // Track previous state for VFX/SFX triggers
        const wasInAir = !this.controller.isGrounded;
        const wasGrounded = this.controller.isGrounded;
        const prevVelocityY = this.controller.velocity.y;
        
        // Update controller physics only if not skipped (skip during online game)
        if (!skipPhysics) {
            this.controller.update(delta);
        }
        
        // Update model position
        this.model.position.copy(this.controller.position);
        
        // Update model facing direction using scale.z flip
        // After -90° rotation, scale.z controls left/right facing
        // Negative = facing right, positive = facing left
        const targetScaleZ = this.controller.facingRight ? -0.01 : 0.01;
        this.model.scale.z = THREE.MathUtils.lerp(this.model.scale.z, targetScaleZ, 0.2);
        
        // Update animation based on movement state (using shared AnimationController)
        const input = this.controller.input;
        const isMoving = input.left || input.right;
        const isRunning = isMoving && input.run;
        
        // VFX: Landing impact when hitting ground
        if (wasInAir && this.controller.isGrounded && prevVelocityY < -5) {
            const landPosition = this.controller.position.clone();
            const fallSpeed = Math.abs(prevVelocityY);
            const intensity = Math.min(1.5, fallSpeed / 15);
            
            if (vfxManager) {
                vfxManager.createLandingImpact(landPosition, intensity);
            }
            
            // SFX: Landing sound
            if (sfxManager) {
                sfxManager.playLand(intensity);
            }
        }
        
        // SFX: Jump sound when leaving ground
        if (wasGrounded && !this.controller.isGrounded && this.controller.velocity.y > 0) {
            if (sfxManager) {
                sfxManager.playJump();
            }
        }
        
        // VFX: Dust cloud when running (throttled)
        if (vfxManager && isRunning && this.controller.isGrounded) {
            if (!this._lastDustTime || performance.now() - this._lastDustTime > 150) {
                const dustPosition = this.controller.position.clone();
                const direction = this.controller.facingRight ? 1 : -1;
                vfxManager.createDustCloud(dustPosition, direction);
                this._lastDustTime = performance.now();
            }
        }
        
        // IDLE ROTATION: When idle, rotate character slightly toward camera to show face
        // When moving, return to profile view for proper walk/run animation
        const isIdle = !isMoving && this.controller.isGrounded && 
                       !this.animController.isAttacking && 
                       !this.animController.isBlocking && 
                       !this.animController.isTaunting;
        
        // Profile rotation is -90° for walking (both directions)
        // For idle, we rotate toward camera - but direction depends on facing
        // Facing right (scale.z < 0): rotate more negative (-117°) to show face
        // Facing left (scale.z > 0): rotate less negative (-63°) to show face
        const profileRotation = -Math.PI / 2;      // -90° full profile for walking
        const idleOffset = Math.PI * 0.15;         // 27° offset toward camera
        const idleRotation = this.controller.facingRight 
            ? profileRotation - idleOffset   // -117° when facing right
            : profileRotation + idleOffset;  // -63° when facing left
        const targetRotation = isIdle ? idleRotation : profileRotation;
        
        // Smooth interpolation for rotation
        this.model.rotation.y = THREE.MathUtils.lerp(
            this.model.rotation.y, 
            targetRotation, 
            0.08 // Slower lerp for smoother rotation
        );
        
        this.animController.updateFromMovementState({
            isMoving,
            isRunning,
            isGrounded: this.controller.isGrounded,
            isJumping: this.controller.isJumping
        });
        
        // Sync state flags from animController to controller
        // This ensures controller knows when animations finish
        this.controller.isTaunting = this.animController.isTaunting;
        
        // Update animation mixer
        this.animController.update(delta);
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
        
        // Only the per-entity cloned materials are disposed: the geometry is shared with the
        // cached character model (SkeletonUtils.clone), which is reused for later players/rematches
        this.model.traverse((child) => {
            if (child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(m => m.dispose());
            }
        });
    }
}

// =================================
// Global Variables
// =================================

let scene, camera, renderer;
let labelRenderer = null; // CSS2DRenderer for floating name labels
let clock = new THREE.Clock();

// VFX Manager instance
let vfxManager = null;

// SFX Manager instance
let sfxManager = null;

// BGM Manager instance
let bgmManager = null;

// Base model and animations
let baseModel = null;
const baseAnimations = {};

// Players map
const players = new Map();

// Local player for keyboard testing
let localPlayer = null;

// Socket.IO connection
let socket = null;
let roomCode = null;
let isHost = false;
let gameState = 'loading'; // 'loading', 'lobby', 'playing', 'finished'

// Animation file mappings
const ANIMATION_FILES = {
    walk: 'Meshy_AI_Animation_Walking_withSkin.fbx',
    run: 'Meshy_AI_Animation_Running_withSkin.fbx',
    punch: 'Meshy_AI_Animation_Left_Uppercut_from_Guard_withSkin.fbx',
    kick: 'Meshy_AI_Animation_Boxing_Guard_Right_Straight_Kick_withSkin.fbx',
    hit: 'Meshy_AI_Animation_Hit_Reaction_1_withSkin.fbx',
    fall: 'Meshy_AI_Animation_Shot_and_Slow_Fall_Backward_withSkin.fbx',
    block: 'Meshy_AI_Animation_Block3_withSkin.fbx',
    taunt: 'Meshy_AI_Animation_Hip_Hop_Dance_withSkin.fbx',
    // Babies crawl instead of walking/running: only needed (and downloaded) in baby shower mode
    ...(IS_BABY_SHOWER ? { crawling: 'Crawling.fbx' } : {})
};

// Available character models
const CHARACTER_MODELS = {
    baby: {
        name: 'Bebé',
        file: 'bebe.fbx',
        thumbnail: '👶'
    },
    edgar: {
        name: 'Edgar',
        file: 'Edgar_Model.fbx',
        thumbnail: '👦'
    },
    isabella: {
        name: 'Isabella', 
        file: 'Isabella_Model.fbx',
        thumbnail: '👧'
    },
    jesus: {
        name: 'Jesus',
        file: 'Jesus_Model.fbx',
        thumbnail: '🧔'
    },
    lia: {
        name: 'Lia',
        file: 'Lia_Model.fbx',
        thumbnail: '👩'
    },
    hector: {
        name: 'Hector',
        file: 'Hector.fbx',
        thumbnail: '🧑'
    },
    katy: {
        name: 'Katy',
        file: 'Katy.fbx',
        thumbnail: '👱‍♀️'
    },
    mariana: {
        name: 'Mariana',
        file: 'Mariana.fbx',
        thumbnail: '👩‍🦱'
    },
    sol: {
        name: 'Sol',
        file: 'Sol.fbx',
        thumbnail: '🌞'
    },
    yadira: {
        name: 'Yadira',
        file: 'Yadira.fbx',
        thumbnail: '💃'
    },
    angel: {
        name: 'Angel',
        file: 'Angel.fbx',
        thumbnail: '😇'
    },
    lidia: {
        name: 'Lidia',
        file: 'Lidia.fbx',
        thumbnail: '👩‍🦰'
    },
    fabian: {
        name: 'Fabian',
        file: 'Fabian.fbx',
        thumbnail: '🧑‍🦲'
    },
    marile: {
        name: 'Marile',
        file: 'Marile.fbx',
        thumbnail: '👩‍🦳'
    },
    gabriel: {
        name: 'Gabriel',
        file: 'Gabriel.fbx',
        thumbnail: '👼'
    }
};

// Currently selected character (initialized at top)
// selectedCharacter is defined at the beginning of the file

// Character shown as the local preview player at startup ('baby' in baby shower mode).
// Also used for players without a character and as fallback when a model fails to load.
const DEFAULT_CHARACTER = selectedCharacter;

// characterId -> loaded model (shared, never added to the scene: PlayerEntity clones it)
const characterModelCache = {};

// Promise of the default character's model (see loadDefaultModel)
let defaultModelPromise = null;

// Resolves with baseAnimations once the animation clips are loaded (set in loadCharacterWithAnimations)
let animationsReady = Promise.resolve(baseAnimations);

// Players whose entity is waiting for its model: playerId -> { token, characterId, promise }.
// Removing the entry (player left, new match) cancels that add when the model arrives.
const pendingPlayerAdds = new Map();
let playerAddToken = 0;

// Players that left the room (so a still-running 'game-started' loop does not recreate them)
const departedPlayerIds = new Set();

// Player colors
const PLAYER_COLORS = ['#ff3366', '#00ffcc', '#ffcc00', '#9966ff'];

// UI Elements
const loadingScreen = document.getElementById('loading-screen');
const loadingText = document.getElementById('loading-text');
const progressFill = document.getElementById('progress-fill');
const animationNameDisplay = document.getElementById('animation-name');

// =================================
// Mode Selection
// =================================

// =================================
// Initialization
// =================================

async function init() {
    // Smash mode is selected directly from menu.html
    // No need for mode selector - go straight to game initialization
    selectedGameMode = GAME_MODES.SMASH;
    
    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    scene.fog = new THREE.Fog(0x1a1a2e, 15, 40);

    // Setup camera - Fixed side view (Smash Bros style)
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 2, 12); // Side view, looking at center
    camera.lookAt(0, 1, 0);

    // Setup renderer
    const canvas = document.getElementById('game-canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Setup CSS2D renderer for floating name labels
    labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0px';
    labelRenderer.domElement.style.pointerEvents = 'none';
    document.getElementById('game-container').appendChild(labelRenderer.domElement);
    
    // Add styles for floating player names
    addPlayerNameStyles();

    // No OrbitControls - camera follows players automatically (side-view)

    // Start downloading the animations + preview character right away, in parallel with
    // everything below. The loading screen hides itself once they are ready.
    const assetsLoaded = loadCharacterWithAnimations();

    // Load and initialize VFX / SFX / BGM managers (independent scripts, loaded in parallel)
    await Promise.all([loadVFXManager(), loadSFXManager(), loadBGMManager()]);

    // Create mute button
    createMuteButton();

    // Add lights
    setupLights();

    // Add arena (side-view platform stage)
    createArena();

    // Setup keyboard controls for local testing
    setupKeyboardControls();

    // Connect to server now: the room is created while models are still downloading.
    // Players that join early get their entity as soon as their character's model is ready.
    connectToServer();

    // Handle window resize
    window.addEventListener('resize', onWindowResize);

    // Start render loop
    animate();

    await assetsLoaded;
}

/**
 * Add CSS styles for floating player names
 */
function addPlayerNameStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .player-name-label {
            color: white;
            font-family: 'Orbitron', 'Segoe UI', sans-serif;
            font-size: 14px;
            font-weight: bold;
            text-shadow: 
                2px 2px 4px rgba(0, 0, 0, 0.8),
                -1px -1px 2px rgba(0, 0, 0, 0.5),
                0 0 10px currentColor;
            padding: 4px 12px;
            background: linear-gradient(180deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 100%);
            border-radius: 12px;
            border: 2px solid currentColor;
            white-space: nowrap;
            transform: translateX(-50%);
            pointer-events: none;
            user-select: none;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .player-name-label::before {
            content: '';
            position: absolute;
            bottom: -6px;
            left: 50%;
            transform: translateX(-50%);
            width: 0;
            height: 0;
            border-left: 6px solid transparent;
            border-right: 6px solid transparent;
            border-top: 6px solid currentColor;
        }
    `;
    document.head.appendChild(style);
}

/**
 * Load the VFXManager module and initialize it
 */
async function loadVFXManager() {
    try {
        // Load VFXManager script dynamically
        const script = document.createElement('script');
        script.src = 'js/effects/VFXManager.js';
        document.head.appendChild(script);
        
        await new Promise((resolve, reject) => {
            script.onload = resolve;
            script.onerror = reject;
        });
        
        // Initialize VFXManager with scene, camera, and THREE library
        if (typeof window.VFXManager !== 'undefined') {
            VFXManager = window.VFXManager;
        }
        vfxManager = new VFXManager(scene, camera, THREE);
        console.log('[Game] VFXManager initialized');
    } catch (error) {
        console.warn('[Game] VFXManager failed to load:', error);
    }
}

/**
 * Load the SFXManager module and initialize it
 */
async function loadSFXManager() {
    try {
        // Load SFXManager script dynamically
        const script = document.createElement('script');
        script.src = 'js/audio/SFXManager.js';
        document.head.appendChild(script);
        
        await new Promise((resolve, reject) => {
            script.onload = resolve;
            script.onerror = reject;
        });
        
        // Initialize SFXManager
        if (typeof window.SFXManager !== 'undefined') {
            SFXManager = window.SFXManager;
        }
        sfxManager = new SFXManager();
        console.log('[Game] SFXManager initialized');
    } catch (error) {
        console.warn('[Game] SFXManager failed to load:', error);
    }
}

/**
 * Load the BGMManager module and initialize it
 */
async function loadBGMManager() {
    try {
        // Load BGMManager script dynamically
        const script = document.createElement('script');
        script.src = 'js/audio/BGMManager.js';
        document.head.appendChild(script);
        
        await new Promise((resolve, reject) => {
            script.onload = resolve;
            script.onerror = reject;
        });
        
        // Initialize BGMManager
        if (typeof window.BGMManager !== 'undefined') {
            BGMManager = window.BGMManager;
        }
        bgmManager = new BGMManager();
        
        // Start playing character select music in lobby
        bgmManager.playCharacterSelect();
        
        console.log('[Game] BGMManager initialized');
    } catch (error) {
        console.warn('[Game] BGMManager failed to load:', error);
    }
}

/**
 * Create mute button for sound control
 */
function createMuteButton() {
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
    
    muteBtn.addEventListener('click', () => {
        isMuted = !isMuted;
        
        // Toggle SFX
        if (sfxManager) {
            sfxManager.setEnabled(!isMuted);
        }
        
        // Toggle BGM
        if (bgmManager) {
            if (isMuted) {
                bgmManager.setVolume(0);
            } else {
                bgmManager.setVolume(1);
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

// =================================
// Lighting Setup
// =================================

function setupLights() {
    const ambientLight = new THREE.AmbientLight(0x404060, 0.5);
    scene.add(ambientLight);
    
    const mainLight = new THREE.DirectionalLight(0xffffff, 1.5);
    mainLight.position.set(5, 10, 7);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 2048;
    mainLight.shadow.mapSize.height = 2048;
    mainLight.shadow.camera.near = 0.1;
    mainLight.shadow.camera.far = 50;
    mainLight.shadow.camera.left = -10;
    mainLight.shadow.camera.right = 10;
    mainLight.shadow.camera.top = 10;
    mainLight.shadow.camera.bottom = -10;
    scene.add(mainLight);
    
    const rimLight = new THREE.DirectionalLight(0xff3366, 0.8);
    rimLight.position.set(-5, 3, -5);
    scene.add(rimLight);
    
    const fillLight = new THREE.DirectionalLight(0x00ffcc, 0.4);
    fillLight.position.set(3, 2, -3);
    scene.add(fillLight);
    
    const pointLight = new THREE.PointLight(0xffcc00, 0.5, 15);
    pointLight.position.set(0, 4, 0);
    scene.add(pointLight);
}

// =================================
// Arena/Ground Creation
// =================================

// Global platforms array for collision detection
const stagePlatforms = [];

function createArena() {
    // === SIDE-VIEW PLATFORM STAGE (Smash Bros style) ===
    
    // Clear platforms array
    stagePlatforms.length = 0;
    
    // Background plane (far back)
    const bgGeometry = new THREE.PlaneGeometry(40, 20);
    const bgMaterial = new THREE.MeshBasicMaterial({
        color: 0x0a0a15,
        side: THREE.DoubleSide
    });
    const background = new THREE.Mesh(bgGeometry, bgMaterial);
    background.position.set(0, 5, -8);
    scene.add(background);
    
    // === MAIN PLATFORM === (Sized for up to 8 players)
    const mainPlatformWidth = 20;  // Larger to fit 8 players comfortably
    const platformDepth = 4;
    const platformHeight = 0.4;
    
    const mainPlatformGeometry = new THREE.BoxGeometry(mainPlatformWidth, platformHeight, platformDepth);
    const mainPlatformMaterial = new THREE.MeshStandardMaterial({
        color: 0x2a2a4a,
        metalness: 0.4,
        roughness: 0.6
    });
    const mainPlatform = new THREE.Mesh(mainPlatformGeometry, mainPlatformMaterial);
    mainPlatform.position.set(0, -platformHeight / 2, 0);
    mainPlatform.receiveShadow = true;
    scene.add(mainPlatform);
    
    // Register main platform for collision
    stagePlatforms.push({
        x: 0,
        y: 0,
        width: mainPlatformWidth,
        isMainGround: true
    });
    
    // Platform edge glow (left)
    const edgeGeometry = new THREE.BoxGeometry(0.15, platformHeight + 0.1, platformDepth);
    const leftEdgeMaterial = new THREE.MeshBasicMaterial({
        color: 0xff3366,
        transparent: true,
        opacity: 0.8
    });
    const leftEdge = new THREE.Mesh(edgeGeometry, leftEdgeMaterial);
    leftEdge.position.set(-mainPlatformWidth / 2, -platformHeight / 2, 0);
    scene.add(leftEdge);
    
    // Platform edge glow (right)
    const rightEdgeMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ffcc,
        transparent: true,
        opacity: 0.8
    });
    const rightEdge = new THREE.Mesh(edgeGeometry, rightEdgeMaterial);
    rightEdge.position.set(mainPlatformWidth / 2, -platformHeight / 2, 0);
    scene.add(rightEdge);
    
    // === FLOATING PLATFORMS (Smash Bros style) === (Positioned for larger stage)
    const floatingPlatformConfigs = [
        { x: -6, y: 2.5, width: 4, color: 0xff3366 },   // Left high
        { x: 6, y: 2.5, width: 4, color: 0x00ffcc },    // Right high
        { x: 0, y: 4.5, width: 3.5, color: 0xffcc00 },  // Center top
        { x: -3, y: 5.5, width: 2.5, color: 0xff66cc }, // Upper left
        { x: 3, y: 5.5, width: 2.5, color: 0x66ccff },  // Upper right
    ];
    
    floatingPlatformConfigs.forEach(config => {
        // Platform body
        const floatGeometry = new THREE.BoxGeometry(config.width, 0.2, 2);
        const floatMaterial = new THREE.MeshStandardMaterial({
            color: 0x3a3a5a,
            metalness: 0.5,
            roughness: 0.4
        });
        const floatPlatform = new THREE.Mesh(floatGeometry, floatMaterial);
        floatPlatform.position.set(config.x, config.y, 0);
        floatPlatform.receiveShadow = true;
        floatPlatform.castShadow = true;
        scene.add(floatPlatform);
        
        // Glowing edge (bottom)
        const glowGeometry = new THREE.BoxGeometry(config.width + 0.1, 0.05, 2.1);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: config.color,
            transparent: true,
            opacity: 0.6
        });
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        glow.position.set(config.x, config.y - 0.12, 0);
        scene.add(glow);
        
        // Register platform for collision
        stagePlatforms.push({
            x: config.x,
            y: config.y + 0.1, // Top surface
            width: config.width,
            isMainGround: false
        });
    });
    
    // Platform top line (center indicator on main)
    const centerLineGeometry = new THREE.PlaneGeometry(0.1, platformDepth);
    const centerLineMaterial = new THREE.MeshBasicMaterial({
        color: 0xffcc00,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide
    });
    const centerLine = new THREE.Mesh(centerLineGeometry, centerLineMaterial);
    centerLine.rotation.x = -Math.PI / 2;
    centerLine.position.set(0, 0.01, 0);
    scene.add(centerLine);
    
    // Grid on main platform surface
    const gridGeometry = new THREE.PlaneGeometry(mainPlatformWidth - 0.5, platformDepth - 0.5);
    const gridMaterial = new THREE.MeshBasicMaterial({
        color: 0x333355,
        transparent: true,
        opacity: 0.3,
        wireframe: true
    });
    const grid = new THREE.Mesh(gridGeometry, gridMaterial);
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = 0.02;
    scene.add(grid);
    
    // Decorative side pillars
    const pillarGeometry = new THREE.BoxGeometry(0.3, 3, 0.3);
    const pillarMaterial = new THREE.MeshStandardMaterial({
        color: 0x1a1a2e,
        metalness: 0.5,
        roughness: 0.5
    });
    
    // Left pillar
    const leftPillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
    leftPillar.position.set(-mainPlatformWidth / 2 - 1, 1.5, -1);
    leftPillar.castShadow = true;
    scene.add(leftPillar);
    
    // Right pillar
    const rightPillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
    rightPillar.position.set(mainPlatformWidth / 2 + 1, 1.5, -1);
    rightPillar.castShadow = true;
    scene.add(rightPillar);
    
    // Pillar glow tops
    const glowTopGeometry = new THREE.SphereGeometry(0.2, 16, 16);
    const leftGlow = new THREE.Mesh(glowTopGeometry, new THREE.MeshBasicMaterial({ color: 0xff3366 }));
    leftGlow.position.set(-mainPlatformWidth / 2 - 1, 3.2, -1);
    scene.add(leftGlow);
    
    const rightGlow = new THREE.Mesh(glowTopGeometry, new THREE.MeshBasicMaterial({ color: 0x00ffcc }));
    rightGlow.position.set(mainPlatformWidth / 2 + 1, 3.2, -1);
    scene.add(rightGlow);
}

// =================================
// Character & Animation Loading
// =================================

/**
 * Startup loading: only what the lobby needs, all in parallel:
 * the animation clips (small JSON files) and the preview/default character model.
 * Every other character is loaded on demand (loadCharacterModel) as soon as a player picks it.
 */
async function loadCharacterWithAnimations() {
    const characterConfig = CHARACTER_MODELS[DEFAULT_CHARACTER];
    const clipCount = Object.keys(ANIMATION_FILES).length;
    let modelFraction = 0;
    let clipsLoaded = 0;
    // The model is almost all of the bytes; the animation clips are 20-110 KB each
    const refreshProgress = () => updateLoadingProgress(
        Math.round(modelFraction * 85 + (clipsLoaded / clipCount) * 15)
    );

    updateLoadingProgress(0, `Cargando ${characterConfig.name}...`);

    animationsReady = loadClips(ANIMATION_FILES, (loaded) => {
        clipsLoaded = loaded;
        refreshProgress();
    }).then((clips) => {
        Object.assign(baseAnimations, clips);
        console.log(`[Assets] Animaciones cargadas: ${Object.keys(clips).join(', ')}`);
        return baseAnimations;
    });

    const modelPromise = loadDefaultModel((xhr) => {
        if (xhr.lengthComputable && xhr.total > 0) {
            modelFraction = xhr.loaded / xhr.total;
            refreshProgress();
        }
    });

    try {
        const [model] = await Promise.all([modelPromise, animationsReady]);
        baseModel = model;
        console.log(`=== MODELO CARGADO: ${characterConfig.name} ===`);

        // Local test player (not if a match already started while we were loading)
        if (gameState === 'loading' || gameState === 'lobby') {
            createLocalPlayer();
        }

        updateLoadingProgress(100, '¡Listo!');

        setTimeout(() => {
            loadingScreen.classList.add('hidden');
            if (gameState === 'loading') {
                gameState = 'lobby';
                // The room may already exist (we connect while loading): keep its status text
                if (!roomCode) updateAnimationDisplay('Conectando al servidor...');
            }

            // Create character selector UI
            createCharacterSelector();
        }, 500);

    } catch (error) {
        console.error('Error loading character:', error);
        loadingText.textContent = 'Error al cargar el modelo';
    }
}

/**
 * Model of the default character (also the fallback for unknown/failed characters).
 * Downloaded once; the first caller may pass a progress callback.
 */
function loadDefaultModel(onProgress) {
    if (!defaultModelPromise) {
        defaultModelPromise = loadModel(CHARACTER_MODELS[DEFAULT_CHARACTER].file, onProgress)
            .then((model) => {
                characterModelCache[DEFAULT_CHARACTER] = model;
                return model;
            });
    }
    return defaultModelPromise;
}

/**
 * Get a character's model, downloading it if needed. AssetLoader caches by URL and shares
 * in-flight downloads, so calling this repeatedly (join, character-selected, game-started)
 * costs nothing extra. Unknown or failed characters fall back to the default model.
 */
function loadCharacterModel(characterId) {
    if (characterModelCache[characterId]) {
        return Promise.resolve(characterModelCache[characterId]);
    }

    const characterConfig = CHARACTER_MODELS[characterId];
    if (!characterConfig) {
        console.warn(`[Character] Unknown character "${characterId}", using ${DEFAULT_CHARACTER}`);
        return loadDefaultModel();
    }
    if (characterId === DEFAULT_CHARACTER) {
        return loadDefaultModel();
    }

    console.log(`[Character] Loading model for ${characterId}...`);
    return loadModel(characterConfig.file)
        .then((model) => {
            characterModelCache[characterId] = model;
            console.log(`[Character] Model ${characterId} loaded and cached`);
            return model;
        })
        .catch((error) => {
            console.error(`[Character] Could not load ${characterId}, using ${DEFAULT_CHARACTER}`, error);
            return loadDefaultModel();
        });
}

/** Start downloading a character in the background (as soon as a player picks it) */
function preloadCharacter(characterId) {
    if (!characterId || characterModelCache[characterId]) return;
    loadCharacterModel(characterId).catch(() => {}); // failures are already logged
}

// =================================
// Player Management
// =================================

function createLocalPlayer() {
    // Create a test local player
    localPlayer = new PlayerEntity('local', 1, PLAYER_COLORS[0], baseModel, baseAnimations);
    localPlayer.controller.position.set(0, 0, 0);
    
    // Set name based on selected character
    const characterName = CHARACTER_MODELS[selectedCharacter]?.name || 'Player 1';
    localPlayer.setName(characterName);
    localPlayer.characterId = selectedCharacter;
    
    scene.add(localPlayer.model);
    players.set('local', localPlayer);
}

// Bumped on every character change; an older (slower) load never overrides a newer pick
let characterChangeToken = 0;

/**
 * Change character model - loads the model (cached) and recreates local player
 */
async function changeCharacter(characterId) {
    if (!CHARACTER_MODELS[characterId]) {
        console.error(`Character ${characterId} not found!`);
        return;
    }
    
    if (selectedCharacter === characterId) {
        console.log(`Character ${characterId} already selected`);
        return;
    }
    
    console.log(`[Game] Changing character to: ${characterId}`);
    selectedCharacter = characterId;
    const token = ++characterChangeToken;
    updateCharacterSelector();

    // Show loading indicator (only when the model still has to be downloaded)
    let loadingOverlay = null;
    if (!characterModelCache[characterId]) {
        loadingOverlay = document.createElement('div');
        loadingOverlay.id = 'character-loading';
        loadingOverlay.innerHTML = `
            <div style="
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(10, 10, 21, 0.9);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 9999;
                color: #00ffcc;
                font-family: 'Orbitron', sans-serif;
                font-size: 1.5rem;
            ">
                <div>Cargando ${CHARACTER_MODELS[characterId].name}...</div>
            </div>
        `;
        document.body.appendChild(loadingOverlay);
    }

    try {
        // Models are cached and shared (never disposed); animations are already loaded
        const [model] = await Promise.all([loadCharacterModel(characterId), animationsReady]);

        // A newer pick won, or a match started meanwhile (no local test player during matches)
        if (token !== characterChangeToken || gameState !== 'lobby') return;

        // Replace the local test player
        if (localPlayer) {
            scene.remove(localPlayer.model);
            localPlayer.dispose();
            players.delete('local');
            localPlayer = null;
        }
        baseModel = model;
        createLocalPlayer();

        console.log(`[Game] Character changed to: ${CHARACTER_MODELS[characterId].name}`);
    } catch (error) {
        console.error('Error changing character:', error);
    } finally {
        loadingOverlay?.remove();
    }
}

/**
 * Update character selector UI to show current selection
 */
function updateCharacterSelector() {
    const buttons = document.querySelectorAll('.character-btn');
    buttons.forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.character === selectedCharacter);
    });
}

// Expose changeCharacter to global scope for onclick handlers
window.changeCharacter = changeCharacter;

/**
 * Create character selector UI
 */
function createCharacterSelector() {
    const controlsPanel = document.getElementById('controls-panel');
    if (!controlsPanel) return;
    
    // Check if already exists
    if (document.getElementById('character-selector')) return;
    
    const selectorHTML = `
        <div id="character-selector" class="character-selector">
            <h3>🎭 PERSONAJE</h3>
            <div class="character-options">
                ${Object.entries(CHARACTER_MODELS).map(([id, char]) => `
                    <button class="character-btn ${id === selectedCharacter ? 'selected' : ''}" 
                            data-character="${id}"
                            onclick="changeCharacter('${id}')">
                        <span class="char-thumb">${char.thumbnail}</span>
                        <span class="char-name">${char.name}</span>
                    </button>
                `).join('')}
            </div>
        </div>
    `;
    
    controlsPanel.insertAdjacentHTML('afterbegin', selectorHTML);
    
    // Add styles
    if (!document.getElementById('character-selector-styles')) {
        const styles = document.createElement('style');
        styles.id = 'character-selector-styles';
        styles.textContent = `
            .character-selector {
                margin-bottom: 15px;
                padding-bottom: 15px;
                border-bottom: 1px solid rgba(0, 255, 204, 0.2);
                max-height: 280px;
                overflow-y: auto;
            }
            .character-selector::-webkit-scrollbar {
                width: 8px;
            }
            .character-selector::-webkit-scrollbar-track {
                background: rgba(0, 0, 0, 0.3);
                border-radius: 4px;
            }
            .character-selector::-webkit-scrollbar-thumb {
                background: linear-gradient(180deg, #00ffcc, #ffcc00);
                border-radius: 4px;
            }
            .character-selector::-webkit-scrollbar-thumb:hover {
                background: linear-gradient(180deg, #00ffcc, #ff3366);
            }
            .character-selector h3 {
                color: #ffcc00;
                font-size: 0.8rem;
                margin-bottom: 10px;
                position: sticky;
                top: 0;
                background: rgba(10, 10, 21, 0.95);
                padding: 5px 0;
                z-index: 1;
            }
            .character-options {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 8px;
            }
            .character-btn {
                padding: 8px;
                background: rgba(0, 0, 0, 0.3);
                border: 2px solid rgba(255, 255, 255, 0.2);
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.2s;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 5px;
            }
            .character-btn:hover {
                border-color: rgba(0, 255, 204, 0.5);
                background: rgba(0, 255, 204, 0.1);
            }
            .character-btn.selected {
                border-color: #00ffcc;
                background: rgba(0, 255, 204, 0.2);
                box-shadow: 0 0 15px rgba(0, 255, 204, 0.3);
            }
            .char-thumb {
                font-size: 2rem;
            }
            .char-name {
                color: white;
                font-size: 0.75rem;
                font-family: 'Orbitron', sans-serif;
            }
        `;
        document.head.appendChild(styles);
    }
}

/**
 * Add a player entity. The model may still be downloading: the entity is created when it
 * arrives. Safe to call several times (one entity per player) and cancelled if the player
 * leaves or a new match starts meanwhile (removePlayer / handleGameStarted).
 * @returns {Promise<PlayerEntity|null>}
 */
function addPlayer(playerData) {
    if (players.has(playerData.id)) {
        console.log(`[Game] Player ${playerData.id} already exists`);
        return Promise.resolve(players.get(playerData.id));
    }
    if (departedPlayerIds.has(playerData.id)) {
        return Promise.resolve(null);
    }

    const characterId = playerData.character || DEFAULT_CHARACTER;
    const pending = pendingPlayerAdds.get(playerData.id);
    if (pending && pending.characterId === characterId) {
        return pending.promise; // same player already being added
    }

    // New add (an older pending one for another character is superseded)
    const token = ++playerAddToken;
    const promise = createPlayerEntity(playerData, characterId, token);
    pendingPlayerAdds.set(playerData.id, { token, characterId, promise });
    return promise;
}

async function createPlayerEntity(playerData, characterId, token) {
    console.log(`[Game] Adding player: ${playerData.name} (${playerData.id}) with character: ${characterId}`);

    let playerModel = null;
    try {
        [playerModel] = await Promise.all([loadCharacterModel(characterId), animationsReady]);
    } catch (error) {
        console.error(`[Game] Could not load a model for player ${playerData.id}`, error);
    }

    // Cancelled while loading (player left, superseded, or a new match recreated everyone)
    if (pendingPlayerAdds.get(playerData.id)?.token !== token) {
        return players.get(playerData.id) || null;
    }
    pendingPlayerAdds.delete(playerData.id);

    if (!playerModel) return null;
    if (players.has(playerData.id)) {
        return players.get(playerData.id);
    }

    const player = new PlayerEntity(
        playerData.id,
        playerData.number,
        playerData.color || PLAYER_COLORS[(playerData.number - 1) % PLAYER_COLORS.length],
        playerModel,
        baseAnimations
    );
    
    player.setName(playerData.name || `Player ${playerData.number}`);
    player.characterId = characterId;
    
    // Set initial position
    let xPos = 0;
    if (playerData.position) {
        player.controller.position.set(
            playerData.position.x,
            playerData.position.y,
            playerData.position.z
        );
        xPos = playerData.position.x;
    } else {
        // Spread players out
        xPos = (playerData.number - 2.5) * 2;
        player.controller.position.set(xPos, 0, 0);
    }
    
    // Set initial facing direction: players should face each other
    // Player on the left faces right, player on the right faces left
    player.controller.facingRight = xPos < 0;
    
    // Apply the facing direction to the model immediately
    player.model.scale.z = player.controller.facingRight ? -0.01 : 0.01;
    
    scene.add(player.model);
    players.set(playerData.id, player);
    
    // Create HUD for this player
    createPlayerHUD(player);
    
    // Update status text
    updatePlayersHUD();
    
    return player;
}

function removePlayer(playerId) {
    pendingPlayerAdds.delete(playerId); // cancel an add still waiting for its model
    const player = players.get(playerId);
    
    if (player) {
        console.log(`[Game] Removing player: ${playerId}`);
        scene.remove(player.model);
        player.dispose();
        players.delete(playerId);
        removePlayerHUD(playerId);
        updatePlayersHUD();
    }
}

function updatePlayersHUD() {
    const count = players.size;
    updateAnimationDisplay(`Jugadores: ${count} | Sala: ${roomCode || 'Creando...'}`);
}

// =================================
// Socket.IO Connection
// =================================

function connectToServer() {
    // Load Socket.IO dynamically
    const script = document.createElement('script');
    script.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
    script.onload = () => {
        initializeSocket();
    };
    script.onerror = () => {
        console.error('[Socket] Failed to load Socket.IO');
        updateAnimationDisplay('Error: No se pudo cargar Socket.IO');
    };
    document.head.appendChild(script);
}

function initializeSocket() {
    console.log('[Socket] Connecting to server:', SERVER_URL);
    
    socket = io(SERVER_URL, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
    });
    
    socket.on('connect', () => {
        // Recovered reconnect (connectionStateRecovery): same socket id, same room, missed
        // events replayed by the server. Creating a room here would orphan every phone.
        if (socket.recovered) {
            console.log(`[Socket] Connection recovered, still in room ${roomCode}`);
            return;
        }

        console.log('[Socket] Connected to server');
        isHost = true;

        // Create room as host with selected game mode (host is display only, not a player)
        const isBabyShower = document.documentElement.classList.contains('baby-theme');
        socket.emit('create-room', { 
            gameMode: selectedGameMode,
            isBabyShower: isBabyShower 
        }, (response) => {
            if (response.success) {
                roomCode = response.roomCode;
                console.log(`[Socket] Room created: ${roomCode} with mode: ${selectedGameMode}`);
                updateAnimationDisplay(`Sala: ${roomCode} - Esperando jugadores...`);
                showRoomCode(roomCode);
            } else {
                console.error('[Socket] Failed to create room:', response.error);
            }
        });
    });
    
    socket.on('disconnect', () => {
        console.log('[Socket] Disconnected from server');
        updateAnimationDisplay('Desconectado del servidor');
    });
    
    socket.on('connect_error', (error) => {
        console.error('[Socket] Connection error:', error);
        updateAnimationDisplay('Error de conexión - Modo local');
    });
    
    // Game events
    socket.on('player-joined', handlePlayerJoined);
    socket.on('player-left', handlePlayerLeft);
    socket.on('character-selected', (data) => preloadCharacter(data?.character));
    socket.on('player-ready-changed', handleReadyChanged);
    socket.on('game-started', handleGameStarted);
    socket.on('player-input-update', handlePlayerInput);
    socket.on('game-state', handleGameState);
    socket.on('attack-started', handleAttackStarted);  // Animation starts immediately
    socket.on('attack-hit', handleAttackHit);          // Hit detection after active frames
    socket.on('player-ko', handlePlayerKO);
    socket.on('game-over', handleGameOver);
    socket.on('game-reset', handleGameReset);
    
    // Block and taunt events
    socket.on('player-block-state', handlePlayerBlockState);
    socket.on('player-taunting', handlePlayerTaunt);
    
    // Tournament events - listen for round transitions (also used for rematches: data.rematch)
    socket.on('round-starting', (data) => {
        console.log('[Smash] Round starting:', data);
        if (data && data.rematch) {
            resetTournamentForRematch();
        }
        resetForNextRound(data);
    });
    
    socket.on('round-ended', (data) => {
        console.log('[Smash] Round ended:', data);
        // Hide game over overlay since tournament overlay will show
        const gameOverOverlay = document.getElementById('game-over-overlay');
        if (gameOverOverlay) {
            gameOverOverlay.classList.add('hidden');
        }
    });
    
    socket.on('tournament-ended', (data) => {
        console.log('[Smash] Tournament ended:', data);
        // Hide game over overlay since tournament end overlay will show
        const gameOverOverlay = document.getElementById('game-over-overlay');
        if (gameOverOverlay) {
            gameOverOverlay.classList.add('hidden');
        }
    });
    
    // Initialize tournament manager
    window.tournamentManager = new TournamentManager(socket, 'smash');

    // REVANCHA on the tournament-end screen (button lives in smash.html; wire it once)
    const tournamentRematchBtn = document.getElementById('tournament-rematch-btn');
    if (tournamentRematchBtn && !tournamentRematchBtn.dataset.wired) {
        tournamentRematchBtn.dataset.wired = 'true';
        tournamentRematchBtn.addEventListener('click', () => requestRematch());
    }
}

function showRoomCode(code) {
    // Create room code overlay
    let overlay = document.getElementById('room-code-overlay');
    
    // Generate mobile URL with room code
    const mobileUrl = `${window.location.origin}/mobile/?room=${code}`;
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(mobileUrl)}&bgcolor=0a0a15&color=00ffcc`;
    
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'room-code-overlay';
        overlay.innerHTML = `
            <div class="room-code-content">
                <h2>CÓDIGO DE SALA</h2>
                <div class="room-code">${code}</div>
                <div class="qr-container">
                    <img src="${qrCodeUrl}" alt="QR Code" class="qr-code" />
                </div>
                <p>Escanea o ingresa este código en tu celular</p>
                <a href="${mobileUrl}" target="_blank" class="url">${mobileUrl}</a>
                
                <div class="rounds-selector">
                    <span class="rounds-label">RONDAS:</span>
                    <button class="round-btn selected" data-rounds="1">1</button>
                    <button class="round-btn" data-rounds="3">3</button>
                    <button class="round-btn" data-rounds="5">5</button>
                </div>
                
                <button id="start-game-btn" disabled>INICIAR JUEGO</button>
                <p class="waiting-text">Esperando jugadores...</p>
            </div>
        `;
        
        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            #room-code-overlay {
                position: fixed;
                top: 20px;
                right: 20px;
                background: rgba(10, 10, 21, 0.95);
                border: 2px solid #00ffcc;
                border-radius: 16px;
                padding: 24px;
                z-index: 100;
                text-align: center;
                font-family: 'Orbitron', sans-serif;
                box-shadow: 0 0 30px rgba(0, 255, 204, 0.3);
                min-width: 280px;
            }
            #room-code-overlay h2 {
                color: #00ffcc;
                font-size: 0.9rem;
                margin-bottom: 12px;
                letter-spacing: 3px;
            }
            #room-code-overlay .room-code {
                font-size: 3rem;
                font-weight: 900;
                color: #ffcc00;
                letter-spacing: 12px;
                text-shadow: 0 0 20px rgba(255, 204, 0, 0.5);
                margin-bottom: 12px;
            }
            #room-code-overlay .qr-container {
                margin: 16px auto;
                padding: 10px;
                background: #0a0a15;
                border-radius: 12px;
                border: 2px solid #00ffcc;
                display: inline-block;
            }
            #room-code-overlay .qr-code {
                display: block;
                width: 120px;
                height: 120px;
                border-radius: 8px;
            }
            #room-code-overlay p {
                color: rgba(255, 255, 255, 0.7);
                font-size: 0.85rem;
                margin-bottom: 8px;
                font-family: 'Rajdhani', sans-serif;
            }
            #room-code-overlay .url {
                display: block;
                color: #ff3366;
                font-size: 0.75rem;
                word-break: break-all;
                text-decoration: none;
                margin-bottom: 8px;
                font-family: 'Rajdhani', sans-serif;
            }
            #room-code-overlay .url:hover {
                color: #ffcc00;
                text-decoration: underline;
            }
            #room-code-overlay button {
                margin-top: 16px;
                padding: 14px 28px;
                font-family: 'Orbitron', sans-serif;
                font-size: 1rem;
                font-weight: 700;
                background: linear-gradient(135deg, #ff3366, #ffcc00);
                border: none;
                border-radius: 8px;
                color: #0a0a15;
                cursor: pointer;
                transition: all 0.3s;
            }
            #room-code-overlay button:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            #room-code-overlay button:hover:not(:disabled) {
                transform: scale(1.05);
                box-shadow: 0 0 20px rgba(255, 51, 102, 0.5);
            }
            #room-code-overlay .waiting-text {
                margin-top: 12px;
                color: #00ffcc;
                font-size: 0.8rem;
            }
            #room-code-overlay.hidden {
                display: none;
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(overlay);
        
        // Start game button
        document.getElementById('start-game-btn').addEventListener('click', startGame);
        
        // Rounds selector
        setupRoundsSelector();
    } else {
        overlay.querySelector('.room-code').textContent = code;
        overlay.querySelector('.qr-code').src = qrCodeUrl;
        overlay.querySelector('.url').href = mobileUrl;
        overlay.querySelector('.url').textContent = mobileUrl;
        overlay.classList.remove('hidden');
    }
}

function setupRoundsSelector() {
    const roundBtns = document.querySelectorAll('.round-btn');
    roundBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const rounds = parseInt(e.target.dataset.rounds);
            
            // Update UI
            roundBtns.forEach(b => b.classList.remove('selected'));
            e.target.classList.add('selected');
            
            // Send to server
            socket?.emit('set-tournament-rounds', rounds);
        });
    });
}

function updateRoomOverlay(playerCount) {
    const btn = document.getElementById('start-game-btn');
    const waitingText = document.querySelector('#room-code-overlay .waiting-text');
    
    if (btn && waitingText) {
        btn.disabled = playerCount < 1;
        waitingText.textContent = playerCount > 0 
            ? `${playerCount} jugador${playerCount > 1 ? 'es' : ''} conectado${playerCount > 1 ? 's' : ''}`
            : 'Esperando jugadores...';
    }
}

function startGame() {
    if (!socket || !isHost) return;
    
    socket.emit('start-game', (response) => {
        if (response.success) {
            console.log('[Game] Starting game!');
            gameState = 'playing';
            
            // Hide room overlay
            const overlay = document.getElementById('room-code-overlay');
            if (overlay) overlay.classList.add('hidden');
            
            // Remove local test player
            if (players.has('local')) {
                removePlayer('local');
                localPlayer = null;
            }
        } else {
            console.error('[Game] Failed to start:', response.error);
        }
    });
}

// =================================
// Socket Event Handlers
// =================================

async function handlePlayerJoined(data) {
    console.log('[Game] Player joined:', data.player);
    departedPlayerIds.delete(data.player.id);
    // Update the lobby right away; the entity appears when its model is ready
    updateRoomOverlay(data.room.playerCount);
    await addPlayer(data.player);
}

function handlePlayerLeft(data) {
    console.log('[Game] Player left:', data.playerId);
    departedPlayerIds.add(data.playerId);
    removePlayer(data.playerId);
    updateRoomOverlay(data.room?.playerCount || 0);
}

function handleReadyChanged(data) {
    console.log('[Game] Ready changed:', data);
}

// Bumped on every 'game-started'; an older (still loading) handler stops when it sees a newer one
let gameStartGeneration = 0;

async function handleGameStarted(data) {
    console.log('[Game] Game started!', data);
    const generation = ++gameStartGeneration;
    gameState = 'playing';

    // A new match/round never keeps the previous end-of-match screens
    hideEndOfMatchUI();

    // Remove local test player
    if (players.has('local')) {
        removePlayer('local');
        localPlayer = null;
    }
    
    // Remove ALL existing players to recreate them with correct character models
    // This is necessary because players join before selecting characters
    for (const [playerId, player] of players) {
        if (playerId !== 'local') {
            removePlayer(playerId);
        }
    }
    
    // Adds still waiting for a model (lobby joins) are recreated below with the final characters
    pendingPlayerAdds.clear();

    // Clear existing HUDs
    playerHudsContainer.innerHTML = '';

    // The server's list is authoritative: download every missing character in parallel
    // (usually already cached from the lobby)
    data.players.forEach(playerData => {
        departedPlayerIds.delete(playerData.id);
        preloadCharacter(playerData.character);
    });

    // Add all players from server with their selected characters
    // Use for...of to properly await async calls (keeps HUD order)
    for (const playerData of data.players) {
        console.log(`[Game] Creating player ${playerData.name} with character: ${playerData.character}`);
        const player = await addPlayer(playerData);
        if (generation !== gameStartGeneration) return; // superseded by a newer game-started

        // Reset player state for new game
        if (player) {
            player.controller.health = 0;
            player.controller.stocks = 3;
            updatePlayerHUD(player);
        }
    }
    
    // Hide room overlay
    const overlay = document.getElementById('room-code-overlay');
    if (overlay) overlay.classList.add('hidden');
    
    // Hide controls panel during game
    const controlsPanel = document.getElementById('controls-panel');
    if (controlsPanel) controlsPanel.style.display = 'none';
    
    // Show fight announcement
    showFightAnnouncement();
    
    // BGM: Start battle music
    if (bgmManager) {
        bgmManager.playBattle();
    }
    
    updateAnimationDisplay('¡PELEA!');
}

function handlePlayerInput(data) {
    const player = players.get(data.playerId);
    
    if (player) {
        // Update player input from mobile controller
        player.controller.input = { ...player.controller.input, ...data.input };
        
        // Update facing direction based on input
        if (data.input.left) {
            player.controller.facingRight = false;
        } else if (data.input.right) {
            player.controller.facingRight = true;
        }
        
        // Handle attacks (use AnimationController which handles transitions properly)
        // Note: Mobile controller already emits 'player-attack' to server directly
        // We just handle the animation here
        if (data.input.punch && !player.animController.isAttacking) {
            if (player.controller.punch()) {
                player.playAnimation('punch');
            }
        }
        if (data.input.kick && !player.animController.isAttacking) {
            if (player.controller.kick()) {
                player.playAnimation('kick');
            }
        }
    }
}

function handleGameState(data) {
    // Update all player states from server
    data.players.forEach(state => {
        const player = players.get(state.id);
        if (player) {
            // Apply server state (position, velocity, health, stocks)
            player.controller.applyServerState(state);

            // Eliminated players (no stocks) are out of the match: hide them and their name tag
            const isOut = typeof state.stocks === 'number' && state.stocks <= 0;
            if (player.model) player.model.visible = !isOut;
            if (player.nameLabel) player.nameLabel.visible = !isOut;
                        
            // Update HUD with latest health/stocks from server
            updatePlayerHUD(player);
        }
    });
}

/**
 * Handle attack started - play attacker's animation immediately
 * This is triggered as soon as player presses attack button
 */
function handleAttackStarted(data) {
    console.log('[Game] Attack started:', data.attackType, 'by', data.attackerId);
    
    // Play attacker's animation (punch or kick) immediately
    const attacker = players.get(data.attackerId);
    if (attacker) {
        attacker.playAnimation(data.attackType); // 'punch' or 'kick'
    }
}

/**
 * Handle attack hit - process damage after active frames delay
 * This is triggered after the attack animation reaches its active frames
 */
function handleAttackHit(data) {
    console.log('[Game] Attack hit:', data);
    
    const attacker = players.get(data.attackerId);
    
    // Show hit animations and effects for targets
    data.hits.forEach(hit => {
        const target = players.get(hit.targetId);
        if (target) {
            target.playAnimation('hit');
            target.controller.health = hit.newHealth;
            
            // Apply knockback - always push AWAY from attacker
            if (hit.knockback && attacker) {
                // Calculate direction from attacker to target
                const dirX = target.controller.position.x - attacker.controller.position.x;
                const knockbackDir = dirX >= 0 ? 1 : -1; // Push away from attacker
                
                // Apply knockback in the correct direction
                target.controller.velocity.x = knockbackDir * Math.abs(hit.knockback.x);
                target.controller.velocity.y = Math.abs(hit.knockback.y);
            }
            
            // Trigger visual effects with damage and blocked info
            triggerHitEffect(hit.targetId, data.attackerId, hit.damage || 0, hit.blocked || false);
            updatePlayerHUD(target);
            
            // Show "BLOCKED!" indicator if attack was blocked
            if (hit.blocked) {
                showBlockedIndicator(target);
            }
        }
    });
}

/**
 * Handle player block state change
 */
function handlePlayerBlockState(data) {
    const player = players.get(data.playerId);
    if (player) {
        player.controller.isBlocking = data.isBlocking;
        if (data.isBlocking) {
            player.playAnimation('block');
        } else {
            // Release block and return to idle
            player.animController.releaseBlock();
        }
    }
}

/**
 * Handle player taunt (Hip Hop Dance!)
 */
function handlePlayerTaunt(data) {
    const player = players.get(data.playerId);
    if (player) {
        player.controller.isTaunting = true;
        player.playAnimation('taunt');
    }
}

/**
 * Show "BLOCKED!" text indicator above player
 */
function showBlockedIndicator(player) {
    // Create floating text
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#00FFFF';
    ctx.font = 'bold 32px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('BLOCKED!', 128, 40);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ 
        map: texture, 
        transparent: true,
        depthTest: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(2, 0.5, 1);
    sprite.position.copy(player.model.position);
    sprite.position.y += 2.5;
    scene.add(sprite);
    
    // Animate and remove
    let elapsed = 0;
    const animate = () => {
        elapsed += 0.016;
        sprite.position.y += 0.02;
        sprite.material.opacity = 1 - (elapsed / 0.8);
        
        if (elapsed < 0.8) {
            requestAnimationFrame(animate);
        } else {
            scene.remove(sprite);
            sprite.material.dispose();
            texture.dispose();
        }
    };
    animate();
}

function handlePlayerKO(kos) {
    console.log('[Game] KOs:', kos);
    
    kos.forEach(ko => {
        const player = players.get(ko.playerId);
        if (player) {
            player.playAnimation('fall');
            player.controller.stocks = ko.stocksRemaining;
            
            // Trigger KO visual effects
            triggerKOEffect(ko.playerId);
            updatePlayerHUD(player);
            
            if (ko.eliminated) {
                console.log(`[Game] Player ${player.name} eliminated!`);
            }
        }
    });
}

function handleGameOver(data) {
    console.log('[Game] Game over!', data);
    gameState = 'finished';
    
    // BGM: Victory fanfare
    if (bgmManager) {
        bgmManager.playVictory();
    }
    
    if (data.winner) {
        updateAnimationDisplay(`¡${data.winner.name} GANA!`);
    } else {
        updateAnimationDisplay('¡EMPATE!');
    }
    
    // Show game over UI
    showGameOverUI(data);
}

/**
 * Reset game state for the next round in a tournament
 */
function resetForNextRound(data) {
    console.log('[Smash] Resetting for next round:', data.round);

    // Hide overlays (game over, round end, tournament end, confetti, room code)
    hideEndOfMatchUI();

    // Reset game state
    gameState = 'playing';
    
    // Reset all players - Support up to 8 players on larger stage
    const spawnPoints = [
        new THREE.Vector3(-7, 2, 0),    // Player 1 - Far left
        new THREE.Vector3(7, 2, 0),     // Player 2 - Far right
        new THREE.Vector3(-4, 2, 0),    // Player 3 - Left
        new THREE.Vector3(4, 2, 0),     // Player 4 - Right
        new THREE.Vector3(-1, 2, 0),    // Player 5 - Center left
        new THREE.Vector3(1, 2, 0),     // Player 6 - Center right
        new THREE.Vector3(-6, 3.5, 0),  // Player 7 - Left platform
        new THREE.Vector3(6, 3.5, 0),   // Player 8 - Right platform
    ];
    
    let playerIndex = 0;
    players.forEach((player, playerId) => {
        const spawnPoint = spawnPoints[playerIndex % spawnPoints.length];

        // Reset controller state
        if (player.controller) {
            player.controller.health = 0;
            player.controller.stocks = 3;
            player.controller.velocity = new THREE.Vector3();
            player.controller.position.copy(spawnPoint);
            player.controller.isGrounded = false;
            player.controller.isAttacking = false;
            player.controller.isBlocking = false;
            player.controller.isTaunting = false;
            player.controller.input = {
                left: false, right: false, jump: false, punch: false,
                kick: false, run: false, block: false
            };
        }

        // Reset position and visibility (eliminated players were hidden by handleGameState)
        player.model.position.copy(spawnPoint);
        player.model.visible = true;

        if (player.nameLabel) {
            player.nameLabel.visible = true;
        }

        // Clear any attack/block/taunt/fall lock so idle can actually play
        player.animController?.stopAll();
        player.playAnimation('idle');

        updatePlayerHUD(player);
        const playerHud = document.getElementById(`hud-${playerId}`);
        if (playerHud) playerHud.classList.remove('hit', 'ko');

        playerIndex++;
    });
    
    // BGM: Back to battle music
    if (bgmManager) {
        bgmManager.playBattle?.();
    }
    
    // Show round announcement
    updateAnimationDisplay(`¡RONDA ${data.round}!`);
    
    console.log('[Smash] Reset complete');
}

// Legacy: the server no longer emits 'game-reset' (rematch now uses round-starting + game-started).
// Kept harmless in case an older server sends it.
function handleGameReset(data) {
    console.log('[Game] Game reset');
    gameState = 'lobby';
    hideEndOfMatchUI();

    // BGM: Back to character select music
    if (bgmManager) {
        bgmManager.playCharacterSelect();
    }
    
    // Reset all players
    players.forEach(player => {
        player.controller.health = 0;
        player.controller.stocks = 3;
        player.controller.position.set(0, 0, 0);
    });
    
    // Show room overlay again
    const overlay = document.getElementById('room-code-overlay');
    if (overlay) overlay.classList.remove('hidden');
    
    updateAnimationDisplay(`Sala: ${roomCode} - Esperando...`);
}

function showGameOverUI(data) {
    let overlay = document.getElementById('game-over-overlay');
    
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'game-over-overlay';
        overlay.innerHTML = `
            <div class="game-over-content">
                <h1 id="winner-text">¡VICTORIA!</h1>
                <p id="winner-name"></p>
                <button id="rematch-btn">REVANCHA</button>
            </div>
        `;
        
        const style = document.createElement('style');
        style.textContent = `
            #game-over-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(10, 10, 21, 0.9);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 200;
            }
            .game-over-content {
                text-align: center;
            }
            .game-over-content h1 {
                font-family: 'Orbitron', sans-serif;
                font-size: 4rem;
                color: #ffcc00;
                text-shadow: 0 0 40px rgba(255, 204, 0, 0.5);
                margin-bottom: 20px;
            }
            .game-over-content p {
                font-size: 1.5rem;
                color: #fff;
                margin-bottom: 40px;
            }
            .game-over-content button {
                padding: 16px 40px;
                font-family: 'Orbitron', sans-serif;
                font-size: 1.2rem;
                background: linear-gradient(135deg, #ff3366, #ffcc00);
                border: none;
                border-radius: 8px;
                color: #0a0a15;
                cursor: pointer;
            }
            .game-over-content button:disabled {
                opacity: 0.5;
                cursor: wait;
            }
            #game-over-overlay.hidden {
                display: none;
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(overlay);
        
        document.getElementById('rematch-btn').addEventListener('click', () => requestRematch());
    }

    // Fresh button for every game over (it may have been left disabled by a previous request)
    resetRematchButtons();

    const winnerText = overlay.querySelector('#winner-text');
    const winnerName = overlay.querySelector('#winner-name');
    
    if (data.winner) {
        winnerText.textContent = '¡VICTORIA!';
        winnerName.textContent = data.winner.name;
    } else {
        winnerText.textContent = '¡EMPATE!';
        winnerName.textContent = '';
    }
    
    overlay.classList.remove('hidden');
}

// =================================
// Rematch
// =================================

const REMATCH_BUTTON_IDS = ['rematch-btn', 'tournament-rematch-btn'];
let rematchPending = false;

/**
 * Ask the server for a rematch. On success the server emits 'round-starting' ({ rematch: true })
 * and then 'game-started'; those handlers reset the screen (see resetForNextRound / handleGameStarted).
 */
function requestRematch() {
    if (!socket || !socket.connected || rematchPending) return;

    rematchPending = true;
    REMATCH_BUTTON_IDS.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'ESPERANDO...';
        }
    });

    socket.timeout(8000).emit('request-rematch', (err, res) => {
        rematchPending = false;
        if (err || !res || !res.success) {
            const reason = err ? 'sin respuesta del servidor' : (res?.error || 'error desconocido');
            console.warn('[Rematch] Request failed:', reason);
            updateAnimationDisplay(`No se pudo iniciar la revancha (${reason})`);
            resetRematchButtons();
        }
        // On success the overlays are closed by the 'round-starting' handler
    });
}

function resetRematchButtons() {
    REMATCH_BUTTON_IDS.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'REVANCHA';
        }
    });
}

/**
 * Hide every end-of-match screen (game over, round end, tournament end, confetti, room code)
 */
function hideEndOfMatchUI() {
    ['game-over-overlay', 'round-end-overlay', 'tournament-end-overlay', 'room-code-overlay'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    const confetti = document.getElementById('tournament-confetti');
    if (confetti) confetti.innerHTML = '';

    resetRematchButtons();
}

/**
 * A rematch restarts the tournament from round 1 with no scores.
 * Runs before TournamentManager's own 'round-starting' listener (registered later),
 * so its HUD refresh already sees the cleared scores.
 */
function resetTournamentForRematch() {
    const tm = window.tournamentManager;
    if (tm) {
        tm.currentRound = 1;
        tm.roundWinners = [];
        tm.playerScores = {};
        tm.clearLocalStorage?.();
    }

    // TournamentManager.updateHUD() leaves the old scores in place when there are none, so clear them here
    const scores = document.getElementById('tournament-scores');
    if (scores) scores.innerHTML = '';
}

// =================================
// Keyboard Controls (Local Testing)
// =================================

function setupKeyboardControls() {
    window.addEventListener('keydown', (event) => {
        if (!localPlayer) return;
        
        const gameKeys = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's', ' ', 'j', 'k', 'l', 't', 'shift'];
        if (gameKeys.includes(event.key.toLowerCase())) {
            event.preventDefault();
        }
        
        const input = localPlayer.controller.input;
        
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
            case ' ':
                input.jump = true;
                break;
            case 'shift':
                input.run = true;
                break;
            case 'j':
                // Use animController to check if not already attacking
                if (!localPlayer.animController.isAttacking && localPlayer.controller.punch()) {
                    localPlayer.playAnimation('punch');
                    // Send attack to server for hit detection
                    if (socket && socket.connected) {
                        socket.emit('player-attack', 'punch');
                    }
                }
                break;
            case 'k':
                if (!localPlayer.animController.isAttacking && localPlayer.controller.kick()) {
                    localPlayer.playAnimation('kick');
                    // Send attack to server for hit detection
                    if (socket && socket.connected) {
                        socket.emit('player-attack', 'kick');
                    }
                }
                break;
            case 'l':
                // Block - hold to maintain block stance
                if (!localPlayer.animController.isAttacking) {
                    input.block = true;
                    localPlayer.controller.isBlocking = true;
                    localPlayer.playAnimation('block');
                    if (socket && socket.connected) {
                        socket.emit('player-block', true);
                    }
                }
                break;
            case 't':
                // Taunt - Hip Hop Dance!
                if (!localPlayer.animController.isAttacking && !localPlayer.controller.isBlocking && !localPlayer.controller.isTaunting) {
                    localPlayer.controller.isTaunting = true;
                    localPlayer.playAnimation('taunt');
                    if (socket && socket.connected) {
                        socket.emit('player-taunt');
                    }
                }
                break;
        }
    });
    
    window.addEventListener('keyup', (event) => {
        if (!localPlayer) return;
        
        const input = localPlayer.controller.input;
        
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
            case ' ':
                input.jump = false;
                break;
            case 'shift':
                input.run = false;
                break;
            case 'l':
                // Release block
                input.block = false;
                localPlayer.controller.isBlocking = false;
                localPlayer.animController.releaseBlock();
                if (socket && socket.connected) {
                    socket.emit('player-block', false);
                }
                break;
        }
    });
}

// =================================
// UI Updates
// =================================

function updateLoadingProgress(percent, text) {
    progressFill.style.width = `${percent}%`;
    if (text) loadingText.textContent = text;
}

function updateAnimationDisplay(name) {
    animationNameDisplay.textContent = name;
}

// =================================
// Player HUD System
// =================================

const playerHudsContainer = document.getElementById('player-huds');

/**
 * Escape player-provided text before putting it in innerHTML
 */
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function createPlayerHUD(player) {
    const hud = document.createElement('div');
    hud.className = 'player-hud';
    hud.id = `hud-${player.id}`;
    hud.dataset.playerId = player.id;

    const color = escapeHtml(player.color);
    hud.innerHTML = `
        <div class="player-hud-header">
            <div class="player-badge" style="background: ${color}; box-shadow: 0 0 15px ${color};">
                P${escapeHtml(player.number)}
            </div>
            <span class="player-name">${escapeHtml(player.name)}</span>
        </div>
        <div class="player-damage low">0%</div>
        <div class="player-stocks">
            ${[0, 1, 2].map(i => `
                <div class="stock-icon" style="border-color: ${color}; background: ${color};"></div>
            `).join('')}
        </div>
    `;
    
    playerHudsContainer.appendChild(hud);
    return hud;
}

function updatePlayerHUD(player) {
    const hud = document.getElementById(`hud-${player.id}`);
    if (!hud) return;
    
    const damageEl = hud.querySelector('.player-damage');
    const damage = Math.floor(player.controller.health);
    
    // Update damage text
    damageEl.textContent = `${damage}%`;
    
    // Update damage color class
    damageEl.classList.remove('low', 'medium', 'high', 'critical');
    if (damage < 50) {
        damageEl.classList.add('low');
    } else if (damage < 100) {
        damageEl.classList.add('medium');
    } else if (damage < 150) {
        damageEl.classList.add('high');
    } else {
        damageEl.classList.add('critical');
    }
    
    // Update stocks
    const stockIcons = hud.querySelectorAll('.stock-icon');
    stockIcons.forEach((icon, i) => {
        icon.classList.toggle('lost', i >= player.controller.stocks);
    });
}

function removePlayerHUD(playerId) {
    const hud = document.getElementById(`hud-${playerId}`);
    if (hud) {
        hud.remove();
    }
}

function triggerHitEffect(playerId, attackerId = null, damage = 0, blocked = false) {
    const player = players.get(playerId);
    const attacker = attackerId ? players.get(attackerId) : null;
    const hud = document.getElementById(`hud-${playerId}`);
    
    if (hud) {
        hud.classList.add('hit');
        setTimeout(() => hud.classList.remove('hit'), 300);
    }
    
    // Use VFXManager for particle effects
    if (vfxManager && player) {
        const hitPosition = player.controller.position.clone();
        hitPosition.y += 1.0; // Offset to body center
        
        // Get attacker color for effects
        let effectColor = 0xFF6600;
        if (attacker) {
            const colorIndex = attacker.controller.playerNumber - 1;
            const colors = [0xff3366, 0x00ffcc, 0xffcc00, 0x9966ff];
            effectColor = colors[colorIndex] || 0xFF6600;
        }
        
        if (blocked) {
            // Block effects - blue shield sparks
            vfxManager.createBlockShield(hitPosition, 0x00BFFF);
            vfxManager.createBlockSparks(hitPosition);
        } else {
            // Hit effects - sparks, ring, damage number, flash
            const intensity = Math.min(2.0, 0.5 + damage / 50);
            vfxManager.createHitSparks(hitPosition, effectColor, intensity);
            vfxManager.createImpactRing(hitPosition, effectColor);
            
            // Damage number
            if (damage > 0) {
                vfxManager.createDamageNumber(hitPosition, damage, effectColor);
            }
            
            // Flash the character
            vfxManager.createCharacterFlash(player.model, 100);
        }
    }
    
    // Screen shake (intensity based on damage)
    const shakeIntensity = blocked ? 0.2 : Math.min(0.5, 0.2 + damage / 100);
    triggerScreenShake(shakeIntensity, blocked ? 150 : 300);
    
    // SFX: Hit sound
    if (sfxManager) {
        sfxManager.playHit(damage, blocked);
    }
}

function triggerKOEffect(playerId) {
    const player = players.get(playerId);
    const hud = document.getElementById(`hud-${playerId}`);
    
    if (hud) {
        hud.classList.add('ko');
        setTimeout(() => hud.classList.remove('ko'), 1500);
    }
    
    // Get player's last position for particle effect
    let effectPosition = new THREE.Vector3(0, -5, 0);
    let playerColor = 0xff3366;
    
    if (player) {
        effectPosition.copy(player.controller.position);
        // Clamp to screen edges for effect
        effectPosition.x = Math.max(-10, Math.min(10, effectPosition.x));
        effectPosition.y = Math.max(-8, Math.min(12, effectPosition.y));
        
        // Get player color
        const colorIndex = player.controller.playerNumber - 1;
        const colors = [0xff3366, 0x00ffcc, 0xffcc00, 0x9966ff];
        playerColor = colors[colorIndex] || 0xff3366;
    }
    
    // Create explosion particles
    createKOExplosion(effectPosition, playerColor);
    
    // Intense screen shake
    triggerScreenShake(0.8, 500);
    
    // Screen flash
    triggerScreenFlash(playerColor);
    
    // SFX: KO sound
    if (sfxManager) {
        sfxManager.playKO();
    }
    
    // BGM: Knockout impact
    if (bgmManager) {
        bgmManager.playKnockout();
    }
}

/**
 * Create explosion particle effect at position (Smash Bros style)
 */
function createKOExplosion(position, color) {
    const particleCount = 50;
    const particles = [];
    
    // Create particle geometry
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    const velocities = [];
    
    const baseColor = new THREE.Color(color);
    const whiteColor = new THREE.Color(0xffffff);
    
    for (let i = 0; i < particleCount; i++) {
        // Start position (slightly randomized around impact point)
        positions[i * 3] = position.x + (Math.random() - 0.5) * 0.5;
        positions[i * 3 + 1] = position.y + (Math.random() - 0.5) * 0.5;
        positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * 0.5;
        
        // Random color between player color and white
        const mixRatio = Math.random() * 0.5;
        const particleColor = baseColor.clone().lerp(whiteColor, mixRatio);
        colors[i * 3] = particleColor.r;
        colors[i * 3 + 1] = particleColor.g;
        colors[i * 3 + 2] = particleColor.b;
        
        // Random size
        sizes[i] = Math.random() * 0.5 + 0.2;
        
        // Explosion velocity (outward burst)
        const angle = Math.random() * Math.PI * 2;
        const upAngle = Math.random() * Math.PI - Math.PI / 4; // Mostly upward
        const speed = Math.random() * 15 + 8;
        
        velocities.push({
            x: Math.cos(angle) * Math.cos(upAngle) * speed,
            y: Math.abs(Math.sin(upAngle)) * speed + 5, // Mostly upward
            z: Math.sin(angle) * Math.cos(upAngle) * speed * 0.3
        });
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    
    // Particle material
    const material = new THREE.PointsMaterial({
        size: 0.4,
        vertexColors: true,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    
    const particleSystem = new THREE.Points(geometry, material);
    scene.add(particleSystem);
    
    // Create star/spark sprites for extra effect
    const starSprites = [];
    for (let i = 0; i < 8; i++) {
        const starGeometry = new THREE.PlaneGeometry(1, 1);
        const starMaterial = new THREE.MeshBasicMaterial({
            color: i % 2 === 0 ? color : 0xffffff,
            transparent: true,
            opacity: 1,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        
        const star = new THREE.Mesh(starGeometry, starMaterial);
        star.position.copy(position);
        star.rotation.z = Math.random() * Math.PI;
        
        const angle = (i / 8) * Math.PI * 2;
        star.userData = {
            vx: Math.cos(angle) * 12,
            vy: Math.sin(angle) * 8 + 6,
            vz: 0,
            rotSpeed: (Math.random() - 0.5) * 10
        };
        
        scene.add(star);
        starSprites.push(star);
    }
    
    // Animate particles
    let elapsed = 0;
    const duration = 1.5;
    const gravity = -25;
    
    const animateParticles = () => {
        elapsed += 0.016;
        const progress = elapsed / duration;
        
        if (progress >= 1) {
            scene.remove(particleSystem);
            geometry.dispose();
            material.dispose();
            
            starSprites.forEach(star => {
                scene.remove(star);
                star.geometry.dispose();
                star.material.dispose();
            });
            return;
        }
        
        // Update particle positions
        const posAttr = geometry.getAttribute('position');
        for (let i = 0; i < particleCount; i++) {
            velocities[i].y += gravity * 0.016;
            
            posAttr.array[i * 3] += velocities[i].x * 0.016;
            posAttr.array[i * 3 + 1] += velocities[i].y * 0.016;
            posAttr.array[i * 3 + 2] += velocities[i].z * 0.016;
        }
        posAttr.needsUpdate = true;
        
        // Update star sprites
        starSprites.forEach(star => {
            star.userData.vy += gravity * 0.016;
            star.position.x += star.userData.vx * 0.016;
            star.position.y += star.userData.vy * 0.016;
            star.rotation.z += star.userData.rotSpeed * 0.016;
            star.scale.setScalar(1 - progress * 0.5);
            star.material.opacity = 1 - progress;
        });
        
        // Fade out particles
        material.opacity = 1 - progress;
        
        requestAnimationFrame(animateParticles);
    };
    
    animateParticles();
    
    // Create shockwave ring
    createShockwave(position, color);
}

/**
 * Create expanding shockwave ring
 */
function createShockwave(position, color) {
    const ringGeometry = new THREE.RingGeometry(0.1, 0.3, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.copy(position);
    ring.rotation.x = -Math.PI / 2; // Lay flat
    scene.add(ring);
    
    let elapsed = 0;
    const duration = 0.6;
    
    const animateRing = () => {
        elapsed += 0.016;
        const progress = elapsed / duration;
        
        if (progress >= 1) {
            scene.remove(ring);
            ringGeometry.dispose();
            ringMaterial.dispose();
            return;
        }
        
        // Expand ring
        const scale = 1 + progress * 8;
        ring.scale.set(scale, scale, 1);
        
        // Fade out
        ringMaterial.opacity = 0.8 * (1 - progress);
        
        requestAnimationFrame(animateRing);
    };
    
    animateRing();
}

/**
 * Trigger screen shake effect
 */
function triggerScreenShake(intensity = 0.5, duration = 300) {
    const container = document.getElementById('game-container');
    if (!container) return;
    
    const startTime = Date.now();
    const originalTransform = container.style.transform;
    
    const shake = () => {
        const elapsed = Date.now() - startTime;
        const progress = elapsed / duration;
        
        if (progress >= 1) {
            container.style.transform = originalTransform || '';
            return;
        }
        
        // Decreasing intensity over time
        const currentIntensity = intensity * (1 - progress);
        const offsetX = (Math.random() - 0.5) * 20 * currentIntensity;
        const offsetY = (Math.random() - 0.5) * 20 * currentIntensity;
        
        container.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
        
        requestAnimationFrame(shake);
    };
    
    shake();
}

/**
 * Trigger screen flash effect
 */
function triggerScreenFlash(color) {
    const flash = document.createElement('div');
    flash.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: #${color.toString(16).padStart(6, '0')};
        opacity: 0.6;
        pointer-events: none;
        z-index: 9999;
        mix-blend-mode: screen;
    `;
    document.body.appendChild(flash);
    
    let opacity = 0.6;
    const fadeOut = () => {
        opacity -= 0.05;
        if (opacity <= 0) {
            flash.remove();
            return;
        }
        flash.style.opacity = opacity;
        requestAnimationFrame(fadeOut);
    };
    
    requestAnimationFrame(fadeOut);
}

function showFightAnnouncement() {
    const announcement = document.createElement('div');
    announcement.id = 'fight-announcement';
    announcement.textContent = '¡PELEA!';
    document.body.appendChild(announcement);
    
    setTimeout(() => {
        announcement.remove();
    }, 2000);
}

// =================================
// Window Resize Handler
// =================================

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (labelRenderer) {
        labelRenderer.setSize(window.innerWidth, window.innerHeight);
    }
}

// =================================
// Player Collision Detection
// =================================

/**
 * Check and resolve collisions between players
 * Prevents players from walking through each other
 * Uses smooth collision to avoid shaking
 */
function checkPlayerCollisions() {
    const playerArray = Array.from(players.values());
    const COLLISION_RADIUS = 0.8; // Distance at which collision starts
    const PUSH_STRENGTH = 0.15;   // How hard to push (smaller = smoother, less shaking)
    
    for (let i = 0; i < playerArray.length; i++) {
        for (let j = i + 1; j < playerArray.length; j++) {
            const p1 = playerArray[i].controller;
            const p2 = playerArray[j].controller;
            
            // Calculate horizontal distance between players
            const dx = p2.position.x - p1.position.x;
            const dy = p2.position.y - p1.position.y;
            const dist = Math.abs(dx);
            
            // Only collide if players are at similar height (not jumping over each other)
            const verticalOverlap = Math.abs(dy) < 1.5;
            
            if (dist < COLLISION_RADIUS && verticalOverlap) {
                // Calculate overlap amount
                const overlap = COLLISION_RADIUS - dist;
                const pushDir = dx === 0 ? 1 : Math.sign(dx);
                
                // Calculate smooth push amount based on overlap
                // More overlap = stronger push, but capped to prevent jitter
                const pushAmount = Math.min(overlap * PUSH_STRENGTH, 0.1);
                
                // Only push if players are trying to move into each other or standing still
                const p1MovingToward = p1.velocity.x * pushDir > 0;
                const p2MovingToward = p2.velocity.x * -pushDir > 0;
                
                // Apply gentle push
                if (Math.abs(p1.velocity.x) < 8 && (p1MovingToward || Math.abs(p1.velocity.x) < 0.5)) {
                    p1.position.x -= pushDir * pushAmount;
                    // Also reduce velocity toward the other player
                    if (p1MovingToward) {
                        p1.velocity.x *= 0.5;
                    }
                }
                if (Math.abs(p2.velocity.x) < 8 && (p2MovingToward || Math.abs(p2.velocity.x) < 0.5)) {
                    p2.position.x += pushDir * pushAmount;
                    // Also reduce velocity toward the other player
                    if (p2MovingToward) {
                        p2.velocity.x *= 0.5;
                    }
                }
            }
        }
    }
}

// =================================
// Animation Loop
// =================================

function animate() {
    requestAnimationFrame(animate);
    
    const delta = clock.getDelta();
    
    // Update all players
    players.forEach(player => {
        // During online game, skip local physics - server handles it
        // Only calculate local physics for 'local' player in lobby/testing
        const isLocalTestPlayer = player.id === 'local';
        const skipPhysics = gameState === 'playing' && !isLocalTestPlayer;
        
        player.update(delta, skipPhysics);
        
        // Update HUD periodically (every few frames for performance)
        if (gameState === 'playing') {
            updatePlayerHUD(player);
        }
    });
    
    // Check collisions between players (push them apart).
    // During an online match the server resolves collisions; running it here too makes players jitter.
    if (gameState !== 'playing') {
        checkPlayerCollisions();
    }
    
    // Update VFX Manager (particle effects, etc.)
    if (vfxManager) {
        vfxManager.update(delta);
    }
    
    // Update camera - Side view following system (Smash Bros style)
    updateSideViewCamera();
    
    renderer.render(scene, camera);
    
    // Render floating name labels
    if (labelRenderer) {
        labelRenderer.render(scene, camera);
    }
}

/**
 * Dynamic elastic camera with automatic framing (Smash Bros style)
 * - Follows all players
 * - Adjusts zoom to keep everyone visible
 * - Smooth interpolation for elastic feel
 */

// Camera configuration - Supports up to 8 players
const CAMERA_CONFIG = {
    // Minimum and maximum zoom distances
    MIN_ZOOM: 10,      // Increased for better view with more players
    MAX_ZOOM: 35,      // Increased to fit 8 players spread out
    
    // Padding around players (in world units)
    HORIZONTAL_PADDING: 4,    // More padding for larger groups
    VERTICAL_PADDING: 3,      // More vertical padding
    
    // Interpolation speeds (lower = smoother/slower)
    POSITION_LERP: 0.06,
    ZOOM_LERP: 0.04,
    
    // Vertical offset for camera target
    LOOK_AT_OFFSET_Y: 1.5,    // Slightly higher to see all players
    
    // Camera height offset from center
    CAMERA_HEIGHT_OFFSET: 2.0,  // Higher camera for better overview
    
    // FOV for calculations (should match camera FOV)
    FOV: 45
};

function updateSideViewCamera() {
    if (players.size === 0) return;
    
    // Calculate bounding box of all players
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    players.forEach(player => {
        const px = player.controller.position.x;
        const py = player.controller.position.y;
        
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);
    });
    
    // Add padding to bounds
    minX -= CAMERA_CONFIG.HORIZONTAL_PADDING;
    maxX += CAMERA_CONFIG.HORIZONTAL_PADDING;
    minY -= CAMERA_CONFIG.VERTICAL_PADDING;
    maxY += CAMERA_CONFIG.VERTICAL_PADDING + 1; // Extra for names above heads
    
    // Calculate center of bounding box
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    
    // Calculate required dimensions
    const spreadX = maxX - minX;
    const spreadY = maxY - minY;
    
    // Calculate required distance based on FOV to fit all players
    // Using vertical FOV for calculation
    const fovRad = THREE.MathUtils.degToRad(CAMERA_CONFIG.FOV);
    const aspectRatio = window.innerWidth / window.innerHeight;
    
    // Distance needed to fit vertical spread
    const distanceForHeight = (spreadY / 2) / Math.tan(fovRad / 2);
    
    // Distance needed to fit horizontal spread (accounting for aspect ratio)
    const horizontalFov = 2 * Math.atan(Math.tan(fovRad / 2) * aspectRatio);
    const distanceForWidth = (spreadX / 2) / Math.tan(horizontalFov / 2);
    
    // Use the larger distance to ensure everything fits
    let targetZ = Math.max(distanceForHeight, distanceForWidth);
    
    // Clamp zoom to min/max
    targetZ = THREE.MathUtils.clamp(targetZ, CAMERA_CONFIG.MIN_ZOOM, CAMERA_CONFIG.MAX_ZOOM);
    
    // Target camera position
    const targetX = centerX;
    const targetY = centerY + CAMERA_CONFIG.CAMERA_HEIGHT_OFFSET;
    
    // Smoothly interpolate camera position (elastic effect)
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetX, CAMERA_CONFIG.POSITION_LERP);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetY, CAMERA_CONFIG.POSITION_LERP);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZ, CAMERA_CONFIG.ZOOM_LERP);
    
    // Look at center of action with smooth interpolation
    // Store current lookAt target for smooth transitions
    if (!camera.userData.lookAtTarget) {
        camera.userData.lookAtTarget = new THREE.Vector3(centerX, centerY + CAMERA_CONFIG.LOOK_AT_OFFSET_Y, 0);
    }
    
    camera.userData.lookAtTarget.x = THREE.MathUtils.lerp(
        camera.userData.lookAtTarget.x, centerX, CAMERA_CONFIG.POSITION_LERP
    );
    camera.userData.lookAtTarget.y = THREE.MathUtils.lerp(
        camera.userData.lookAtTarget.y, centerY + CAMERA_CONFIG.LOOK_AT_OFFSET_Y, CAMERA_CONFIG.POSITION_LERP
    );
    
    camera.lookAt(camera.userData.lookAtTarget);
}

// =================================
// Start the application
// =================================

init();
