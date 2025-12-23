/**
 * ARENA DE PELUCHES - Wrestling Ring Game Mode
 * Three.js based arena fighting game with top-down perspective
 * Features: Health system, Stamina, Grabs, Ring-out mechanics
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { SERVER_URL, CONFIG } from '../config.js';
import { AnimationController, ANIMATION_CONFIG } from '../animation/AnimationController.js';
import ArenaPlayerController from './ArenaPlayerController.js';
import ArenaHUD from './ArenaHUD.js';

// =================================
// Configuration
// =================================

const ARENA_CONFIG = {
    // Ring dimensions
    RING_SIZE: 12,          // Width/depth of the ring
    RING_HEIGHT: 0.5,       // Height of the ring platform
    ROPE_HEIGHT: 1.2,       // Height of the ropes
    RING_OUT_ZONE: 2,       // Distance outside ring before considered "out"
    
    // Physics
    GRAVITY: -30,
    MOVE_SPEED: 5,
    RUN_SPEED: 8,
    
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
    
    // Camera
    CAMERA_HEIGHT: 18,
    CAMERA_ANGLE: Math.PI / 3, // 60 degrees from vertical
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
    taunt: 'Meshy_AI_Animation_Hip_Hop_Dance_withSkin.fbx'
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
        
        // Animation controller
        this.animController = new AnimationController(this.model, baseAnimations);
        
        // Arena-specific controller (360 movement)
        this.controller = new ArenaPlayerController(id, number, color);
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
            default: this.animController.play(actionName);
        }
    }
    
    update(delta) {
        // Update controller physics
        this.controller.update(delta);
        
        // Update model position
        this.model.position.copy(this.controller.position);
        
        // Update model rotation to face movement direction
        if (this.controller.movementDirection.length() > 0.1) {
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
        this.clock = new THREE.Clock();
        
        // Players
        this.players = new Map();
        this.localPlayer = null;
        
        // Base assets
        this.baseModel = null;
        this.baseAnimations = {};
        this.characterModelCache = {};
        
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
    
    setupLights() {
        // Ambient light
        const ambient = new THREE.AmbientLight(0x404060, 0.6);
        this.scene.add(ambient);
        
        // Main spotlight (arena style)
        const mainLight = new THREE.SpotLight(0xffffff, 2, 50, Math.PI / 4, 0.5);
        mainLight.position.set(0, 20, 0);
        mainLight.castShadow = true;
        mainLight.shadow.mapSize.width = 2048;
        mainLight.shadow.mapSize.height = 2048;
        this.scene.add(mainLight);
        
        // Corner spotlights (colored)
        const cornerColors = [0xff3366, 0x00ffcc, 0xffcc00, 0x9966ff];
        const corners = [
            [-ARENA_CONFIG.RING_SIZE/2, -ARENA_CONFIG.RING_SIZE/2],
            [ARENA_CONFIG.RING_SIZE/2, -ARENA_CONFIG.RING_SIZE/2],
            [-ARENA_CONFIG.RING_SIZE/2, ARENA_CONFIG.RING_SIZE/2],
            [ARENA_CONFIG.RING_SIZE/2, ARENA_CONFIG.RING_SIZE/2]
        ];
        
        corners.forEach((corner, i) => {
            const light = new THREE.PointLight(cornerColors[i], 0.8, 15);
            light.position.set(corner[0], 8, corner[1]);
            this.scene.add(light);
        });
        
        // Rim lights for drama
        const rimLight1 = new THREE.DirectionalLight(0xff3366, 0.5);
        rimLight1.position.set(-10, 5, -10);
        this.scene.add(rimLight1);
        
        const rimLight2 = new THREE.DirectionalLight(0x00ffcc, 0.5);
        rimLight2.position.set(10, 5, 10);
        this.scene.add(rimLight2);
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
            this.socket.emit('create-room', { gameMode: 'arena' }, (response) => {
                if (response.success) {
                    this.roomCode = response.roomCode;
                    console.log(`[Socket] Arena room created: ${this.roomCode}`);
                    this.updateAnimationDisplay(`Sala: ${this.roomCode} - Esperando jugadores...`);
                    this.showRoomCode(this.roomCode);
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
        
        player.name = playerData.name || `Player ${playerData.number}`;
        
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
    }
    
    checkPlayerCollisions() {
        const playerArray = Array.from(this.players.values());
        const COLLISION_RADIUS = 0.8;
        
        for (let i = 0; i < playerArray.length; i++) {
            for (let j = i + 1; j < playerArray.length; j++) {
                const p1 = playerArray[i].controller;
                const p2 = playerArray[j].controller;
                
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
        const ringHalf = ARENA_CONFIG.RING_SIZE / 2 - 0.5;
        
        this.players.forEach(player => {
            const pos = player.controller.position;
            
            // Check if outside ring
            if (Math.abs(pos.x) > ringHalf || Math.abs(pos.z) > ringHalf) {
                // Player is near/at edge - could implement ring-out here
                player.controller.isNearEdge = true;
            } else {
                player.controller.isNearEdge = false;
            }
            
            // Clamp to max arena bounds (outside ring but not infinite)
            const maxBound = ARENA_CONFIG.RING_SIZE / 2 + ARENA_CONFIG.RING_OUT_ZONE;
            pos.x = THREE.MathUtils.clamp(pos.x, -maxBound, maxBound);
            pos.z = THREE.MathUtils.clamp(pos.z, -maxBound, maxBound);
        });
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());
        
        const delta = this.clock.getDelta();
        
        // Update all players
        this.players.forEach(player => {
            player.update(delta);
            
            if (this.hud) {
                this.hud.updatePlayer(player);
            }
        });
        
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
    }
    
    updateCamera() {
        if (this.players.size === 0) return;
        
        // Calculate center of all players
        let centerX = 0, centerZ = 0;
        this.players.forEach(player => {
            centerX += player.controller.position.x;
            centerZ += player.controller.position.z;
        });
        centerX /= this.players.size;
        centerZ /= this.players.size;
        
        // Smoothly move camera to follow action
        const targetX = centerX * 0.5;
        const targetZ = centerZ * 0.5 + ARENA_CONFIG.CAMERA_HEIGHT * Math.sin(ARENA_CONFIG.CAMERA_ANGLE);
        
        this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, targetX, 0.05);
        this.camera.position.z = THREE.MathUtils.lerp(this.camera.position.z, targetZ, 0.05);
        
        this.camera.lookAt(centerX * 0.3, 0, centerZ * 0.3);
    }
}

// Initialize game when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.arenaGame = new ArenaGame();
});

