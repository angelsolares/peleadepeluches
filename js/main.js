/**
 * PELEA DE PELUCHES - 3D Fighter Prototype
 * Three.js based fighting game with FBX animations
 * Multiplayer support via WebSocket
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { SERVER_URL, CONFIG } from './config.js';
import { AnimationController, ANIMATION_CONFIG, AnimationState } from './animation/AnimationController.js';

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
     * Perform a punch attack
     */
    punch() {
        if (!this.isAttacking && this.attackCooldown <= 0) {
            this.isAttacking = true;
            this.attackCooldown = 1.0;
            return true;
        }
        return false;
    }
    
    /**
     * Perform a kick attack
     */
    kick() {
        if (!this.isAttacking && this.attackCooldown <= 0) {
            this.isAttacking = true;
            this.attackCooldown = 0.8;
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
                break;
            case 'kick':
                this.animController.playKick();
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
// Global Variables
// =================================

let scene, camera, renderer;
let clock = new THREE.Clock();

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
    taunt: 'Meshy_AI_Animation_Hip_Hop_Dance_withSkin.fbx'
};

// Available character models
const CHARACTER_MODELS = {
    edgar: {
        name: 'Edgar',
        file: 'Edgar_Model.fbx',
        thumbnail: '👦'
    },
    isabella: {
        name: 'Isabella', 
        file: 'Isabella_Model.fbx',
        thumbnail: '👧'
    }
};

// Currently selected character
let selectedCharacter = 'edgar';

// Player colors
const PLAYER_COLORS = ['#ff3366', '#00ffcc', '#ffcc00', '#9966ff'];

// UI Elements
const loadingScreen = document.getElementById('loading-screen');
const loadingText = document.getElementById('loading-text');
const progressFill = document.getElementById('progress-fill');
const animationNameDisplay = document.getElementById('animation-name');

// =================================
// Initialization
// =================================

async function init() {
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

    // No OrbitControls - camera follows players automatically (side-view)

    // Add lights
    setupLights();
    
    // Add arena (side-view platform stage)
    createArena();
    
    // Load character and animations
    await loadCharacterWithAnimations();
    
    // Setup keyboard controls for local testing
    setupKeyboardControls();
    
    // Connect to server
    connectToServer();
    
    // Handle window resize
    window.addEventListener('resize', onWindowResize);
    
    // Start render loop
    animate();
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
    
    // === MAIN PLATFORM ===
    const mainPlatformWidth = 14;
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
    
    // === FLOATING PLATFORMS (Smash Bros style) ===
    const floatingPlatformConfigs = [
        { x: -4, y: 2.5, width: 3, color: 0xff3366 },   // Left high
        { x: 4, y: 2.5, width: 3, color: 0x00ffcc },    // Right high
        { x: 0, y: 4.5, width: 2.5, color: 0xffcc00 },  // Center top
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

async function loadCharacterWithAnimations(characterId = null) {
    const loader = new FBXLoader();
    const totalFiles = Object.keys(ANIMATION_FILES).length + 1; // +1 for character model
    let loadedCount = 0;
    
    // Use provided character or selected one
    const charId = characterId || selectedCharacter;
    const characterConfig = CHARACTER_MODELS[charId];
    
    if (!characterConfig) {
        console.error(`Character ${charId} not found!`);
        return;
    }
    
    try {
        updateLoadingProgress(0, `Cargando modelo: ${characterConfig.name}...`);
        
        // Load selected character model
        baseModel = await loadFBX(loader, `assets/${characterConfig.file}`);
        console.log(`=== MODELO CARGADO: ${characterConfig.name} ===`);
        loadedCount++;
        
        // Load all animations
        console.log('=== CARGANDO ANIMACIONES ===');
        for (const [actionName, fileName] of Object.entries(ANIMATION_FILES)) {
            updateLoadingProgress(
                (loadedCount / totalFiles) * 100,
                `Cargando animación: ${actionName}...`
            );
            
            try {
                const animationModel = await loadFBX(loader, `assets/${fileName}`);
                
                if (animationModel.animations && animationModel.animations.length > 0) {
                    const clip = animationModel.animations[0];
                    console.log(`${actionName}: ${clip.name} (duration: ${clip.duration.toFixed(2)}s)`);
                    baseAnimations[actionName] = clip;
                }
                
                disposeModel(animationModel);
            } catch (error) {
                console.error(`Error loading animation ${actionName}:`, error);
            }
            
            loadedCount++;
        }
        
        console.log('=== FIN DE CARGA ===');
        
        // Create local player for testing
        createLocalPlayer();
        
        updateLoadingProgress(100, '¡Listo!');
        
        setTimeout(() => {
            loadingScreen.classList.add('hidden');
            updateAnimationDisplay('Conectando al servidor...');
            gameState = 'lobby';
            
            // Create character selector UI
            createCharacterSelector();
        }, 500);
        
    } catch (error) {
        console.error('Error loading character:', error);
        loadingText.textContent = 'Error al cargar el modelo';
    }
}

function loadFBX(loader, path) {
    return new Promise((resolve, reject) => {
        loader.load(
            path,
            (object) => resolve(object),
            (xhr) => {
                if (xhr.lengthComputable) {
                    const percent = (xhr.loaded / xhr.total * 100).toFixed(0);
                    console.log(`Loading ${path}: ${percent}%`);
                }
            },
            (error) => reject(error)
        );
    });
}

function disposeModel(model) {
    model.traverse((child) => {
        if (child.isSkinnedMesh) child.skeleton?.dispose();
        if (child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach(material => {
                if (material.map) material.map.dispose();
                material.dispose();
            });
        }
        if (child.geometry) child.geometry.dispose();
    });
}

// =================================
// Player Management
// =================================

function createLocalPlayer() {
    // Create a test local player
    localPlayer = new PlayerEntity('local', 1, PLAYER_COLORS[0], baseModel, baseAnimations);
    localPlayer.controller.position.set(0, 0, 0);
    scene.add(localPlayer.model);
    players.set('local', localPlayer);
}

/**
 * Change character model - reloads the model and recreates local player
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
    
    // Show loading indicator
    const loadingOverlay = document.createElement('div');
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
    
    // Remove existing local player
    if (localPlayer) {
        scene.remove(localPlayer.model);
        localPlayer.dispose();
        players.delete('local');
        localPlayer = null;
    }
    
    // Dispose old base model
    if (baseModel) {
        disposeModel(baseModel);
        baseModel = null;
    }
    
    // Clear animations
    Object.keys(baseAnimations).forEach(key => delete baseAnimations[key]);
    
    // Load new character
    const loader = new FBXLoader();
    const characterConfig = CHARACTER_MODELS[characterId];
    
    try {
        // Load new model
        baseModel = await loadFBX(loader, `assets/${characterConfig.file}`);
        
        // Load animations
        for (const [actionName, fileName] of Object.entries(ANIMATION_FILES)) {
            try {
                const animationModel = await loadFBX(loader, `assets/${fileName}`);
                if (animationModel.animations && animationModel.animations.length > 0) {
                    baseAnimations[actionName] = animationModel.animations[0];
                }
                disposeModel(animationModel);
            } catch (error) {
                console.error(`Error loading animation ${actionName}:`, error);
            }
        }
        
        // Recreate local player
        createLocalPlayer();
        
        // Update UI
        updateCharacterSelector();
        
        console.log(`[Game] Character changed to: ${characterConfig.name}`);
    } catch (error) {
        console.error('Error changing character:', error);
    }
    
    // Remove loading overlay
    loadingOverlay.remove();
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
            }
            .character-selector h3 {
                color: #ffcc00;
                font-size: 0.8rem;
                margin-bottom: 10px;
            }
            .character-options {
                display: flex;
                gap: 10px;
            }
            .character-btn {
                flex: 1;
                padding: 10px;
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

function addPlayer(playerData) {
    if (players.has(playerData.id)) {
        console.log(`[Game] Player ${playerData.id} already exists`);
        return players.get(playerData.id);
    }
    
    console.log(`[Game] Adding player: ${playerData.name} (${playerData.id})`);
    
    const player = new PlayerEntity(
        playerData.id,
        playerData.number,
        playerData.color || PLAYER_COLORS[(playerData.number - 1) % PLAYER_COLORS.length],
        baseModel,
        baseAnimations
    );
    
    player.name = playerData.name || `Player ${playerData.number}`;
    
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
        console.log('[Socket] Connected to server');
        isHost = true;
        
        // Create room as host
        socket.emit('create-room', (response) => {
            if (response.success) {
                roomCode = response.roomCode;
                console.log(`[Socket] Room created: ${roomCode}`);
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
}

function showRoomCode(code) {
    // Create room code overlay
    let overlay = document.getElementById('room-code-overlay');
    
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'room-code-overlay';
        overlay.innerHTML = `
            <div class="room-code-content">
                <h2>CÓDIGO DE SALA</h2>
                <div class="room-code">${code}</div>
                <p>Escanea o ingresa este código en tu celular</p>
                <p class="url">${window.location.origin}/mobile/</p>
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
            #room-code-overlay p {
                color: rgba(255, 255, 255, 0.7);
                font-size: 0.85rem;
                margin-bottom: 8px;
                font-family: 'Rajdhani', sans-serif;
            }
            #room-code-overlay .url {
                color: #ff3366;
                font-size: 0.8rem;
                word-break: break-all;
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
    } else {
        overlay.querySelector('.room-code').textContent = code;
        overlay.classList.remove('hidden');
    }
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

function handlePlayerJoined(data) {
    console.log('[Game] Player joined:', data.player);
    addPlayer(data.player);
    updateRoomOverlay(data.room.playerCount);
}

function handlePlayerLeft(data) {
    console.log('[Game] Player left:', data.playerId);
    removePlayer(data.playerId);
    updateRoomOverlay(data.room?.playerCount || 0);
}

function handleReadyChanged(data) {
    console.log('[Game] Ready changed:', data);
}

function handleGameStarted(data) {
    console.log('[Game] Game started!', data);
    gameState = 'playing';
    
    // Remove local test player
    if (players.has('local')) {
        removePlayer('local');
        localPlayer = null;
    }
    
    // Clear existing HUDs
    playerHudsContainer.innerHTML = '';
    
    // Add all players from server (or update existing ones)
    data.players.forEach(playerData => {
        let player = players.get(playerData.id);
        
        if (!player) {
            // Player doesn't exist, create it
            player = addPlayer(playerData);
        } else {
            // Player exists, just create HUD for them
            createPlayerHUD(player);
        }
        
        // Reset player state for new game
        if (player) {
            player.controller.health = 0;
            player.controller.stocks = 3;
            updatePlayerHUD(player);
        }
    });
    
    // Hide room overlay
    const overlay = document.getElementById('room-code-overlay');
    if (overlay) overlay.classList.add('hidden');
    
    // Hide controls panel during game
    const controlsPanel = document.getElementById('controls-panel');
    if (controlsPanel) controlsPanel.style.display = 'none';
    
    // Show fight announcement
    showFightAnnouncement();
    
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
            
            // Trigger visual effects
            triggerHitEffect(hit.targetId);
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
    
    if (data.winner) {
        updateAnimationDisplay(`¡${data.winner.name} GANA!`);
    } else {
        updateAnimationDisplay('¡EMPATE!');
    }
    
    // Show game over UI
    showGameOverUI(data);
}

function handleGameReset(data) {
    console.log('[Game] Game reset');
    gameState = 'lobby';
    
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
            #game-over-overlay.hidden {
                display: none;
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(overlay);
        
        document.getElementById('rematch-btn').addEventListener('click', () => {
            if (socket) {
                socket.emit('request-rematch');
            }
            overlay.classList.add('hidden');
        });
    }
    
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

function createPlayerHUD(player) {
    const hud = document.createElement('div');
    hud.className = 'player-hud';
    hud.id = `hud-${player.id}`;
    hud.dataset.playerId = player.id;
    
    hud.innerHTML = `
        <div class="player-hud-header">
            <div class="player-badge" style="background: ${player.color}; box-shadow: 0 0 15px ${player.color};">
                P${player.number}
            </div>
            <span class="player-name">${player.name}</span>
        </div>
        <div class="player-damage low">0%</div>
        <div class="player-stocks">
            ${[0, 1, 2].map(i => `
                <div class="stock-icon" style="border-color: ${player.color}; background: ${player.color};"></div>
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

function triggerHitEffect(playerId) {
    const hud = document.getElementById(`hud-${playerId}`);
    if (hud) {
        hud.classList.add('hit');
        setTimeout(() => hud.classList.remove('hit'), 300);
    }
    
    // Screen shake
    document.getElementById('game-container').classList.add('screen-shake');
    setTimeout(() => {
        document.getElementById('game-container').classList.remove('screen-shake');
    }, 300);
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
    
    // Check collisions between players (push them apart)
    checkPlayerCollisions();
    
    // Update camera - Side view following system (Smash Bros style)
    updateSideViewCamera();
    
    renderer.render(scene, camera);
}

/**
 * Update camera to follow players from side view (Smash Bros style)
 */
function updateSideViewCamera() {
    if (players.size === 0) return;
    
    // Calculate bounds of all players
    let minX = Infinity;
    let maxX = -Infinity;
    let avgY = 0;
    
    players.forEach(player => {
        const px = player.controller.position.x;
        const py = player.controller.position.y;
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        avgY += py;
    });
    avgY /= players.size;
    
    // Calculate center and spread
    const centerX = (minX + maxX) / 2;
    const spread = maxX - minX;
    
    // Target camera position
    // X follows players, Y stays slightly above players, Z adjusts for zoom
    const targetX = centerX;
    const targetY = Math.max(1.5, avgY + 1.5);
    const targetZ = Math.max(10, 8 + spread * 0.8); // Dynamic zoom based on spread
    
    // Smoothly interpolate camera position
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetX, 0.05);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetY, 0.03);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZ, 0.03);
    
    // Look at center of action
    const lookAtY = Math.max(1, avgY + 0.5);
    camera.lookAt(centerX, lookAtY, 0);
}

// =================================
// Start the application
// =================================

init();
