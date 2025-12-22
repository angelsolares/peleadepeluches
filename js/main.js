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
    JUMP_FORCE: 12,
    GROUND_Y: 0,
    // 2D Stage boundaries (Smash Bros style)
    STAGE_LEFT: -6,
    STAGE_RIGHT: 6
};

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
            run: false
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
        
        // Don't process movement during attack
        if (this.isAttacking) {
            if (!this.isGrounded) {
                this.velocity.y += PHYSICS.GRAVITY * delta;
                this.position.y += this.velocity.y * delta;
                
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
        
        // Update position
        this.position.x += this.velocity.x * delta;
        this.position.y += this.velocity.y * delta;
        
        // Ground collision
        if (this.position.y <= PHYSICS.GROUND_Y) {
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
        this.model.scale.set(0.01, 0.01, 0.01);
        
        // Rotate model to face RIGHT by default (profile view for side-scroller)
        this.model.rotation.y = -Math.PI / 2;
        
        // Apply color tint to materials
        this.applyColorTint(color);
        
        // Create shared AnimationController (handles mixer, actions, and transitions)
        this.animController = new AnimationController(this.model, baseAnimations);
        
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
                
                // Apply emissive color for subtle tint
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(mat => {
                    if (mat.emissive) {
                        mat.emissive = tintColor;
                        mat.emissiveIntensity = 0.1;
                    }
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
        
        // Rotate model based on facing direction (profile view for side-scroller)
        // -PI/2 = facing right, +PI/2 = facing left
        const targetRotationY = this.controller.facingRight ? -Math.PI / 2 : Math.PI / 2;
        this.model.rotation.y = THREE.MathUtils.lerp(this.model.rotation.y, targetRotationY, 0.2);
        
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
    punch: 'Meshy_AI_Animation_Boxing_Guard_Prep_Straight_Punch_withSkin.fbx',
    kick: 'Meshy_AI_Animation_Boxing_Guard_Right_Straight_Kick_withSkin.fbx',
    hit: 'Meshy_AI_Animation_Hit_Reaction_1_withSkin.fbx',
    fall: 'Meshy_AI_Animation_Shot_and_Slow_Fall_Backward_withSkin.fbx'
};

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

function createArena() {
    // === SIDE-VIEW PLATFORM STAGE (Smash Bros style) ===
    
    // Background plane (far back)
    const bgGeometry = new THREE.PlaneGeometry(40, 20);
    const bgMaterial = new THREE.MeshBasicMaterial({
        color: 0x0a0a15,
        side: THREE.DoubleSide
    });
    const background = new THREE.Mesh(bgGeometry, bgMaterial);
    background.position.set(0, 5, -8);
    scene.add(background);
    
    // Main platform
    const platformWidth = 14;
    const platformDepth = 4;
    const platformHeight = 0.4;
    
    const platformGeometry = new THREE.BoxGeometry(platformWidth, platformHeight, platformDepth);
    const platformMaterial = new THREE.MeshStandardMaterial({
        color: 0x2a2a4a,
        metalness: 0.4,
        roughness: 0.6
    });
    const platform = new THREE.Mesh(platformGeometry, platformMaterial);
    platform.position.set(0, -platformHeight / 2, 0);
    platform.receiveShadow = true;
    scene.add(platform);
    
    // Platform edge glow (left)
    const edgeGeometry = new THREE.BoxGeometry(0.15, platformHeight + 0.1, platformDepth);
    const leftEdgeMaterial = new THREE.MeshBasicMaterial({
        color: 0xff3366,
        transparent: true,
        opacity: 0.8
    });
    const leftEdge = new THREE.Mesh(edgeGeometry, leftEdgeMaterial);
    leftEdge.position.set(-platformWidth / 2, -platformHeight / 2, 0);
    scene.add(leftEdge);
    
    // Platform edge glow (right)
    const rightEdgeMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ffcc,
        transparent: true,
        opacity: 0.8
    });
    const rightEdge = new THREE.Mesh(edgeGeometry, rightEdgeMaterial);
    rightEdge.position.set(platformWidth / 2, -platformHeight / 2, 0);
    scene.add(rightEdge);
    
    // Platform top line (center indicator)
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
    
    // Grid on platform surface
    const gridGeometry = new THREE.PlaneGeometry(platformWidth - 0.5, platformDepth - 0.5);
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
    leftPillar.position.set(-platformWidth / 2 - 1, 1.5, -1);
    leftPillar.castShadow = true;
    scene.add(leftPillar);
    
    // Right pillar
    const rightPillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
    rightPillar.position.set(platformWidth / 2 + 1, 1.5, -1);
    rightPillar.castShadow = true;
    scene.add(rightPillar);
    
    // Pillar glow tops
    const glowGeometry = new THREE.SphereGeometry(0.2, 16, 16);
    const leftGlow = new THREE.Mesh(glowGeometry, new THREE.MeshBasicMaterial({ color: 0xff3366 }));
    leftGlow.position.set(-platformWidth / 2 - 1, 3.2, -1);
    scene.add(leftGlow);
    
    const rightGlow = new THREE.Mesh(glowGeometry, new THREE.MeshBasicMaterial({ color: 0x00ffcc }));
    rightGlow.position.set(platformWidth / 2 + 1, 3.2, -1);
    scene.add(rightGlow);
}

// =================================
// Character & Animation Loading
// =================================

async function loadCharacterWithAnimations() {
    const loader = new FBXLoader();
    const totalFiles = Object.keys(ANIMATION_FILES).length;
    let loadedCount = 0;
    
    try {
        updateLoadingProgress(0, 'Cargando modelo base...');
        
        // Load base model
        baseModel = await loadFBX(loader, `assets/${ANIMATION_FILES.walk}`);
        
        // Store walk animation
        if (baseModel.animations && baseModel.animations.length > 0) {
            console.log('=== ANIMACIONES CARGADAS ===');
            console.log(`Base model (walk): ${baseModel.animations[0].name}`);
            baseAnimations.walk = baseModel.animations[0];
            loadedCount++;
        }
        
        // Load remaining animations
        for (const [actionName, fileName] of Object.entries(ANIMATION_FILES)) {
            if (actionName === 'walk') continue;
            
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
    if (playerData.position) {
        player.controller.position.set(
            playerData.position.x,
            playerData.position.y,
            playerData.position.z
        );
    } else {
        // Spread players out
        const xPos = (playerData.number - 2.5) * 2;
        player.controller.position.set(xPos, 0, 0);
    }
    
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
    socket.on('attack-performed', handleAttack);
    socket.on('player-ko', handlePlayerKO);
    socket.on('game-over', handleGameOver);
    socket.on('game-reset', handleGameReset);
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
    
    // Add all players from server
    data.players.forEach(playerData => {
        addPlayer(playerData);
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
            player.controller.applyServerState(state);
        }
    });
}

function handleAttack(data) {
    console.log('[Game] Attack:', data);
    
    // Show hit animations and effects
    data.hits.forEach(hit => {
        const player = players.get(hit.targetId);
        if (player) {
            player.playAnimation('hit');
            player.controller.health = hit.newHealth;
            
            // Apply knockback
            if (hit.knockback) {
                player.controller.velocity.x = hit.knockback.x;
                player.controller.velocity.y = hit.knockback.y;
            }
            
            // Trigger visual effects
            triggerHitEffect(hit.targetId);
            updatePlayerHUD(player);
        }
    });
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
        
        const gameKeys = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's', ' ', 'j', 'k', 'shift'];
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
                }
                break;
            case 'k':
                if (!localPlayer.animController.isAttacking && localPlayer.controller.kick()) {
                    localPlayer.playAnimation('kick');
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
        <div class="player-damage low" style="color: ${player.color};">0%</div>
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
    const hud = document.getElementById(`hud-${playerId}`);
    if (hud) {
        hud.classList.add('ko');
        setTimeout(() => hud.classList.remove('ko'), 1500);
    }
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
