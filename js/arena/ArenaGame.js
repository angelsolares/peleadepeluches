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
    lidia: { name: 'Lidia', file: 'Lidia.fbx', thumbnail: '👩‍🦰' }
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
    // Additional animations for escape sequence
    uppercut: 'Meshy_AI_Animation_Left_Uppercut_from_Guard_withSkin.fbx',
    knockdown: 'Meshy_AI_Animation_Shot_and_Slow_Fall_Backward_withSkin.fbx'
};

const PLAYER_COLORS = ['#ff3366', '#00ffcc', '#ffcc00', '#9966ff'];

// =================================
// Arena Player Entity
// =================================

class ArenaPlayerEntity {
    constructor(id, number, color, baseModel, baseAnimations) {
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
        this.animController = new AnimationController(this.model, baseAnimations);
        
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
        switch (actionName) {
            case 'idle': this.animController.playIdle(); break;
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
    
    update(delta) {
        // Update controller physics
        this.controller.update(delta);
        
        // Update model position
        this.model.position.copy(this.controller.position);
        
        // Update model rotation based on facing angle (always, not just when moving)
        // This ensures rotation updates even when grabbing/grabbed
        if (this.controller.facingAngle !== undefined) {
            const targetAngle = this.controller.facingAngle;
            this.model.rotation.y = THREE.MathUtils.lerp(
                this.model.rotation.y,
                targetAngle,
                0.15
            );
        } else if (this.controller.movementDirection.length() > 0.1) {
            // Fallback to movement direction
            const targetAngle = Math.atan2(
                this.controller.movementDirection.x,
                this.controller.movementDirection.z
            );
            this.model.rotation.y = THREE.MathUtils.lerp(
                this.model.rotation.y,
                targetAngle,
                0.15
            );
        }
        
        // Update animation based on state
        const isMoving = this.controller.velocity.length() > 0.5;
        const isRunning = isMoving && this.controller.input.run;
        
        this.animController.updateFromMovementState({
            isMoving,
            isRunning,
            isGrounded: true,
            isJumping: false
        });
        
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
        this.selectedCharacter = 'edgar'; // Default character
        
        // Networking
        this.socket = null;
        this.roomCode = null;
        this.isHost = false;
        this.gameState = 'loading';
        
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
    }
    
    async loadCharacterWithAnimations(characterId = 'edgar') {
        const loader = new FBXLoader();
        const totalFiles = Object.keys(ANIMATION_FILES).length + 1;
        let loadedCount = 0;
        
        const characterConfig = CHARACTER_MODELS[characterId];
        
        try {
            this.updateLoadingProgress(0, `Cargando modelo: ${characterConfig.name}...`);
            
            // Load character model
            this.baseModel = await this.loadFBX(loader, `assets/${characterConfig.file}`);
            this.characterModelCache[characterId] = this.baseModel;
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
            
            // Create local player
            this.createLocalPlayer();
            
            this.updateLoadingProgress(100, '¡Arena lista!');
            
            setTimeout(() => {
                this.loadingScreen.classList.add('hidden');
                this.updateAnimationDisplay('Conectando al servidor...');
                this.gameState = 'lobby';
            }, 500);
            
        } catch (error) {
            console.error('Error loading character:', error);
            this.loadingText.textContent = 'Error al cargar el modelo';
        }
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
    
    createLocalPlayer() {
        this.localPlayer = new ArenaPlayerEntity(
            'local',
            1,
            PLAYER_COLORS[0],
            this.baseModel,
            this.baseAnimations
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
            console.log('[Socket] Connected to server');
            this.isHost = true;
            
            // Create room with arena mode
            console.log('[Socket] Emitting create-room with arena mode...');
            this.socket.emit('create-room', { gameMode: 'arena' }, (response) => {
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
                    <div class="room-code">${code}</div>
                    <div class="qr-container">
                        <img src="${qrCodeUrl}" alt="QR Code" class="qr-code" />
                    </div>
                    <p>Escanea o ingresa este código en tu celular</p>
                    <a href="${mobileUrl}" target="_blank" class="url">${mobileUrl}</a>
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
        }
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
        this.addPlayer(data.player);
        this.updateRoomOverlay(data.room.playerCount);
    }
    
    handlePlayerLeft(data) {
        console.log('[Arena] Player left:', data.playerId);
        this.removePlayer(data.playerId);
    }
    
    handleGameStarted(data) {
        console.log('[Arena] Game started!', data);
        this.gameState = 'playing';
        
        // Clear and add all players
        this.players.forEach((player, id) => {
            if (id !== 'local') this.removePlayer(id);
        });
        
        data.players.forEach((playerData, index) => {
            this.addPlayer(playerData, index);
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
                // Apply position and state from server
                player.controller.applyServerState(state);
                
                // Debug: Log first player position every 60 frames
                if (state.id === data.players[0].id && Math.random() < 0.03) {
                    console.log('[Arena] P1 pos:', state.position);
                }
                
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
        if (player) {
            // Play attack animation
            player.playAnimation(data.attackType);
            
            // Play sound effect
            if (this.sfxManager) {
                if (data.attackType === 'punch') {
                    this.sfxManager.playPunchSwing?.();
                } else if (data.attackType === 'kick') {
                    this.sfxManager.playKickSwing?.();
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
                        this.vfxManager.createHitSparks?.(hitPosition, 0xff3366, hit.damage / 10);
                        this.vfxManager.createDamageNumber?.(hitPosition, hit.damage, hit.blocked ? 0x00bfff : 0xff3366);
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
            grabber.controller.isGrabbing = true;
            grabber.controller.grabbedPlayer = victim.controller;
            grabber.grabbedEntity = victim; // Store the entity reference for position updates
            victim.controller.isGrabbed = true;
            victim.controller.grabbedBy = grabber.controller;
            
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
     * Show visual indicator when someone is grabbed
     */
    showGrabIndicator(grabber, victim) {
        // Create a floating text indicator
        const indicator = document.createElement('div');
        indicator.className = 'grab-indicator';
        indicator.innerHTML = `🤼 ${grabber.name} → ${victim.name}`;
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
            // Release grab state
            grabber.controller.isGrabbing = false;
            grabber.controller.grabbedPlayer = null;
            grabber.grabbedEntity = null;
            victim.controller.isGrabbed = false;
            victim.controller.grabbedBy = null;
            victim.isBeingCarried = false;
            
            // Mark victim as being thrown for visual effects
            victim.isBeingThrown = true;
            victim.throwStartTime = Date.now();
            
            // Reset victim's rotation from carried position
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
            
            // Play fall animation on victim (ragdoll effect)
            victim.playAnimation('fall');
            if (victim.animController) {
                const fallAction = victim.animController.mixer?.clipAction(
                    victim.animController.animations['fall']
                );
                if (fallAction) {
                    fallAction.timeScale = 1.5;
                }
            }
            
            // Add spinning effect to thrown victim (ragdoll)
            victim.throwSpin = {
                active: true,
                speed: 12, // Rotations per second
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
        console.log('[Arena] Elimination:', data);
        const player = this.players.get(data.playerId);
        
        if (player) {
            // Show elimination announcement
            const reason = data.reason === 'ringout' ? '¡RING OUT!' : '¡K.O.!';
            this.showEliminationAnnouncement(data.playerName, reason);
            
            // Play fall animation
            player.playAnimation('fall');
            
            // Start fade out effect
            this.fadeOutPlayer(player);
            
            // Hide HUD for this player after delay
            setTimeout(() => {
                if (this.hud) {
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
        }
    }
    
    /**
     * Show elimination announcement
     */
    showEliminationAnnouncement(playerName, reason) {
        const announcement = document.createElement('div');
        announcement.className = 'elimination-announcement';
        announcement.innerHTML = `
            <div class="elimination-text">${reason}</div>
            <div class="eliminated-name">${playerName}</div>
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
        
        const duration = 1500; // ms
        const startTime = Date.now();
        
        const fadeOut = () => {
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
        console.log('[Arena] Game Over:', data);
        this.gameState = 'finished';
        
        // Show winner announcement
        if (data.winner) {
            this.showRoundAnnouncement(`¡${data.winner.name} GANA!`);
        } else {
            this.showRoundAnnouncement('¡EMPATE!');
        }
        
        // Play victory music
        if (this.bgmManager) {
            this.bgmManager.playVictory?.();
        }
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
            } else {
                player.playAnimation('idle');
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
            // Release grab state
            grabber.controller.isGrabbing = false;
            grabber.controller.grabbedPlayer = null;
            grabber.grabbedEntity = null;
            victim.controller.isGrabbed = false;
            victim.controller.grabbedBy = null;
            victim.isBeingCarried = false;
            
            // Reset victim's rotation to normal (was laying flat)
            victim.model.rotation.x = 0;
            victim.model.rotation.z = 0;
            victim.controller.position.y = grabber.controller.position.y; // Back to ground level
            victim.model.position.copy(victim.controller.position);
            
            // Play UPPERCUT animation on escaping player (fast!)
            victim.playAnimation('punch');
            if (victim.animController) {
                const punchAction = victim.animController.mixer?.clipAction(
                    victim.animController.animations['punch']
                );
                if (punchAction) {
                    punchAction.timeScale = 2.0; // Double speed for dramatic effect
                }
            }
            
            // Play KNOCKDOWN animation on grabber (fast!)
            grabber.playAnimation('fall');
            if (grabber.animController) {
                const fallAction = grabber.animController.mixer?.clipAction(
                    grabber.animController.animations['fall']
                );
                if (fallAction) {
                    fallAction.timeScale = 1.5; // Faster fall
                }
            }
            
            // Show status
            if (this.hud) {
                this.hud.showStatus(data.targetId, '¡ESCAPÓ CON GOLPE!');
                this.hud.showStatus(data.grabberId, '¡DERRIBADO!');
            }
            
            // Screen shake for dramatic effect
            this.shakeScreen(0.4, 300);
            
            // Create VFX
            if (this.vfxManager) {
                const pos = grabber.model.position.clone();
                this.vfxManager.createHitSparks?.(pos, 0xff3366, 2);
                this.vfxManager.createImpactRing?.(pos);
            }
            
            // Return both players to idle after animations
            setTimeout(() => {
                if (victim && !victim.controller.isEliminated) {
                    victim.playAnimation('idle');
                }
                if (grabber && !grabber.controller.isEliminated) {
                    grabber.playAnimation('idle');
                }
            }, 800); // After escape animations complete
            
            // Play punch sound
            if (this.sfxManager) {
                this.sfxManager.playPunch?.();
            }
        }
    }
    
    async addPlayer(playerData, index = 0) {
        if (this.players.has(playerData.id)) return;
        
        const characterId = playerData.character || 'edgar';
        let playerModel = this.characterModelCache[characterId];
        
        if (!playerModel) {
            const loader = new FBXLoader();
            const config = CHARACTER_MODELS[characterId];
            playerModel = await this.loadFBX(loader, `assets/${config.file}`);
            this.characterModelCache[characterId] = playerModel;
        }
        
        const player = new ArenaPlayerEntity(
            playerData.id,
            playerData.number,
            playerData.color || PLAYER_COLORS[(playerData.number - 1) % PLAYER_COLORS.length],
            playerModel,
            this.baseAnimations
        );
        
        player.setName(playerData.name || `Player ${playerData.number}`);
        
        // Position players around the ring
        const angle = (index / 4) * Math.PI * 2;
        const radius = ARENA_CONFIG.RING_SIZE / 3;
        player.controller.position.set(
            Math.cos(angle) * radius,
            ARENA_CONFIG.RING_HEIGHT,
            Math.sin(angle) * radius
        );
        
        this.scene.add(player.model);
        this.players.set(playerData.id, player);
        
        if (this.hud) {
            this.hud.addPlayer(player);
        }
    }
    
    removePlayer(playerId) {
        const player = this.players.get(playerId);
        if (player) {
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
                
                // Skip collision if one is grabbing the other
                if (p1.isGrabbing && p1.grabbedPlayer === p2) continue;
                if (p2.isGrabbing && p2.grabbedPlayer === p1) continue;
                if (p1.isGrabbed && p1.grabbedBy === p2) continue;
                if (p2.isGrabbed && p2.grabbedBy === p1) continue;
                
                // Skip collision if either is being carried
                if (playerArray[i].isBeingCarried || playerArray[j].isBeingCarried) continue;
                
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
    
    checkRingBoundaries() {
        const ringHalf = ARENA_CONFIG.RING_SIZE / 2 - 0.8; // Rope boundary
        const ringBounce = 0.3; // Bounce back force when hitting ropes
        
        this.players.forEach(player => {
            const pos = player.controller.position;
            const vel = player.controller.velocity;
            
            // Check and enforce rope boundaries (can't go through ropes)
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
        
        // Update all players
        this.players.forEach(player => {
            player.update(delta);
            
            // Update thrown player effects
            this.updateThrownPlayer(player, delta);
            
            if (this.hud) {
                this.hud.updatePlayer(player);
            }
        });
        
        // Update grabbed player positions (make them follow their grabber)
        this.updateGrabbedPlayerPositions();
        
        // Check collisions
        this.checkPlayerCollisions();
        this.checkRingBoundaries();
        
        // Update VFX
        if (this.vfxManager) {
            this.vfxManager.update(delta);
        }
        
        // Update camera to follow action
        this.updateCamera();
        
        this.renderer.render(this.scene, this.camera);
        
        // Render floating name labels
        if (this.labelRenderer) {
            this.labelRenderer.render(this.scene, this.camera);
        }
    }
    
    /**
     * Update thrown player - spin effect and landing recovery
     */
    updateThrownPlayer(player, delta) {
        if (!player.isBeingThrown) return;
        
        // Apply spinning effect while in air
        if (player.throwSpin && player.throwSpin.active) {
            player.model.rotation.x += player.throwSpin.speed * delta;
        }
        
        // Check if player landed (Y position back to ground level)
        const groundLevel = ARENA_CONFIG.RING_HEIGHT || 0.5;
        if (player.controller.position.y <= groundLevel + 0.1) {
            // Player landed!
            player.isBeingThrown = false;
            
            if (player.throwSpin) {
                player.throwSpin.active = false;
            }
            
            // Reset rotation
            player.model.rotation.x = 0;
            player.model.rotation.z = 0;
            
            // Play landing effect
            if (this.vfxManager && player.model) {
                const pos = player.model.position.clone();
                this.vfxManager.createDustCloud?.(pos, 1.5);
                this.vfxManager.createImpactRing?.(pos);
            }
            
            // Play landing sound
            if (this.sfxManager) {
                this.sfxManager.playLand?.();
            }
            
            // After a short delay, return to idle animation (if not eliminated)
            if (!player.controller.isEliminated) {
                setTimeout(() => {
                    if (!player.controller.isEliminated && !player.controller.isStunned) {
                        player.playAnimation('idle');
                    }
                }, 500);
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
        
        // Camera configuration for Arena
        const ARENA_CAMERA = {
            MIN_HEIGHT: 10,    // Closer minimum height
            MAX_HEIGHT: 22,    // Closer maximum height
            PADDING: 2,        // Less padding for tighter framing
            POSITION_LERP: 0.06,
            ZOOM_LERP: 0.04,
            ANGLE: ARENA_CONFIG.CAMERA_ANGLE,
            FOV: 50            // Wider FOV for better view
        };
        
        // Calculate bounding box of all players
        let minX = Infinity, maxX = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        
        this.players.forEach(player => {
            const px = player.controller.position.x;
            const pz = player.controller.position.z;
            
            minX = Math.min(minX, px);
            maxX = Math.max(maxX, px);
            minZ = Math.min(minZ, pz);
            maxZ = Math.max(maxZ, pz);
        });
        
        // Add padding to bounds
        minX -= ARENA_CAMERA.PADDING;
        maxX += ARENA_CAMERA.PADDING;
        minZ -= ARENA_CAMERA.PADDING;
        maxZ += ARENA_CAMERA.PADDING;
        
        // Calculate center of bounding box
        const centerX = (minX + maxX) / 2;
        const centerZ = (minZ + maxZ) / 2;
        
        // Calculate required dimensions
        const spreadX = maxX - minX;
        const spreadZ = maxZ - minZ;
        const maxSpread = Math.max(spreadX, spreadZ);
        
        // Calculate required height based on spread and FOV
        const fovRad = THREE.MathUtils.degToRad(ARENA_CAMERA.FOV);
        const aspectRatio = window.innerWidth / window.innerHeight;
        
        // Distance needed to fit the spread (considering the camera angle)
        const viewDistance = (maxSpread / 2) / Math.tan(fovRad / 2);
        let targetHeight = viewDistance * Math.cos(ARENA_CAMERA.ANGLE);
        
        // Clamp height to min/max
        targetHeight = THREE.MathUtils.clamp(targetHeight, ARENA_CAMERA.MIN_HEIGHT, ARENA_CAMERA.MAX_HEIGHT);
        
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

